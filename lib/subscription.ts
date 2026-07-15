import { supabase } from './supabase';

export type PlanId = 'free' | 'basic' | 'pro';
export type SubscriptionStatus = 'free' | 'trial' | 'active' | 'past_due' | 'cancelled' | 'blocked';

export interface PlanFeatures {
  // 공통 (Free 포함)
  member_management: boolean;
  schedule: boolean;
  attendance: boolean;
  payment: boolean;
  basic_profile: boolean;
  // Basic+
  operations_management: boolean;  // 미납/만료/이탈/재등록 관리
  member_notifications: boolean;   // 레슨 리마인드, 재등록 알림 등
  ai_analysis: boolean;            // AI 레슨 분석 (Basic: 월5회, Pro: 월100회)
  coaching_stats_collect: boolean; // 4대 지표 데이터 수집 (베이직: 블라인드)
  // Pro only
  ai_coaching_model: boolean;      // AI 코칭 모델 (음성 기반 학습)
  coaching_stats_public: boolean;  // 4대 지표 공개 + KERRI 검증 노출
  tagging: boolean;                // 반복 이슈 태그 / 기술별 패턴 분석
}

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  price: number;          // 얼리버드가
  regularPrice: number;   // 정식가
  memberLimit: number | null; // null = 무제한
  reportMonthlyLimit: number; // 무료 리포트 발송 횟수 (코치 무료분)
  aiAnalysisMonthlyLimit: number; // AI 분석 월 한도 (Free: 3, Basic: 10, Pro: 100)
  features: PlanFeatures;
}

export interface Subscription {
  id: string;
  coach_id: string;
  plan_id: PlanId;
  status: SubscriptionStatus;
  trial_starts_at: string;
  trial_ends_at: string;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  toss_billing_key: string | null;
  toss_customer_key: string | null;
  pending_plan_id: PlanId | null;
  downgrade_at: string | null;
  created_at: string;
  updated_at: string;
}

export const FREE_MEMBER_LIMIT = 3;

export const PLANS: Record<PlanId, SubscriptionPlan> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    regularPrice: 0,
    memberLimit: FREE_MEMBER_LIMIT,
    reportMonthlyLimit: 3,
    aiAnalysisMonthlyLimit: 3,
    features: {
      member_management: true,
      schedule: true,
      attendance: true,
      payment: true,
      basic_profile: true,
      operations_management: false,
      member_notifications: false,
      ai_analysis: true,
      coaching_stats_collect: false,
      ai_coaching_model: false,
      coaching_stats_public: false,
      tagging: false,
    },
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    price: 9900,
    regularPrice: 9900,
    memberLimit: null,
    reportMonthlyLimit: 10,
    aiAnalysisMonthlyLimit: 10,
    features: {
      member_management: true,
      schedule: true,
      attendance: true,
      payment: true,
      basic_profile: true,
      operations_management: true,
      member_notifications: true,
      ai_analysis: true,
      coaching_stats_collect: true, // 수집되지만 블라인드
      ai_coaching_model: false,
      coaching_stats_public: false, // 블라인드 상태
      tagging: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 19000,
    regularPrice: 19000,
    memberLimit: null,
    reportMonthlyLimit: 100,
    aiAnalysisMonthlyLimit: 100,
    features: {
      member_management: true,
      schedule: true,
      attendance: true,
      payment: true,
      basic_profile: true,
      operations_management: true,
      member_notifications: true,
      ai_analysis: true,
      coaching_stats_collect: true,
      ai_coaching_model: true,
      coaching_stats_public: true, // 공개 + KERRI 검증 배지
      tagging: true,
    },
  },
};

export const PLAN_FEATURES_LABELS: Record<keyof PlanFeatures, string> = {
  member_management: '회원 관리',
  schedule: '일간·주간·월간 캘린더',
  attendance: '출석 · 잔여횟수 관리',
  payment: '결제 관리',
  basic_profile: '기본 프로필',
  operations_management: '운영 관리 (미납·이탈·재등록)',
  member_notifications: '회원 알림 (리마인드·재등록)',
  ai_analysis: 'AI 레슨 분석',
  coaching_stats_collect: '코칭 실적 (4대 지표)',
  ai_coaching_model: 'AI 코칭 모델 (음성 기반 학습)',
  coaching_stats_public: '코칭 실적 공개 + KERRI 검증',
  tagging: '코칭 데이터 분석 (태그·패턴·추적)',
};

/** 구독 상태 조회 */
export async function getSubscription(coachId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('coach_id', coachId)
    .single();

  if (error || !data) return null;
  return data as Subscription;
}

/** 기능 접근 권한 체크 */
export function canUseFeature(
  subscription: Subscription | null,
  feature: keyof PlanFeatures
): boolean {
  if (!subscription) return false;
  if (subscription.status === 'blocked' || subscription.status === 'cancelled') return false;
  const plan = PLANS[subscription.plan_id];
  if (!plan) return false;
  return plan.features[feature] === true;
}

/** 구독이 활성 상태인지 (trial 또는 active 또는 free) */
export function isSubscriptionActive(subscription: Subscription | null): boolean {
  if (!subscription) return false;
  return (
    subscription.status === 'trial' ||
    subscription.status === 'active' ||
    subscription.status === 'free'
  );
}

/** Trial 남은 일수 */
export function getTrialDaysLeft(subscription: Subscription): number {
  if (subscription.status !== 'trial') return 0;
  const now = new Date();
  const trialEnd = new Date(subscription.trial_ends_at);
  const diff = trialEnd.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/** 업그레이드 차액 계산 (basic → pro) */
export function calculateUpgradeCost(
  currentPlanId: PlanId,
  newPlanId: PlanId,
  currentPeriodEnd: string | null
): number {
  if (!currentPeriodEnd) return PLANS[newPlanId].price;

  const now = new Date();
  const periodEnd = new Date(currentPeriodEnd);
  const totalMs = 30 * 24 * 60 * 60 * 1000; // 30일
  const remainingMs = Math.max(0, periodEnd.getTime() - now.getTime());
  const remainingRatio = remainingMs / totalMs;

  const currentPrice = PLANS[currentPlanId].price;
  const newPrice = PLANS[newPlanId].price;
  const priceDiff = newPrice - currentPrice;
  const prorated = Math.ceil(priceDiff * remainingRatio);

  return Math.max(0, prorated);
}

/** 현재 코치 구독 조회 */
export async function getCurrentSubscription(): Promise<Subscription | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return getSubscription(user.id);
}

/** 구독 생성 (trial 시작) */
export async function createTrialSubscription(
  coachId: string,
  planId: PlanId,
  billingKey: string,
  customerKey: string
): Promise<{ subscription: Subscription | null; error: string | null }> {
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  const { data, error } = await supabase
    .from('subscriptions')
    .upsert({
      coach_id: coachId,
      plan_id: planId,
      status: 'trial',
      trial_starts_at: new Date().toISOString(),
      trial_ends_at: trialEndsAt.toISOString(),
      next_billing_at: trialEndsAt.toISOString(),
      toss_billing_key: billingKey,
      toss_customer_key: customerKey,
    }, { onConflict: 'coach_id' })
    .select()
    .single();

  if (error) {
    console.error('Failed to create trial subscription:', error);
    return { subscription: null, error: error.message };
  }

  try {
    await supabase.from('subscription_logs').insert({
      subscription_id: data.id,
      coach_id: coachId,
      event_type: 'trial_started',
      plan_id: planId,
    });
  } catch (e) {
    console.warn('Log insert failed:', e);
  }

  return { subscription: data as Subscription, error: null };
}

/** Free 구독 생성 (신규 코치 등록 시) */
export async function createFreeSubscription(
  coachId: string
): Promise<{ subscription: Subscription | null; error: string | null }> {
  const { data, error } = await supabase
    .from('subscriptions')
    .upsert({
      coach_id: coachId,
      plan_id: 'free',
      status: 'free',
      trial_starts_at: new Date().toISOString(),
      trial_ends_at: new Date().toISOString(), // free는 trial 없음
    }, { onConflict: 'coach_id' })
    .select()
    .single();

  if (error) {
    return { subscription: null, error: error.message };
  }

  try {
    await supabase.from('subscription_logs').insert({
      subscription_id: data.id,
      coach_id: coachId,
      event_type: 'free_started',
      plan_id: 'free',
    });
  } catch (e) {
    console.warn('Log insert failed:', e);
  }

  return { subscription: data as Subscription, error: null };
}

/** 코치의 현재 회원 수 조회 */
export async function getMemberCount(coachId: string): Promise<number> {
  const { count } = await supabase
    .from('members')
    .select('*', { count: 'exact', head: true })
    .eq('coach_id', coachId);
  return count ?? 0;
}

/** 구독 없이 회원 추가 가능한지 체크 (Free: 3명까지) */
export async function canAddMemberWithoutSubscription(coachId: string): Promise<boolean> {
  const count = await getMemberCount(coachId);
  return count < FREE_MEMBER_LIMIT;
}

/** 현재 플랜에서 회원 추가 가능한지 체크 */
export async function canAddMember(
  coachId: string,
  subscription: Subscription | null
): Promise<boolean> {
  if (!subscription) {
    const count = await getMemberCount(coachId);
    return count < FREE_MEMBER_LIMIT;
  }

  const plan = PLANS[subscription.plan_id];
  if (plan.memberLimit === null) return true; // 무제한

  const count = await getMemberCount(coachId);
  return count < plan.memberLimit;
}

/** 이번 달 AI 레슨 분석 사용 횟수 조회 */
export async function getAiAnalysisUsageThisMonth(coachId: string): Promise<number> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const { data } = await supabase
    .from('ai_analysis_usage')
    .select('count')
    .eq('coach_id', coachId)
    .eq('year_month', yearMonth)
    .maybeSingle();

  return data?.count ?? 0;
}

/** AI 분석 사용 가능 여부 체크 — 한도 포함 */
export async function checkAiAnalysisLimit(
  coachId: string,
  subscription: Subscription | null
): Promise<{ allowed: boolean; used: number; limit: number; planId: PlanId | null }> {
  if (!subscription || subscription.status === 'blocked' || subscription.status === 'cancelled') {
    return { allowed: false, used: 0, limit: 0, planId: null };
  }

  const plan = PLANS[subscription.plan_id];
  const limit = plan.reportMonthlyLimit;

  if (limit === 0) {
    return { allowed: false, used: 0, limit: 0, planId: subscription.plan_id };
  }

  const used = await getAiAnalysisUsageThisMonth(coachId);
  return { allowed: used < limit, used, limit, planId: subscription.plan_id };
}

/** 리포트 발송 가능 여부 체크 — 코치 무료 한도 + 회원 크레딧 포함 */
export async function checkReportSendLimit(
  coachId: string,
  subscription: Subscription | null
): Promise<{ allowed: boolean; freeUsed: number; freeLimit: number; needsMemberCredit: boolean }> {
  if (!subscription || subscription.status === 'blocked' || subscription.status === 'cancelled') {
    return { allowed: false, freeUsed: 0, freeLimit: 0, needsMemberCredit: false };
  }

  const plan = PLANS[subscription.plan_id];
  const freeLimit = plan.reportMonthlyLimit;
  const freeUsed = await getAiAnalysisUsageThisMonth(coachId);

  if (freeUsed < freeLimit) {
    return { allowed: true, freeUsed, freeLimit, needsMemberCredit: false };
  }

  // 무료 한도 소진 → 회원이 크레딧 보유 시 발송 가능
  return { allowed: true, freeUsed, freeLimit, needsMemberCredit: true };
}

// -------------------------------------------------------
// 충전권
// -------------------------------------------------------

export interface CreditBundle {
  count: number;
  price: number;
  pricePerUnit: number;
  isPopular?: boolean;
}

export const CREDIT_BUNDLES: CreditBundle[] = [
  { count: 10, price: 5000, pricePerUnit: 500 },
  { count: 30, price: 12000, pricePerUnit: 400 },
  { count: 50, price: 15000, pricePerUnit: 300, isPopular: true },
];

// -------------------------------------------------------
// Pro 6개월 선결제
// -------------------------------------------------------

export const PRO_BIANNUAL = {
  price: 99000,
  monthlyEquivalent: 16500,
  discountPct: 13,
  includesRecorder: true,
};

/** AI 분석 1회 사용 기록 (upsert) */
export async function incrementAiAnalysisUsage(coachId: string): Promise<void> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  await supabase.rpc('increment_ai_analysis_usage', {
    p_coach_id: coachId,
    p_year_month: yearMonth,
  });
}
