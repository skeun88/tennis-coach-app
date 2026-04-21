import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Payment, PaymentStatus } from '../../types';

const STATUS_COLOR: Record<PaymentStatus, string> = {
  '납부완료': '#22c55e', '미납': '#ef4444', '부분납부': '#f59e0b',
};

type Filter = 'all' | '미납' | '부분납부' | '납부완료';

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
  if (status === '납부완료') return '#22c55e';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00');
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return '#ef4444';
  if (diff <= 3) return '#f59e0b';
  return '#888';
}

export default function PaymentsScreen() {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filtered, setFiltered] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('미납');

  async function loadPayments() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('payments')
      .select('*, member:members(name, phone)')
      .eq('coach_id', user.id)
      .order('due_date', { ascending: false });
    setPayments(data ?? []);
  }

  useFocusEffect(useCallback(() => { loadPayments(); }, []));

  useEffect(() => {
    setFiltered(filter === 'all' ? payments : payments.filter(p => p.status === filter));
  }, [payments, filter]);

  // Derived stats
  const totalUnpaid = payments
    .filter(p => p.status !== '납부완료')
    .reduce((s, p) => s + (p.amount - p.paid_amount), 0);

  const thisMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const thisMonthPaid = payments
    .filter(p => p.status === '납부완료' && p.paid_date && p.paid_date.startsWith(thisMonth))
    .reduce((s, p) => s + p.paid_amount, 0);

  async function markPaid(payment: Payment) {
    Alert.alert('납부 확인', `${(payment as any).member?.name}님 납부 완료 처리하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '확인', onPress: async () => {
          await supabase.from('payments').update({
            status: '납부완료', paid_amount: payment.amount,
            paid_date: new Date().toISOString().split('T')[0],
          }).eq('id', payment.id);
          loadPayments();
        },
      },
    ]);
  }

  function renderPayment({ item }: { item: Payment }) {
    const member = (item as any).member;
    const remaining = item.amount - item.paid_amount;
    const dday = getDDay(item.due_date);
    const ddayColor = getDDayColor(item.due_date, item.status);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.memberInfo}>
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
          {item.paid_amount > 0 && item.status !== '납부완료' && (
            <View>
              <Text style={styles.amountLabel}>납부금액</Text>
              <Text style={[styles.amount, { color: '#22c55e' }]}>{item.paid_amount.toLocaleString()}원</Text>
            </View>
          )}
          {item.status !== '납부완료' && (
            <View>
              <Text style={styles.amountLabel}>미납금액</Text>
              <Text style={[styles.amount, { color: '#ef4444' }]}>{remaining.toLocaleString()}원</Text>
            </View>
          )}
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.row}>
            <Ionicons name="calendar-outline" size={12} color="#888" />
            <Text style={styles.dueDate}>납부기한: {item.due_date}</Text>
          </View>
          {item.status !== '납부완료' && (
            <TouchableOpacity style={styles.paidBtn} onPress={() => markPaid(item)}>
              <Text style={styles.paidBtnText}>납부 처리</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  const FILTERS: Filter[] = ['미납', '부분납부', '납부완료', 'all'];
  const FILTER_LABELS: Record<Filter, string> = { '미납': '미납', '부분납부': '부분', '납부완료': '완료', 'all': '전체' };

  return (
    <View style={styles.container}>
      {/* Summary Banner */}
      <View style={styles.summaryBanner}>
        <View style={styles.summaryLeft}>
          <View>
            <Text style={styles.summaryLabel}>전체 미납 금액</Text>
            <Text style={styles.summaryAmount}>
              {totalUnpaid > 0 ? `${totalUnpaid.toLocaleString()}원` : '없음'}
            </Text>
          </View>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryRight}>
          <Text style={styles.summaryLabel}>이번 달 납부 완료</Text>
          <Text style={styles.summaryPaid}>{thisMonthPaid.toLocaleString()}원</Text>
        </View>
      </View>

      {/* Unpaid alert if positive */}
      {totalUnpaid > 0 && (
        <View style={styles.unpaidBanner}>
          <Ionicons name="alert-circle" size={16} color="#dc2626" />
          <Text style={styles.unpaidBannerText}>
            미납 총액 <Text style={styles.unpaidBannerAmount}>{totalUnpaid.toLocaleString()}원</Text>
          </Text>
        </View>
      )}

      {/* Filters */}
      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
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

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderPayment}
        contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadPayments(); setRefreshing(false); }}
            tintColor="#1a7a4a"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="card-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>결제 내역이 없습니다</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },

  // Summary banner (top)
  summaryBanner: {
    backgroundColor: '#1a7a4a', flexDirection: 'row',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
    alignItems: 'center',
  },
  summaryLeft: { flex: 1 },
  summaryDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 16 },
  summaryRight: { flex: 1 },
  summaryLabel: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 4 },
  summaryAmount: { fontSize: 22, fontWeight: '800', color: '#fff' },
  summaryPaid: { fontSize: 22, fontWeight: '800', color: '#a7f3d0' },

  // Unpaid banner
  unpaidBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff5f5', paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#fecaca',
  },
  unpaidBannerText: { fontSize: 13, color: '#555' },
  unpaidBannerAmount: { fontWeight: '700', color: '#dc2626' },

  // Filters
  filterRow: {
    flexDirection: 'row', padding: 12, gap: 8,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f0f0f0' },
  filterChipActive: { backgroundColor: '#1a7a4a' },
  filterChipText: { fontSize: 13, color: '#888', fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  count: { fontSize: 12, color: '#888', paddingHorizontal: 16, paddingVertical: 8 },

  // Card
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 8,
  },
  memberInfo: {},
  memberName: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  memberPhone: { fontSize: 12, color: '#888', marginTop: 2 },
  cardHeaderRight: { alignItems: 'flex-end', gap: 4 },
  ddayBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  ddayText: { fontSize: 11, fontWeight: '800' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontWeight: '700' },
  description: { fontSize: 13, color: '#555', marginBottom: 10 },
  amountRow: { flexDirection: 'row', gap: 20, marginBottom: 10 },
  amountLabel: { fontSize: 11, color: '#888', marginBottom: 2 },
  amount: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dueDate: { fontSize: 12, color: '#888' },
  paidBtn: { backgroundColor: '#1a7a4a', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  paidBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Empty
  empty: { alignItems: 'center', padding: 60 },
  emptyText: { fontSize: 15, color: '#aaa', fontWeight: '500', marginTop: 12 },
});
