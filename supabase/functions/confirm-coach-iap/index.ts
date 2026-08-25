import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRODUCT_CREDITS_MAP: Record<string, { credits: number; amount: number }> = {
  kerri_ai_10: { credits: 10, amount: 4900 },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { productId, transactionId } = await req.json();

    const product = PRODUCT_CREDITS_MAP[productId];
    if (!product) throw new Error(`알 수 없는 상품 ID: ${productId}`);
    if (!transactionId) throw new Error('transactionId 누락');

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
    if (authError || !user) throw new Error('인증 실패');

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

    // 거래 기록 생성 (pending)
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

    if (txnError || !txn) throw new Error('거래 기록 생성 실패: ' + txnError?.message);

    // 크레딧 적립 + 거래 완료 처리 (RPC 내부에서 status → 'completed' 업데이트)
    const { data: newBalance, error: rpcError } = await supabase.rpc('add_extra_report_credits', {
      p_coach_id: user.id,
      p_credits: product.credits,
      p_transaction_id: txn.id,
    });

    if (rpcError) {
      console.error('[confirm-coach-iap] add_extra_report_credits error:', rpcError);
      throw new Error('크레딧 적립 중 오류가 발생했습니다. 고객센터에 문의해주세요.');
    }

    return new Response(
      JSON.stringify({ success: true, new_balance: newBalance, credits_added: product.credits }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[confirm-coach-iap] error:', err.message);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
