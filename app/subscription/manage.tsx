import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '../../hooks/useSubscription';
import {
  PLANS, getAiAnalysisUsageThisMonth,
  TOPUP_PRODUCTS, TRIAL_DAYS, ANNUAL_PRICES,
} from '../../lib/subscription';
import { supabase } from '../../lib/supabase';
import ReportTopupModal from '../../components/ReportTopupModal';
import { IS_BETA } from '../../lib/beta';

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';

const STATUS_LABELS: Record<string, string> = {
  trial: '무료 체험 중',
  active: '이용 중',
  free: '이용 중',
  past_due: '결제 실패',
  cancelled: '취소됨',
  blocked: '차단됨',
};

const STATUS_COLORS: Record<string, string> = {
  trial: TERRACOTTA,
  active: '#22A566',
  free: WARM_GRAY,
  past_due: '#DC4444',
  cancelled: WARM_GRAY,
  blocked: '#DC4444',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

function MenuRow({ icon, label, value, onPress, destructive }: { icon: string; label: string; value?: string; onPress: () => void; destructive?: boolean }) {
  return (
    <TouchableOpacity style={s.menuRow} onPress={onPress} activeOpacity={0.7}>
      <View style={s.menuRowLeft}>
        <Ionicons name={icon as any} size={18} color={destructive ? '#DC4444' : DARK_BROWN} />
        <Text style={[s.menuRowLabel, destructive && s.menuRowLabelDestructive]}>{label}</Text>
      </View>
      <View style={s.menuRowRight}>
        {value ? <Text style={s.menuRowValue}>{value}</Text> : null}
        <Ionicons name="chevron-forward" size={16} color={WARM_GRAY_BORDER} />
      </View>
    </TouchableOpacity>
  );
}

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const { subscription, loading, isTrial, trialDaysLeft, refresh } = useSubscription();
  const [aiUsed, setAiUsed] = useState(0);
  const [topupVisible, setTopupVisible] = useState(false);
  const [authToken, setAuthToken] = useState('');

  const loadUsage = useCallback(async () => {
    if (!subscription) return;
    const used = await getAiAnalysisUsageThisMonth(subscription.coach_id);
    setAiUsed(used);
  }, [subscription]);

  useEffect(() => { loadUsage(); }, [loadUsage]);

  async function openTopup() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setAuthToken(session.access_token);
    setTopupVisible(true);
  }

  async function openStoreManagement() {
    // Toss Payments 기반이므로 구독 취소/관리는 고객센터 안내
    Alert.alert(
      '구독 관리',
      '구독 변경 및 취소는 아래 방법으로 진행해 주세요.\n\n• 플랜 변경: 이 화면에서 직접 변경\n• 구독 취소: 고객센터 문의',
      [
        { text: '확인' },
      ]
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator size="large" color={TERRACOTTA} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!subscription) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={DARK_BROWN} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>구독 및 요금제</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.emptyState}>
          <Ionicons name="card-outline" size={48} color={WARM_GRAY_BORDER} />
          <Text style={s.emptyTitle}>구독 정보가 없습니다</Text>
          <TouchableOpacity style={s.startBtn} onPress={() => router.push('/subscription/select-plan')}>
            <Text style={s.startBtnText}>플랜 시작하기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const plan = PLANS[subscription.plan_id];
  const isPaid = subscription.plan_id !== 'free';
  const isBasic = subscription.plan_id === 'basic';
  const isPro = subscription.plan_id === 'pro';

  const aiLimit = plan.aiAnalysisMonthlyLimit;
  const aiExtra = subscription.extra_report_credits ?? 0;
  const aiRemain = Math.max(0, aiLimit - aiUsed);
  const aiProgress = aiLimit > 0 ? Math.min(1, aiUsed / aiLimit) : 0;

  const nextBillingDate = subscription.next_billing_at
    ? new Date(subscription.next_billing_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const nextResetDate = (() => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  })();

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={DARK_BROWN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>구독 및 요금제</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── 현재 플랜 카드 ── */}
        <View style={s.card}>
          <Text style={s.cardSectionLabel}>현재 플랜</Text>
          <View style={s.planRow}>
            <Text style={s.planName}>{plan.name}</Text>
            <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[subscription.status] + '18' }]}>
              <Text style={[s.statusText, { color: STATUS_COLORS[subscription.status] }]}>
                {STATUS_LABELS[subscription.status] ?? subscription.status}
              </Text>
            </View>
          </View>

          {isTrial && (
            <View style={s.trialRow}>
              <Ionicons name="time-outline" size={14} color={TERRACOTTA} />
              <Text style={s.trialText}>무료 체험 {trialDaysLeft}일 남음</Text>
              {nextBillingDate && (
                <Text style={s.trialSubText}>· {nextBillingDate}부터 자동 결제</Text>
              )}
            </View>
          )}

          {isPaid && plan.price > 0 && (
            <>
              <View style={s.divider} />
              {isTrial ? (
                <InfoRow label="체험 후 결제" value={`${plan.price.toLocaleString()}원/월`} />
              ) : (
                <InfoRow label="현재 결제" value={`${plan.price.toLocaleString()}원/월`} />
              )}
              {nextBillingDate && (
                <InfoRow label="다음 갱신일" value={nextBillingDate} />
              )}
            </>
          )}
        </View>

        {/* ── AI 레슨 기록 사용량 ── */}
        <View style={s.card}>
          <Text style={s.cardSectionLabel}>AI 레슨 기록</Text>

          {/* 기본 제공량 */}
          <View style={s.usageHeader}>
            <Text style={s.usageTitle}>이번 달 기본 제공</Text>
            <Text style={s.usageCount}>
              <Text style={s.usageUsed}>{aiUsed}</Text>
              <Text style={s.usageSep}> / </Text>
              <Text>{aiLimit}개</Text>
            </Text>
          </View>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round(aiProgress * 100)}%` as any, backgroundColor: aiProgress >= 0.9 ? '#DC4444' : TERRACOTTA }]} />
          </View>
          <View style={s.usageFooter}>
            <Text style={s.usageRemain}>{aiRemain}개 남음</Text>
            <Text style={s.usageReset}>다음 초기화 {nextResetDate}</Text>
          </View>

          {/* 추가 충전 */}
          {aiExtra > 0 && (
            <View style={s.extraSection}>
              <View style={s.extraRow}>
                <Ionicons name="add-circle-outline" size={15} color={TERRACOTTA} />
                <Text style={s.extraLabel}>추가 충전</Text>
                <Text style={s.extraCount}>{aiExtra}개 남음</Text>
              </View>
              <Text style={s.extraNote}>기본 제공량을 먼저 사용한 후 충전 횟수가 사용됩니다.</Text>
            </View>
          )}

          {/* 충전 버튼 (Basic/Pro만) */}
          {isPaid && (
            <TouchableOpacity style={s.topupBtn} onPress={openTopup} activeOpacity={0.8}>
              <Ionicons name="flash-outline" size={15} color={TERRACOTTA} />
              <Text style={s.topupBtnText}>AI 레슨 기록 충전 · {TOPUP_PRODUCTS[0].credits}개 {TOPUP_PRODUCTS[0].price.toLocaleString()}원</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── 하단 메뉴 ── */}
        <View style={s.menuCard}>
          {/* 플랜 변경 */}
          {subscription.status !== 'cancelled' && subscription.status !== 'blocked' && (
            <MenuRow
              icon="swap-horizontal-outline"
              label="플랜 변경"
              onPress={() => router.push('/subscription/select-plan')}
            />
          )}

          {/* AI 레슨 기록 충전 (Basic/Pro만) */}
          {isPaid && (
            <MenuRow
              icon="add-circle-outline"
              label="AI 레슨 기록 충전"
              value={`${TOPUP_PRODUCTS[0].price.toLocaleString()}원/10개`}
              onPress={openTopup}
            />
          )}

          {/* 구독 관리 (스토어/고객센터) */}
          <MenuRow
            icon="storefront-outline"
            label="구독 관리"
            onPress={openStoreManagement}
          />

          {/* 유료서비스·구독·환불정책 */}
          <MenuRow
            icon="document-text-outline"
            label="유료서비스·구독·환불정책"
            onPress={() => Linking.openURL('https://kerri.ai/policy/refund')}
          />
        </View>

        {/* 구독 종료 후 충전권 안내 */}
        {aiExtra > 0 && !isPaid && (
          <View style={s.retainedCreditCard}>
            <Ionicons name="information-circle-outline" size={16} color={WARM_GRAY} />
            <Text style={s.retainedCreditText}>
              보유 충전 {aiExtra}개는 Basic 또는 Pro 재구독 시 사용할 수 있습니다.
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {topupVisible && authToken && subscription && (
        <ReportTopupModal
          visible={topupVisible}
          onClose={() => setTopupVisible(false)}
          onTopupSuccess={async () => {
            setTopupVisible(false);
            await refresh();
            await loadUsage();
          }}
          onUpgradePress={() => {
            setTopupVisible(false);
            router.push('/subscription/select-plan');
          }}
          currentPlanId={subscription.plan_id}
          authToken={authToken}
        />
      )}
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

  card: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 18, borderWidth: 1, borderColor: WARM_GRAY_BORDER,
  },
  cardSectionLabel: { fontSize: 11, fontWeight: '700', color: WARM_GRAY, marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' },

  planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  planName: { fontSize: 26, fontWeight: '800', color: DARK_BROWN },
  statusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },

  trialRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  trialText: { fontSize: 13, color: TERRACOTTA, fontWeight: '700' },
  trialSubText: { fontSize: 12, color: WARM_GRAY },

  divider: { height: 1, backgroundColor: '#F5EDE5', marginVertical: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  infoLabel: { fontSize: 13, color: WARM_GRAY },
  infoValue: { fontSize: 13, color: DARK_BROWN, fontWeight: '600' },

  // AI 사용량
  usageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  usageTitle: { fontSize: 13, color: WARM_GRAY, fontWeight: '600' },
  usageCount: { fontSize: 15, color: WARM_GRAY },
  usageUsed: { fontSize: 22, fontWeight: '800', color: DARK_BROWN },
  usageSep: { color: WARM_GRAY_BORDER },
  progressTrack: { height: 7, backgroundColor: '#F0E8E0', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 4 },
  usageFooter: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  usageRemain: { fontSize: 13, color: TERRACOTTA, fontWeight: '700' },
  usageReset: { fontSize: 12, color: WARM_GRAY },

  extraSection: { borderTopWidth: 1, borderTopColor: '#F5EDE5', marginTop: 12, paddingTop: 12, gap: 5 },
  extraRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  extraLabel: { fontSize: 13, color: DARK_BROWN, fontWeight: '600', flex: 1 },
  extraCount: { fontSize: 14, fontWeight: '700', color: TERRACOTTA },
  extraNote: { fontSize: 11, color: WARM_GRAY, lineHeight: 16 },

  topupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center',
    borderWidth: 1.5, borderColor: TERRACOTTA, borderRadius: 10,
    paddingVertical: 11, marginTop: 14,
  },
  topupBtnText: { fontSize: 13, color: TERRACOTTA, fontWeight: '700' },

  menuCard: {
    backgroundColor: '#fff', borderRadius: 16,
    borderWidth: 1, borderColor: WARM_GRAY_BORDER,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 15, paddingHorizontal: 18,
    borderBottomWidth: 1, borderBottomColor: '#F5EDE5',
  },
  menuRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuRowLabel: { fontSize: 14, color: DARK_BROWN, fontWeight: '500' },
  menuRowLabelDestructive: { color: '#DC4444' },
  menuRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  menuRowValue: { fontSize: 12, color: WARM_GRAY },

  retainedCreditCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#F5EDE5', borderRadius: 12, padding: 14,
  },
  retainedCreditText: { flex: 1, fontSize: 12, color: WARM_GRAY, lineHeight: 18 },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 32 },
  emptyTitle: { fontSize: 16, color: WARM_GRAY, fontWeight: '600' },
  startBtn: { backgroundColor: TERRACOTTA, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
  startBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
