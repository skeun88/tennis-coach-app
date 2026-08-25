import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PLANS, ANNUAL_PRICES, TRIAL_DAYS } from '../../lib/subscription';
import { useSubscription } from '../../hooks/useSubscription';

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';

const REGULAR_PRICES: Record<string, number> = { basic: 19000, pro: 39000 };

export default function ConfirmPlanScreen() {
  const router = useRouter();
  const { planId, billingType } = useLocalSearchParams<{ planId: string; billingType: string }>();
  const { subscription, isTrial } = useSubscription();

  const plan = planId === 'basic' || planId === 'pro' ? PLANS[planId] : null;
  if (!plan) {
    router.back();
    return null;
  }

  const isAnnual = billingType === 'annual';
  const isTrialEligible = (() => {
    if (!subscription) return true;
    if (subscription.plan_id !== 'free') return false;
    if (isTrial) return false;
    const ts = subscription.trial_starts_at ? new Date(subscription.trial_starts_at).getTime() : 0;
    const te = subscription.trial_ends_at ? new Date(subscription.trial_ends_at).getTime() : 0;
    return Math.abs(ts - te) < 5000;
  })();

  const isChangingPlan = !!subscription && subscription.plan_id !== 'free' && subscription.plan_id !== planId;

  const annualPrice = ANNUAL_PRICES[planId as 'basic' | 'pro'];
  const displayPrice = isAnnual && annualPrice
    ? `${annualPrice.toLocaleString()}원/년`
    : `${plan.price.toLocaleString()}원/월`;

  const isPro = planId === 'pro';
  const accentColor = isPro ? DARK_BROWN : TERRACOTTA;

  function handleConfirm() {
    router.push({
      pathname: '/subscription/register-card',
      params: { planId, billingType: isAnnual ? 'biannual' : 'monthly' },
    });
  }

  const ctaLabel = (() => {
    if (isTrialEligible) return `${TRIAL_DAYS}일 무료 체험 시작`;
    if (isChangingPlan) return `${plan.name}으로 변경`;
    return `${plan.name} 구독 시작`;
  })();

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color={DARK_BROWN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>결제 확인</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* 플랜 요약 카드 */}
        <View style={[s.planCard, { borderColor: accentColor + '60' }]}>
          <View style={s.planCardRow}>
            <Text style={[s.planName, { color: accentColor }]}>{plan.name}</Text>
            <Text style={[s.planPrice, { color: accentColor }]}>{displayPrice}</Text>
          </View>
          {isAnnual && annualPrice && (
            <Text style={s.annualNote}>월 약 {Math.round(annualPrice / 12).toLocaleString()}원 · 1개월 무료 혜택</Text>
          )}
          {!isAnnual && REGULAR_PRICES[planId] && (
            <View style={s.launchRow}>
              <Text style={s.launchLabel}>출시가</Text>
              <Text style={s.regularPrice}>정가 {REGULAR_PRICES[planId].toLocaleString()}원</Text>
            </View>
          )}
        </View>

        {/* 체험 안내 */}
        {isTrialEligible && (
          <View style={s.trialCard}>
            <Ionicons name="gift-outline" size={20} color={TERRACOTTA} />
            <View style={{ flex: 1 }}>
              <Text style={s.trialTitle}>{TRIAL_DAYS}일 무료 체험</Text>
              <Text style={s.trialDesc}>
                체험 기간 중에는 요금이 청구되지 않으며, 언제든 취소할 수 있습니다.
                체험 종료 후 {displayPrice}이 자동 결제됩니다.
              </Text>
            </View>
          </View>
        )}

        {/* 플랜 변경 안내 */}
        {isChangingPlan && subscription && (
          <View style={s.changeCard}>
            <Ionicons name="swap-horizontal-outline" size={18} color={WARM_GRAY} />
            <Text style={s.changeDesc}>
              현재 {PLANS[subscription.plan_id]?.name} 플랜에서 {plan.name} 플랜으로 변경됩니다.
              변경은 다음 결제일부터 적용됩니다.
            </Text>
          </View>
        )}

        {/* 포함 기능 */}
        <View style={s.featuresCard}>
          <Text style={s.featuresTitle}>{plan.name} 플랜 포함 기능</Text>
          {planId === 'basic' ? (
            <>
              <ConfirmFeatureRow text="회원 무제한" />
              <ConfirmFeatureRow text="일정·출석·횟수·결제 관리" />
              <ConfirmFeatureRow text="회원 관리 자동 알림" />
              <ConfirmFeatureRow text="AI 레슨 기록 월 10개" />
              <ConfirmFeatureRow text="AI 맞춤 코칭 분석 (기본)" />
              <ConfirmFeatureRow text="AI 레슨 기록 충전 가능" />
            </>
          ) : (
            <>
              <ConfirmFeatureRow text="회원 무제한" />
              <ConfirmFeatureRow text="일정·출석·횟수·결제 관리" />
              <ConfirmFeatureRow text="회원 관리 자동 알림" />
              <ConfirmFeatureRow text="AI 레슨 기록 월 50개" />
              <ConfirmFeatureRow text="상세 AI 맞춤 코칭 분석" />
              <ConfirmFeatureRow text="개인화 AI · 코치 브랜딩" />
              <ConfirmFeatureRow text="AI 레슨 기록 충전 가능" />
            </>
          )}
        </View>

        <Text style={s.legalNote}>
          * 가격은 부가세 포함{'\n'}
          * 체험 기간 중 취소 시 요금 없음{'\n'}
          * 출시가는 한시적 특별가로 종료 시 정가로 변경
        </Text>
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity
          style={[s.ctaBtn, { backgroundColor: accentColor }]}
          onPress={handleConfirm}
          activeOpacity={0.85}
        >
          <Text style={s.ctaBtnText}>{ctaLabel}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function ConfirmFeatureRow({ text }: { text: string }) {
  return (
    <View style={s.featureRow}>
      <Ionicons name="checkmark-circle" size={15} color={TERRACOTTA} />
      <Text style={s.featureText}>{text}</Text>
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
  scroll: { padding: 20, gap: 14 },

  planCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20,
    borderWidth: 1.5,
  },
  planCardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  planName: { fontSize: 22, fontWeight: '800' },
  planPrice: { fontSize: 22, fontWeight: '800' },
  annualNote: { fontSize: 12, color: WARM_GRAY, marginTop: 2 },
  launchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  launchLabel: { fontSize: 11, color: TERRACOTTA, fontWeight: '700' },
  regularPrice: { fontSize: 11, color: WARM_GRAY, textDecorationLine: 'line-through' },

  trialCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: TERRACOTTA + '12', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: TERRACOTTA + '30',
  },
  trialTitle: { fontSize: 14, fontWeight: '700', color: DARK_BROWN, marginBottom: 4 },
  trialDesc: { fontSize: 13, color: WARM_GRAY, lineHeight: 20 },

  changeCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: WARM_GRAY_BORDER,
  },
  changeDesc: { flex: 1, fontSize: 13, color: WARM_GRAY, lineHeight: 20 },

  featuresCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: WARM_GRAY_BORDER, gap: 10,
  },
  featuresTitle: { fontSize: 13, fontWeight: '700', color: DARK_BROWN, marginBottom: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { fontSize: 13, color: DARK_BROWN, fontWeight: '500' },

  legalNote: { fontSize: 11, color: WARM_GRAY, lineHeight: 18, textAlign: 'center' },

  footer: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: WARM_GRAY_BORDER,
    backgroundColor: CREAM,
  },
  ctaBtn: {
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  ctaBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
