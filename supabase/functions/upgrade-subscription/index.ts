import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TOSS_SECRET_KEY = Deno.env.get('TOSS_SECRET_KEY') ?? 'test_sk_nRQoOaPz8LlvM2EMxaam8y47BMw6';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { subscriptionId, targetPlanId, amount } = await req.json();

    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();

    if (error || !sub) return new Response(JSON.stringify({ error: '구독 없음' }), { status: 404 });

    if (amount > 0) {
      // 차액 즉시 결제
      const orderId = `upgrade_${sub.coach_id}_${Date.now()}`;
      const tossRes = await fetch(`https://api.tosspayments.com/v1/billing/${sub.toss_billing_key}`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(TOSS_SECRET_KEY + ':')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerKey: sub.toss_customer_key,
          amount,
          orderId,
          orderName: 'Kerri Pro 업그레이드',
        }),
      });

      if (!tossRes.ok) {
        const err = await tossRes.json();
        return new Response(JSON.stringify({ error: err.message }), { status: 400 });
      }

      const payment = await tossRes.json();

      await supabase.from('subscription_logs').insert({
        subscription_id: sub.id,
        coach_id: sub.coach_id,
        event_type: 'upgrade',
        amount,
        plan_id: targetPlanId,
        toss_payment_key: payment.paymentKey,
        toss_order_id: orderId,
      });
    }

    // 플랜 업그레이드
    await supabase.from('subscriptions').update({
      plan_id: targetPlanId,
      pending_plan_id: null,
      downgrade_at: null,
    }).eq('id', subscriptionId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
