import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 인앱결제 제품 ID → 크레딧 금액(원) 매핑
const IAP_PRODUCT_CREDIT_MAP: Record<string, number> = {
  'kerri_credit_10000': 10000,
  'kerri_credit_20000': 20000,
  'kerri_credit_30000': 30000,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { source } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 유저 인증 (공통)
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error('인증 실패');

    // 회원 row 찾기 (공통)
    let memberId: string | null = null;
    const { data: byAuth } = await supabase
      .from('members').select('id').eq('auth_user_id', user.id).maybeSingle();
    if (byAuth) {
      memberId = byAuth.id;
    } else if (user.email) {
      const { data: byEmail } = await supabase
        .from('members').select('id').ilike('email', user.email).maybeSingle();
      if (byEmail) {
        memberId = byEmail.id;
        await supabase.from('members').update({ auth_user_id: user.id }).eq('id', byEmail.id);
      }
    }
    if (!memberId) throw new Error('회원 정보를 찾을 수 없습니다.');

    let chargeAmount: number;

    if (source === 'iap') {
      // ── 인앱결제 경로 ──────────────────────────────────────────────
      const { productId, transactionId } = body;
      if (!productId) throw new Error('productId 누락');

      const mapped = IAP_PRODUCT_CREDIT_MAP[productId];
      if (!mapped) throw new Error(`알 수 없는 제품 ID: ${productId}`);

      // 중복 트랜잭션 방지 (transactionId가 있을 경우)
      if (transactionId) {
        const { data: existing } = await supabase
          .from('member_report_credits')
          .select('id')
          .eq('member_id', memberId)
          .contains('iap_transaction_ids', [transactionId])
          .maybeSingle();
        if (existing) throw new Error('이미 처리된 트랜잭션입니다.');

        // 트랜잭션 ID 기록 (배열 컬럼 있으면 저장, 없으면 무시)
        await supabase
          .from('member_report_credits')
          .update({ iap_transaction_ids: supabase.rpc('array_append_unique', { arr_col: 'iap_transaction_ids', val: transactionId }) })
          .eq('member_id', memberId)
          .then(() => {}); // 실패해도 계속 진행 (컬럼 없을 수 있음)
      }

      chargeAmount = mapped;
    } else {
      // ── 토스페이먼츠 경로 (레거시, 하위호환) ──────────────────────
      const { paymentKey, orderId, amount } = body;
      if (!paymentKey || !orderId || !amount) throw new Error('필수 파라미터 누락');

      const secretKey = Deno.env.get('TOSS_SECRET_KEY') ?? 'test_sk_nRQoOaPz8LlvM2EMxaam8y47BMw6';
      const authHeader = 'Basic ' + btoa(secretKey + ':');

      const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentKey, orderId, amount }),
      });

      if (!tossRes.ok) {
        const err = await tossRes.json();
        throw new Error(err.message || '결제 확인 실패');
      }

      chargeAmount = amount;
    }

    // 크레딧 충전 (공통)
    const { data: balance, error: chargeError } = await supabase.rpc('charge_member_report_credit', {
      p_member_id: memberId,
      p_amount: chargeAmount,
    });
    if (chargeError) throw new Error(chargeError.message);

    return new Response(JSON.stringify({ success: true, balance }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
