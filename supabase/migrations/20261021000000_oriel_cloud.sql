-- Oriel na nuvem: assinaturas (escritas só pelo webhook do Stripe), projetos e versões por usuário.
-- Cada usuário só vê e muda o que é seu (Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security).
-- O texto dos projetos fica no Storage (bucket privado "projects", pasta = id do usuário); aqui ficam os dados para listar.

-- ── Clientes e assinaturas do Stripe ──
create table public.customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique
);

create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_subscription_id text not null unique,
  status text not null,
  price_id text,
  plan text not null default 'pro',
  billing_interval text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.customers enable row level security;
alter table public.subscriptions enable row level security;
-- Só leitura para o próprio usuário; quem escreve é a função do webhook com a chave secreta (ignora RLS).
create policy "own customer" on public.customers for select to authenticated using ((select auth.uid()) = user_id);
create policy "own subscription" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

-- O plano em vigor: 'pro' com assinatura ativa, em teste ou com pagamento atrasado (o Stripe ainda tenta cobrar).
create or replace function public.oriel_plan(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'pro' from public.subscriptions s
      where s.user_id = uid and s.status in ('active', 'trialing', 'past_due')
        and (s.current_period_end is null or s.current_period_end > now() - interval '3 days')),
    'free')
$$;

-- ── Projetos ──
create table public.projects (
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name text not null default '',
  buildings integer not null default 0,
  bytes integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.project_versions (
  vid bigint generated always as identity primary key,
  owner uuid not null default auth.uid(),
  project_id text not null,
  label text not null default '',
  auto boolean not null default false,
  bytes integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (owner, project_id) references public.projects (owner, id) on delete cascade
);
create index project_versions_by_project on public.project_versions (owner, project_id, created_at desc);

alter table public.projects enable row level security;
alter table public.project_versions enable row level security;

create policy "own projects: read" on public.projects for select to authenticated using ((select auth.uid()) = owner);
create policy "own projects: add" on public.projects for insert to authenticated with check ((select auth.uid()) = owner);
create policy "own projects: change" on public.projects for update to authenticated using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "own projects: delete" on public.projects for delete to authenticated using ((select auth.uid()) = owner);

create policy "own versions: read" on public.project_versions for select to authenticated using ((select auth.uid()) = owner);
create policy "own versions: add" on public.project_versions for insert to authenticated with check ((select auth.uid()) = owner);
create policy "own versions: change" on public.project_versions for update to authenticated using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "own versions: delete" on public.project_versions for delete to authenticated using ((select auth.uid()) = owner);

-- Limites do plano grátis, garantidos no banco (o app avisa antes; isto vale mesmo contra um cliente alterado).
create or replace function public.oriel_project_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Um upsert de um projeto que já existe também passa por aqui (before insert): esse não conta como novo.
  if public.oriel_plan(new.owner) = 'free'
     and not exists (select 1 from public.projects p where p.owner = new.owner and p.id = new.id)
     and (select count(*) from public.projects p where p.owner = new.owner) >= 3 then
    raise exception 'oriel_limit_projects' using errcode = 'P0001', hint = 'O plano grátis guarda até 3 projetos na nuvem.';
  end if;
  return new;
end $$;
create trigger projects_limit before insert on public.projects for each row execute function public.oriel_project_limit();

create or replace function public.oriel_version_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap integer := case when public.oriel_plan(new.owner) = 'free' then 10 else 200 end;
begin
  if (select count(*) from public.project_versions v where v.owner = new.owner and v.project_id = new.project_id) >= cap then
    raise exception 'oriel_limit_versions' using errcode = 'P0001', hint = 'Apague versões antigas para guardar outra.';
  end if;
  return new;
end $$;
create trigger versions_limit before insert on public.project_versions for each row execute function public.oriel_version_limit();

-- ── Storage: bucket privado; caminho <usuário>/<projeto>/(current.json | thumb.webp | v/<vid>.json) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('projects', 'projects', false, 52428800, array['application/json', 'image/webp', 'image/png'])
on conflict (id) do nothing;

-- Só na própria pasta, e só para um projeto que já está na tabela (o limite de projetos vale também aqui).
-- objects.name com o nome da tabela: dentro do exists, "name" sozinho seria o nome do projeto.
create policy "projects bucket: read own" on storage.objects for select to authenticated
  using (bucket_id = 'projects' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "projects bucket: add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'projects' and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.projects p where p.owner = (select auth.uid()) and p.id = (storage.foldername(objects.name))[2]));
create policy "projects bucket: change own" on storage.objects for update to authenticated
  using (bucket_id = 'projects' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'projects' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "projects bucket: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'projects' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- O plano de outra pessoa não é da conta de ninguém: o app lê a própria linha em subscriptions.
revoke execute on function public.oriel_plan(uuid) from public, anon, authenticated;
