import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, Alert, ActivityIndicator, Linking, Platform, AppState,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSubscription } from '../../hooks/useSubscription';
import { format } from 'date-fns-tz';
import Purchases from 'react-native-purchases';
import {
  PLANS, getAiAnalysisUsageThisMonth,
  TOPUP_PRODUCTS, TRIAL_DAYS, ANNUAL_PRICES,
} from '../../lib/subscription';
import { restorePurchases, ENTITLEMENT_IDS } from '../../lib/purchases';

/** RevenueCat entitlement 기반 trial 정보 */
interface RcTrialInfo {
  isTrial: boolean;
  expirationDate: string | null; // ISO UTC
  willRenew: boolean;
  daysLeft: number;
  appUserId: string;
  periodType: string;
}

async function fetchRcTrialInfo(): Promise<RcTrialInfo> {
  const customerInfo = await Purchases.getCustomerInfo();
  const appUserId = await Purchases.getAppUserID();
  const active = customerInfo.entitlements.active;
  const ent = active[ENTITLEMENT_IDS.PRO] ?? active[ENTITLEMENT_IDS.BASIC] ?? null;

  const periodType: string = (ent as any)?.periodType ?? '';
  const isTrial = periodType === 'TRIAL';
  const expirationDate: string | null = ent?.expirationDate ?? null;
  const willRenew: boolean = (ent as any)?.willRenew ?? false;

  let daysLeft = 0;
  if (isTrial && expirationDate) {
    const diff = new Date(expirationDate).getTime() - Date.now();
    daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return { isTrial, expirationDate, willRenew, daysLeft, appUserId, periodType };
}

function formatKoreanDate(isoStr: string | null): string | null {
  if (!isoStr) return null;
  try {
    // Use UTC to extract the calendar date so it matches Apple's subscription management display.
    // Apple's renewal date is the UTC calendar date of the billing event; converting to Seoul (+9)
    // can shift it forward by one day when the timestamp falls in the 15:00–23:59Z window.
    return format(new Date(isoStr), 'yyyy년 M월 d일', { timeZone: 'UTC' });
  } catch { return null; }
}

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';

const STATUS_LABELS: Record<string, string> = {
  trial: '무료 체험 중',
  active: '이용 중',
  free: '이용 중',
  past_due: '결제 실패',
  cancelled: '취소됨',
  blocked: '차단됨',
};

const STATUS_COLORS: Record<string, string> = {
  trial: TERRACOTTA,
  active: '#22A566',
  free: WARM_GRAY,
  past_due: '#DC4444',
  cancelled: WARM_GRAY,
  blocked: '#DC4444',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

function MenuRow({ icon, label, value, onPress, destructive }: { icon: string; label: string; value?: string; onPress: () => void; destructive?: boolean }) {
  return (
    <TouchableOpacity style={s.menuRow} onPress={onPress} activeOpacity={0.7}>
      <View style={s.menuRowLeft}>
        <Ionicons name={icon as any} size={18} color={destructive ? '#DC4444' : DARK_BROWN} />
        <Text style={[s.menuRowLabel, destructive && s.menuRowLabelDestructive]}>{label}</Text>
      </View>
      <View style={s.menuRowRight}>
        {value ? <Text style={s.menuRowValue}>{value}</Text> : null}
        <Ionicons name="chevron-forward" size={16} color={WARM_GRAY_BORDER} />
      </View>
    </TouchableOpacity>
  );
}

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const { subscription, loading, refresh } = useSubscription();
  const [aiUsed, setAiUsed] = useState(0);
  const [rcInfo, setRcInfo] = useState<RcTrialInfo | null>(null);
  const [rcLoading, setRcLoading] = useState(true);
  const appStateRef = useRef(AppState.currentState);

  const loadUsage = useCallback(async () => {
    if (!subscription) return;
    const used = await getAiAnalysisUsageThisMonth(subscription.coach_id);
    setAiUsed(used);
  }, [subscription]);

  useEffect(() => { loadUsage(); }, [loadUsage]);

  // RevenueCat 직접 조회 — DB 날짜 사용 안 함
  const loadRcInfo = useCallback(async () => {
    try {
      setRcLoading(true);
      const info = await fetchRcTrialInfo();
      setRcInfo(info);
    } catch (e) {
      console.warn('[RC] fetchRcTrialInfo error:', e);
    } finally {
      setRcLoading(false);
    }
  }, []);

  // 화면 진입 시 갱신
  useFocusEffect(useCallback(() => { loadRcInfo(); }, [loadRcInfo]));

  // foreground 복귀 시 갱신
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        loadRcInfo();
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [loadRcInfo]);

  async function openStoreManagement() {
    const url = Platform.OS === 'android'
      ? 'https://play.google.com/store/account/subscriptions'
      : 'https://apps.apple.com/account/subscriptions';
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      Linking.openURL(url);
    } else {
      Alert.alert('구독 관리', 'App Store 또는 설정 앱에서 구독을 관리하세요.');
    }
  }

  async function handleRestorePurchase() {
    try {
      await restorePurchases();
      await refresh();
      await loadRcInfo(); // 복원 완료 후 RC 정보 즉시 갱신
      Alert.alert('구매 복원 완료', '이전 구매 내역이 복원됐습니다.');
    } catch (e: any) {
      if (!e.userCancelled) {
        console.error('[IAP] restore error:', e.code, e.message);
        Alert.alert('복원 실패', e.message ?? '구매 복원 중 오류가 발생했습니다.');
      }
    }
  }

  if (loading || rcLoading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator size="large" color={TERRACOTTA} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!subscription) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={DARK_BROWN} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>구독 및 요금제</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.emptyState}>
          <Ionicons name="card-outline" size={48} color={WARM_GRAY_BORDER} />
          <Text style={s.emptyTitle}>구독 정보가 없습니다</Text>
          <TouchableOpacity style={s.startBtn} onPress={() => router.push('/subscription/select-plan')}>
            <Text style={s.startBtnText}>플랜 시작하기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const plan = PLANS[subscription.plan_id];
  const isPaid = subscription.plan_id !== 'free';
  const isBasic = subscription.plan_id === 'basic';
  const isPro = subscription.plan_id === 'pro';

  const aiLimit = plan.aiAnalysisMonthlyLimit;
  const aiExtra = subscription.extra_report_credits ?? 0;
  const aiRemain = Math.max(0, aiLimit - aiUsed);
  const aiProgress = aiLimit > 0 ? Math.min(1, aiUsed / aiLimit) : 0;

  // ── RevenueCat 기반 trial 정보 (DB 날짜 사용 안 함) ──
  const isTrial = rcInfo?.isTrial ?? false;
  const trialDaysLeft = rcInfo?.daysLeft ?? 0;
  const willRenew = rcInfo?.willRenew ?? false;
  // RC expirationDate 기준 다음 갱신일/만료일
  const nextBillingDate = formatKoreanDate(rcInfo?.expirationDate ?? null);
  // RC가 로드됐고 trial이 아님을 확인했으면 DB status 'trial' 무시
  const rcResolvedNonTrial = !rcLoading && rcInfo !== null && !isTrial && rcInfo.periodType !== '';
  const effectiveStatus = (subscription.status === 'trial' && rcResolvedNonTrial) ? 'active' : subscription.status;

  const nextResetDate = (() => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  })();

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={DARK_BROWN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>구독 및 요금제</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── 현재 플랜 카드 ── */}
        <View style={s.card}>
          <Text style={s.cardSectionLabel}>현재 플랜</Text>
          <View style={s.planRow}>
            <Text style={s.planName}>{plan.name}</Text>
            <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[effectiveStatus] + '18' }]}>
              <Text style={[s.statusText, { color: STATUS_COLORS[effectiveStatus] }]}>
                {STATUS_LABELS[effectiveStatus] ?? effectiveStatus}
              </Text>
            </View>
          </View>

          {isTrial && (
            <View style={s.trialRow}>
              <Ionicons name="time-outline" size={14} color={TERRACOTTA} />
              <Text style={s.trialText}>
                {rcLoading
                  ? '확인 중...'
                  : (() => {
                      const exp = rcInfo?.expirationDate ?? null;
                      if (!exp) return '무료 체험 중';
                      const ms = new Date(exp).getTime() - Date.now();
                      if (ms <= 0) return '무료 체험 종료';
                      if (ms < 24 * 60 * 60 * 1000) return '무료 체험 1일 미만 남음';
                      return `무료 체험 ${Math.ceil(ms / (24 * 60 * 60 * 1000))}일 남음`;
                    })()
                }
              </Text>
              {nextBillingDate && willRenew && (
                <Text style={s.trialSubText}>· {nextBillingDate}부터 자동 결제</Text>
              )}
            </View>
          )}

          {/* willRenew=false: 가격 동의 미완료 안내 */}
          {isTrial && !willRenew && nextBillingDate && (
            <TouchableOpacity style={s.noRenewBanner} onPress={openStoreManagement}>
              <Ionicons name="alert-circle-outline" size={15} color="#DC4444" />
              <Text style={s.noRenewText}>
                {nextBillingDate}까지 무료 체험 · 계속 이용하려면 App Store에서 결제에 동의해 주세요
              </Text>
              <Ionicons name="chevron-forward" size={13} color="#DC4444" />
            </TouchableOpacity>
          )}

          {isPaid && plan.price > 0 && (
            <>
              <View style={s.divider} />
              {isTrial ? (
                <InfoRow label="체험 후 결제" value={`${plan.price.toLocaleString()}원/월`} />
              ) : (
                <InfoRow label="현재 결제" value={`${plan.price.toLocaleString()}원/월`} />
              )}
              {nextBillingDate && (
                <InfoRow
                  label={isTrial ? '다음 결제 예정일' : '다음 갱신일'}
                  value={nextBillingDate}
                />
              )}
            </>
          )}
        </View>

        {/* ── AI 레슨 기록 사용량 ── */}
        <View style={s.card}>
          <Text style={s.cardSectionLabel}>AI 레슨 기록</Text>

          {/* 기본 제공량 */}
          <View style={s.usageHeader}>
            <Text style={s.usageTitle}>이번 달 기본 제공</Text>
            <Text style={s.usageCount}>
              <Text style={s.usageUsed}>{aiUsed}</Text>
              <Text style={s.usageSep}> / </Text>
              <Text>{aiLimit}개</Text>
            </Text>
          </View>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round(aiProgress * 100)}%` as any, backgroundColor: aiProgress >= 0.9 ? '#DC4444' : TERRACOTTA }]} />
          </View>
          <View style={s.usageFooter}>
            <Text style={s.usageRemain}>{aiRemain}개 남음</Text>
            <Text style={s.usageReset}>다음 초기화 {nextResetDate}</Text>
          </View>

          {/* 추가 충전 */}
          {aiExtra > 0 && (
            <View style={s.extraSection}>
              <View style={s.extraRow}>
                <Ionicons name="add-circle-outline" size={15} color={TERRACOTTA} />
                <Text style={s.extraLabel}>추가 충전</Text>
                <Text style={s.extraCount}>{aiExtra}개 남음</Text>
              </View>
              <Text style={s.extraNote}>기본 제공량을 먼저 사용한 후 충전 횟수가 사용됩니다.</Text>
            </View>
          )}

          {/* 충전 버튼 (Basic/Pro만) */}
          {isPaid && (
            <TouchableOpacity style={s.topupBtn} onPress={() => router.push('/subscription/topup')} activeOpacity={0.8}>
              <Ionicons name="flash-outline" size={15} color={TERRACOTTA} />
              <Text style={s.topupBtnText}>AI 레슨 기록 {TOPUP_PRODUCTS[0].credits}개 충전 · {TOPUP_PRODUCTS[0].price.toLocaleString()}원</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── 하단 메뉴 ── */}
        <View style={s.menuCard}>
          {/* 플랜 변경 */}
          {subscription.status !== 'cancelled' && subscription.status !== 'blocked' && (
            <MenuRow
              icon="swap-horizontal-outline"
              label="플랜 변경"
              onPress={() => router.push('/subscription/select-plan')}
            />
          )}

          {/* 결제·충전 내역 */}
          <MenuRow
            icon="receipt-outline"
            label="결제·충전 내역"
            onPress={() => router.push('/subscription/billing-history')}
          />

          {/* 스토어 구독 관리 */}
          <MenuRow
            icon="storefront-outline"
            label={Platform.OS === 'android' ? 'Google Play에서 구독 관리' : 'App Store에서 구독 관리'}
            onPress={openStoreManagement}
          />
        </View>

        {/* 구매 복원 / 정책 링크 */}
        <View style={s.footerLinks}>
          <TouchableOpacity onPress={handleRestorePurchase}>
            <Text style={s.footerLink}>구매 복원</Text>
          </TouchableOpacity>
          <Text style={s.footerSep}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://kerri.co.kr/refund-policy')}>
            <Text style={s.footerLink}>구독·환불 정책</Text>
          </TouchableOpacity>
        </View>

        {/* 구독 종료 후 충전권 안내 */}
        {aiExtra > 0 && !isPaid && (
          <View style={s.retainedCreditCard}>
            <Ionicons name="information-circle-outline" size={16} color={WARM_GRAY} />
            <Text style={s.retainedCreditText}>
              보유 충전 {aiExtra}개는 Basic 또는 Pro 재구독 시 사용할 수 있습니다.
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: WARM_GRAY_BORDER,
    backgroundColor: CREAM,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: DARK_BROWN },
  scroll: { padding: 20, gap: 14 },

  card: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 18, borderWidth: 1, borderColor: WARM_GRAY_BORDER,
  },
  cardSectionLabel: { fontSize: 11, fontWeight: '700', color: WARM_GRAY, marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' },

  planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  planName: { fontSize: 26, fontWeight: '800', color: DARK_BROWN },
  statusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },

  trialRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  trialText: { fontSize: 13, color: TERRACOTTA, fontWeight: '700' },
  trialSubText: { fontSize: 12, color: WARM_GRAY },
  noRenewBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF0F0', borderRadius: 10,
    padding: 10, marginTop: 8,
  },
  noRenewText: { flex: 1, fontSize: 12, color: '#DC4444', lineHeight: 17 },

  divider: { height: 1, backgroundColor: '#F5EDE5', marginVertical: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  infoLabel: { fontSize: 13, color: WARM_GRAY },
  infoValue: { fontSize: 13, color: DARK_BROWN, fontWeight: '600' },

  // AI 사용량
  usageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  usageTitle: { fontSize: 13, color: WARM_GRAY, fontWeight: '600' },
  usageCount: { fontSize: 15, color: WARM_GRAY },
  usageUsed: { fontSize: 22, fontWeight: '800', color: DARK_BROWN },
  usageSep: { color: WARM_GRAY_BORDER },
  progressTrack: { height: 7, backgroundColor: '#F0E8E0', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 4 },
  usageFooter: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  usageRemain: { fontSize: 13, color: TERRACOTTA, fontWeight: '700' },
  usageReset: { fontSize: 12, color: WARM_GRAY },

  extraSection: { borderTopWidth: 1, borderTopColor: '#F5EDE5', marginTop: 12, paddingTop: 12, gap: 5 },
  extraRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  extraLabel: { fontSize: 13, color: DARK_BROWN, fontWeight: '600', flex: 1 },
  extraCount: { fontSize: 14, fontWeight: '700', color: TERRACOTTA },
  extraNote: { fontSize: 11, color: WARM_GRAY, lineHeight: 16 },

  topupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center',
    borderWidth: 1.5, borderColor: TERRACOTTA, borderRadius: 10,
    paddingVertical: 11, marginTop: 14,
  },
  topupBtnText: { fontSize: 13, color: TERRACOTTA, fontWeight: '700' },

  menuCard: {
    backgroundColor: '#fff', borderRadius: 16,
    borderWidth: 1, borderColor: WARM_GRAY_BORDER,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 15, paddingHorizontal: 18,
    borderBottomWidth: 1, borderBottomColor: '#F5EDE5',
  },
  menuRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuRowLabel: { fontSize: 14, color: DARK_BROWN, fontWeight: '500' },
  menuRowLabelDestructive: { color: '#DC4444' },
  menuRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  menuRowValue: { fontSize: 12, color: WARM_GRAY },

  footerLinks: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 4,
  },
  footerLink: { fontSize: 12, color: WARM_GRAY, textDecorationLine: 'underline' },
  footerSep: { fontSize: 12, color: WARM_GRAY_BORDER },

  retainedCreditCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#F5EDE5', borderRadius: 12, padding: 14,
  },
  retainedCreditText: { flex: 1, fontSize: 12, color: WARM_GRAY, lineHeight: 18 },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 32 },
  emptyTitle: { fontSize: 16, color: WARM_GRAY, fontWeight: '600' },
  startBtn: { backgroundColor: TERRACOTTA, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
  startBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
