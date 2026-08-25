import React, { useState } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PLANS, ANNUAL_PRICES, TRIAL_DAYS } from '../../lib/subscription';
import { IS_BETA } from '../../lib/beta';
import { useSubscription } from '../../hooks/useSubscription';

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';
const CREAM_CARD = '#FDFAF7';

// 출시가 vs 정가 (할인율 표시용)
const REGULAR_PRICES = { basic: 19000, pro: 39000 };
const DISCOUNT_PCTS = { basic: 48, pro: 51 };

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

export default function SelectPlanScreen() {
  const router = useRouter();
  if (IS_BETA) { router.replace('/(tabs)'); return null; }

  const { subscription, isTrial } = useSubscription();
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [compareVisible, setCompareVisible] = useState(false);

  const currentPlanId = subscription?.plan_id ?? 'free';

  // 신규 유료 구독 자격: Free 플랜이고 trial을 한 번도 사용하지 않은 사용자
  // (createFreeSubscription은 trial_starts_at === trial_ends_at로 기록)
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

  function getCtaText(planId: 'basic' | 'pro'): string {
    if (currentPlanId === planId) return '현재 플랜';
    if (isTrialEligible) return '14일 무료로 시작하기';
    if (currentPlanId === 'free') return `${PLANS[planId].name} 구독하기`;
    return `${PLANS[planId].name}으로 변경`;
  }

  function handleSelectPlan(planId: 'basic' | 'pro') {
    router.push({
      pathname: '/subscription/confirm-plan',
      params: { planId, billingType: billing },
    });
  }

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
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>나에게 맞는 플랜을{'\n'}선택하세요</Text>
        <Text style={s.subtitle}>Basic과 Pro는 신규 구독 시 {TRIAL_DAYS}일 동안 무료로 이용할 수 있어요.</Text>

        {/* 출시가 안내 배너 */}
        <View style={s.launchBanner}>
          <Ionicons name="pricetag-outline" size={13} color={TERRACOTTA} />
          <Text style={s.launchBannerText}>
            출시가는 첫 유료 결제일부터 12개월간 적용되며, 이후 다음 갱신부터 정가가 적용됩니다.
          </Text>
        </View>

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
                <Text style={s.savingsBadgeText}>1개월 무료</Text>
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
          <Text style={s.planDesc}>기본 회원 관리를 가볍게 시작해 보세요.</Text>
          <View style={s.featureList}>
            <FeatureItem icon="people-outline" text="회원 3명까지 등록" />
            <FeatureItem icon="grid-outline" text="일정·출석·횟수·결제 관리" />
            <FeatureItem icon="mic-outline" text="AI 레슨 기록 월 3개" />
          </View>
          {currentPlanId === 'free' ? (
            <TouchableOpacity style={s.freeCta} disabled>
              <Text style={s.freeCtaText}>현재 플랜</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={s.freeCta}
              onPress={() => {
                const url = Platform.OS === 'ios'
                  ? 'https://apps.apple.com/account/subscriptions'
                  : 'https://play.google.com/store/account/subscriptions';
                Linking.openURL(url);
              }}
            >
              <Text style={[s.freeCtaText, { color: TERRACOTTA }]}>
                {Platform.OS === 'ios' ? 'App Store에서 구독 관리' : 'Google Play에서 구독 관리'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Basic 카드 */}
        <View style={[s.planCard, s.planCardPaid, currentPlanId === 'basic' && s.planCardCurrent]}>
          {isTrialEligible && (
            <View style={s.trialBadge}>
              <Ionicons name="gift-outline" size={12} color={TERRACOTTA} />
              <Text style={s.trialBadgeText}>{TRIAL_DAYS}일 무료 체험</Text>
            </View>
          )}
          <View style={s.planCardHeader}>
            <Text style={[s.planName, s.planNamePaid]}>Basic</Text>
            {currentPlanId === 'basic' && (
              <View style={s.currentBadge}>
                <Text style={s.currentBadgeText}>이용 중</Text>
              </View>
            )}
          </View>
          {billing === 'monthly' ? (
            <View style={s.priceBlock}>
              <View style={s.priceTopRow}>
                <Text style={[s.planPrice, s.planPricePaid]}>{PLANS.basic.price.toLocaleString()}원/월</Text>
                <View style={s.discountBadge}>
                  <Text style={s.discountBadgeText}>정가 대비 {DISCOUNT_PCTS.basic}% 할인</Text>
                </View>
              </View>
              <View style={s.regularPriceRow}>
                <Text style={s.launchLabel}>출시가</Text>
                <Text style={s.regularPrice}>정가 {REGULAR_PRICES.basic.toLocaleString()}원</Text>
              </View>
              <Text style={s.launchPeriodNote}>첫 유료 결제일부터 12개월 적용</Text>
            </View>
          ) : (
            <View style={s.priceBlock}>
              <Text style={[s.planPrice, s.planPricePaid]}>{ANNUAL_PRICES.basic?.toLocaleString()}원/년</Text>
              <Text style={s.annualSavings}>월 약 {monthlyEquivalent('basic').toLocaleString()}원 · 1개월 무료</Text>
            </View>
          )}
          <Text style={s.planDesc}>회원 관리와 기본 AI 분석이 필요한 코치</Text>
          <View style={s.featureList}>
            <FeatureItem icon="people-outline" text="회원 무제한 등록" />
            <FeatureItem icon="grid-outline" text="일정·출석·횟수·결제 관리" />
            <FeatureItem icon="notifications-outline" text="회원 관리 자동 알림" />
            <FeatureItem icon="mic-outline" text="AI 레슨 기록 월 10개" />
            <FeatureItem icon="analytics-outline" text="AI 맞춤 코칭 분석 기본 제공" />
            <FeatureItem icon="add-circle-outline" text="AI 레슨 기록 충전 가능" />
          </View>
          <TouchableOpacity
            style={[s.paidCta, currentPlanId === 'basic' && s.paidCtaDisabled]}
            onPress={currentPlanId !== 'basic' ? () => handleSelectPlan('basic') : undefined}
            disabled={currentPlanId === 'basic'}
            activeOpacity={0.85}
          >
            <Text style={s.paidCtaText}>{getCtaText('basic')}</Text>
          </TouchableOpacity>
        </View>

        {/* Pro 카드 (추천) */}
        <View style={[s.planCard, s.planCardPaid, s.planCardPro, currentPlanId === 'pro' && s.planCardProCurrent]}>
          <View style={[s.trialBadge, s.trialBadgePro]}>
            <Ionicons name="star-outline" size={12} color={DARK_BROWN} />
            <Text style={[s.trialBadgeText, { color: DARK_BROWN }]}>
              {isTrialEligible ? `추천 · ${TRIAL_DAYS}일 무료 체험` : '추천'}
            </Text>
          </View>
          <View style={s.planCardHeader}>
            <Text style={[s.planName, s.planNamePro]}>Pro</Text>
            {currentPlanId === 'pro' && (
              <View style={[s.currentBadge, { backgroundColor: DARK_BROWN }]}>
                <Text style={s.currentBadgeText}>이용 중</Text>
              </View>
            )}
          </View>
          {billing === 'monthly' ? (
            <View style={s.priceBlock}>
              <View style={s.priceTopRow}>
                <Text style={[s.planPrice, s.planPricePro]}>{PLANS.pro.price.toLocaleString()}원/월</Text>
                <View style={[s.discountBadge, { backgroundColor: DARK_BROWN }]}>
                  <Text style={s.discountBadgeText}>정가 대비 {DISCOUNT_PCTS.pro}% 할인</Text>
                </View>
              </View>
              <View style={s.regularPriceRow}>
                <Text style={[s.launchLabel, { color: DARK_BROWN }]}>출시가</Text>
                <Text style={s.regularPrice}>정가 {REGULAR_PRICES.pro.toLocaleString()}원</Text>
              </View>
              <Text style={[s.launchPeriodNote, { color: DARK_BROWN + 'AA' }]}>첫 유료 결제일부터 12개월 적용</Text>
            </View>
          ) : (
            <View style={s.priceBlock}>
              <Text style={[s.planPrice, s.planPricePro]}>{ANNUAL_PRICES.pro?.toLocaleString()}원/년</Text>
              <Text style={s.annualSavings}>월 약 {monthlyEquivalent('pro').toLocaleString()}원 · 1개월 무료</Text>
            </View>
          )}
          <Text style={s.planDesc}>AI 분석을 적극적으로 활용하는 전문 코치</Text>
          <View style={s.featureList}>
            <FeatureItem icon="people-outline" text="회원 무제한 등록" />
            <FeatureItem icon="grid-outline" text="일정·출석·횟수·결제 관리" />
            <FeatureItem icon="notifications-outline" text="회원 관리 자동 알림" />
            <FeatureItem icon="mic-outline" text="AI 레슨 기록 월 50개" />
            <FeatureItem icon="analytics-outline" text="AI 맞춤 코칭 분석 상세 제공" />
            <FeatureItem icon="key-outline" text="회원별 반복 이슈·키워드 분석" />
            <FeatureItem icon="person-circle-outline" text="개인화 AI · 코치 브랜딩" />
            <FeatureItem icon="add-circle-outline" text="AI 레슨 기록 충전 가능" />
          </View>
          <TouchableOpacity
            style={[s.paidCta, s.paidCtaPro, currentPlanId === 'pro' && s.paidCtaDisabled]}
            onPress={currentPlanId !== 'pro' ? () => handleSelectPlan('pro') : undefined}
            disabled={currentPlanId === 'pro'}
            activeOpacity={0.85}
          >
            <Text style={s.paidCtaText}>{getCtaText('pro')}</Text>
          </TouchableOpacity>
        </View>

        {/* 전체 비교 링크 */}
        <TouchableOpacity style={s.compareLink} onPress={() => setCompareVisible(true)}>
          <Text style={s.compareLinkText}>플랜 전체 비교 보기</Text>
          <Ionicons name="chevron-forward" size={14} color={TERRACOTTA} />
        </TouchableOpacity>

        <Text style={s.legalNote}>
          * 출시가는 한시적 특별가로, 종료 시 정가로 변경됩니다{'\n'}
          * 가격은 부가세 포함 · 체험 기간 중 언제든 취소 가능{'\n'}
          * 연간 결제 시 {ANNUAL_PRICES.basic?.toLocaleString()}원 / {ANNUAL_PRICES.pro?.toLocaleString()}원 일괄 결제
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeatureItem({ icon, text, dim }: { icon: string; text: string; dim?: boolean }) {
  return (
    <View style={s.featureItem}>
      <Ionicons name={icon as any} size={14} color={dim ? WARM_GRAY_BORDER : TERRACOTTA} />
      <Text style={[s.featureItemText, dim && s.featureItemTextDim]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  backBtn: { padding: 8 },
  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '800', color: DARK_BROWN, marginBottom: 6, lineHeight: 34 },
  subtitle: { fontSize: 13, color: WARM_GRAY, marginBottom: 12, lineHeight: 18 },
  launchBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: TERRACOTTA + '12', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16,
  },
  launchBannerText: { fontSize: 11, color: TERRACOTTA, fontWeight: '500', flex: 1, lineHeight: 16 },
  planDesc: { fontSize: 12, color: WARM_GRAY, marginBottom: 12, lineHeight: 17 },
  launchPeriodNote: { fontSize: 10, color: TERRACOTTA + 'AA', marginTop: 2 },

  billingToggle: {
    flexDirection: 'row', alignSelf: 'flex-start',
    backgroundColor: '#EDE6DE', borderRadius: 12, padding: 3, marginBottom: 20,
  },
  billingBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  billingBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  billingBtnText: { fontSize: 14, color: WARM_GRAY, fontWeight: '600' },
  billingBtnTextActive: { color: DARK_BROWN },
  savingsBadge: { backgroundColor: TERRACOTTA, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  savingsBadgeText: { fontSize: 9, color: '#fff', fontWeight: '700' },

  planCard: {
    backgroundColor: CREAM_CARD, borderRadius: 16,
    borderWidth: 1.5, borderColor: WARM_GRAY_BORDER,
    padding: 20, marginBottom: 14,
  },
  planCardPaid: { borderColor: WARM_GRAY_BORDER },
  planCardPro: { borderColor: DARK_BROWN + '50', backgroundColor: '#FEFCFA' },
  planCardCurrent: { borderColor: TERRACOTTA },
  planCardProCurrent: { borderColor: DARK_BROWN },

  trialBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: TERRACOTTA + '15', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, marginBottom: 10,
  },
  trialBadgePro: { backgroundColor: DARK_BROWN + '12' },
  trialBadgeText: { fontSize: 11, color: TERRACOTTA, fontWeight: '700' },

  planCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  planName: { fontSize: 20, fontWeight: '800', color: WARM_GRAY },
  planNamePaid: { color: DARK_BROWN },
  planNamePro: { color: DARK_BROWN },
  currentBadge: { backgroundColor: TERRACOTTA, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  currentBadgeText: { fontSize: 11, color: '#fff', fontWeight: '700' },

  priceBlock: { marginBottom: 16 },
  priceTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  planPrice: { fontSize: 24, fontWeight: '800', color: WARM_GRAY },
  planPricePaid: { color: TERRACOTTA },
  planPricePro: { color: DARK_BROWN },
  discountBadge: {
    backgroundColor: TERRACOTTA, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  discountBadgeText: { fontSize: 11, color: '#fff', fontWeight: '800' },
  regularPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  launchLabel: { fontSize: 11, color: TERRACOTTA, fontWeight: '700' },
  regularPrice: { fontSize: 11, color: WARM_GRAY, textDecorationLine: 'line-through' },
  annualSavings: { fontSize: 11, color: WARM_GRAY, marginTop: 3 },

  featureList: { gap: 10, marginBottom: 18 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureItemText: { fontSize: 13, color: DARK_BROWN, fontWeight: '500', flex: 1 },
  featureItemTextDim: { color: WARM_GRAY },

  freeCta: {
    backgroundColor: 'transparent', borderRadius: 12,
    borderWidth: 1.5, borderColor: WARM_GRAY_BORDER,
    paddingVertical: 14, alignItems: 'center',
  },
  freeCtaText: { fontSize: 14, color: WARM_GRAY, fontWeight: '600' },
  paidCta: {
    backgroundColor: TERRACOTTA, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  paidCtaPro: { backgroundColor: DARK_BROWN },
  paidCtaDisabled: { opacity: 0.4 },
  paidCtaText: { fontSize: 15, color: '#fff', fontWeight: '700' },

  compareLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 12, marginBottom: 12,
  },
  compareLinkText: { fontSize: 13, color: TERRACOTTA, fontWeight: '600', textDecorationLine: 'underline' },

  legalNote: { fontSize: 11, color: WARM_GRAY, textAlign: 'center', lineHeight: 18, marginTop: 4 },

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
