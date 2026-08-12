import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, ActivityIndicator, Alert
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '../../hooks/useSubscription';
import { PLANS, PlanId, calculateUpgradeCost } from '../../lib/subscription';
import { supabase } from '../../lib/supabase';
import { IS_BETA } from '../../lib/beta';

export default function UpgradeScreen() {
  const router = useRouter();
  if (IS_BETA) { router.replace('/(tabs)'); return null; }
  const { targetPlan } = useLocalSearchParams<{ targetPlan: PlanId }>();
  const { subscription, refresh } = useSubscription();
  const [processing, setProcessing] = useState(false);
  const [cost, setCost] = useState(0);

  useEffect(() => {
    if (subscription) {
      const upgradeCost = calculateUpgradeCost(
        subscription.plan_id,
        targetPlan || 'pro',
        subscription.current_period_end
      );
      setCost(upgradeCost);
    }
  }, [subscription, targetPlan]);

  const target = PLANS[targetPlan || 'pro'];

  const handleUpgrade = async () => {
    if (!subscription) return;
    setProcessing(true);
    try {
      // 차액 즉시 결제 (Edge Function 호출)
      const { data, error } = await supabase.functions.invoke('upgrade-subscription', {
        body: {
          subscriptionId: subscription.id,
          targetPlanId: targetPlan,
          amount: cost,
        },
      });

      if (error) throw new Error(error.message);

      await refresh();
      Alert.alert('업그레이드 완료! 🎉', `${target.name} 플랜으로 변경되었습니다.`, [
        { text: '확인', onPress: () => router.replace('/subscription/manage') },
      ]);
    } catch (err: any) {
      Alert.alert('오류', err.message || '업그레이드 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  if (!subscription) return null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pro로 업그레이드</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.costCard}>
          <Text style={styles.costLabel}>오늘 결제 금액 (잔여 기간 차액)</Text>
          <Text style={styles.costAmount}>{cost.toLocaleString()}원</Text>
          <Text style={styles.costNote}>다음 달부터 19,000원/월 자동 결제</Text>
        </View>

        <View style={styles.featureCard}>
          <Text style={styles.featureTitle}>Pro에서 추가되는 기능</Text>
          <View style={styles.featureRow}>
            <Ionicons name="document-text" size={20} color="#4A90D9" />
            <Text style={styles.featureText}>리포트 월 50회 무료 발송 (미사용분 입막당 소멸)</Text>
          </View>
          <View style={styles.featureRow}>
            <Ionicons name="mic" size={20} color="#4A90D9" />
            <Text style={styles.featureText}>AI 코칭 모델 (음성 기반 학습)</Text>
          </View>
          <View style={styles.featureRow}>
            <Ionicons name="hardware-chip" size={20} color="#4A90D9" />
            <Text style={styles.featureText}>클립형 녹음기 포함 (3만원 상당)</Text>
          </View>
          <View style={styles.featureRow}>
            <Ionicons name="stats-chart" size={20} color="#4A90D9" />
            <Text style={styles.featureText}>코칭 실적 공개 + KERRI 검증</Text>
          </View>
          <View style={styles.featureRow}>
            <Ionicons name="pricetag" size={20} color="#4A90D9" />
            <Text style={styles.featureText}>코칭 데이터 분석 (태그·패턴·추적)</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.upgradeButton, processing && styles.buttonDisabled]}
          onPress={handleUpgrade}
          disabled={processing}
        >
          {processing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.upgradeButtonText}>
              {cost > 0 ? `${cost.toLocaleString()}원 결제하고 업그레이드` : 'Pro로 업그레이드'}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          결제는 등록된 카드로 즉시 청구됩니다.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e' },
  content: { flex: 1, padding: 20, gap: 16 },
  costCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  costLabel: { fontSize: 13, color: '#888', marginBottom: 8 },
  costAmount: { fontSize: 36, fontWeight: '800', color: '#4A90D9', marginBottom: 8 },
  costNote: { fontSize: 13, color: '#aaa' },
  featureCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  featureTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 14, color: '#444' },
  upgradeButton: {
    backgroundColor: '#4A90D9', borderRadius: 14, padding: 18, alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.7 },
  upgradeButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disclaimer: { textAlign: 'center', fontSize: 12, color: '#aaa' },
});
