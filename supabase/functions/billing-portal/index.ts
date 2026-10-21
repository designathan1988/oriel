// Gerenciar a assinatura (trocar cartão ou Pix, ver faturas, cancelar): o portal do cliente do Stripe.
// https://docs.stripe.com/api/customer_portal/sessions/create
import { withSupabase } from 'npm:@supabase/server@^1';
import { appUrl, stripe } from '../_shared/stripe.ts';

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    try {
      const body = (await req.json().catch(() => ({}))) as { returnUrl?: string };
      const { data } = await ctx.supabaseAdmin.from('customers').select('stripe_customer_id').eq('user_id', ctx.userClaims!.id).maybeSingle();
      if (!data?.stripe_customer_id) return Response.json({ error: 'no_customer' }, { status: 404 });
      const s = await stripe.billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: appUrl(req, body.returnUrl), locale: 'pt-BR' });
      return Response.json({ url: s.url });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }),
};
