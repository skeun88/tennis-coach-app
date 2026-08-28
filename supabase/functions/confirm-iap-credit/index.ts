import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 인앱 상품 ID → 충전 금액(원) 매핑 (lib/revenueCat.ts와 동일하게 유지)
const PRODUCT_CREDIT_MAP: Record<string, number> = {
  kerri_member_credits_10k: 10000,
  kerri_member_credits_20k: 20000,
  kerri_member_credits_30k: 30000,
  kerri_member_credits_50k: 50000,
  // 소비형 단건 충전권
  kerri_credit_4900: 4900,
  kerri_credit_10000: 10000,
  kerri_credit_20000: 20000,
  kerri_credit_30000: 30000,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { productId, transactionId } = await req.json();

    const creditAmount = PRODUCT_CREDIT_MAP[productId];
    if (!creditAmount) throw new Error(`알 수 없는 상품 ID: ${productId}`);
    if (!transactionId) throw new Error('transactionId 누락');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 유저 인증
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error('인증 실패');

    // 회원 row 조회 (auth_user_id 우선, 없으면 이메일 fallback)
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

    // 크레딧 충전 (RPC 내부에서 중복 방지 처리)
    const { data: balance, error: chargeError } = await supabase.rpc(
      'charge_member_report_credit',
      {
        p_member_id: memberId,
        p_amount: creditAmount,
        p_iap_transaction_id: transactionId,
      },
    );
    if (chargeError) throw new Error(chargeError.message);

    return new Response(
      JSON.stringify({ success: true, balance }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
