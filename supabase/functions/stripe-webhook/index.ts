// Avisos do Stripe sobre as assinaturas: grava em public.subscriptions o estado de cada uma (é o que libera o plano).
// O Stripe assina cada aviso; a função confere a assinatura (por isso verify_jwt = false no config.toml).
// https://supabase.com/docs/guides/functions/examples/stripe-webhooks · https://docs.stripe.com/billing/subscriptions/webhooks
import Stripe from 'npm:stripe@^22';
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { stripe } from '../_shared/stripe.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();
const secretKey = (() => {
  try {
    return (JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>)['default'];
  } catch {
    return undefined;
  }
})() ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const id = (x: string | { id: string } | null | undefined) => (typeof x === 'string' ? x : x?.id ?? null);

async function userFor(sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.user_id) return sub.metadata.user_id;
  const { data } = await admin.from('customers').select('user_id').eq('stripe_customer_id', id(sub.customer)).maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

async function save(sub: Stripe.Subscription, userHint?: string | null): Promise<void> {
  const userId = userHint ?? (await userFor(sub));
  if (!userId) throw new Error(`Subscription ${sub.id} without a user`);
  // Desde a versão 2025-03-31 da API o período fica em cada item da assinatura.
  const item = sub.items.data[0];
  const end = item?.current_period_end;
  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: item?.price.id ?? null,
      plan: 'pro',
      billing_interval: item?.price.recurring?.interval ?? null,
      current_period_end: end ? new Date(end * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end || !!sub.cancel_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(error.message);
  const customer = id(sub.customer);
  if (customer) await admin.from('customers').upsert({ user_id: userId, stripe_customer_id: customer }, { onConflict: 'user_id' });
}

export default {
  fetch: async (req: Request) => {
    const signature = req.headers.get('Stripe-Signature');
    // O texto cru: a assinatura é conferida sobre ele.
    const body = await req.text();
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature!, Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET')!, undefined, cryptoProvider);
    } catch (err) {
      return new Response(err instanceof Error ? err.message : 'bad signature', { status: 400 });
    }
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const s = event.data.object;
          if (s.mode === 'subscription' && s.subscription) await save(await stripe.subscriptions.retrieve(id(s.subscription)!), s.client_reference_id);
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed':
          // Lida de novo no Stripe: os avisos podem chegar fora de ordem, o estado atual é o que vale.
          await save(await stripe.subscriptions.retrieve(event.data.object.id));
          break;
      }
      return Response.json({ received: true });
    } catch (e) {
      // 500: o Stripe tenta de novo mais tarde.
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  },
};
