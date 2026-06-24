import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PLANS, PlanId } from '../../lib/subscription';

type SelectablePlan = 'basic' | 'pro';

interface PlanFeatureRow {
  label: string;
  free: boolean | string;
  basic: boolean | string;
  pro: boolean | string;
}

const FEATURE_ROWS: PlanFeatureRow[] = [
  { label: '회원 등록', free: '3명까지', basic: '무제한', pro: '무제한' },
  { label: '회원 관리 · 일정 · 출석 · 결제', free: true, basic: true, pro: true },
  { label: '운영 관리 (미납·이탈·재등록)', free: false, basic: true, pro: true },
  { label: '회원 알림', free: false, basic: true, pro: true },
  { label: 'AI 레슨 분석', free: false, basic: '월 5회', pro: '월 100회' },
  { label: '코칭 실적 (4대 지표)', free: false, basic: '블라인드', pro: '공개' },
  { label: 'AI 코칭 모델 (음성 기반)', free: false, basic: false, pro: true },
  { label: '코칭 데이터 분석 (태그·패턴)', free: false, basic: false, pro: true },
  { label: 'KERRI 검증 배지', free: false, basic: false, pro: true },
];

function FeatureCell({ value }: { value: boolean | string }) {
  if (value === true) {
    return <Ionicons name="checkmark-circle" size={18} color="#2ecc71" />;
  }
  if (value === false) {
    return <Ionicons name="remove-circle-outline" size={18} color="#ccc" />;
  }
  return <Text style={styles.featureCellText}>{value}</Text>;
}

export default function SelectPlanScreen() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<SelectablePlan>('pro');

  const handleNext = () => {
    router.push({
      pathname: '/subscription/register-card',
      params: { planId: selectedPlan },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color="#1a1a2e" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>플랜을 선택하세요</Text>
        <Text style={styles.subtitle}>
          가입 즉시 1개월 프로 체험 — 체험 후 선택한 플랜으로 전환됩니다
        </Text>

        {/* 플랜 카드 2개 */}
        <View style={styles.planRow}>
          {/* Basic */}
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'basic' && styles.planCardSelected]}
            onPress={() => setSelectedPlan('basic')}
            activeOpacity={0.85}
          >
            <Text style={styles.planName}>Basic</Text>
            <Text style={styles.planPrice}>
              29,000<Text style={styles.planPriceSub}>원/월</Text>
            </Text>
            <Text style={styles.planRegular}>정식가 35,000원</Text>
            <Text style={styles.earlyBirdNote}>런칭 특별가</Text>
            {selectedPlan === 'basic' && (
              <View style={styles.selectedDot} />
            )}
          </TouchableOpacity>

          {/* Pro */}
          <TouchableOpacity
            style={[styles.planCard, styles.planCardPro, selectedPlan === 'pro' && styles.planCardSelected]}
            onPress={() => setSelectedPlan('pro')}
            activeOpacity={0.85}
          >
            <View style={styles.recommendBadge}>
              <Text style={styles.recommendText}>추천</Text>
            </View>
            <Text style={[styles.planName, styles.planNamePro]}>Pro</Text>
            <Text style={[styles.planPrice, styles.planPricePro]}>
              49,000<Text style={styles.planPriceSub}>원/월</Text>
            </Text>
            <Text style={styles.planRegular}>정식가 65,000원</Text>
            <Text style={styles.earlyBirdNote}>런칭 특별가</Text>
            {selectedPlan === 'pro' && (
              <View style={[styles.selectedDot, styles.selectedDotPro]} />
            )}
          </TouchableOpacity>
        </View>

        {/* 창립 멤버 안내 */}
        <View style={styles.founderBanner}>
          <Ionicons name="star-outline" size={16} color="#9b59b6" />
          <Text style={styles.founderText}>
            출시 후 3개월 내 가입 시 창립 멤버 — 1년간 런칭 특별가 유지
          </Text>
        </View>

        {/* 기능 비교표 */}
        <View style={styles.compareCard}>
          <Text style={styles.compareTitle}>플랜 비교</Text>

          {/* 헤더 */}
          <View style={styles.compareHeaderRow}>
            <View style={styles.compareFeatureCol} />
            <View style={styles.compareValueCol}>
              <Text style={styles.compareHeaderText}>Free</Text>
            </View>
            <View style={styles.compareValueCol}>
              <Text style={[styles.compareHeaderText, { color: '#4A90D9' }]}>Basic</Text>
            </View>
            <View style={styles.compareValueCol}>
              <Text style={[styles.compareHeaderText, { color: '#9b59b6' }]}>Pro</Text>
            </View>
          </View>

          {FEATURE_ROWS.map((row, i) => (
            <View
              key={i}
              style={[styles.compareRow, i % 2 === 1 && styles.compareRowAlt]}
            >
              <View style={styles.compareFeatureCol}>
                <Text style={styles.compareFeatureText}>{row.label}</Text>
              </View>
              <View style={styles.compareValueCol}>
                <FeatureCell value={row.free} />
              </View>
              <View style={styles.compareValueCol}>
                <FeatureCell value={row.basic} />
              </View>
              <View style={styles.compareValueCol}>
                <FeatureCell value={row.pro} />
              </View>
            </View>
          ))}
        </View>

        {/* 트라이얼 배너 */}
        <View style={styles.trialBanner}>
          <Ionicons name="gift-outline" size={20} color="#4A90D9" />
          <Text style={styles.trialText}>
            1개월 프로 체험 — 실제 회원 데이터로 KERRI의 모든 기능 경험
          </Text>
        </View>

        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextButtonText}>
            {selectedPlan === 'pro' ? 'Pro' : 'Basic'} 플랜으로 시작하기
          </Text>
          <Text style={styles.nextButtonSub}>1개월 프로 체험 후 전환</Text>
        </TouchableOpacity>

        <Text style={styles.legalNote}>
          * 가격은 부가세 포함 · 정식가 인상 예정 · 체험 기간 중 언제든 취소 가능
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 8 },
  closeBtn: { padding: 8 },
  scroll: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 20 },

  planRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  planCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    position: 'relative',
    overflow: 'hidden',
  },
  planCardPro: { borderColor: '#e9ecef' },
  planCardSelected: { borderColor: '#4A90D9' },
  planName: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  planNamePro: { color: '#9b59b6' },
  planPrice: { fontSize: 22, fontWeight: '800', color: '#4A90D9' },
  planPricePro: { color: '#9b59b6' },
  planPriceSub: { fontSize: 13, fontWeight: '400', color: '#888' },
  planRegular: { fontSize: 11, color: '#aaa', textDecorationLine: 'line-through', marginTop: 2 },
  earlyBirdNote: { fontSize: 11, color: '#e67e22', fontWeight: '600', marginTop: 3 },
  selectedDot: {
    position: 'absolute', top: 10, right: 10,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#4A90D9',
    justifyContent: 'center', alignItems: 'center',
  },
  selectedDotPro: { backgroundColor: '#9b59b6' },
  recommendBadge: {
    position: 'absolute', top: -1, right: -1,
    backgroundColor: '#9b59b6',
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  recommendText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  founderBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f5f0fa',
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  founderText: { flex: 1, fontSize: 12, color: '#9b59b6', lineHeight: 17 },

  compareCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  compareTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
  compareHeaderRow: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', marginBottom: 4 },
  compareRow: { flexDirection: 'row', paddingVertical: 8, alignItems: 'center' },
  compareRowAlt: { backgroundColor: '#fafbfc', borderRadius: 6 },
  compareFeatureCol: { flex: 2.5 },
  compareValueCol: { flex: 1, alignItems: 'center' },
  compareHeaderText: { fontSize: 12, fontWeight: '700', color: '#888' },
  compareFeatureText: { fontSize: 12, color: '#444', lineHeight: 16 },
  featureCellText: { fontSize: 11, color: '#555', textAlign: 'center' },

  trialBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#EBF4FF', borderRadius: 12,
    padding: 14, marginBottom: 20,
  },
  trialText: { flex: 1, fontSize: 13, color: '#4A90D9', lineHeight: 18 },

  nextButton: {
    backgroundColor: '#4A90D9', borderRadius: 14,
    padding: 18, alignItems: 'center', marginBottom: 12,
  },
  nextButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  nextButtonSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 3 },

  legalNote: { fontSize: 11, color: '#aaa', textAlign: 'center', lineHeight: 16 },
});
