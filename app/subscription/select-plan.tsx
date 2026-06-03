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
import { PLANS, PlanId, PLAN_FEATURES_LABELS, PlanFeatures } from '../../lib/subscription';

export default function SelectPlanScreen() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('pro');

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
          1달 무료 체험 후 선택한 플랜으로 자동 결제됩니다
        </Text>

        {/* Basic 플랜 */}
        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'basic' && styles.planCardSelected]}
          onPress={() => setSelectedPlan('basic')}
          activeOpacity={0.8}
        >
          <View style={styles.planHeader}>
            <View>
              <Text style={styles.planName}>Basic</Text>
              <Text style={styles.planPrice}>
                29,000원<Text style={styles.planPriceSub}>/월</Text>
              </Text>
            </View>
            {selectedPlan === 'basic' && (
              <View style={styles.checkCircle}>
                <Ionicons name="checkmark" size={18} color="#fff" />
              </View>
            )}
          </View>
          <View style={styles.featureList}>
            {(Object.keys(PLANS.basic.features) as Array<keyof PlanFeatures>).map((key) => (
              <View key={key} style={styles.featureRow}>
                <Ionicons
                  name={PLANS.basic.features[key] ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={PLANS.basic.features[key] ? '#2ecc71' : '#ccc'}
                />
                <Text
                  style={[
                    styles.featureText,
                    !PLANS.basic.features[key] && styles.featureTextDisabled,
                  ]}
                >
                  {PLAN_FEATURES_LABELS[key]}
                </Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>

        {/* Pro 플랜 */}
        <TouchableOpacity
          style={[styles.planCard, selectedPlan === 'pro' && styles.planCardSelected]}
          onPress={() => setSelectedPlan('pro')}
          activeOpacity={0.8}
        >
          <View style={styles.recommendBadge}>
            <Text style={styles.recommendText}>추천</Text>
          </View>
          <View style={styles.planHeader}>
            <View>
              <Text style={styles.planName}>Pro</Text>
              <Text style={styles.planPrice}>
                49,000원<Text style={styles.planPriceSub}>/월</Text>
              </Text>
            </View>
            {selectedPlan === 'pro' && (
              <View style={styles.checkCircle}>
                <Ionicons name="checkmark" size={18} color="#fff" />
              </View>
            )}
          </View>
          <View style={styles.featureList}>
            {(Object.keys(PLANS.pro.features) as Array<keyof PlanFeatures>).map((key) => (
              <View key={key} style={styles.featureRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color="#2ecc71"
                />
                <Text style={styles.featureText}>{PLAN_FEATURES_LABELS[key]}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>

        <View style={styles.trialBanner}>
          <Ionicons name="gift-outline" size={20} color="#4A90D9" />
          <Text style={styles.trialText}>
            첫 1달은 무료! 체험 기간 중 언제든 취소 가능
          </Text>
        </View>

        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextButtonText}>
            {PLANS[selectedPlan].name} 플랜으로 시작하기
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 8 },
  closeBtn: { padding: 8 },
  scroll: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 20 },
  planCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  planCardSelected: { borderColor: '#4A90D9' },
  recommendBadge: {
    position: 'absolute',
    top: -12,
    right: 20,
    backgroundColor: '#4A90D9',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  recommendText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  planName: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  planPrice: { fontSize: 24, fontWeight: '800', color: '#4A90D9' },
  planPriceSub: { fontSize: 14, fontWeight: '400', color: '#888' },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#4A90D9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureList: { gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { fontSize: 14, color: '#333' },
  featureTextDisabled: { color: '#bbb' },
  trialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF4FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    gap: 10,
  },
  trialText: { flex: 1, fontSize: 13, color: '#4A90D9', lineHeight: 18 },
  nextButton: {
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
  },
  nextButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
