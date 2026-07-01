import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  Alert, Modal, FlatList, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { Payment, PaymentStatus } from '../../types';
import { Colors, Radius } from '../../lib/theme';

type Filter = 'all' | '미납' | '부분납부' | '납부완료';
type PaymentMethod = '계좌이체' | '카드' | '현금';

interface ActionMember {
  key: string;
  memberId: string;
  name: string;
  phone: string;
  type: 'low_credit' | 'unpaid';
  remainingCredits?: number;
  paymentId?: string;
  unpaidAmount?: number;
  dueDate?: string;
}

interface LessonPackage {
  id: string;
  title: string;
  price: number;
  total_credits: number;
  duration_minutes: number;
  days: number[];
}

const METHOD_ICONS: Record<PaymentMethod, string> = {
  '계좌이체': 'phone-portrait-outline',
  '카드': 'card-outline',
  '현금': 'cash-outline',
};

export default function PaymentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filtered, setFiltered] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('미납');
  const [actionMembers, setActionMembers] = useState<ActionMember[]>([]);

  // 납부 모달
  const [payModal, setPayModal] = useState(false);
  const [payTarget, setPayTarget] = useState<ActionMember | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [saving, setSaving] = useState(false);

  // 레슨권 선택
  const [packages, setPackages] = useState<LessonPackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<LessonPackage | null>(null);

  // 수정 모달
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Payment | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editPaidAmount, setEditPaidAmount] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPaidDate, setEditPaidDate] = useState('');
  const [editStatus, setEditStatus] = useState<PaymentStatus>('미납');
  const [editMethod, setEditMethod] = useState<PaymentMethod | ''>('');
  const [editSaving, setEditSaving] = useState(false);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: paymentsData } = await supabase
      .from('payments')
      .select('*, member:members(name, phone)')
      .eq('coach_id', user.id)
      .order('due_date', { ascending: false });
    setPayments(paymentsData ?? []);

    const { data: lowCredits } = await supabase
      .from('members')
      .select('id, name, phone, remaining_credits, lesson_package_id, lesson_packages(id, title, price, total_credits)')
      .eq('coach_id', user.id)
      .eq('is_active', true)
      .lte('remaining_credits', 3)
      .order('remaining_credits');

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

    const combined: ActionMember[] = [...unpaidMap.values()];
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

  async function openPayModal(member: ActionMember) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: pkgs } = await supabase
      .from('lesson_packages')
      .select('id, title, price, total_credits, duration_minutes, days')
      .eq('coach_id', user.id)
      .eq('is_active', true)
      .order('price');
    setPackages(pkgs ?? []);
    setSelectedPackage(null);
    setPayTarget(member);
    setSelectedMethod(null);
    setPayModal(true);
  }

  async function confirmPayment() {
    if (!payTarget || !selectedMethod) return;
    if (payTarget.type === 'low_credit' && !selectedPackage) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const memberId = payTarget.memberId;

    const today = new Date().toISOString().split('T')[0];

    if (payTarget.type === 'unpaid') {
      if (payTarget.paymentId) {
        // 기존 미납 row 업데이트
        const { error } = await supabase.from('payments').update({
          status: '납부완료',
          paid_amount: (payTarget.unpaidAmount ?? 0) + (payments.find(p => p.id === payTarget.paymentId)?.paid_amount ?? 0),
          paid_date: today,
          payment_method: selectedMethod,
          ...(selectedPackage ? { description: `${selectedPackage.title} 결제` } : {}),
        }).eq('id', payTarget.paymentId);
        if (error) { Alert.alert('오류', '결제 저장에 실패했어요.\n' + error.message); setSaving(false); return; }
      } else {
        // 미납 row 없는 경우 새로 insert
        const pkg = selectedPackage;
        const { error } = await supabase.from('payments').insert({
          coach_id: user.id,
          member_id: memberId,
          amount: pkg ? pkg.price : (payTarget.unpaidAmount ?? 0),
          paid_amount: pkg ? pkg.price : (payTarget.unpaidAmount ?? 0),
          status: '납부완료',
          description: pkg ? `${pkg.title} 결제` : '결제',
          due_date: today,
          paid_date: today,
          payment_method: selectedMethod,

        });
        if (error) { Alert.alert('오류', '결제 저장에 실패했어요.\n' + error.message); setSaving(false); return; }
      }
      if (selectedPackage) {
        await supabase.from('members').update({
          remaining_credits: (payTarget.remainingCredits ?? 0) + selectedPackage.total_credits,
          lesson_package_id: selectedPackage.id,
        }).eq('id', memberId);
      }
    } else if (payTarget.type === 'low_credit' && selectedPackage) {
      const { error } = await supabase.from('payments').insert({
        coach_id: user.id,
        member_id: memberId,
        amount: selectedPackage.price,
        paid_amount: selectedPackage.price,
        status: '납부완료',
        description: `${selectedPackage.title} 결제`,
        due_date: today,
        paid_date: today,
        payment_method: selectedMethod,
      });
      if (error) { Alert.alert('오류', '결제 저장에 실패했어요.\n' + error.message); setSaving(false); return; }
      await supabase.from('members').update({
        remaining_credits: (payTarget.remainingCredits ?? 0) + selectedPackage.total_credits,
        lesson_package_id: selectedPackage.id,
      }).eq('id', memberId);
    }

    setSaving(false);
    setPayModal(false);
    setPayTarget(null);
    loadData();

    // 레슨권 충전 정보를 params로 전달해 회원상세에서 완료 모달 표시
    const prevCredits = payTarget.remainingCredits ?? 0;
    const addedCredits = selectedPackage?.total_credits ?? 0;
    const newCredits = prevCredits + addedCredits;
    if (selectedPackage) {
      router.push({
        pathname: `/members/${memberId}`,
        params: {
          paymentDone: '1',
          prevCredits: String(prevCredits),
          addedCredits: String(addedCredits),
          newCredits: String(newCredits),
          packageTitle: selectedPackage.title,
        },
      });
    } else {
      router.push(`/members/${memberId}`);
    }
  }

  function openEditModal(payment: Payment) {
    setEditTarget(payment);
    setEditDesc(payment.description);
    setEditAmount(String(payment.amount));
    setEditPaidAmount(String(payment.paid_amount));
    setEditDueDate(payment.due_date);
    setEditPaidDate(payment.paid_date ?? '');
    setEditStatus(payment.status);
    setEditMethod(((payment as any).payment_method as PaymentMethod) ?? '');
    setEditModal(true);
  }

  async function saveEditPayment() {
    if (!editTarget) return;
    setEditSaving(true);
    const amount = parseInt(editAmount) || editTarget.amount;
    const paidAmount = editStatus === '납부완료' ? amount : editStatus === '미납' ? 0 : parseInt(editPaidAmount) || editTarget.paid_amount;
    const paidDate = editStatus === '미납' ? null : (editPaidDate || new Date().toISOString().split('T')[0]);
    await supabase.from('payments').update({
      description: editDesc, amount, paid_amount: paidAmount,
      due_date: editDueDate, paid_date: paidDate, status: editStatus,
      payment_method: editMethod || null,
    }).eq('id', editTarget.id);
    setEditSaving(false);
    setEditModal(false);
    setEditTarget(null);
    loadData();
  }

  async function markPaidQuick(payment: Payment) {
    Alert.alert(
      '납부 방법 선택',
      `${(payment as any).member?.name}님\n${(payment.amount - payment.paid_amount).toLocaleString()}원`,
      [
        { text: '취소', style: 'cancel' },
        { text: '계좌이체', onPress: async () => { await supabase.from('payments').update({ status: '납부완료', paid_amount: payment.amount, paid_date: new Date().toISOString().split('T')[0], payment_method: '계좌이체' }).eq('id', payment.id); loadData(); } },
        { text: '카드', onPress: async () => { await supabase.from('payments').update({ status: '납부완료', paid_amount: payment.amount, paid_date: new Date().toISOString().split('T')[0], payment_method: '카드' }).eq('id', payment.id); loadData(); } },
        { text: '현금', onPress: async () => { await supabase.from('payments').update({ status: '납부완료', paid_amount: payment.amount, paid_date: new Date().toISOString().split('T')[0], payment_method: '현금' }).eq('id', payment.id); loadData(); } },
      ]
    );
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: '미납', label: '미납' },
    { key: '부분납부', label: '부분' },
    { key: '납부완료', label: '완납' },
    { key: 'all', label: '전체' },
  ];
  const METHODS: PaymentMethod[] = ['계좌이체', '카드', '현금'];

  function renderPayment({ item }: { item: Payment }) {
    const member = (item as any).member;
    const remaining = item.amount - item.paid_amount;
    const isUnpaid = item.status !== '납부완료';

    return (
      <View style={[styles.payCard, isUnpaid && styles.payCardUnpaid]}>
        <View style={styles.payHeader}>
          <View>
            <Text style={styles.payName}>{member?.name ?? '알 수 없음'}</Text>
            <Text style={styles.payLbl}>{item.description}</Text>
          </View>
          <Text style={styles.payAmount}>{item.amount.toLocaleString()}원</Text>
        </View>
        <View style={styles.payFooter}>
          <Text style={styles.payMethod}>
            {item.due_date}
            {(item as any).payment_method ? ` · ${(item as any).payment_method}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[styles.payStatus, item.status === '납부완료' && styles.payStatusPaid]}>
              <Text style={[styles.payStatusText, item.status === '납부완료' && styles.payStatusTextPaid]}>
                {item.status}
              </Text>
            </View>
            {isUnpaid && (
              <TouchableOpacity style={styles.payBtnSm} onPress={() => markPaidQuick(item)}>
                <Text style={styles.payBtnSmText}>납부</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.editBtn} onPress={() => openEditModal(item)}>
              <Ionicons name="create-outline" size={13} color={Colors.mutedFg} />
              <Text style={styles.editBtnText}>수정</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={[styles.headerCard, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>결제 관리</Text>
        </View>
        {/* 요약 카드 */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalUnpaid > 0 ? totalUnpaid.toLocaleString() + '원' : '없음'}</Text>
            <Text style={styles.summaryLabel}>미수금</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{thisMonthPaid > 0 ? thisMonthPaid.toLocaleString() + '원' : '-'}</Text>
            <Text style={styles.summaryLabel}>이번 달 수입</Text>
          </View>
        </View>
      </View>

      {/* Filter Chips */}
      <View style={[styles.filterChips, { paddingTop: 4 }]}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.fchip, filter === f.key && styles.fchipOn]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.fchipText, filter === f.key && styles.fchipTextOn]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderPayment}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} tintColor={Colors.foreground} />}
        ListHeaderComponent={
          actionMembers.length > 0 ? (
            <View style={styles.alertSection}>
              <View style={styles.alertHeader}>
                <Ionicons name="alert-circle" size={16} color={Colors.foreground} />
                <Text style={styles.alertTitle}>납부 필요 회원</Text>
                <View style={styles.alertCount}>
                  <Text style={styles.alertCountText}>{actionMembers.length}명</Text>
                </View>
              </View>
              {actionMembers.map(m => {
                const isUnpaid = m.type === 'unpaid';
                const subLabel = isUnpaid
                  ? `미납 ${(m.unpaidAmount ?? 0).toLocaleString()}원${m.dueDate ? ` · 기한 ${m.dueDate}` : ''}`
                  : `잔여 ${m.remainingCredits}회`;
                return (
                  <View key={m.key} style={styles.alertRow}>
                    <View style={styles.alertDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.alertName}>{m.name}</Text>
                      <Text style={styles.alertSub}>{subLabel}</Text>
                    </View>
                    <TouchableOpacity style={styles.payBtnSm} onPress={() => openPayModal(m)}>
                      <Text style={styles.payBtnSmText}>{isUnpaid ? '납부' : '결제'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', padding: 60 }}>
            <Ionicons name="card-outline" size={48} color={Colors.placeholder} />
            <Text style={{ fontSize: 15, color: Colors.placeholder, marginTop: 12 }}>결제 내역이 없습니다</Text>
          </View>
        }
      />

      {/* 납부 모달 */}
      <Modal visible={payModal} transparent animationType="slide" onRequestClose={() => setPayModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setPayModal(false)}>
          <TouchableOpacity style={styles.modalSheet} activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>납부 처리</Text>
            {payTarget && (
              <>
                {/* 회원 정보 */}
                <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: Colors.background, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="person-outline" size={16} color={Colors.mutedFg} />
                  <Text style={{ fontSize: 13, color: Colors.mutedFg, width: 52 }}>회원</Text>
                  <Text style={{ flex: 1, fontSize: 15, color: Colors.foreground, fontWeight: '600' }}>{payTarget.name}</Text>
                  {payTarget.type === 'unpaid' && (
                    <Text style={{ fontSize: 14, fontWeight: '800', color: Colors.foreground }}>{(payTarget.unpaidAmount ?? 0).toLocaleString()}원</Text>
                  )}
                </View>

                {/* 레슨권 선택 */}
                <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginHorizontal: 16, marginBottom: 8 }}>
                  레슨권 선택{payTarget.type === 'unpaid' ? ' (선택사항)' : ''}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                  {packages.length === 0 ? (
                    <Text style={{ fontSize: 13, color: Colors.placeholder, paddingVertical: 12 }}>등록된 레슨권이 없습니다</Text>
                  ) : (
                    packages.map(pkg => {
                      const isSelected = selectedPackage?.id === pkg.id;
                      return (
                        <TouchableOpacity
                          key={pkg.id}
                          onPress={() => setSelectedPackage(isSelected ? null : pkg)}
                          style={{
                            borderWidth: 1.5,
                            borderColor: isSelected ? Colors.foreground : Colors.border,
                            borderRadius: 10,
                            padding: 12,
                            minWidth: 130,
                            backgroundColor: isSelected ? Colors.foreground : Colors.card,
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '700', color: isSelected ? '#fff' : Colors.foreground, marginBottom: 4 }}>{pkg.title}</Text>
                          <Text style={{ fontSize: 12, color: isSelected ? 'rgba(255,255,255,0.7)' : Colors.mutedFg }}>{pkg.total_credits}회 · {pkg.price.toLocaleString()}원</Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
                {selectedPackage && (
                  <Text style={{ fontSize: 12, color: Colors.mutedFg, marginHorizontal: 16, marginTop: 4, marginBottom: 4 }}>
                    결제 금액: <Text style={{ fontWeight: '800', color: Colors.foreground }}>{selectedPackage.price.toLocaleString()}원</Text> · {selectedPackage.total_credits}회 추가
                  </Text>
                )}

                {/* 납부 방법 */}
                <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginHorizontal: 16, marginTop: 12, marginBottom: 10 }}>납부 방법</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 }}>
                  {METHODS.map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.methodBtn, selectedMethod === m && styles.methodBtnActive]}
                      onPress={() => setSelectedMethod(m)}
                    >
                      <Ionicons name={METHOD_ICONS[m] as any} size={22} color={selectedMethod === m ? '#fff' : Colors.mutedFg} />
                      <Text style={[styles.methodBtnText, selectedMethod === m && { color: '#fff' }]}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.confirmBtn, (saving || !selectedMethod || (payTarget.type === 'low_credit' && !selectedPackage)) && { backgroundColor: Colors.placeholder }]}
                  onPress={confirmPayment}
                  disabled={saving || !selectedMethod || (payTarget.type === 'low_credit' && !selectedPackage)}
                >
                  <Text style={styles.confirmBtnText}>
                    {saving ? '처리 중...' : !selectedMethod ? '납부 방법을 선택하세요' : (payTarget.type === 'low_credit' && !selectedPackage) ? '레슨권을 선택하세요' : `${selectedMethod}으로 납부 완료`}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 수정 모달 */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => { setEditModal(false); setEditTarget(null); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => { setEditModal(false); setEditTarget(null); }}>
            <TouchableOpacity style={[styles.modalSheet, { paddingBottom: 32 }]} activeOpacity={1} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>결제 수정</Text>
              <ScrollView style={{ paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.editFieldLabel}>내용</Text>
                <TextInput style={styles.editInput} value={editDesc} onChangeText={setEditDesc} placeholder="레슨권명 등" placeholderTextColor={Colors.placeholder} />
                <Text style={styles.editFieldLabel}>청구금액 (원)</Text>
                <TextInput style={styles.editInput} value={editAmount} onChangeText={setEditAmount} keyboardType="numeric" placeholder="예: 150000" placeholderTextColor={Colors.placeholder} />
                <Text style={styles.editFieldLabel}>납부 상태</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {(['미납', '부분납부', '납부완료'] as PaymentStatus[]).map(s => (
                    <TouchableOpacity key={s} style={[styles.fchip, editStatus === s && styles.fchipOn]} onPress={() => setEditStatus(s)}>
                      <Text style={[styles.fchipText, editStatus === s && styles.fchipTextOn]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {editStatus === '부분납부' && (
                  <>
                    <Text style={styles.editFieldLabel}>실납부금액 (원)</Text>
                    <TextInput style={styles.editInput} value={editPaidAmount} onChangeText={setEditPaidAmount} keyboardType="numeric" placeholderTextColor={Colors.placeholder} />
                  </>
                )}
                <Text style={styles.editFieldLabel}>납부기한 (YYYY-MM-DD)</Text>
                <TextInput style={styles.editInput} value={editDueDate} onChangeText={setEditDueDate} placeholder="2026-06-30" placeholderTextColor={Colors.placeholder} />
                {editStatus !== '미납' && (
                  <>
                    <Text style={styles.editFieldLabel}>납부일 (YYYY-MM-DD)</Text>
                    <TextInput style={styles.editInput} value={editPaidDate} onChangeText={setEditPaidDate} placeholder="2026-06-15" placeholderTextColor={Colors.placeholder} />
                  </>
                )}
                <TouchableOpacity style={[styles.confirmBtn, { marginTop: 8, marginBottom: 16 }]} onPress={saveEditPayment} disabled={editSaving}>
                  <Text style={styles.confirmBtnText}>{editSaving ? '저장 중...' : '수정 저장'}</Text>
                </TouchableOpacity>
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  // 헤더
  headerCard: {
    backgroundColor: Colors.background,
    paddingHorizontal: 16, paddingBottom: 12,
    marginBottom: 0,
  },
  headerTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.foreground },
  summaryRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 0,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  summaryValue: { fontSize: 18, fontWeight: '800', color: Colors.foreground, marginBottom: 4 },
  summaryLabel: { fontSize: 12, color: Colors.mutedFg, fontWeight: '500' },
  filterChips: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  fchip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: Colors.mutedBg },
  fchipOn: { backgroundColor: Colors.primary },
  fchipText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  fchipTextOn: { color: '#FFFFFF' },
  alertSection: {
    backgroundColor: Colors.card, borderRadius: Radius.md, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.foreground,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  alertTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foreground },
  alertCount: { backgroundColor: Colors.foreground, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  alertCountText: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  alertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.foreground },
  alertName: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  alertSub: { fontSize: 13, color: Colors.mutedFg },
  payBtnSm: { backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  payBtnSmText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  payCard: {
    backgroundColor: Colors.card, borderRadius: Radius.md, padding: 16, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  payCardUnpaid: { borderLeftWidth: 3, borderLeftColor: Colors.foreground },
  payHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  payName: { fontSize: 16, fontWeight: '600', color: Colors.foreground },
  payLbl: { fontSize: 13, color: Colors.mutedFg, marginTop: 2 },
  payAmount: { fontSize: 20, fontWeight: '700', color: Colors.foreground },
  payFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  payMethod: { fontSize: 13, color: Colors.mutedFg },
  payStatus: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, backgroundColor: Colors.mutedBg },
  payStatusPaid: { backgroundColor: 'rgba(45,51,64,0.08)' },
  payStatusText: { fontSize: 12, fontWeight: '500', color: Colors.mutedFg },
  payStatusTextPaid: { color: Colors.foreground },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.mutedBg, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10,
  },
  editBtnText: { fontSize: 12, fontWeight: '600', color: Colors.mutedFg },
  methodBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.mutedBg, borderWidth: 2, borderColor: Colors.border, gap: 6,
  },
  methodBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  methodBtnText: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  confirmBtn: { margin: 16, marginTop: 0, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground, textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  editFieldLabel: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 14, marginBottom: 6 },
  editInput: { borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.foreground, backgroundColor: Colors.background },
});
