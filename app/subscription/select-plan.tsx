import React, { useState, useEffect } from 'react';
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
import Purchases from 'react-native-purchases';
import { PLANS, ANNUAL_PRICES, TRIAL_DAYS } from '../../lib/subscription';
import { IS_BETA } from '../../lib/beta';
import { supabase } from '../../lib/supabase';
import { useSubscription } from '../../hooks/useSubscription';
import { purchaseProductById, getPlanProductId, PLAN_PRODUCT_IDS, ENTITLEMENT_IDS, restorePurchases, getAppUserID, getCurrentBillingCycle, syncDowngradeStatus, syncRevenueCatToDb } from '../../lib/purchases';

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';
const CREAM_CARD = '#FDFAF7';

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
  { label: 'AI 레슨 기록', free: '월 3개', basic: '월 10회', pro: '월 50회' },
  { label: 'AI 레슨 기록 충전권', free: '충전 불가', basic: true, pro: true },
  { label: '14일 무료 체험', free: false, basic: true, pro: true },
  { label: 'AI 맞춤 코칭 분석', free: false, basic: '기본', pro: '상세' },
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

function formatScheduledDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}

export default function SelectPlanScreen() {
  const router = useRouter();
  const { reason } = useLocalSearchParams<{ reason?: string }>();

  const { subscription, isTrial, refresh, loading } = useSubscription();
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [compareVisible, setCompareVisible] = useState(false);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [currentBillingCycle, setCurrentBillingCycle] = useState<'monthly' | 'annual' | null>(null);
  const [willRenew, setWillRenew] = useState<boolean | null>(null);
  const [expirationDate, setExpirationDate] = useState<Date | null>(null);
  const [scheduledBasicBilling, setScheduledBasicBilling] = useState<'monthly' | 'annual' | null>(null);

  const currentPlanId = subscription?.plan_id ?? 'free';

  useEffect(() => {
    if (currentPlanId === 'free') { setCurrentBillingCycle(null); return; }
    getCurrentBillingCycle(currentPlanId as 'basic' | 'pro').then(setCurrentBillingCycle);
  }, [currentPlanId]);

  useEffect(() => {
    (async () => {
      try {
        await Purchases.invalidateCustomerInfoCache();
        const info = await Purchases.getCustomerInfo();
        const active = info.entitlements.active;
        const proEnt = active[ENTITLEMENT_IDS.PRO];
        const basicEnt = active[ENTITLEMENT_IDS.BASIC];
        const ent = proEnt ?? basicEnt ?? null;
        // Pro + Basic 둘 다 active = Pro 기간 중 Basic 구매 → 다운그레이드 예약 케이스
        if (proEnt && basicEnt) {
          setWillRenew(false);
          const basicProductId: string = (basicEnt as any)?.productIdentifier ?? '';
          setScheduledBasicBilling(
            basicProductId === PLAN_PRODUCT_IDS.basic.annual ? 'annual' : 'monthly'
          );
        } else {
          // null(미확인) 유지 → true 가정 시 downgrade 배지가 잘못 숨겨짐
          const rv = (ent as any)?.willRenew;
          if (typeof rv === 'boolean') setWillRenew(rv);
        }
        const expStr = (proEnt as any)?.expirationDate ?? (ent as any)?.expirationDate;
        if (expStr) setExpirationDate(new Date(expStr));
      } catch {
        // 네트워크 오류: null 유지 (true 가정 금지)
      }
      // Apple IAP 다운그레이드 예약 감지 (RC v2 → DB 업데이트)
      await syncDowngradeStatus();
      await refresh();
    })();
  }, []);

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

  // DB pending_plan_id(Toss 결제용) 또는 RC willRenew=false(Apple IAP용)
  const dbScheduledDowngrade = subscription?.pending_plan_id === 'basic' && !!subscription?.downgrade_at;
  const isScheduledDowngradeToBasic = currentPlanId === 'pro' && (dbScheduledDowngrade || willRenew === false);
  // Basic 카드 UI: 예약된 billing 타입과 현재 탭이 일치할 때만 "변경 완료예정" 표시
  const isScheduledDowngradeToThisBilling = isScheduledDowngradeToBasic &&
    (scheduledBasicBilling === null || scheduledBasicBilling === billing);
  // Pro인데 willRenew 아직 조회 중 → CTA 눌러서 Apple 팝업 뜨지 않도록 로딩 표시
  const isProAndLoadingWillRenew = currentPlanId === 'pro' && !dbScheduledDowngrade && willRenew === null;

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
    if (isActive && subscription?.coach_id) {
      await syncRevenueCatToDb(subscription.coach_id).catch(() => {});
    }
    await refresh();
    if (isActive) {
      const msg = isTrial
        ? `${PLANS[planId].name} 플랜 무료 체험이 시작되었습니다.`
        : `${PLANS[planId].name} 플랜으로 변경되었습니다.`;
      Alert.alert('완료', msg, [
        { text: '확인', onPress: () => router.replace('/subscription/manage') },
      ]);
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

  async function handleRestoreForPlan(planId: 'basic' | 'pro') {
    setPurchasing(planId);
    try {
      const customerInfo = await restorePurchases();
      await applySubscription(customerInfo, planId);
    } catch (e: any) {
      if (isOtherSubscriberError(e)) {
        showOtherSubscriberAlert();
      } else {
        Alert.alert('복원 실패', e.message ?? '구매 복원 중 오류가 발생했습니다.');
      }
    } finally {
      setPurchasing(null);
    }
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

  const isPaidUser = currentPlanId !== 'free';

  if (loading && !subscription) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={DARK_BROWN} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>요금제 변경</Text>
        </View>
        <ActivityIndicator size="large" color={TERRACOTTA} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      {/* 플랜 전체 비교 모달 */}
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
                <Text style={s.savingsBadgeText}>할인</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Free 카드 */}
        <View style={[s.planCard, currentPlanId === 'free' && s.planCardCurrent]}>
          <View style={s.planCardHeader}>
            <Text style={s.planName}>Free</Text>
            {currentPlanId === 'free' && (
              <View style={s.currentBadge}>
                <Text style={s.currentBadgeText}>현재 플랜</Text>
              </View>
            )}
          </View>
          <Text style={s.planPrice}>무료</Text>
          <View style={s.featureList}>
            <FeatureItem icon="people-outline" text="회원 3명까지 등록" />
            <FeatureItem icon="grid-outline" text="일정·출석·결제 관리" />
            <FeatureItem icon="mic-outline" text="AI 레슨 기록 월 3회" />
          </View>
          {isPaidUser ? (
            <TouchableOpacity style={s.freeCta} onPress={openStoreManagement} activeOpacity={0.8}>
              <Text style={s.freeCtaText}>구독 취소 시 자동 전환</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.freeCta}>
              <Text style={s.freeCtaText}>현재 플랜</Text>
            </View>
          )}
        </View>

        {/* Basic 카드 */}
        <View style={[s.planCard, s.planCardPaid,
          isCurrentPlan('basic') && s.planCardCurrent,
          isScheduledDowngradeToThisBilling && s.planCardScheduled,
        ]}>
          <View style={s.planCardHeader}>
            <Text style={[s.planName, s.planNamePaid]}>Basic</Text>
            <View style={s.badgeRow}>
              {isScheduledDowngradeToThisBilling && (
                <View style={s.scheduledBadge}>
                  <Text style={s.scheduledBadgeText}>변경 예정</Text>
                </View>
              )}
              {isCurrentPlan('basic') && (
                <View style={s.currentBadge}>
                  <Text style={s.currentBadgeText}>이용 중</Text>
                </View>
              )}
              {!isScheduledDowngradeToThisBilling && !isCurrentPlan('basic') && isTrialEligible && (
                <View style={s.trialBadge}>
                  <Text style={s.trialBadgeText}>{TRIAL_DAYS}일 무료</Text>
                </View>
              )}
            </View>
          </View>

          {billing === 'monthly' ? (
            <Text style={[s.planPrice, s.planPricePaid]}>{PLANS.basic.price.toLocaleString()}원/월</Text>
          ) : (
            <View>
              <Text style={[s.planPrice, s.planPricePaid]}>{ANNUAL_PRICES.basic?.toLocaleString()}원/년</Text>
              <Text style={s.annualNote}>월 약 {monthlyEquivalent('basic').toLocaleString()}원</Text>
            </View>
          )}

          <Text style={s.planDesc}>회원 관리와 기본 AI 코칭</Text>

          <View style={s.featureList}>
            <FeatureItem icon="people-outline" text="회원 무제한 등록" />
            <FeatureItem icon="grid-outline" text="일정·출석·회차 관리" />
            <FeatureItem icon="card-outline" text="레슨권·결제 관리" />
            <FeatureItem icon="notifications-outline" text="회원 관리 자동 알림" />
            <FeatureItem icon="mic-outline" text="AI 레슨 기록 월 10회" />
            <FeatureItem icon="analytics-outline" text="기본 AI 코칭 분석" />
            <FeatureItem icon="add-circle-outline" text="AI 레슨 기록 추가 충전 가능" />
          </View>

          {isScheduledDowngradeToThisBilling && expirationDate && (
            <View style={s.scheduledDateRow}>
              <Ionicons name="calendar-outline" size={12} color={TERRACOTTA} />
              <Text style={s.scheduledDateText}>{formatScheduledDate(expirationDate)}부터 적용 예정</Text>
            </View>
          )}

          {isScheduledDowngradeToThisBilling ? (
            <View style={[s.statusView, s.statusViewScheduled]}>
              <Ionicons name="checkmark-circle" size={16} color={TERRACOTTA} />
              <Text style={s.statusViewText}>베이직으로 변경 완료예정</Text>
            </View>
          ) : isProAndLoadingWillRenew ? (
            <View style={[s.paidCta, s.paidCtaDisabled]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : isCurrentPlan('basic') ? (
            <View style={[s.statusView, s.statusViewCurrent]}>
              <Ionicons name="checkmark-circle" size={16} color={TERRACOTTA} />
              <Text style={[s.statusViewText, { color: TERRACOTTA }]}>이용 중</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[s.paidCta, !!purchasing && s.paidCtaDisabled]}
              onPress={!purchasing ? () => handleSelectPlan('basic') : undefined}
              disabled={!!purchasing}
              activeOpacity={0.85}
            >
              {purchasing === 'basic'
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.paidCtaText}>{getCtaText('basic')}</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {/* Pro 카드 */}
        <View style={[s.planCard, s.planCardPaid, s.planCardPro,
          isCurrentPlan('pro') && s.planCardProCurrent,
        ]}>
          <View style={s.planCardHeader}>
            <Text style={[s.planName, s.planNamePro]}>Pro</Text>
            <View style={s.badgeRow}>
              {!isScheduledDowngradeToBasic && (
                <View style={[s.trialBadge, s.trialBadgePro]}>
                  <Ionicons name="star-outline" size={11} color={DARK_BROWN} />
                  <Text style={[s.trialBadgeText, { color: DARK_BROWN }]}>
                    {isTrialEligible ? `추천 · ${TRIAL_DAYS}일 무료` : '추천'}
                  </Text>
                </View>
              )}
              {isCurrentPlan('pro') && (
                <View style={[s.currentBadge, { backgroundColor: DARK_BROWN }]}>
                  <Text style={s.currentBadgeText}>이용 중</Text>
                </View>
              )}
            </View>
          </View>

          {billing === 'monthly' ? (
            <Text style={[s.planPrice, s.planPricePro]}>{PLANS.pro.price.toLocaleString()}원/월</Text>
          ) : (
            <View>
              <Text style={[s.planPrice, s.planPricePro]}>{ANNUAL_PRICES.pro?.toLocaleString()}원/년</Text>
              <Text style={s.annualNote}>월 약 {monthlyEquivalent('pro').toLocaleString()}원</Text>
            </View>
          )}

          <Text style={s.planDesc}>AI 코칭을 적극적으로 활용하는 코치</Text>

          <View style={s.featureList}>
            <FeatureItem icon="grid-outline" text="Basic의 모든 기능" />
            <FeatureItem icon="mic-outline" text="AI 레슨 기록 월 50회" />
            <FeatureItem icon="analytics-outline" text="상세 AI 코칭 분석" />
            <FeatureItem icon="refresh-outline" text="회원별 반복 이슈 분석" />
            <FeatureItem icon="trending-up-outline" text="레슨 기록 기반 키워드·성장 변화 추적" />
            <FeatureItem icon="bulb-outline" text="개인화 AI 코칭 기능" />
            <FeatureItem icon="add-circle-outline" text="AI 레슨 기록 추가 충전 가능" />
          </View>

          {isScheduledDowngradeToBasic && expirationDate && (
            <View style={s.scheduledDateRow}>
              <Ionicons name="information-circle-outline" size={12} color={WARM_GRAY} />
              <Text style={[s.scheduledDateText, { color: WARM_GRAY }]}>{formatScheduledDate(expirationDate)}까지 Pro 혜택 유지</Text>
            </View>
          )}

          {isCurrentPlan('pro') ? (
            <View style={[s.statusView, s.statusViewPro]}>
              <Ionicons name="checkmark-circle" size={16} color={DARK_BROWN} />
              <Text style={[s.statusViewText, { color: DARK_BROWN }]}>이용 중</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[s.paidCta, s.paidCtaPro, !!purchasing && s.paidCtaDisabled]}
              onPress={!purchasing ? () => handleSelectPlan('pro') : undefined}
              disabled={!!purchasing}
              activeOpacity={0.85}
            >
              {purchasing === 'pro'
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.paidCtaText}>{getCtaText('pro')}</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {/* 하단 링크 */}
        <View style={s.bottomLinks}>
          <TouchableOpacity style={s.bottomLink} onPress={() => setCompareVisible(true)}>
            <Text style={s.bottomLinkText}>전체 기능 비교</Text>
            <Ionicons name="chevron-forward" size={13} color={TERRACOTTA} />
          </TouchableOpacity>
          <View style={s.bottomLinkDivider} />
          <TouchableOpacity style={s.bottomLink} onPress={openStoreManagement}>
            <Text style={s.bottomLinkText}>
              {Platform.OS === 'ios' ? 'App Store에서 구독 관리' : 'Google Play에서 구독 관리'}
            </Text>
            <Ionicons name="chevron-forward" size={13} color={TERRACOTTA} />
          </TouchableOpacity>
        </View>

        {/* Apple 가이드라인 3.1.2 구독 필수 고지 */}
        <View style={s.subscriptionDisclosure}>
          <Text style={s.subscriptionDisclosureText}>
            구독은 선택한 기간마다 자동으로 갱신되며, 현재 기간 만료 24시간 전까지 취소하지 않으면 갱신됩니다.{'\n'}
            App Store 계정 설정에서 언제든 관리·해지할 수 있습니다.
          </Text>
          <Text style={s.subscriptionDisclosureText}>
            월간 {PLANS.basic.price.toLocaleString()}원(Basic) / {PLANS.pro.price.toLocaleString()}원(Pro){ANNUAL_PRICES.basic ? ` · 연간 ${ANNUAL_PRICES.basic.toLocaleString()}원(Basic) / ${ANNUAL_PRICES.pro?.toLocaleString()}원(Pro)` : ''}
          </Text>
          <View style={s.subscriptionDisclosureLinks}>
            <TouchableOpacity onPress={() => Linking.openURL('https://kerri.co.kr/terms').catch(() => {})}>
              <Text style={s.subscriptionDisclosureLink}>이용약관</Text>
            </TouchableOpacity>
            <Text style={s.subscriptionDisclosureSeparator}> · </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/privacy-policy')}>
              <Text style={s.subscriptionDisclosureLink}>개인정보처리방침</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={s.featureItem}>
      <Ionicons name={icon as any} size={14} color={TERRACOTTA} />
      <Text style={s.featureItemText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 17, fontWeight: '700', color: DARK_BROWN,
    flex: 1, textAlign: 'center', marginRight: 40,
  },
  backBtn: { padding: 8 },
  scroll: { paddingHorizontal: 20, paddingBottom: 48, paddingTop: 8 },

  reasonBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: TERRACOTTA + '12', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
    borderWidth: 1, borderColor: TERRACOTTA + '30',
  },
  reasonBannerText: { fontSize: 13, color: TERRACOTTA, fontWeight: '600', flex: 1, lineHeight: 18 },

  billingToggle: {
    flexDirection: 'row', alignSelf: 'flex-start',
    backgroundColor: '#EDE6DE', borderRadius: 10, padding: 3, marginBottom: 16,
  },
  billingBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8,
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  billingBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  billingBtnText: { fontSize: 13, color: WARM_GRAY, fontWeight: '600' },
  billingBtnTextActive: { color: DARK_BROWN },
  savingsBadge: {
    backgroundColor: TERRACOTTA, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1,
  },
  savingsBadgeText: { fontSize: 9, color: '#fff', fontWeight: '700' },

  planCard: {
    backgroundColor: CREAM_CARD, borderRadius: 16,
    borderWidth: 1.5, borderColor: WARM_GRAY_BORDER,
    padding: 18, marginBottom: 12,
  },
  planCardPaid: { borderColor: WARM_GRAY_BORDER },
  planCardPro: { borderColor: DARK_BROWN + '40', backgroundColor: '#FEFCFA' },
  planCardCurrent: { borderColor: TERRACOTTA },
  planCardProCurrent: { borderColor: DARK_BROWN },
  planCardScheduled: { borderColor: TERRACOTTA + '70' },

  planCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8,
  },
  planName: { fontSize: 20, fontWeight: '800', color: WARM_GRAY },
  planNamePaid: { color: DARK_BROWN },
  planNamePro: { color: DARK_BROWN },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  currentBadge: {
    backgroundColor: TERRACOTTA, borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  currentBadgeText: { fontSize: 11, color: '#fff', fontWeight: '700' },

  scheduledBadge: {
    backgroundColor: TERRACOTTA + '20', borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: TERRACOTTA + '40',
  },
  scheduledBadgeText: { fontSize: 11, color: TERRACOTTA, fontWeight: '700' },

  trialBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: TERRACOTTA + '15', borderRadius: 7,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  trialBadgePro: { backgroundColor: DARK_BROWN + '12' },
  trialBadgeText: { fontSize: 11, color: TERRACOTTA, fontWeight: '700' },

  planPrice: { fontSize: 22, fontWeight: '800', color: WARM_GRAY, marginBottom: 4 },
  planPricePaid: { color: TERRACOTTA },
  planPricePro: { color: DARK_BROWN },
  annualNote: { fontSize: 11, color: WARM_GRAY, marginBottom: 4 },

  planDesc: { fontSize: 12, color: WARM_GRAY, marginBottom: 12, lineHeight: 17 },

  featureList: { gap: 9, marginBottom: 16 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureItemText: { fontSize: 13, color: DARK_BROWN, fontWeight: '500', flex: 1 },

  scheduledDateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginBottom: 12,
  },
  scheduledDateText: { fontSize: 12, color: TERRACOTTA, fontWeight: '600' },

  statusView: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12, paddingVertical: 13,
    borderWidth: 1.5, borderColor: TERRACOTTA + '40',
  },
  statusViewCurrent: { borderColor: TERRACOTTA + '40' },
  statusViewPro: { borderColor: DARK_BROWN + '30' },
  statusViewScheduled: { backgroundColor: TERRACOTTA + '08' },
  statusViewText: { fontSize: 14, color: TERRACOTTA, fontWeight: '700' },

  freeCta: {
    backgroundColor: 'transparent', borderRadius: 12,
    borderWidth: 1.5, borderColor: WARM_GRAY_BORDER,
    paddingVertical: 13, alignItems: 'center',
  },
  freeCtaText: { fontSize: 14, color: WARM_GRAY, fontWeight: '600' },

  paidCta: {
    backgroundColor: TERRACOTTA, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  paidCtaPro: { backgroundColor: DARK_BROWN },
  paidCtaDisabled: { opacity: 0.4 },
  paidCtaText: { fontSize: 15, color: '#fff', fontWeight: '700' },

  bottomLinks: {
    backgroundColor: CREAM_CARD, borderRadius: 14,
    borderWidth: 1, borderColor: WARM_GRAY_BORDER,
    marginTop: 4, marginBottom: 16, overflow: 'hidden',
  },
  bottomLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  bottomLinkText: { fontSize: 14, color: DARK_BROWN, fontWeight: '500' },
  bottomLinkDivider: { height: 1, backgroundColor: WARM_GRAY_BORDER, marginHorizontal: 16 },

  subscriptionDisclosure: {
    paddingTop: 12, borderTopWidth: 1, borderTopColor: WARM_GRAY_BORDER, gap: 6,
  },
  subscriptionDisclosureText: {
    fontSize: 10, color: WARM_GRAY, lineHeight: 15, textAlign: 'center',
  },
  subscriptionDisclosureLinks: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 2,
  },
  subscriptionDisclosureLink: {
    fontSize: 10, color: TERRACOTTA, textDecorationLine: 'underline',
  },
  subscriptionDisclosureSeparator: { fontSize: 10, color: WARM_GRAY },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  compareSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, maxHeight: '85%',
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: '#E0D8D0', borderRadius: 2,
    alignSelf: 'center', marginVertical: 12,
  },
  compareTitle: { fontSize: 17, fontWeight: '800', color: DARK_BROWN, marginBottom: 16 },
  compareHeaderRow: {
    flexDirection: 'row', paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#F0E8E0', marginBottom: 4,
  },
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
