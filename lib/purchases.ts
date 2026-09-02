import Purchases, { LOG_LEVEL, PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '';

export const PLAN_PRODUCT_IDS: Record<string, { monthly: string; annual: string }> = {
  basic: { monthly: 'kerri_basic_monthly', annual: 'kerri_basic_yearly' },
  pro: { monthly: 'kerri_pro_monthly', annual: 'kerri_pro_yearly' },
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
  await Purchases.logIn(userId);
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

export function getPlanProductId(planId: string, isAnnual: boolean): string {
  const map = PLAN_PRODUCT_IDS[planId];
  if (!map) throw new Error(`알 수 없는 플랜: ${planId}`);
  return isAnnual ? map.annual : map.monthly;
}
