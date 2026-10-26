import Purchases, { LOG_LEVEL, PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '';

export const PLAN_PRODUCT_IDS: Record<string, { monthly: string; annual: string }> = {
  basic: { monthly: 'kerri_basic_monthly', annual: 'kerri_basic_yearly' },
  pro: { monthly: 'kerri_pro_monthly', annual: 'kerri_pro_yearly' },
};

// Apple IAP 상품 ID → KRW 결제 금액 매핑 (구독 갱신 로그용)
const PRODUCT_AMOUNT_MAP: Record<string, number> = {
  kerri_basic_monthly: 9900,
  kerri_basic_yearly: 109000,
  kerri_pro_monthly: 19000,
  kerri_pro_yearly: 209000,
};

export const ENTITLEMENT_IDS = {
  BASIC: 'basic',
  PRO: 'pro',
} as const;

export const AI_TOPUP_PRODUCT_ID = 'kerri_ai_10';

export function configurePurchases(): void {
  const apiKey = Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
  if (!apiKey) return;
  Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey });
}

export async function loginPurchases(userId: string): Promise<void> {
  if (!IOS_KEY && !ANDROID_KEY) return;
  try {
    const currentId = await Purchases.getAppUserID();
    if (currentId !== userId) {
      await Purchases.logIn(userId);
    }
  } catch {
    await Purchases.logIn(userId);
  }
}

export async function logoutPurchases(): Promise<void> {
  if (!IOS_KEY && !ANDROID_KEY) return;
  try { await Purchases.logOut(); } catch {}
}

export async function findPackageById(productId: string): Promise<PurchasesPackage | null> {
  const offerings = await Purchases.getOfferings();
  const offering = offerings.current;
  if (!offering) return null;
  return offering.availablePackages.find(p => p.product.identifier === productId) ?? null;
}

export async function purchaseProductById(productId: string) {
  const pkg = await findPackageById(productId);
  if (!pkg) throw new Error(`상품을 찾을 수 없습니다: ${productId}`);
  return Purchases.purchasePackage(pkg);
}

export async function restorePurchases() {
  return Purchases.restorePurchases();
}

export async function getAppUserID(): Promise<string> {
  return Purchases.getAppUserID();
}

export async function getCurrentBillingCycle(planId: 'basic' | 'pro'): Promise<'monthly' | 'annual' | null> {
  try {
    const info = await Purchases.getCustomerInfo();
    const entId = planId === 'pro' ? ENTITLEMENT_IDS.PRO : ENTITLEMENT_IDS.BASIC;
    const productId = info.entitlements.active[entId]?.productIdentifier ?? '';
    if (!productId) return null;
    const isAnnual = Object.values(PLAN_PRODUCT_IDS).some(p => p.annual === productId);
    return isAnnual ? 'annual' : 'monthly';
  } catch {
    return null;
  }
}

export function getPlanProductId(planId: string, isAnnual: boolean): string {
  const map = PLAN_PRODUCT_IDS[planId];
  if (!map) throw new Error(`알 수 없는 플랜: ${planId}`);
  return isAnnual ? map.annual : map.monthly;
}

/** RevenueCat CustomerInfo → Supabase DB 동기화 (활성 구독이 있을 때만 업데이트) */
export async function syncRevenueCatToDb(userId: string): Promise<void> {
  try {
    // logIn을 먼저 호출하면 RC 사용자가 전환되어 Apple IAP 엔타이틀먼트가 사라지는 버그 발생.
    // 현재 RC 세션의 customerInfo를 먼저 확인한 뒤, 엔타이틀먼트가 없을 때만 복구 시도.
    // DB 상태를 먼저 확인 — free 유저는 auto-restore 스킵 (과거 영수증이 되살아나 Pro로 덮이는 버그 방지)
    const { data: dbSubCheck } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('coach_id', userId)
      .single();
    const dbIsFree = !dbSubCheck || dbSubCheck.status === 'free';

    let customerInfo = await Purchases.getCustomerInfo();
    let active = customerInfo.entitlements.active;

    // 활성 구독이 없으면 restorePurchases로 Apple 영수증 재동기화
    // 단, DB가 이미 free이면 복원 시도 안 함 (과거 영수증으로 잘못 업그레이드 방지)
    if (Object.keys(active).length === 0 && !dbIsFree) {
      try {
        const restored = await Purchases.restorePurchases();
        active = restored.entitlements.active;
        customerInfo = restored;
      } catch {}
    }

    let planId: 'basic' | 'pro' | null = null;
    let status: 'active' | 'trial' = 'active';
    let currentPeriodEnd: string | null = null;
    let activeEntitlement: any = null;

    const proEnt = active[ENTITLEMENT_IDS.PRO];
    const basicEnt = active[ENTITLEMENT_IDS.BASIC];

    if (proEnt && basicEnt) {
      // 둘 다 active인 경우: 유료(NORMAL) entitlement 우선
      // Pro Trial 중 Basic 유료 구독 시 Basic이 표시돼야 함
      const basicIsPaid = (basicEnt as any).periodType !== 'TRIAL';
      const proIsPaid = (proEnt as any).periodType !== 'TRIAL';
      if (basicIsPaid && !proIsPaid) {
        planId = 'basic';
        activeEntitlement = basicEnt;
      } else {
        planId = 'pro';
        activeEntitlement = proEnt;
      }
    } else if (proEnt) {
      planId = 'pro';
      activeEntitlement = proEnt;
    } else if (basicEnt) {
      planId = 'basic';
      activeEntitlement = basicEnt;
    }

    if (activeEntitlement) {
      currentPeriodEnd = activeEntitlement.expirationDate ?? null;
      if ((activeEntitlement as any).periodType === 'TRIAL') status = 'trial';
    }

    if (!planId) {
      // 활성 RevenueCat 구독 없음 → 만료된 IAP 구독이면 free로 리셋
      // (Toss 직접결제는 process-billing이 관리하므로 건드리지 않음)
      const { data: cur } = await supabase
        .from('subscriptions')
        .select('status, current_period_end, toss_billing_key')
        .eq('coach_id', userId)
        .single();
      if (
        cur &&
        !cur.toss_billing_key &&
        cur.status !== 'free' &&
        cur.status !== 'trial' &&
        (!cur.current_period_end || new Date(cur.current_period_end) <= new Date())
      ) {
        await supabase
          .from('subscriptions')
          .update({ plan_id: 'free', status: 'free', current_period_end: null })
          .eq('coach_id', userId);
      }
      return;
    }

    // Toss 직접결제 구독은 process-billing이 status를 관리하므로 RevenueCat이 덮어쓰지 않음
    const { data: curSub } = await supabase
      .from('subscriptions')
      .select('toss_billing_key')
      .eq('coach_id', userId)
      .single();

    // Apple/RC IAP 갱신 감지 → subscription_logs에 기록 (결제·충전 내역 화면에 표시)
    // store 체크 제거: Toss 결제는 process-billing이 별도 로그를 남기므로 중복 무관
    // log_iap_renewal 내부의 2일 중복 방지가 중복 삽입을 막아줌
    if (
      status !== 'trial' &&
      activeEntitlement?.latestPurchaseDate
    ) {
      const productId: string = activeEntitlement.productIdentifier ?? '';
      const amount = PRODUCT_AMOUNT_MAP[productId] ?? 0;
      await supabase.rpc('log_iap_renewal', {
        p_plan_id: planId,
        p_renewal_date: activeEntitlement.latestPurchaseDate,
        p_period_end: currentPeriodEnd ?? new Date().toISOString(),
        p_amount: amount,
        p_product_id: productId,
      });
    }

    const upsertPayload: Record<string, unknown> = {
      coach_id: userId,
      plan_id: planId,
      current_period_end: currentPeriodEnd,
    };
    if (!curSub?.toss_billing_key) {
      upsertPayload.status = status;
      // trial 상태이면 trial_ends_at도 RevenueCat expirationDate로 동기화
      // (초기 startTrial() 세팅값이 실제 App Store trial 기간과 다를 수 있음)
      if (status === 'trial' && currentPeriodEnd) {
        upsertPayload.trial_ends_at = currentPeriodEnd;
        upsertPayload.next_billing_at = currentPeriodEnd;
      }
    }

    await supabase
      .from('subscriptions')
      .upsert(upsertPayload, { onConflict: 'coach_id' });
  } catch (e) {
    console.warn('[syncRevenueCat] error:', e);
  }
}
