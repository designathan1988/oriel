// Stripe para as funções do Oriel (Deno). Segredos (Edge Function Secrets, https://supabase.com/docs/guides/functions/secrets):
// STRIPE_API_KEY, STRIPE_WEBHOOK_SIGNING_SECRET, STRIPE_PRICE_PRO_MONTH, STRIPE_PRICE_PRO_YEAR,
// opcionais STRIPE_PIX ("1" quando o Pix estiver ativo na conta) e APP_URL (endereço do app, para voltar do pagamento).
import Stripe from 'npm:stripe@^22';

export const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY') as string);

export const PRICES: Record<string, { price: string | undefined; schedule: 'monthly' | 'yearly' }> = {
  month: { price: Deno.env.get('STRIPE_PRICE_PRO_MONTH'), schedule: 'monthly' },
  year: { price: Deno.env.get('STRIPE_PRICE_PRO_YEAR'), schedule: 'yearly' },
};

/** Para onde o Stripe devolve a pessoa: o endereço do app configurado, ou a página que chamou. */
export function appUrl(req: Request, asked?: unknown): string {
  const conf = Deno.env.get('APP_URL');
  const origin = req.headers.get('origin');
  const want = typeof asked === 'string' ? asked : '';
  // Só um endereço do próprio app (o configurado ou a origem do pedido): nunca um site qualquer.
  const base = conf || origin || '';
  if (want && base && want.startsWith(base)) return want;
  return base || want;
}

/** O cliente do Stripe desta pessoa: o guardado, ou um novo (e guardado) com o e-mail dela. */
// deno-lint-ignore no-explicit-any
export async function customerFor(admin: any, userId: string, email: string | undefined): Promise<string> {
  const { data } = await admin.from('customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (data?.stripe_customer_id) return data.stripe_customer_id as string;
  const c = await stripe.customers.create({ email, metadata: { user_id: userId } }, { idempotencyKey: `oriel-customer-${userId}` });
  const { error } = await admin.from('customers').upsert({ user_id: userId, stripe_customer_id: c.id }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return c.id;
}
