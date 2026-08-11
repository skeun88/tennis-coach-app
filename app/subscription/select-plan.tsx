import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PLANS, PlanId, PRO_BIANNUAL } from '../../lib/subscription';
import ClipRecorderModal from '../../components/ClipRecorderModal';
import { IS_BETA } from '../../lib/beta';

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
  { label: 'AI 레슨 분석 (월 한도)', free: '월 3회', basic: '월 10회', pro: '월 100회' },
  { label: '코칭 실적 (4대 지표)', free: false, basic: '블라인드', pro: '공개' },
  { label: 'AI 코칭 모델 (음성 기반)', free: false, basic: false, pro: true },
  { label: '코칭 데이터 분석 (태그·패턴)', free: false, basic: false, pro: true },
  { label: 'KERRI 검증 배지', free: false, basic: false, pro: true },
  { label: '클립형 녹음기 무상 제공', free: false, basic: false, pro: '6개월 선결제 시' },
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

type BillingType = 'monthly' | 'biannual';

export default function SelectPlanScreen() {
  const router = useRouter();
  if (IS_BETA) { router.replace('/(tabs)'); return null; }
  const [selectedPlan, setSelectedPlan] = useState<SelectablePlan>('pro');
  const [showBillingOptions, setShowBillingOptions] = useState(false);
  const [showRecorderModal, setShowRecorderModal] = useState(false);

  const handleNext = () => {
    if (selectedPlan === 'pro') {
      // 녹음기 혜택 모달을 먼저 보여줘서 6개월 선결제 전환율 높이기
      setShowRecorderModal(true);
    } else {
      router.push({
        pathname: '/subscription/register-card',
        params: { planId: selectedPlan, billingType: 'monthly' },
      });
    }
  };

  const handleBillingSelect = (type: BillingType) => {
    setShowBillingOptions(false);
    router.push({
      pathname: '/subscription/register-card',
      params: { planId: 'pro', billingType: type },
    });
  };

  const handleRecorderModalConfirm = () => {
    setShowRecorderModal(false);
    router.push({
      pathname: '/subscription/register-card',
      params: { planId: 'pro', billingType: 'biannual' },
    });
  };

  const handleRecorderModalClose = () => {
    setShowRecorderModal(false);
    setShowBillingOptions(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Pro 결제 방식 선택 모달 */}
      <Modal visible={showBillingOptions} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>결제 방식 선택</Text>
            <Text style={styles.modalSubtitle}>Pro 플랜 결제 방식을 선택해 주세요</Text>

            <TouchableOpacity
              style={styles.billingOptionCard}
              onPress={() => handleBillingSelect('monthly')}
            >
              <View style={styles.billingOptionLeft}>
                <Text style={styles.billingOptionTitle}>월 결제</Text>
                <Text style={styles.billingOptionPrice}>19,000원/월</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#888" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.billingOptionCard, styles.billingOptionCardHighlight]}
              onPress={() => handleBillingSelect('biannual')}
            >
              <View style={styles.billingOptionBadge}>
                <Text style={styles.billingOptionBadgeText}>🎁 녹음기 무상 제공</Text>
              </View>
              <View style={styles.billingOptionLeft}>
                <Text style={[styles.billingOptionTitle, { color: '#9b59b6' }]}>6개월 선결제</Text>
                <Text style={[styles.billingOptionPrice, { color: '#9b59b6' }]}>{PRO_BIANNUAL.price.toLocaleString()}원 (월 {PRO_BIANNUAL.monthlyEquivalent.toLocaleString()}원)</Text>
                <Text style={styles.billingOptionDiscount}>약 {PRO_BIANNUAL.discountPct}% 할인 + 클립형 녹음기 무상 제공</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9b59b6" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowBillingOptions(false)}>
              <Text style={styles.modalCancelBtnText}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 클립형 녹음기 안내 모달 */}
      <ClipRecorderModal
        visible={showRecorderModal}
        onClose={handleRecorderModalClose}
        onConfirm={handleRecorderModalConfirm}
      />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color="#1a1a2e" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>플랜을 선택하세요</Text>

        {/* 1개월 프로 체험 강조 배너 */}
        <View style={styles.trialHighlight}>
          <View style={styles.trialHighlightBadge}>
            <Text style={styles.trialHighlightBadgeText}>🎁 무료</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.trialHighlightTitle}>지금 가입하면 1개월 프로 체험!</Text>
            <Text style={styles.trialHighlightSub}>체험 후 선택한 플랜으로 자동 전환</Text>
          </View>
        </View>

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
              9,900<Text style={styles.planPriceSub}>원/월</Text>
            </Text>
            <Text style={styles.planDesc}>월 10회 무료 리포트</Text>
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
              19,000<Text style={styles.planPriceSub}>원/월</Text>
            </Text>
            <Text style={styles.planDesc}>월 100회 AI 레슨 분석</Text>
            {/* 녹음기 혜택 배너 */}
            <View style={styles.recorderBanner}>
              <Ionicons name="mic" size={13} color="#9b59b6" />
              <Text style={styles.recorderBannerText} numberOfLines={1}>🎁 녹음기 무상 제공</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* 회원 리포트 열람 안내 */}
        <View style={styles.creditInfoBanner}>
          <Ionicons name="information-circle-outline" size={16} color="#4A90D9" />
          <Text style={styles.creditInfoText}>
            회원은 <Text style={{ fontWeight: '700' }}>처음 1회 무료</Text> 열람 후 크레딧으로 열람합니다. (만원 단위 충전 · 건당 700원)
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
          * 가격은 부가세 포함 · 체험 기간 중 언제든 취소 가능
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
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 20 },
  trialHighlight: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF8E1',
    borderRadius: 14, padding: 14,
    marginBottom: 20,
    borderWidth: 1.5, borderColor: '#F59E0B',
  },
  trialHighlightBadge: {
    backgroundColor: '#F59E0B', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  trialHighlightBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  trialHighlightTitle: { fontSize: 16, fontWeight: '800', color: '#92400E', marginBottom: 2 },
  trialHighlightSub: { fontSize: 12, color: '#B45309' },

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
  planPrice: { fontSize: 20, fontWeight: '800', color: '#4A90D9' },
  planPricePro: { color: '#9b59b6' },
  planPriceSub: { fontSize: 13, fontWeight: '400', color: '#888' },
  planDesc: { fontSize: 11, color: '#888', marginTop: 4 },
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
  recorderBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f5f0fa', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    marginTop: 8, alignSelf: 'flex-start',
  },
  recorderBannerText: { fontSize: 11, color: '#9b59b6', fontWeight: '600' },

  creditInfoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#EBF4FF',
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  creditInfoText: { flex: 1, fontSize: 12, color: '#4A90D9', lineHeight: 18 },

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

  // 모달 스타일
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  modalHandle: {
    width: 40, height: 4, backgroundColor: '#e0e0e0',
    borderRadius: 2, alignSelf: 'center', marginBottom: 20,
  },
  recorderIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#f5f0fa',
    justifyContent: 'center', alignItems: 'center',
    alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#1a1a2e', textAlign: 'center', marginBottom: 4 },
  modalSubtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24 },
  recorderFeatureList: { gap: 12, marginBottom: 24 },
  recorderFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  recorderFeatureText: { flex: 1, fontSize: 14, color: '#333', lineHeight: 20 },
  recorderPriceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f5f0fa', borderRadius: 12, padding: 14, marginBottom: 8,
  },
  recorderPriceLabel: { fontSize: 13, color: '#888' },
  recorderPriceOriginal: { fontSize: 16, color: '#aaa', textDecorationLine: 'line-through', flex: 1 },
  recorderFreeBadge: {
    backgroundColor: '#9b59b6', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  recorderFreeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  recorderNote: { fontSize: 12, color: '#aaa', textAlign: 'center', marginBottom: 24 },
  modalNextBtn: {
    backgroundColor: '#9b59b6', borderRadius: 14,
    padding: 18, alignItems: 'center', marginBottom: 10,
  },
  modalNextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalCancelBtn: { alignItems: 'center', padding: 12 },
  modalCancelBtnText: { color: '#888', fontSize: 14 },

  // 결제 방식 선택 모달
  billingOptionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f8f9fa', borderRadius: 14,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#e9ecef',
  },
  billingOptionCardHighlight: {
    borderColor: '#9b59b6', backgroundColor: '#f5f0fa',
    position: 'relative',
  },
  billingOptionLeft: { flex: 1 },
  billingOptionTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 2 },
  billingOptionPrice: { fontSize: 16, fontWeight: '800', color: '#4A90D9' },
  billingOptionDiscount: { fontSize: 11, color: '#9b59b6', marginTop: 4 },
  billingOptionBadge: {
    position: 'absolute', top: -1, left: 12,
    backgroundColor: '#9b59b6', borderRadius: 0,
    borderBottomLeftRadius: 6, borderBottomRightRadius: 6,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  billingOptionBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
