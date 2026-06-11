import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Alert, Modal, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Payment, PaymentStatus } from '../../types';
import { Colors, Radius, Shadow } from '../../lib/theme';

const STATUS_COLOR: Record<PaymentStatus, string> = {
  '납부완료': Colors.success, '미납': Colors.destructive, '부분납부': Colors.warning,
};

type Filter = 'all' | '미납' | '부분납부' | '납부완료';
type PaymentMethod = '계좌이체' | '카드' | '현금';

// 납부 필요 회원 (잔여 3회 이하 OR 미납)
interface ActionMember {
  key: string;          // unique key
  memberId: string;
  name: string;
  phone: string;
  type: 'low_credit' | 'unpaid';
  // low_credit 전용
  remainingCredits?: number;
  packageTitle?: string;
  packagePrice?: number;
  // unpaid 전용
  paymentId?: string;
  unpaidAmount?: number;
  dueDate?: string;
}

function getDDay(dueDateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00');
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'D-Day';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function getDDayColor(dueDateStr: string, status: PaymentStatus): string {
  if (status === '납부완료') return Colors.success;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00');
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return Colors.destructive;
  if (diff <= 3) return Colors.warning;
  return Colors.mutedFg;
}

const METHOD_ICONS: Record<PaymentMethod, string> = {
  '계좌이체': 'phone-portrait-outline',
  '카드': 'card-outline',
  '현금': 'cash-outline',
};

export default function PaymentsScreen() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filtered, setFiltered] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('미납');
  const [actionMembers, setActionMembers] = useState<ActionMember[]>([]);

  // 납부 처리 모달
  const [payModal, setPayModal] = useState(false);
  const [payTarget, setPayTarget] = useState<ActionMember | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 결제 내역
    const { data: paymentsData } = await supabase
      .from('payments')
      .select('*, member:members(name, phone)')
      .eq('coach_id', user.id)
      .order('due_date', { ascending: false });
    setPayments(paymentsData ?? []);

    // 잔여 3회 이하 회원 (레슨권 가격 포함)
    const { data: lowCredits } = await supabase
      .from('members')
      .select('id, name, phone, remaining_credits, lesson_package_id, lesson_packages(id, title, price)')
      .eq('coach_id', user.id)
      .eq('is_active', true)
      .lte('remaining_credits', 3)
      .order('remaining_credits');

    // 미납 회원 (회원별 최신 미납 1건)
    const unpaidMap = new Map<string, ActionMember>();
    for (const p of (paymentsData ?? []) as any[]) {
      if (p.status === '미납' && !unpaidMap.has(p.member_id)) {
        unpaidMap.set(p.member_id, {
          key: `unpaid-${p.id}`,
          memberId: p.member_id,
          name: p.member?.name ?? '알 수 없음',
          phone: p.member?.phone ?? '',
          type: 'unpaid',
          paymentId: p.id,
          unpaidAmount: p.amount - p.paid_amount,
          dueDate: p.due_date,
        });
      }
    }

    // 합치기 (중복 제거: 미납 회원은 low_credit에서 제외)
    const combined: ActionMember[] = [];
    // 미납 먼저
    for (const u of unpaidMap.values()) {
      combined.push(u);
    }
    // 잔여 3회 이하 (미납 처리 회원 제외)
    for (const m of (lowCredits ?? []) as any[]) {
      if (!unpaidMap.has(m.id)) {
        const pkg = m.lesson_packages;
        combined.push({
          key: `low-${m.id}`,
          memberId: m.id,
          name: m.name,
          phone: m.phone,
          type: 'low_credit',
          remainingCredits: m.remaining_credits,
          packageTitle: pkg?.title ?? null,
          packagePrice: pkg?.price ?? null,
        });
      }
    }
    setActionMembers(combined);
  }

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    setFiltered(filter === 'all' ? payments : payments.filter(p => p.status === filter));
  }, [payments, filter]);

  const totalUnpaid = payments
    .filter(p => p.status !== '납부완료')
    .reduce((s, p) => s + (p.amount - p.paid_amount), 0);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthPaid = payments
    .filter(p => p.status === '납부완료' && p.paid_date?.startsWith(thisMonth))
    .reduce((s, p) => s + p.paid_amount, 0);

  function openPayModal(member: ActionMember) {
    // low_credit이면 레슨권 가격 없으면 alert
    if (member.type === 'low_credit' && !member.packagePrice) {
      Alert.alert('레슨권 미배정', `${member.name}님에게 등록된 레슨권이 없습니다.\n먼저 레슨권을 배정해주세요.`);
      return;
    }
    setPayTarget(member);
    setSelectedMethod(null);
    setPayModal(true);
  }

  async function confirmPayment() {
    if (!payTarget || !selectedMethod) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    if (payTarget.type === 'unpaid' && payTarget.paymentId) {
      // 기존 미납 → 납부완료 처리
      await supabase.from('payments').update({
        status: '납부완료',
        paid_amount: (payTarget.unpaidAmount ?? 0) + (payments.find(p => p.id === payTarget.paymentId)?.paid_amount ?? 0),
        paid_date: new Date().toISOString().split('T')[0],
        payment_method: selectedMethod,
      }).eq('id', payTarget.paymentId);
    } else if (payTarget.type === 'low_credit' && payTarget.packagePrice) {
      // 새 결제 생성 + 바로 납부완료
      const today = new Date().toISOString().split('T')[0];
      await supabase.from('payments').insert({
        coach_id: user.id,
        member_id: payTarget.memberId,
        amount: payTarget.packagePrice,
        paid_amount: payTarget.packagePrice,
        status: '납부완료',
        description: `${payTarget.packageTitle ?? '레슨권'} 결제`,
        due_date: today,
        paid_date: today,
        payment_method: selectedMethod,
      });
      // 레슨권 크레딧 갱신 (총 횟수로 리셋하거나 그냥 기록만)
    }

    setSaving(false);
    setPayModal(false);
    setPayTarget(null);
    Alert.alert('납부 완료', `${payTarget.name}님 납부 처리됐습니다 (${selectedMethod})`);
    loadData();
  }

  // 결제 카드 렌더
  async function markPaidQuick(payment: Payment) {
    Alert.alert(
      '납부 방법 선택',
      `${(payment as any).member?.name}님\n${(payment.amount - payment.paid_amount).toLocaleString()}원`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '계좌이체', onPress: async () => {
            await supabase.from('payments').update({
              status: '납부완료', paid_amount: payment.amount,
              paid_date: new Date().toISOString().split('T')[0],
              payment_method: '계좌이체',
            }).eq('id', payment.id);
            loadData();
          }
        },
        {
          text: '카드', onPress: async () => {
            await supabase.from('payments').update({
              status: '납부완료', paid_amount: payment.amount,
              paid_date: new Date().toISOString().split('T')[0],
              payment_method: '카드',
            }).eq('id', payment.id);
            loadData();
          }
        },
        {
          text: '현금', onPress: async () => {
            await supabase.from('payments').update({
              status: '납부완료', paid_amount: payment.amount,
              paid_date: new Date().toISOString().split('T')[0],
              payment_method: '현금',
            }).eq('id', payment.id);
            loadData();
          }
        },
      ]
    );
  }

  function renderPayment({ item }: { item: Payment }) {
    const member = (item as any).member;
    const remaining = item.amount - item.paid_amount;
    const dday = getDDay(item.due_date);
    const ddayColor = getDDayColor(item.due_date, item.status);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.memberName}>{member?.name ?? '알 수 없음'}</Text>
            <Text style={styles.memberPhone}>{member?.phone ?? ''}</Text>
          </View>
          <View style={styles.cardHeaderRight}>
            {item.status !== '납부완료' && (
              <View style={[styles.ddayBadge, { backgroundColor: ddayColor + '18' }]}>
                <Text style={[styles.ddayText, { color: ddayColor }]}>{dday}</Text>
              </View>
            )}
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[item.status] + '22' }]}>
              <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>{item.status}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.description}>{item.description}</Text>
        <View style={styles.amountRow}>
          <View>
            <Text style={styles.amountLabel}>청구금액</Text>
            <Text style={styles.amount}>{item.amount.toLocaleString()}원</Text>
          </View>
          {item.status !== '납부완료' && (
            <View>
              <Text style={styles.amountLabel}>미납금액</Text>
              <Text style={[styles.amount, { color: Colors.destructive }]}>{remaining.toLocaleString()}원</Text>
            </View>
          )}
          {(item as any).payment_method && (
            <View>
              <Text style={styles.amountLabel}>납부방법</Text>
              <Text style={[styles.amount, { color: Colors.success, fontSize: 13 }]}>{(item as any).payment_method}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardFooter}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="calendar-outline" size={12} color={Colors.mutedFg} />
            <Text style={styles.dueDate}>납부기한: {item.due_date}</Text>
          </View>
          {item.status !== '납부완료' && (
            <TouchableOpacity style={styles.paidBtn} onPress={() => markPaidQuick(item)}>
              <Text style={styles.paidBtnText}>납부 처리</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  const FILTERS: Filter[] = ['미납', '부분납부', '납부완료', 'all'];
  const FILTER_LABELS: Record<Filter, string> = { '미납': '미납', '부분납부': '부분', '납부완료': '완료', 'all': '전체' };
  const METHODS: PaymentMethod[] = ['계좌이체', '카드', '현금'];

  const payAmount = payTarget?.type === 'unpaid'
    ? payTarget.unpaidAmount ?? 0
    : payTarget?.packagePrice ?? 0;

  return (
    <View style={styles.container}>
      {/* Summary Banner */}
      <View style={styles.summaryBanner}>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryLabel}>전체 미납 금액</Text>
          <Text style={styles.summaryAmount}>{totalUnpaid > 0 ? `${totalUnpaid.toLocaleString()}원` : '없음'}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryLabel}>이번 달 납부 완료</Text>
          <Text style={styles.summaryPaid}>{thisMonthPaid.toLocaleString()}원</Text>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderPayment}
        contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }}
            tintColor={Colors.navy} />
        }
        ListHeaderComponent={
          <>
            {/* 납부 필요 회원 */}
            {actionMembers.length > 0 && (
              <View style={styles.alertSection}>
                <View style={styles.alertHeader}>
                  <Ionicons name="alert-circle" size={16} color={Colors.destructive} />
                  <Text style={styles.alertTitle}>납부 필요 회원</Text>
                  <View style={styles.alertCount}>
                    <Text style={styles.alertCountText}>{actionMembers.length}명</Text>
                  </View>
                </View>
                {actionMembers.map(m => {
                  const isUnpaid = m.type === 'unpaid';
                  const dotColor = isUnpaid ? Colors.destructive : Colors.warning;
                  const amount = isUnpaid ? m.unpaidAmount : m.packagePrice;
                  const subLabel = isUnpaid
                    ? `미납 ${(m.unpaidAmount ?? 0).toLocaleString()}원${m.dueDate ? ` · 기한 ${m.dueDate}` : ''}`
                    : `잔여 ${m.remainingCredits}회${m.packageTitle ? ` · ${m.packageTitle}` : ''}${m.packagePrice ? ` · ${m.packagePrice.toLocaleString()}원` : ' · 레슨권 미배정'}`;
                  return (
                    <View key={m.key} style={styles.alertRow}>
                      <View style={[styles.alertDot, { backgroundColor: dotColor }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.alertName}>{m.name}</Text>
                        <Text style={styles.alertSub}>{subLabel}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.alertPayBtn, (!amount && !isUnpaid) && { backgroundColor: Colors.placeholder }]}
                        onPress={() => openPayModal(m)}
                      >
                        <Ionicons name="checkmark-circle-outline" size={14} color="#fff" />
                        <Text style={styles.alertPayBtnText}>{isUnpaid ? '납부' : '결제'}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {/* 필터 */}
            <View style={styles.filterRow}>
              {FILTERS.map(f => (
                <TouchableOpacity key={f}
                  style={[styles.filterChip, filter === f && styles.filterChipActive]}
                  onPress={() => setFilter(f)}
                >
                  <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
                    {FILTER_LABELS[f]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.count}>{filtered.length}건</Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="card-outline" size={48} color={Colors.iconMuted} />
            <Text style={styles.emptyText}>결제 내역이 없습니다</Text>
          </View>
        }
      />

      {/* 납부 모달 */}
      <Modal visible={payModal} transparent animationType="slide"
        onRequestClose={() => { setPayModal(false); setPayTarget(null); }}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1}
          onPress={() => { setPayModal(false); setPayTarget(null); }}>
          <TouchableOpacity style={styles.modalSheet} activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>납부 처리</Text>

            {payTarget && (
              <>
                <View style={styles.modalInfoBox}>
                  <View style={styles.modalRow}>
                    <Ionicons name="person-outline" size={16} color={Colors.mutedFg} />
                    <Text style={styles.modalLabel}>회원</Text>
                    <Text style={styles.modalValue}>{payTarget.name}</Text>
                  </View>
                  <View style={styles.modalRow}>
                    <Ionicons name="cash-outline" size={16} color={Colors.mutedFg} />
                    <Text style={styles.modalLabel}>납부금액</Text>
                    <Text style={[styles.modalValue, { color: Colors.navy, fontWeight: '800' }]}>
                      {payAmount.toLocaleString()}원
                    </Text>
                  </View>
                  {payTarget.type === 'low_credit' && payTarget.packageTitle && (
                    <View style={styles.modalRow}>
                      <Ionicons name="layers-outline" size={16} color={Colors.mutedFg} />
                      <Text style={styles.modalLabel}>레슨권</Text>
                      <Text style={styles.modalValue}>{payTarget.packageTitle}</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.methodTitle}>납부 방법</Text>
                <View style={styles.methodRow}>
                  {METHODS.map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.methodBtn, selectedMethod === m && styles.methodBtnActive]}
                      onPress={() => setSelectedMethod(m)}
                    >
                      <Ionicons
                        name={METHOD_ICONS[m] as any}
                        size={22}
                        color={selectedMethod === m ? '#fff' : Colors.mutedFg}
                      />
                      <Text style={[styles.methodBtnText, selectedMethod === m && styles.methodBtnTextActive]}>
                        {m}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.confirmBtn, (!selectedMethod || saving) && styles.confirmBtnDisabled]}
                  onPress={confirmPayment}
                  disabled={!selectedMethod || saving}
                >
                  <Text style={styles.confirmBtnText}>
                    {saving ? '처리 중...' : selectedMethod ? `${selectedMethod}으로 납부 완료` : '납부 방법을 선택하세요'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summaryBanner: {
    backgroundColor: Colors.primary, flexDirection: 'row',
    paddingHorizontal: 20, paddingVertical: 18, alignItems: 'center',
  },
  summaryDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 16 },
  summaryLabel: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 4 },
  summaryAmount: { fontSize: 20, fontWeight: '800', color: '#fff' },
  summaryPaid: { fontSize: 20, fontWeight: '800', color: Colors.white },
  // 납부 필요 섹션
  alertSection: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1.5, borderColor: Colors.destructiveBorder,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  alertTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.destructive },
  alertCount: { backgroundColor: Colors.destructive, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  alertCountText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  alertRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.destructiveLight,
  },
  alertDot: { width: 8, height: 8, borderRadius: 4 },
  alertName: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  alertSub: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  alertPayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  alertPayBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  // Filters
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.mutedBg },
  filterChipActive: { backgroundColor: Colors.primary },
  filterChipText: { fontSize: 13, color: Colors.mutedFg, fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  count: { fontSize: 12, color: Colors.mutedFg, marginBottom: 8 },
  // Card
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  memberName: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  memberPhone: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  cardHeaderRight: { alignItems: 'flex-end', gap: 4 },
  ddayBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  ddayText: { fontSize: 11, fontWeight: '800' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontWeight: '700' },
  description: { fontSize: 13, color: Colors.mutedFg, marginBottom: 10 },
  amountRow: { flexDirection: 'row', gap: 20, marginBottom: 10 },
  amountLabel: { fontSize: 11, color: Colors.mutedFg, marginBottom: 2 },
  amount: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dueDate: { fontSize: 12, color: Colors.mutedFg },
  paidBtn: { backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  paidBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', padding: 60 },
  emptyText: { fontSize: 15, color: Colors.placeholder, fontWeight: '500', marginTop: 12 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground, textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalInfoBox: { margin: 16, backgroundColor: Colors.background, borderRadius: 12, padding: 14, gap: 10 },
  modalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalLabel: { fontSize: 13, color: Colors.mutedFg, width: 60 },
  modalValue: { flex: 1, fontSize: 15, color: Colors.foreground, fontWeight: '600' },
  methodTitle: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginHorizontal: 16, marginBottom: 10 },
  methodRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 },
  methodBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.mutedBg, borderWidth: 2, borderColor: Colors.border, gap: 6,
  },
  methodBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  methodBtnText: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  methodBtnTextActive: { color: '#fff' },
  confirmBtn: { margin: 16, marginTop: 0, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnDisabled: { backgroundColor: Colors.iconMuted },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
