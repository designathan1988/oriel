// Assinar o Oriel Pro: cria a sessão do Stripe Checkout (página do Stripe: cartão e, se ativo, Pix Automático)
// e devolve o endereço dela. https://docs.stripe.com/billing/subscriptions/pix?api-integration=checkout
import { withSupabase } from 'npm:@supabase/server@^1';
import { appUrl, customerFor, PRICES, stripe } from '../_shared/stripe.ts';

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    try {
      const body = (await req.json().catch(() => ({}))) as { interval?: string; returnUrl?: string };
      const plan = PRICES[body.interval === 'year' ? 'year' : 'month']!;
      if (!plan.price) return Response.json({ error: 'Preço do Stripe não configurado (STRIPE_PRICE_PRO_MONTH / _YEAR).' }, { status: 500 });
      const userId = ctx.userClaims!.id as string;
      const { data: sub } = await ctx.supabaseAdmin.from('subscriptions').select('status').eq('user_id', userId).maybeSingle();
      if (sub && ['active', 'trialing', 'past_due'].includes(sub.status)) return Response.json({ error: 'already_subscribed' }, { status: 409 });
      const customer = await customerFor(ctx.supabaseAdmin, userId, ctx.userClaims?.email as string | undefined);
      const back = appUrl(req, body.returnUrl);
      const sep = back.includes('?') ? '&' : '?';
      const price = await stripe.prices.retrieve(plan.price);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer,
        client_reference_id: userId,
        line_items: [{ price: plan.price, quantity: 1 }],
        subscription_data: { metadata: { user_id: userId } },
        allow_promotion_codes: true,
        locale: 'pt-BR',
        success_url: `${back}${sep}assinatura=ok`,
        cancel_url: `${back}${sep}assinatura=cancelada`,
        // Pix Automático: a pessoa autoriza no app do banco cobranças de até este valor por ciclo.
        ...(Deno.env.get('STRIPE_PIX') === '1' && price.currency === 'brl' && price.unit_amount
          ? { payment_method_options: { pix: { mandate_options: { amount: price.unit_amount, amount_type: 'maximum', payment_schedule: plan.schedule, reference: 'Oriel Pro' } } } }
          : {}),
      });
      return Response.json({ url: session.url });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }),
};
