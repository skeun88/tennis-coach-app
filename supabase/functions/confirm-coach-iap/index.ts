import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRODUCT_CREDITS_MAP: Record<string, { credits: number; amount: number }> = {
  kerri_ai_10: { credits: 10, amount: 4900 },
};

const MSG_PAYMENT_OK_CREDIT_DELAYED = '결제는 완료되었지만 충전 반영이 지연되고 있어요. 잠시 후 다시 확인해 주세요.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { productId, transactionId } = await req.json().catch(() => ({}));

  const product = PRODUCT_CREDITS_MAP[productId];
  if (!product) {
    return new Response(
      JSON.stringify({ success: false, error: '알 수 없는 상품입니다.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  if (!transactionId) {
    return new Response(
      JSON.stringify({ success: false, error: '결제 정보가 올바르지 않습니다.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ success: false, error: '인증이 필요합니다.' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const appleOrderId = `apple_iap_${transactionId}`;

  // 멱등성: 동일 Apple transaction ID 중복 처리 방지
  const { data: existing } = await supabase
    .from('report_topup_transactions')
    .select('id, credits_added')
    .eq('coach_id', user.id)
    .eq('toss_order_id', appleOrderId)
    .eq('status', 'completed')
    .maybeSingle();

  if (existing) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('extra_report_credits')
      .eq('coach_id', user.id)
      .single();
    return new Response(
      JSON.stringify({ success: true, new_balance: sub?.extra_report_credits ?? 0, duplicate: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // 거래 기록 생성 (pending) — 여기까지 오면 Apple 결제는 승인된 상태
  const { data: txn, error: txnError } = await supabase
    .from('report_topup_transactions')
    .insert({
      coach_id: user.id,
      product_id: productId,
      credits_added: product.credits,
      amount: product.amount,
      toss_order_id: appleOrderId,
      status: 'pending',
    })
    .select()
    .single();

  if (txnError || !txn) {
    console.error('[confirm-coach-iap] txn insert error:', txnError);
    return new Response(
      JSON.stringify({ success: false, error: MSG_PAYMENT_OK_CREDIT_DELAYED, retryable: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // 크레딧 적립 + 거래 완료 처리
  const { data: newBalance, error: rpcError } = await supabase.rpc('add_extra_report_credits', {
    p_coach_id: user.id,
    p_credits: product.credits,
    p_transaction_id: txn.id,
  });

  if (rpcError) {
    console.error('[confirm-coach-iap] add_extra_report_credits error:', rpcError);
    return new Response(
      JSON.stringify({ success: false, error: MSG_PAYMENT_OK_CREDIT_DELAYED, retryable: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, new_balance: newBalance, credits_added: product.credits }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
