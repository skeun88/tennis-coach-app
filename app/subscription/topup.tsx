import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '../../hooks/useSubscription';
import { getAiAnalysisUsageThisMonth, TOPUP_PRODUCTS, PLANS } from '../../lib/subscription';
import { supabase } from '../../lib/supabase';
import { IS_BETA } from '../../lib/beta';

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';

const TOPUP = TOPUP_PRODUCTS[0]; // { credits: 10, price: 4900 }

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;

export default function TopupScreen() {
  const router = useRouter();
  if (IS_BETA) { router.replace('/(tabs)'); return null; }

  const { subscription, refresh } = useSubscription();
  const [aiUsed, setAiUsed] = useState(0);
  const [loading, setLoading] = useState(false);

  const isPaid = !!subscription && subscription.plan_id !== 'free';
  const plan = subscription ? PLANS[subscription.plan_id] : null;
  const aiLimit = plan?.aiAnalysisMonthlyLimit ?? 0;
  const aiExtra = subscription?.extra_report_credits ?? 0;
  const aiRemain = Math.max(0, aiLimit - aiUsed);

  const nextResetDate = (() => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  })();

  const loadUsage = useCallback(async () => {
    if (!subscription) return;
    const used = await getAiAnalysisUsageThisMonth(subscription.coach_id);
    setAiUsed(used);
  }, [subscription]);

  useEffect(() => { loadUsage(); }, [loadUsage]);

  async function handlePurchase() {
    if (!subscription) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('로그인이 필요합니다.');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/topup-report-credits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ product_id: TOPUP.id ?? '10' }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        Alert.alert('결제 실패', data.error ?? '결제 중 오류가 발생했습니다.');
        return;
      }

      Alert.alert(
        `${TOPUP.credits}개 충전 완료`,
        `추가 충전 잔여: ${data.new_balance}개`,
        [{ text: '확인', onPress: () => { refresh(); loadUsage(); } }]
      );
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '결제 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={DARK_BROWN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>AI 레슨 기록 충전</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* 상품 정보 */}
        <View style={s.productCard}>
          <View style={s.productTop}>
            <View style={s.productIconWrap}>
              <Ionicons name="flash" size={24} color={TERRACOTTA} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.productName}>AI 레슨 기록 {TOPUP.credits}개</Text>
              <Text style={s.productPrice}>{TOPUP.price.toLocaleString()}원</Text>
            </View>
          </View>
          <Text style={s.productNote}>한 번만 결제되며 자동 결제되지 않아요</Text>
        </View>

        {/* 현재 보유 현황 */}
        <View style={s.card}>
          <Text style={s.cardLabel}>현재 보유 현황</Text>
          <View style={s.holdingRow}>
            <Ionicons name="calendar-outline" size={15} color={WARM_GRAY} />
            <Text style={s.holdingLabel}>기본 제공</Text>
            <Text style={s.holdingValue}>{aiRemain}개 남음</Text>
          </View>
          <View style={s.holdingRow}>
            <Ionicons name="add-circle-outline" size={15} color={TERRACOTTA} />
            <Text style={s.holdingLabel}>추가 충전</Text>
            <Text style={[s.holdingValue, { color: TERRACOTTA }]}>{aiExtra}개 남음</Text>
          </View>
          <Text style={s.holdingReset}>기본 제공량 초기화일: {nextResetDate}</Text>
        </View>

        {/* 안내 문구 */}
        <View style={s.infoCard}>
          {[
            'Basic·Pro 이용자만 구매할 수 있어요.',
            '기본 제공량을 먼저 사용한 후 충전분이 차감돼요.',
            '충전분은 매월 초기화되지 않고 계속 보관돼요.',
            '구독이 종료돼도 충전분은 보관돼요.',
            '다시 구독하면 남아 있는 충전분을 사용할 수 있어요.',
            'AI 레슨 기록 생성에 실패하면 차감되지 않아요.',
            '자동결제 상품이 아닙니다.',
          ].map((line, i) => (
            <View key={i} style={s.infoRow}>
              <Text style={s.infoBullet}>•</Text>
              <Text style={s.infoText}>{line}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* 하단 CTA */}
      <View style={s.footer}>
        {isPaid ? (
          <TouchableOpacity
            style={[s.ctaBtn, loading && s.ctaBtnDisabled]}
            onPress={handlePurchase}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.ctaBtnText}>{TOPUP.credits}개 충전하기 · {TOPUP.price.toLocaleString()}원</Text>
            }
          </TouchableOpacity>
        ) : (
          <View>
            <Text style={s.freeNotice}>AI 레슨 기록 충전은 Basic·Pro 플랜에서 이용할 수 있어요.</Text>
            <TouchableOpacity
              style={s.upgradeBtn}
              onPress={() => router.push('/subscription/select-plan')}
              activeOpacity={0.85}
            >
              <Text style={s.upgradeBtnText}>요금제 보기</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
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

  productCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: WARM_GRAY_BORDER,
  },
  productTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  productIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: TERRACOTTA + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  productName: { fontSize: 16, fontWeight: '700', color: DARK_BROWN, marginBottom: 2 },
  productPrice: { fontSize: 22, fontWeight: '800', color: TERRACOTTA },
  productNote: { fontSize: 12, color: WARM_GRAY, lineHeight: 18 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: WARM_GRAY_BORDER, gap: 10,
  },
  cardLabel: { fontSize: 11, fontWeight: '700', color: WARM_GRAY, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },
  holdingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  holdingLabel: { fontSize: 13, color: DARK_BROWN, flex: 1 },
  holdingValue: { fontSize: 14, fontWeight: '700', color: DARK_BROWN },
  holdingReset: { fontSize: 11, color: WARM_GRAY, marginTop: 4 },

  infoCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: WARM_GRAY_BORDER, gap: 8,
  },
  infoRow: { flexDirection: 'row', gap: 6 },
  infoBullet: { fontSize: 13, color: WARM_GRAY, lineHeight: 20 },
  infoText: { fontSize: 13, color: WARM_GRAY, lineHeight: 20, flex: 1 },

  footer: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: WARM_GRAY_BORDER, backgroundColor: CREAM },
  ctaBtn: {
    backgroundColor: TERRACOTTA, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  freeNotice: { fontSize: 13, color: WARM_GRAY, textAlign: 'center', marginBottom: 12, lineHeight: 20 },
  upgradeBtn: {
    backgroundColor: DARK_BROWN, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  upgradeBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
