import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TOSS_SECRET_KEY = Deno.env.get('TOSS_SECRET_KEY') ?? 'test_sk_nRQoOaPz8LlvM2EMxaam8y47BMw6'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const TOPUP_PRODUCTS: Record<string, { credits: number; price: number; name: string }> = {
  '10': { credits: 10, price: 4900, name: 'AI 리포트 +10개' },
  '30': { credits: 30, price: 11900, name: 'AI 리포트 +30개' },
  '50': { credits: 50, price: 17900, name: 'AI 리포트 +50개' },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // JWT에서 coach_id 추출
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: '인증이 필요합니다.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: '인증 실패' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const coachId = user.id
    const { product_id } = await req.json()

    const product = TOPUP_PRODUCTS[product_id]
    if (!product) {
      return new Response(JSON.stringify({ error: '유효하지 않은 상품입니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 코치 구독 조회 (billing key 확인)
    const { data: sub, error: subError } = await supabase
      .from('subscriptions')
      .select('id, toss_billing_key, toss_customer_key, status')
      .eq('coach_id', coachId)
      .single()

    if (subError || !sub) {
      return new Response(JSON.stringify({ error: '구독 정보를 찾을 수 없습니다.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!sub.toss_billing_key || !sub.toss_customer_key) {
      return new Response(JSON.stringify({ error: '등록된 결제 수단이 없습니다. 구독 설정에서 카드를 먼저 등록해주세요.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 거래 pending 기록 생성
    const orderId = `topup_${coachId}_${Date.now()}`
    const { data: txn, error: txnError } = await supabase
      .from('report_topup_transactions')
      .insert({
        coach_id: coachId,
        product_id,
        credits_added: product.credits,
        amount: product.price,
        toss_order_id: orderId,
        status: 'pending',
      })
      .select()
      .single()

    if (txnError || !txn) {
      return new Response(JSON.stringify({ error: '거래 기록 생성 실패' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 토스페이먼츠 빌링 결제
    const tossRes = await fetch(`https://api.tosspayments.com/v1/billing/${sub.toss_billing_key}`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(TOSS_SECRET_KEY + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerKey: sub.toss_customer_key,
        amount: product.price,
        orderId,
        orderName: product.name,
      }),
    })

    if (!tossRes.ok) {
      const tossErr = await tossRes.json()
      // 결제 실패 → 거래 failed 업데이트
      await supabase
        .from('report_topup_transactions')
        .update({ status: 'failed' })
        .eq('id', txn.id)

      return new Response(JSON.stringify({ error: tossErr.message || '결제에 실패했습니다.' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payment = await tossRes.json()

    // 크레딧 충전 + 거래 완료
    const { data: newBalance, error: rpcError } = await supabase.rpc('add_extra_report_credits', {
      p_coach_id: coachId,
      p_credits: product.credits,
      p_transaction_id: txn.id,
    })

    if (rpcError) {
      console.error('add_extra_report_credits error:', rpcError)
      // 결제는 됐으나 크레딧 추가 실패 — 거래 키 보존해서 후처리 가능하도록
      await supabase
        .from('report_topup_transactions')
        .update({ toss_payment_key: payment.paymentKey })
        .eq('id', txn.id)

      return new Response(JSON.stringify({ error: '크레딧 적립 중 오류가 발생했습니다. 고객센터에 문의해주세요.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // payment key 저장 (이미 completed 상태)
    await supabase
      .from('report_topup_transactions')
      .update({ toss_payment_key: payment.paymentKey })
      .eq('id', txn.id)

    return new Response(JSON.stringify({
      success: true,
      credits_added: product.credits,
      new_balance: newBalance,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('topup-report-credits error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
