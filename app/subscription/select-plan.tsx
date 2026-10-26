import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Modal,
  Linking,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Purchases from 'react-native-purchases';
import { PLANS, ANNUAL_PRICES, TRIAL_DAYS } from '../../lib/subscription';
import { supabase } from '../../lib/supabase';
import { useSubscription } from '../../hooks/useSubscription';
import {
  purchaseProductById,
  getPlanProductId,
  ENTITLEMENT_IDS,
  restorePurchases,
  getAppUserID,
  getCurrentBillingCycle,
} from '../../lib/purchases';

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';

type BillingCycle = 'monthly' | 'annual';

interface PlanFeatureRow {
  label: string;
  free: boolean | string;
  basic: boolean | string;
  pro: boolean | string;
}

const FEATURE_ROWS: PlanFeatureRow[] = [
  { label: '회원 등록', free: '3명', basic: '무제한', pro: '무제한' },
  { label: '일정·출석·횟수·결제 관리', free: true, basic: true, pro: true },
  { label: '회원 운영 관리', free: false, basic: true, pro: true },
  { label: '회원 관리 자동 알림', free: false, basic: true, pro: true },
  { label: 'AI 레슨 기록', free: '월 3개', basic: '월 10개', pro: '월 50개' },
  { label: 'AI 레슨 기록 충전권', free: '충전 불가', basic: true, pro: true },
  { label: '14일 무료 체험', free: false, basic: true, pro: true },
  { label: 'AI 맞춤 코칭 분석', free: false, basic: '기본', pro: '상세' },
  { label: '개인화 AI·코치 브랜딩', free: false, basic: false, pro: true },
];

function FeatureCell({ value }: { value: boolean | string }) {
  if (value === true) return <Ionicons name="checkmark-circle" size={16} color={TERRACOTTA} />;
  if (value === false) return <Ionicons name="remove-circle-outline" size={16} color={WARM_GRAY_BORDER} />;
  return <Text style={s.featureCellText}>{value}</Text>;
}

const ANNUAL_SAVINGS: Partial<Record<'basic' | 'pro', number>> = {
  basic: 9800,
  pro: 19000,
};

function formatKoreanDate(isoStr: string | null): string | null {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  } catch { return null; }
}

interface RcPlanInfo {
  willRenew: boolean;
  expirationDate: string | null;
}

export default function SelectPlanScreen() {
  const router = useRouter();
  const { reason } = useLocalSearchParams<{ reason?: string }>();

  const { subscription, isTrial, refresh } = useSubscription();
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [compareVisible, setCompareVisible] = useState(false);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [currentBillingCycle, setCurrentBillingCycle] = useState<'monthly' | 'annual' | null>(null);
  const [rcInfo, setRcInfo] = useState<RcPlanInfo | null>(null);
  const [rcLoading, setRcLoading] = useState(true);

  const currentPlanId = subscription?.plan_id ?? 'free';

  useEffect(() => {
    if (currentPlanId === 'free') { setCurrentBillingCycle(null); return; }
    getCurrentBillingCycle(currentPlanId as 'basic' | 'pro').then(setCurrentBillingCycle);
  }, [currentPlanId]);

  const loadRcInfo = useCallback(async () => {
    try {
      setRcLoading(true);
      const info = await Purchases.getCustomerInfo();
      const active = info.entitlements.active;
      const ent = active[ENTITLEMENT_IDS.PRO] ?? active[ENTITLEMENT_IDS.BASIC] ?? null;
      setRcInfo({
        willRenew: (ent as any)?.willRenew ?? false,
        expirationDate: ent?.expirationDate ?? null,
      });
    } catch {
      setRcInfo({ willRenew: true, expirationDate: null });
    } finally {
      setRcLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadRcInfo();
  }, [loadRcInfo]));

  async function openStoreManagement() {
    const url = Platform.OS === 'android'
      ? 'https://play.google.com/store/account/subscriptions'
      : 'https://apps.apple.com/account/subscriptions';
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) Linking.openURL(url);
    else Alert.alert('구독 관리', 'App Store 또는 설정 앱에서 구독을 관리하세요.');
  }

  // RC 로드 완료 후에만 isScheduledDowngradeToBasic 확정
  const willRenew = rcInfo?.willRenew ?? true;
  const isScheduledDowngradeToBasic = currentPlanId === 'pro' && rcInfo !== null && willRenew === false;

  const scheduledDate = formatKoreanDate(
    rcInfo?.expirationDate ?? subscription?.current_period_end ?? null
  );

  const isTrialEligible = (() => {
    if (!subscription) return true;
    if (subscription.plan_id !== 'free') return false;
    if (isTrial) return false;
    const ts = subscription.trial_starts_at ? new Date(subscription.trial_starts_at).getTime() : 0;
    const te = subscription.trial_ends_at ? new Date(subscription.trial_ends_at).getTime() : 0;
    return Math.abs(ts - te) < 5000;
  })();

  function monthlyEquivalent(planId: 'basic' | 'pro'): number {
    const annual = ANNUAL_PRICES[planId];
    if (!annual) return PLANS[planId].price;
    return Math.round(annual / 12);
  }

  function isCurrentPlan(planId: 'basic' | 'pro'): boolean {
    if (currentPlanId !== planId) return false;
    if (currentBillingCycle === null) return true;
    return billing === currentBillingCycle;
  }

  function getCtaText(planId: 'basic' | 'pro'): string {
    if (planId === 'basic' && isScheduledDowngradeToBasic) return 'Basic 변경 예약 완료';
    if (currentPlanId === planId) {
      if (isCurrentPlan(planId)) return '이용 중';
      return billing === 'annual' ? '연간으로 전환' : '월간으로 전환';
    }
    if (isTrialEligible) return '14일 무료로 시작하기';
    if (currentPlanId === 'free') return `${PLANS[planId].name} 구독하기`;
    return `${PLANS[planId].name}으로 변경`;
  }

  async function applySubscription(customerInfo: Awaited<ReturnType<typeof restorePurchases>>, planId: 'basic' | 'pro') {
    const entId = planId === 'pro' ? ENTITLEMENT_IDS.PRO : ENTITLEMENT_IDS.BASIC;
    const isActive = !!customerInfo.entitlements.active[entId];
    if (isActive && subscription) {
      void supabase.from('subscription_logs').insert({
        subscription_id: subscription.id,
        coach_id: subscription.coach_id,
        event_type: isTrial ? 'trial_started' : 'subscription_renewed',
        plan_id: planId,
        amount: billing === 'annual' ? (ANNUAL_PRICES[planId] ?? PLANS[planId].price) : PLANS[planId].price,
      });
    }
    await refresh();
    if (isActive) {
      router.replace('/subscription/manage');
      return;
    }

    const activeIds = Object.keys(customerInfo.entitlements.active ?? {});
    const boundElsewhere =
      customerInfo.originalAppUserId &&
      customerInfo.originalAppUserId !== (await getAppUserID());

    if (activeIds.length === 0 && boundElsewhere) {
      Alert.alert(
        '다른 계정에서 구독 중',
        '이 Apple ID의 구독은 다른 계정에 연결되어 있습니다. 해당 계정으로 로그인해주세요.\n\n어느 계정으로 가입했는지 모르시면 고객센터로 문의해주세요.',
        [{ text: '확인' }]
      );
      return;
    }

    Alert.alert('처리 중', '구독 반영에 시간이 걸릴 수 있습니다. 잠시 후 다시 확인해 주세요.', [
      { text: '확인', onPress: () => router.replace('/subscription/manage') },
    ]);
  }

  function showOtherSubscriberAlert() {
    Alert.alert(
      '다른 계정에서 구독 중',
      '이 Apple ID는 다른 계정에서 구독 중입니다. 해당 계정으로 로그인해주세요.\n\n어느 계정으로 가입했는지 모르시면 고객센터로 문의해주세요.',
      [{ text: '확인' }]
    );
  }

  function isOtherSubscriberError(e: any): boolean {
    const code = String(e?.code ?? '');
    const msg = String(e?.message ?? e?.underlyingErrorMessage ?? '').toLowerCase();
    const readable = String(e?.readableErrorCode ?? '').toUpperCase();
    return code === '13' ||
      readable === 'RECEIPT_ALREADY_IN_USE' ||
      msg.includes('another active subscriber');
  }

  async function handleSelectPlan(planId: 'basic' | 'pro') {
    if (purchasing) return;
    setPurchasing(planId);
    try {
      const productId = getPlanProductId(planId, billing === 'annual');
      const { customerInfo } = await purchaseProductById(productId);
      await applySubscription(customerInfo, planId);
    } catch (e: any) {
      const code = String(e.code ?? '');
      if (code === '6' || code === '7') {
        try {
          const restored = await restorePurchases();
          await applySubscription(restored, planId);
        } catch (restoreErr: any) {
          if (isOtherSubscriberError(restoreErr)) {
            showOtherSubscriberAlert();
          } else {
            Alert.alert('복원 실패', restoreErr.message ?? '구매 복원 중 오류가 발생했습니다.');
          }
        }
      } else if (code === '13') {
        setPurchasing(null);
        showOtherSubscriberAlert();
        return;
      } else if (!e.userCancelled) {
        Alert.alert('결제 실패', e.message ?? '결제 중 오류가 발생했습니다.');
      }
    } finally {
      setPurchasing(null);
    }
  }

  const basicCtaDisabled = isCurrentPlan('basic') || isScheduledDowngradeToBasic || !!purchasing || rcLoading;
  const proCtaDisabled = isCurrentPlan('pro') || !!purchasing;

  return (
    <SafeAreaView style={s.container}>
      <Modal visible={compareVisible} animationType="slide" transparent onRequestClose={() => setCompareVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={s.compareSheet}>
            <View style={s.sheetHandle} />
            <Text style={s.compareTitle}>플랜 전체 비교</Text>
            <View style={s.compareHeaderRow}>
              <View style={{ flex: 2.5 }} />
              <View style={s.compareHeaderCell}><Text style={s.compareHeaderText}>Free</Text></View>
              <View style={s.compareHeaderCell}><Text style={[s.compareHeaderText, { color: TERRACOTTA }]}>Basic</Text></View>
              <View style={s.compareHeaderCell}><Text style={[s.compareHeaderText, { color: DARK_BROWN }]}>Pro</Text></View>
            </View>
            <ScrollView>
              {FEATURE_ROWS.map((row, i) => (
                <View key={i} style={[s.compareRow, i % 2 === 1 && s.compareRowAlt]}>
                  <View style={{ flex: 2.5 }}>
                    <Text style={s.compareRowLabel}>{row.label}</Text>
                  </View>
                  <View style={s.compareHeaderCell}><FeatureCell value={row.free} /></View>
                  <View style={s.compareHeaderCell}><FeatureCell value={row.basic} /></View>
                  <View style={s.compareHeaderCell}><FeatureCell value={row.pro} /></View>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.compareCloseBtn} onPress={() => setCompareVisible(false)}>
              <Text style={s.compareCloseBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color={DARK_BROWN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>요금제 변경</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {reason === 'member_limit' && (
          <View style={s.reasonBanner}>
            <Ionicons name="people-outline" size={14} color={TERRACOTTA} />
            <Text style={s.reasonBannerText}>Free 플랜에서는 회원을 3명까지 등록할 수 있어요.</Text>
          </View>
        )}
        {reason === 'ai_monthly_limit' && (
          <View style={s.reasonBanner}>
            <Ionicons name="mic-outline" size={14} color={TERRACOTTA} />
            <Text style={s.reasonBannerText}>이번 달 무료 AI 레슨 기록 3개를 모두 사용했어요.</Text>
          </View>
        )}
        {reason === 'paid_feature' && (
          <View style={s.reasonBanner}>
            <Ionicons name="lock-closed-outline" size={14} color={TERRACOTTA} />
            <Text style={s.reasonBannerText}>이 기능은 Basic 또는 Pro 플랜에서 사용할 수 있어요.</Text>
          </View>
        )}

        {/* 월간/연간 토글 */}
        <View style={s.billingToggle}>
          <TouchableOpacity
            style={[s.billingBtn, billing === 'monthly' && s.billingBtnActive]}
            onPress={() => setBilling('monthly')}
          >
            <Text style={[s.billingBtnText, billing === 'monthly' && s.billingBtnTextActive]}>월간</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.billingBtn, billing === 'annual' && s.billingBtnActive]}
            onPress={() => setBilling('annual')}
          >
            <Text style={[s.billingBtnText, billing === 'annual' && s.billingBtnTextActive]}>연간</Text>
            {billing !== 'annual' && (
              <View style={s.savingsBadge}>
                <Text style={s.savingsBadgeText}>최대 19,000원 절약</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Basic 카드 ── */}
        <View style={[
          s.planCard,
          isCurrentPlan('basic') && s.planCardCurrent,
          isScheduledDowngradeToBasic && s.planCardScheduled,
        ]}>
          {isScheduledDowngradeToBasic ? (
            <View style={s.scheduledBadge}>
              <Ionicons name="swap-horizontal-outline" size={12} color={TERRACOTTA} />
              <Text style={s.scheduledBadgeText}>변경 예정</Text>
            </View>
          ) : (isTrialEligible && currentPlanId === 'free') ? (
            <View style={s.trialBadge}>
              <Ionicons name="gift-outline" size={12} color={TERRACOTTA} />
              <Text style={s.trialBadgeText}>{TRIAL_DAYS}일 무료 체험</Text>
            </View>
          ) : null}

          <View style={s.planCardHeader}>
            <Text style={s.planName}>Basic</Text>
            {isCurrentPlan('basic') && (
              <View style={s.currentBadge}>
                <Text style={s.currentBadgeText}>이용 중</Text>
              </View>
            )}
          </View>

          {billing === 'monthly' ? (
            <Text style={s.planPrice}>{PLANS.basic.price.toLocaleString()}원/월</Text>
          ) : (
            <View>
              <Text style={s.planPrice}>{ANNUAL_PRICES.basic?.toLocaleString()}원/년</Text>
              <Text style={s.annualNote}>월 약 {monthlyEquivalent('basic').toLocaleString()}원 · 연간 {ANNUAL_SAVINGS.basic?.toLocaleString()}원 절약</Text>
            </View>
          )}

          <Text style={s.planDesc}>회원 관리와 기본 AI 코칭</Text>
          <View style={s.featureList}>
            <FeatureItem icon="grid-outline" text="일정·출석·결제 관리" />
            <FeatureItem icon="mic-outline" text="AI 레슨 기록 월 10회" />
            <FeatureItem icon="analytics-outline" text="기본 AI 코칭 분석" />
          </View>

          {isScheduledDowngradeToBasic && scheduledDate && (
            <View style={s.scheduledDateRow}>
              <Ionicons name="calendar-outline" size={13} color={TERRACOTTA} />
              <Text style={s.scheduledDateText}>{scheduledDate}부터 적용 예정</Text>
            </View>
          )}

          {isScheduledDowngradeToBasic ? (
            <View style={[s.cta, s.ctaScheduled]}>
              <Ionicons name="checkmark-circle-outline" size={15} color={TERRACOTTA} />
              <Text style={[s.ctaTextScheduled, { marginLeft: 6 }]}>변경 예약 완료</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                s.cta,
                basicCtaDisabled && s.ctaDisabled,
              ]}
              onPress={!basicCtaDisabled ? () => handleSelectPlan('basic') : undefined}
              disabled={basicCtaDisabled}
              activeOpacity={0.85}
            >
              {(purchasing === 'basic' || (rcLoading && currentPlanId !== 'free'))
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.ctaText}>{getCtaText('basic')}</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {/* ── Pro 카드 ── */}
        <View style={[
          s.planCard,
          s.planCardPro,
          isCurrentPlan('pro') && s.planCardProCurrent,
        ]}>
          {!isScheduledDowngradeToBasic && (
            <View style={[s.trialBadge, s.trialBadgePro]}>
              <Ionicons name="star-outline" size={12} color={DARK_BROWN} />
              <Text style={[s.trialBadgeText, { color: DARK_BROWN }]}>
                {(isTrialEligible && currentPlanId === 'free') ? `추천 · ${TRIAL_DAYS}일 무료 체험` : '추천'}
              </Text>
            </View>
          )}

          <View style={s.planCardHeader}>
            <Text style={[s.planName, s.planNamePro]}>Pro</Text>
            {isCurrentPlan('pro') && (
              <View style={[s.currentBadge, { backgroundColor: DARK_BROWN }]}>
                <Text style={s.currentBadgeText}>이용 중</Text>
              </View>
            )}
          </View>

          {billing === 'monthly' ? (
            <Text style={[s.planPrice, s.planPricePro]}>{PLANS.pro.price.toLocaleString()}원/월</Text>
          ) : (
            <View>
              <Text style={[s.planPrice, s.planPricePro]}>{ANNUAL_PRICES.pro?.toLocaleString()}원/년</Text>
              <Text style={s.annualNote}>월 약 {monthlyEquivalent('pro').toLocaleString()}원 · 연간 {ANNUAL_SAVINGS.pro?.toLocaleString()}원 절약</Text>
            </View>
          )}

          <Text style={[s.planDesc, { color: DARK_BROWN + '99' }]}>AI 코칭을 적극적으로 활용하는 코치</Text>
          <View style={s.featureList}>
            <FeatureItem icon="checkmark-circle-outline" text="Basic의 모든 기능" pro />
            <FeatureItem icon="mic-outline" text="AI 레슨 기록 월 50회" pro />
            <FeatureItem icon="analytics-outline" text="상세 AI 분석·반복 이슈 추적" pro />
          </View>

          {isScheduledDowngradeToBasic && scheduledDate && (
            <View style={s.proRetainRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={DARK_BROWN + 'AA'} />
              <Text style={s.proRetainText}>{scheduledDate}까지 Pro 혜택이 유지됩니다</Text>
            </View>
          )}

          {isCurrentPlan('pro') ? (
            <View style={[s.cta, s.ctaPro, s.ctaActivePlan]}>
              <Ionicons name="checkmark-circle" size={15} color="rgba(255,255,255,0.75)" />
              <Text style={[s.ctaText, { marginLeft: 6 }]}>이용 중</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[s.cta, s.ctaPro, proCtaDisabled && s.ctaDisabled]}
              onPress={!proCtaDisabled ? () => handleSelectPlan('pro') : undefined}
              disabled={proCtaDisabled}
              activeOpacity={0.85}
            >
              {purchasing === 'pro'
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.ctaText}>{getCtaText('pro')}</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {/* 전체 비교 링크 */}
        <TouchableOpacity style={s.compareLink} onPress={() => setCompareVisible(true)}>
          <Text style={s.compareLinkText}>플랜 전체 비교 보기</Text>
          <Ionicons name="chevron-forward" size={14} color={TERRACOTTA} />
        </TouchableOpacity>

        <Text style={s.legalNote}>
          * 가격은 부가세 포함 · 체험 기간 중 언제든 취소 가능{'\n'}
          * 연간 결제 시 {ANNUAL_PRICES.basic?.toLocaleString()}원 / {ANNUAL_PRICES.pro?.toLocaleString()}원 일괄 결제
        </Text>

        <View style={s.subscriptionDisclosure}>
          <Text style={s.subscriptionDisclosureText}>
            구독은 선택한 기간마다 자동으로 갱신되며, 현재 기간 만료 24시간 전까지 취소하지 않으면 갱신됩니다. App Store 계정 설정에서 언제든 관리·해지할 수 있습니다.
          </Text>
          <View style={s.subscriptionDisclosureLinks}>
            <TouchableOpacity onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}>
              <Text style={s.subscriptionDisclosureLink}>이용약관</Text>
            </TouchableOpacity>
            <Text style={s.subscriptionDisclosureSeparator}> · </Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://skeun88.github.io/tennis-coach-app/privacy-policy.html')}>
              <Text style={s.subscriptionDisclosureLink}>개인정보처리방침</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeatureItem({ icon, text, pro }: { icon: string; text: string; pro?: boolean }) {
  return (
    <View style={s.featureItem}>
      <Ionicons name={icon as any} size={14} color={pro ? DARK_BROWN : TERRACOTTA} />
      <Text style={[s.featureItemText, pro && s.featureItemTextPro]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: WARM_GRAY_BORDER,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: DARK_BROWN },
  scroll: { padding: 20, paddingBottom: 48, gap: 0 },

  reasonBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: TERRACOTTA + '12', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
    borderWidth: 1, borderColor: TERRACOTTA + '30',
  },
  reasonBannerText: { fontSize: 13, color: TERRACOTTA, fontWeight: '600', flex: 1, lineHeight: 18 },

  billingToggle: {
    flexDirection: 'row', alignSelf: 'flex-start',
    backgroundColor: '#EDE6DE', borderRadius: 12, padding: 3, marginBottom: 16,
  },
  billingBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  billingBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  billingBtnText: { fontSize: 14, color: WARM_GRAY, fontWeight: '600' },
  billingBtnTextActive: { color: DARK_BROWN },
  savingsBadge: { backgroundColor: TERRACOTTA, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  savingsBadgeText: { fontSize: 9, color: '#fff', fontWeight: '700' },

  planCard: {
    backgroundColor: '#fff', borderRadius: 18,
    borderWidth: 1.5, borderColor: WARM_GRAY_BORDER,
    padding: 20, marginBottom: 14,
  },
  planCardPro: { borderColor: DARK_BROWN + '40', backgroundColor: '#FEFCFA' },
  planCardCurrent: { borderColor: TERRACOTTA },
  planCardProCurrent: { borderColor: DARK_BROWN },
  planCardScheduled: { borderColor: TERRACOTTA + '80' },

  scheduledBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: TERRACOTTA + '18', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, marginBottom: 10,
    borderWidth: 1, borderColor: TERRACOTTA + '35',
  },
  scheduledBadgeText: { fontSize: 11, color: TERRACOTTA, fontWeight: '700' },

  trialBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: TERRACOTTA + '15', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, marginBottom: 10,
  },
  trialBadgePro: { backgroundColor: DARK_BROWN + '12' },
  trialBadgeText: { fontSize: 11, color: TERRACOTTA, fontWeight: '700' },

  planCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  planName: { fontSize: 22, fontWeight: '800', color: DARK_BROWN },
  planNamePro: { color: DARK_BROWN },
  currentBadge: { backgroundColor: TERRACOTTA, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  currentBadgeText: { fontSize: 11, color: '#fff', fontWeight: '700' },

  planPrice: { fontSize: 22, fontWeight: '800', color: TERRACOTTA, marginBottom: 2 },
  planPricePro: { color: DARK_BROWN },
  annualNote: { fontSize: 11, color: WARM_GRAY, marginTop: 2, marginBottom: 2 },

  planDesc: { fontSize: 12, color: WARM_GRAY, marginBottom: 12, marginTop: 4, lineHeight: 17 },

  featureList: { gap: 9, marginBottom: 18 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureItemText: { fontSize: 13, color: DARK_BROWN, fontWeight: '500', flex: 1 },
  featureItemTextPro: { color: DARK_BROWN },

  scheduledDateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: TERRACOTTA + '0C', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, marginBottom: 14,
  },
  scheduledDateText: { fontSize: 12, color: TERRACOTTA, fontWeight: '600' },

  cta: {
    backgroundColor: TERRACOTTA, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  ctaPro: { backgroundColor: DARK_BROWN },
  ctaDisabled: { opacity: 0.4 },
  ctaScheduled: {
    backgroundColor: 'transparent',
    borderWidth: 1.5, borderColor: TERRACOTTA,
    opacity: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  ctaTextScheduled: { fontSize: 15, color: TERRACOTTA, fontWeight: '700' },
  ctaActivePlan: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: 0.75 },

  proRetainRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: DARK_BROWN + '08', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, marginBottom: 14,
  },
  proRetainText: { fontSize: 12, color: DARK_BROWN, fontWeight: '500', flex: 1 },

  compareLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 12, marginBottom: 8,
  },
  compareLinkText: { fontSize: 13, color: TERRACOTTA, fontWeight: '600', textDecorationLine: 'underline' },

  legalNote: { fontSize: 11, color: WARM_GRAY, textAlign: 'center', lineHeight: 18, marginBottom: 12 },
  subscriptionDisclosure: {
    marginTop: 4, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: WARM_GRAY_BORDER,
  },
  subscriptionDisclosureText: {
    fontSize: 10, color: WARM_GRAY, lineHeight: 15, textAlign: 'center',
  },
  subscriptionDisclosureLinks: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8,
  },
  subscriptionDisclosureLink: {
    fontSize: 10, color: TERRACOTTA, textDecorationLine: 'underline',
  },
  subscriptionDisclosureSeparator: { fontSize: 10, color: WARM_GRAY },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  compareSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 40, maxHeight: '85%' },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#E0D8D0', borderRadius: 2, alignSelf: 'center', marginVertical: 12 },
  compareTitle: { fontSize: 17, fontWeight: '800', color: DARK_BROWN, marginBottom: 16 },
  compareHeaderRow: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F0E8E0', marginBottom: 4 },
  compareHeaderCell: { flex: 1, alignItems: 'center' },
  compareHeaderText: { fontSize: 12, fontWeight: '700', color: WARM_GRAY },
  compareRow: { flexDirection: 'row', paddingVertical: 10, alignItems: 'center' },
  compareRowAlt: { backgroundColor: '#FBF7F3', borderRadius: 8 },
  compareRowLabel: { fontSize: 12, color: DARK_BROWN, lineHeight: 16 },
  featureCellText: { fontSize: 11, color: WARM_GRAY, textAlign: 'center' },
  compareCloseBtn: {
    backgroundColor: TERRACOTTA, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center', marginTop: 16,
  },
  compareCloseBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
