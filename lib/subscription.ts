import { supabase } from './supabase';

export type PlanId = 'basic' | 'pro';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'blocked';

export interface PlanFeatures {
  member_management: boolean;
  ai_analysis: boolean;
  reports: boolean;
  profile: boolean;
  tagging: boolean;
}

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  price: number;
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

export const PLANS: Record<PlanId, SubscriptionPlan> = {
  basic: {
    id: 'basic',
    name: 'Basic',
    price: 29000,
    features: {
      member_management: true,
      ai_analysis: false,
      reports: false,
      profile: false,
      tagging: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 49000,
    features: {
      member_management: true,
      ai_analysis: true,
      reports: true,
      profile: true,
      tagging: true,
    },
  },
};

export const PLAN_FEATURES_LABELS: Record<keyof PlanFeatures, string> = {
  member_management: '회원 운영 관리',
  ai_analysis: 'AI 음성 분석',
  reports: '리포트 생성 및 회원 제공',
  profile: '프로필 관리',
  tagging: '레슨 스타일/기술 데이터 태깅',
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

/** 구독이 활성 상태인지 (trial 또는 active) */
export function isSubscriptionActive(subscription: Subscription | null): boolean {
  if (!subscription) return false;
  return subscription.status === 'trial' || subscription.status === 'active';
}

/** Trial 남은 일수 */
export function getTrialDaysLeft(subscription: Subscription): number {
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

  // 이미 구독이 있으면 업데이트 (upsert)
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

  // 로그 기록 (실패해도 구독은 성공으로 처리)
  await supabase.from('subscription_logs').insert({
    subscription_id: data.id,
    coach_id: coachId,
    event_type: 'trial_started',
    plan_id: planId,
  }).catch(e => console.warn('Log insert failed:', e));

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

/** 구독 없이 회원 추가 가능한지 체크 (2명까지는 무료) */
export const FREE_MEMBER_LIMIT = 2;

export async function canAddMemberWithoutSubscription(coachId: string): Promise<boolean> {
  const count = await getMemberCount(coachId);
  return count < FREE_MEMBER_LIMIT;
}
