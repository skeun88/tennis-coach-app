import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, Alert, ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '../../hooks/useSubscription';
import { PLANS, PlanId } from '../../lib/subscription';
import { supabase } from '../../lib/supabase';

const STATUS_LABELS: Record<string, string> = {
  trial: '무료 체험 중',
  active: '구독 중',
  past_due: '결제 실패',
  cancelled: '취소됨',
  blocked: '차단됨',
};

const STATUS_COLORS: Record<string, string> = {
  trial: '#f39c12',
  active: '#2ecc71',
  past_due: '#e74c3c',
  cancelled: '#888',
  blocked: '#e74c3c',
};

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const { subscription, loading, isTrial, trialDaysLeft, refresh } = useSubscription();
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = () => {
    Alert.alert(
      '구독 취소',
      '정말 취소하시겠어요? 현재 기간이 끝나면 서비스 이용이 제한됩니다.',
      [
        { text: '유지하기', style: 'cancel' },
        {
          text: '취소하기',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            const { error } = await supabase
              .from('subscriptions')
              .update({ status: 'cancelled' })
              .eq('id', subscription?.id);
            if (error) {
              Alert.alert('오류', '취소 처리 중 오류가 발생했습니다.');
            } else {
              await refresh();
              Alert.alert('취소 완료', '구독이 취소되었습니다.');
            }
            setCancelling(false);
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#4A90D9" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!subscription) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>구독 정보가 없습니다.</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push('/subscription/select-plan')}
          >
            <Text style={styles.primaryButtonText}>구독 시작하기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const plan = PLANS[subscription.plan_id];
  const nextBillingDate = subscription.next_billing_at
    ? new Date(subscription.next_billing_at).toLocaleDateString('ko-KR')
    : '-';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>구독 관리</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 현재 플랜 카드 */}
        <View style={styles.planCard}>
          <View style={styles.planRow}>
            <Text style={styles.planName}>{plan.name} 플랜</Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: STATUS_COLORS[subscription.status] + '20' },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  { color: STATUS_COLORS[subscription.status] },
                ]}
              >
                {STATUS_LABELS[subscription.status]}
              </Text>
            </View>
          </View>

          <Text style={styles.planPrice}>
            {plan.price.toLocaleString()}원/월
          </Text>

          {isTrial && (
            <View style={styles.trialRow}>
              <Ionicons name="time-outline" size={16} color="#f39c12" />
              <Text style={styles.trialText}>
                무료 체험 {trialDaysLeft}일 남음
              </Text>
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>다음 결제일</Text>
            <Text style={styles.infoValue}>{nextBillingDate}</Text>
          </View>
        </View>

        {/* 플랜 변경 */}
        {subscription.status !== 'cancelled' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>플랜 변경</Text>
            {subscription.plan_id === 'basic' ? (
              <TouchableOpacity
                style={styles.upgradeButton}
                onPress={() =>
                  router.push({
                    pathname: '/subscription/upgrade',
                    params: { targetPlan: 'pro' },
                  })
                }
              >
                <View>
                  <Text style={styles.upgradeTitle}>Pro로 업그레이드</Text>
                  <Text style={styles.upgradeSubtitle}>AI 분석, 리포트 등 모든 기능 이용</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#4A90D9" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.downgradeButton}
                onPress={() => {
                  Alert.alert(
                    'Basic으로 다운그레이드',
                    '현재 구독 기간 만료 후 Basic 플랜으로 변경됩니다.\nAI 분석 등 Pro 기능이 제한됩니다.',
                    [
                      { text: '취소', style: 'cancel' },
                      {
                        text: '다운그레이드 예약',
                        onPress: async () => {
                          await supabase.from('subscriptions').update({
                            pending_plan_id: 'basic',
                            downgrade_at: subscription.current_period_end,
                          }).eq('id', subscription.id);
                          await refresh();
                          Alert.alert('예약 완료', '기간 만료 후 Basic으로 변경됩니다.');
                        },
                      },
                    ]
                  );
                }}
              >
                <Text style={styles.downgradeText}>Basic으로 다운그레이드</Text>
                <Ionicons name="chevron-forward" size={20} color="#888" />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 취소 */}
        {subscription.status === 'active' || subscription.status === 'trial' ? (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? (
              <ActivityIndicator size="small" color="#e74c3c" />
            ) : (
              <Text style={styles.cancelText}>구독 취소</Text>
            )}
          </TouchableOpacity>
        ) : null}
      </ScrollView>
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
  scroll: { padding: 20, gap: 16 },
  planCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  planName: { fontSize: 20, fontWeight: '700', color: '#1a1a2e' },
  statusBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },
  planPrice: { fontSize: 24, fontWeight: '800', color: '#4A90D9', marginBottom: 12 },
  trialRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  trialText: { fontSize: 14, color: '#f39c12', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { fontSize: 14, color: '#888' },
  infoValue: { fontSize: 14, color: '#333', fontWeight: '600' },
  section: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
  upgradeButton: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#EBF4FF', borderRadius: 12, padding: 16,
  },
  upgradeTitle: { fontSize: 15, fontWeight: '700', color: '#4A90D9', marginBottom: 2 },
  upgradeSubtitle: { fontSize: 12, color: '#888' },
  downgradeButton: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e9ecef',
  },
  downgradeText: { fontSize: 15, color: '#888' },
  cancelButton: {
    alignItems: 'center', padding: 16,
    borderWidth: 1, borderColor: '#e74c3c', borderRadius: 12, backgroundColor: '#fff',
  },
  cancelText: { color: '#e74c3c', fontSize: 15, fontWeight: '600' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  emptyText: { fontSize: 16, color: '#888' },
  primaryButton: { backgroundColor: '#4A90D9', borderRadius: 14, padding: 18, width: '100%', alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
