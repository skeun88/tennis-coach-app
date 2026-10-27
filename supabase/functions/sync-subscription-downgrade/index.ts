import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// App Store Basic 상품 ID 목록
const BASIC_PRODUCT_IDS = new Set(['kerri_basic_monthly', 'kerri_basic_yearly']);
// App Store Pro 상품 ID 목록
const PRO_PRODUCT_IDS = new Set(['kerri_pro_monthly', 'kerri_pro_yearly']);

interface RcSubscription {
  id: string;
  customer_id: string;
  product_id: string | null;
  status: string;
  store: string;
  environment: string;
  auto_renewal_status: string;
  current_period_ends_at: number | null;
  pending_changes?: {
    product?: {
      id: string;
      store_identifier?: string;
    };
  } | null;
}

interface RcSubscriptionsResponse {
  object: string;
  items: RcSubscription[];
  next_page?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const RC_V2_SECRET_KEY = Deno.env.get('REVENUECAT_V2_SECRET_KEY');
  const RC_PROJECT_ID = Deno.env.get('REVENUECAT_PROJECT_ID');

  if (!RC_V2_SECRET_KEY || !RC_PROJECT_ID) {
    console.error('[sync-subscription-downgrade] RC env vars not set');
    return new Response(
      JSON.stringify({ success: false, error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // 1. JWT에서 사용자 확인 (클라이언트가 전달한 ID 신뢰 안 함)
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // 2. Supabase에서 현재 구독 확인
  const { data: dbSub, error: dbError } = await supabase
    .from('subscriptions')
    .select('plan_id, status, toss_billing_key, pending_plan_id, downgrade_at')
    .eq('coach_id', user.id)
    .single();

  if (dbError || !dbSub) {
    return new Response(
      JSON.stringify({ success: false, error: '구독 정보를 찾을 수 없습니다.' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Toss 구독 사용자는 Apple IAP 다운그레이드 감지 제외
  if (dbSub.toss_billing_key) {
    return new Response(
      JSON.stringify({ success: true, message: 'Toss 구독은 이 엔드포인트에서 처리하지 않습니다.', skipped: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // 3. RC v2 API로 고객 구독 조회 (user.id = RC app_user_id)
  const encodedCustomerId = encodeURIComponent(user.id);
  const rcUrl = `https://api.revenuecat.com/v2/projects/${RC_PROJECT_ID}/customers/${encodedCustomerId}/subscriptions`;

  let rcResponse: Response;
  try {
    rcResponse = await fetch(rcUrl, {
      headers: {
        'Authorization': `Bearer ${RC_V2_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (fetchError) {
    console.error('[sync-subscription-downgrade] RC fetch error:', fetchError);
    // 조회 실패 시 기존 DB 데이터 유지
    return new Response(
      JSON.stringify({
        success: false,
        error: 'RevenueCat API 조회 실패',
        preserved_existing: true,
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (!rcResponse.ok) {
    const errText = await rcResponse.text().catch(() => '');
    console.error('[sync-subscription-downgrade] RC API error:', rcResponse.status, errText.slice(0, 200));
    // 조회 실패 시 기존 DB 데이터 유지 (예약 없음으로 덮어쓰지 않음)
    return new Response(
      JSON.stringify({
        success: false,
        error: `RC API 오류 (${rcResponse.status})`,
        preserved_existing: true,
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const rcData: RcSubscriptionsResponse = await rcResponse.json();

  // 4. Production App Store 구독 중 active인 것만 확인
  const appStoreSubs = rcData.items.filter(
    (s) => s.store === 'app_store' && s.environment === 'production' && s.status === 'active',
  );

  // 5. Pro → Basic 다운그레이드 예약 감지
  const downgradeSub = appStoreSubs.find((s) => {
    const isProProduct = s.product_id ? PRO_PRODUCT_IDS.has(s.product_id) : false;
    const isWillChangeProduct = s.auto_renewal_status === 'will_change_product';
    const pendingProductId = s.pending_changes?.product?.id ?? '';
    const isBasicPending = BASIC_PRODUCT_IDS.has(pendingProductId);
    return isProProduct && isWillChangeProduct && isBasicPending;
  });

  let updatePayload: Record<string, unknown>;

  if (downgradeSub) {
    // 다운그레이드 예약 확인됨
    const downgradeAt = downgradeSub.current_period_ends_at
      ? new Date(downgradeSub.current_period_ends_at).toISOString()
      : null;
    updatePayload = {
      pending_plan_id: 'basic',
      downgrade_at: downgradeAt,
    };
  } else {
    // 예약 없음: 다운그레이드 예약이 취소됐거나 이미 완료된 경우
    // 단, Pro가 active 구독으로 확인되는 경우에만 예약 초기화
    const hasActivePro = appStoreSubs.some(
      (s) => s.product_id ? PRO_PRODUCT_IDS.has(s.product_id) : false,
    );
    if (hasActivePro) {
      updatePayload = {
        pending_plan_id: null,
        downgrade_at: null,
      };
    } else {
      // Pro active 구독 없음 → 기존 데이터 유지 (상태 불명확)
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Pro active 구독 없음. 기존 pending 데이터 유지.',
          preserved_existing: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  }

  // 6. DB 업데이트 (plan_id, status, toss_billing_key 변경 안 함)
  const { error: updateError } = await supabase
    .from('subscriptions')
    .update(updatePayload)
    .eq('coach_id', user.id);

  if (updateError) {
    console.error('[sync-subscription-downgrade] DB update error:', updateError);
    return new Response(
      JSON.stringify({ success: false, error: 'DB 업데이트 실패' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      downgrade_detected: !!downgradeSub,
      pending_plan_id: downgradeSub ? 'basic' : null,
      downgrade_at: downgradeSub?.current_period_ends_at
        ? new Date(downgradeSub.current_period_ends_at).toISOString()
        : null,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
