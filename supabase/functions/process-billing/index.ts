import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TOSS_SECRET_KEY = Deno.env.get('TOSS_SECRET_KEY') ?? 'test_sk_nRQoOaPz8LlvM2EMxaam8y47BMw6';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PLAN_PRICES: Record<string, number> = {
  basic: 29000,
  pro: 49000,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const now = new Date();
  const results: { coachId: string; success: boolean; error?: string }[] = [];

  try {
    // 오늘 결제 필요한 구독 조회
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('*')
      .in('status', ['active', 'trial'])
      .gte('next_billing_at', todayStart.toISOString())
      .lte('next_billing_at', todayEnd.toISOString())
      .not('toss_billing_key', 'is', null);

    if (error) throw error;

    for (const sub of subscriptions ?? []) {
      try {
        const amount = PLAN_PRICES[sub.plan_id] ?? 29000;
        const orderId = `sub_${sub.coach_id}_${Date.now()}`;

        // 토스페이먼츠 정기결제 실행
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
            orderName: `Kerri ${sub.plan_id === 'pro' ? 'Pro' : 'Basic'} 월구독`,
          }),
        });

        if (!tossRes.ok) {
          const err = await tossRes.json();
          throw new Error(err.message || '결제 실패');
        }

        const payment = await tossRes.json();

        // 다음 결제일 계산
        const nextBilling = new Date(now);
        nextBilling.setMonth(nextBilling.getMonth() + 1);

        // 다운그레이드 예약 확인
        const newPlanId = sub.pending_plan_id && sub.downgrade_at &&
          new Date(sub.downgrade_at) <= now
          ? sub.pending_plan_id
          : sub.plan_id;

        // 구독 업데이트
        await supabase.from('subscriptions').update({
          status: 'active',
          plan_id: newPlanId,
          current_period_start: now.toISOString(),
          current_period_end: nextBilling.toISOString(),
          next_billing_at: nextBilling.toISOString(),
          pending_plan_id: null,
          downgrade_at: null,
        }).eq('id', sub.id);

        // 로그 기록
        await supabase.from('subscription_logs').insert({
          subscription_id: sub.id,
          coach_id: sub.coach_id,
          event_type: 'payment_success',
          amount,
          plan_id: newPlanId,
          toss_payment_key: payment.paymentKey,
          toss_order_id: orderId,
        });

        results.push({ coachId: sub.coach_id, success: true });
      } catch (e: any) {
        // 결제 실패 처리
        await supabase.from('subscriptions').update({ status: 'past_due' }).eq('id', sub.id);
        await supabase.from('subscription_logs').insert({
          subscription_id: sub.id,
          coach_id: sub.coach_id,
          event_type: 'payment_failed',
          metadata: { error: e.message },
        });
        results.push({ coachId: sub.coach_id, success: false, error: e.message });
      }
    }

    // Trial 만료된 구독 block 처리
    const { data: expiredTrials } = await supabase
      .from('subscriptions')
      .select('id, coach_id')
      .eq('status', 'trial')
      .lt('trial_ends_at', now.toISOString());

    for (const trial of expiredTrials ?? []) {
      await supabase.from('subscriptions').update({ status: 'blocked' }).eq('id', trial.id);
      await supabase.from('subscription_logs').insert({
        subscription_id: trial.id,
        coach_id: trial.coach_id,
        event_type: 'trial_ended',
      });
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
