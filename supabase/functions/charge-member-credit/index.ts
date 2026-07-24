import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { paymentKey, orderId, amount } = await req.json();
    if (!paymentKey || !orderId || !amount) throw new Error('필수 파라미터 누락');

    const secretKey = Deno.env.get('TOSS_SECRET_KEY') ?? 'test_sk_nRQoOaPz8LlvM2EMxaam8y47BMw6';
    const authHeader = 'Basic ' + btoa(secretKey + ':');

    // Toss 결제 확인
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    if (!tossRes.ok) {
      const err = await tossRes.json();
      throw new Error(err.message || '결제 확인 실패');
    }

    // 요청한 유저 인증
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error('인증 실패');

    // 회원 row 찾기 (auth_user_id 우선, 없으면 이메일)
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

    // 크레딧 충전
    const { data: balance, error: chargeError } = await supabase.rpc('charge_member_report_credit', {
      p_member_id: memberId,
      p_amount: amount,
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
