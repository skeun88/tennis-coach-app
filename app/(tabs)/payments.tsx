import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  Alert, Modal, FlatList, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { Payment, PaymentStatus } from '../../types';
import { Colors, Radius } from '../../lib/theme';

const TERRA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const CREAM = '#F7F0E9';
const WARM_GREY = '#8B7D75';
const WARM_BEIGE = '#E8DDD6';

type FilterTab = '미납' | '부분납' | '완납' | '전체';
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

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(ym: string) {
  const [y, m] = ym.split('-');
  return `${y}년 ${parseInt(m)}월`;
}

function getStatusLabel(status: PaymentStatus) {
  switch (status) {
    case '납부완료': return '완납';
    case '부분납부': return '부분납';
    default: return '미납';
  }
}

function getStatusStyle(status: PaymentStatus) {
  switch (status) {
    case '미납': return { bg: '#FEF2F2', color: '#EF4444' };
    case '부분납부': return { bg: '#FFFBEB', color: '#D97706' };
    case '납부완료': return { bg: '#ECFDF5', color: '#16A34A' };
    default: return { bg: '#F4F4F4', color: '#888' };
  }
}

function getSourceLabel(channel?: string) {
  if (!channel || channel === 'coach_manual') return '직접 등록';
  if (channel === 'member_app') return '회원앱 결제';
  return '직접 등록';
}

export default function PaymentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('미납');
  const [selectedMonth, setSelectedMonth] = useState(() => getMonthKey(new Date()));
  const [actionMembers, setActionMembers] = useState<ActionMember[]>([]);

  const [payModal, setPayModal] = useState(false);
  const [payTarget, setPayTarget] = useState<ActionMember | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const [packages, setPackages] = useState<LessonPackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<LessonPackage | null>(null);

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

  function prevMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    setSelectedMonth(getMonthKey(new Date(y, m - 2)));
  }
  function nextMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    setSelectedMonth(getMonthKey(new Date(y, m)));
  }

  const paidThisMonth = payments.filter(p =>
    (p.status === '납부완료' || p.status === '부분납부') &&
    (p.paid_date ?? '').startsWith(selectedMonth)
  );

  function methodSummary(method: PaymentMethod) {
    const items = paidThisMonth.filter(p => (p as any).payment_method === method);
    return { amount: items.reduce((s, p) => s + p.paid_amount, 0), count: items.length };
  }

  const totalRevenue = paidThisMonth.reduce((s, p) => s + p.paid_amount, 0);

  const monthPayments = payments.filter(p => {
    const d = p.paid_date ?? p.due_date;
    return d?.startsWith(selectedMonth);
  });

  const displayPayments = (() => {
    if (filter === '미납') return [];
    if (filter === '부분납') return monthPayments.filter(p => p.status === '부분납부');
    if (filter === '완납') return monthPayments.filter(p => p.status === '납부완료');
    return monthPayments;
  })();

  function isOverdue(dueDate?: string) {
    if (!dueDate) return false;
    return dueDate < new Date().toISOString().split('T')[0];
  }

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
        const { error } = await supabase.from('payments').update({
          status: '납부완료',
          paid_amount: (payTarget.unpaidAmount ?? 0) + (payments.find(p => p.id === payTarget.paymentId)?.paid_amount ?? 0),
          paid_date: today,
          payment_method: selectedMethod,
          payment_channel: 'coach_manual',
          ...(selectedPackage ? { description: `${selectedPackage.title} 결제` } : {}),
        }).eq('id', payTarget.paymentId);
        if (error) { Alert.alert('오류', '결제 저장에 실패했어요.\n' + error.message); setSaving(false); return; }
      } else {
        const pkg = selectedPackage;
        const { error } = await supabase.from('payments').insert({
          coach_id: user.id, member_id: memberId,
          amount: pkg ? pkg.price : (payTarget.unpaidAmount ?? 0),
          paid_amount: pkg ? pkg.price : (payTarget.unpaidAmount ?? 0),
          status: '납부완료',
          description: pkg ? `${pkg.title} 결제` : '결제',
          due_date: today, paid_date: today,
          payment_method: selectedMethod,
          payment_channel: 'coach_manual',
        });
        if (error) { Alert.alert('오류', '결제 저장에 실패했어요.\n' + error.message); setSaving(false); return; }
      }
      if (selectedPackage) {
        await supabase.from('members').update({
          remaining_credits: (payTarget.remainingCredits ?? 0) + selectedPackage.total_credits,
          total_credits: selectedPackage.total_credits,
          lesson_package_id: selectedPackage.id,
        }).eq('id', memberId);
      }
    } else if (payTarget.type === 'low_credit' && selectedPackage) {
      const { error } = await supabase.from('payments').insert({
        coach_id: user.id, member_id: memberId,
        amount: selectedPackage.price, paid_amount: selectedPackage.price,
        status: '납부완료', description: `${selectedPackage.title} 결제`,
        due_date: today, paid_date: today,
        payment_method: selectedMethod, payment_source: 'coach_manual',
      });
      if (error) { Alert.alert('오류', '결제 저장에 실패했어요.\n' + error.message); setSaving(false); return; }
      await supabase.from('members').update({
        remaining_credits: (payTarget.remainingCredits ?? 0) + selectedPackage.total_credits,
        total_credits: selectedPackage.total_credits,
        lesson_package_id: selectedPackage.id,
      }).eq('id', memberId);
    }

    setSaving(false);
    setPayModal(false);
    setPayTarget(null);
    loadData();

    const prevCredits = payTarget.remainingCredits ?? 0;
    const addedCredits = selectedPackage?.total_credits ?? 0;
    if (selectedPackage) {
      router.push({
        pathname: `/members/${memberId}`,
        params: {
          paymentDone: '1',
          prevCredits: String(prevCredits),
          addedCredits: String(addedCredits),
          newCredits: String(prevCredits + addedCredits),
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
        { text: '계좌이체', onPress: async () => { await supabase.from('payments').update({ status: '납부완료', paid_amount: payment.amount, paid_date: new Date().toISOString().split('T')[0], payment_method: '계좌이체', payment_source: 'coach_manual' }).eq('id', payment.id); loadData(); } },
        { text: '카드', onPress: async () => { await supabase.from('payments').update({ status: '납부완료', paid_amount: payment.amount, paid_date: new Date().toISOString().split('T')[0], payment_method: '카드', payment_source: 'coach_manual' }).eq('id', payment.id); loadData(); } },
        { text: '현금', onPress: async () => { await supabase.from('payments').update({ status: '납부완료', paid_amount: payment.amount, paid_date: new Date().toISOString().split('T')[0], payment_method: '현금', payment_source: 'coach_manual' }).eq('id', payment.id); loadData(); } },
      ]
    );
  }

  const FILTERS: { key: FilterTab; label: string }[] = [
    { key: '미납', label: '미납' },
    { key: '부분납', label: '부분납' },
    { key: '완납', label: '완납' },
    { key: '전체', label: '전체' },
  ];
  const METHODS: PaymentMethod[] = ['계좌이체', '카드', '현금'];

  function renderPaymentCard(item: Payment) {
    const member = (item as any).member;
    const statusStyle = getStatusStyle(item.status);
    const method = (item as any).payment_method as PaymentMethod | undefined;
    const source = (item as any).payment_channel as string | undefined;
    const dateStr = item.paid_date ?? item.due_date;
    const dateLabel = dateStr ? dateStr.slice(5).replace('-', '월 ') + '일' : '';

    return (
      <View key={item.id} style={s.payCard}>
        <View style={s.payRow1}>
          <Text style={s.payName}>{member?.name ?? '알 수 없음'}</Text>
          <Text style={s.payAmount}>{item.paid_amount.toLocaleString()}원</Text>
        </View>
        <Text style={s.payDesc}>{item.description}</Text>
        <View style={s.payRow3}>
          <Text style={s.payMeta}>{dateLabel}</Text>
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {method && (
              <View style={[s.badge, { backgroundColor: '#FBF2EF' }]}>
                <Text style={[s.badgeText, { color: TERRA }]}>{method}</Text>
              </View>
            )}
            <View style={[s.badge, { backgroundColor: source === 'member_app' ? '#FBF2EF' : '#F5F0EB' }]}>
              <Text style={[s.badgeText, { color: source === 'member_app' ? TERRA : WARM_GREY }]}>{getSourceLabel(source)}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: statusStyle.bg }]}>
              <Text style={[s.badgeText, { color: statusStyle.color }]}>{getStatusLabel(item.status)}</Text>
            </View>
          </View>
        </View>
        <TouchableOpacity style={s.editBtn} onPress={() => openEditModal(item)}>
          <Ionicons name="create-outline" size={12} color={WARM_GREY} />
          <Text style={s.editBtnText}>수정</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const monthNum = parseInt(selectedMonth.split('-')[1]);

  return (
    <View style={s.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} tintColor={TERRA} />}
      >
        {/* Header */}
        <View style={[s.header, { paddingTop: insets.top + 12 }]}>
          <Text style={s.headerTitle}>결제</Text>
          <Text style={s.headerSubtitle}>레슨비 매출을 한눈에 확인하세요</Text>
        </View>

        {/* Month selector */}
        <View style={s.monthRow}>
          <TouchableOpacity style={s.monthBtn} onPress={prevMonth}>
            <Ionicons name="chevron-back" size={16} color={DARK_BROWN} />
          </TouchableOpacity>
          <Text style={s.monthText}>{formatMonth(selectedMonth)}</Text>
          <TouchableOpacity style={s.monthBtn} onPress={nextMonth}>
            <Ionicons name="chevron-forward" size={16} color={DARK_BROWN} />
          </TouchableOpacity>
        </View>

        {/* Payment method summary */}
        <View style={s.methodCards}>
          {(['카드', '계좌이체', '현금'] as PaymentMethod[]).map(method => {
            const { amount, count } = methodSummary(method);
            return (
              <View key={method} style={s.methodCard}>
                <Text style={s.methodCardLabel}>{method}</Text>
                <Text style={s.methodCardAmount}>{amount > 0 ? amount.toLocaleString() : '0'}원</Text>
                <Text style={s.methodCardCount}>{count}건</Text>
              </View>
            );
          })}
        </View>

        {/* 현재 매출액 */}
        <View style={s.revenueCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text style={s.revenueTitle}>{monthNum}월 현재 매출액</Text>
            <Text style={s.revenueNote}>납부 완료 기준</Text>
          </View>
          <Text style={s.revenueAmount}>{totalRevenue.toLocaleString()}원</Text>
        </View>

        {/* Status filter segment */}
        <View style={s.segmentWrap}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[s.segmentItem, filter === f.key && s.segmentItemActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[s.segmentText, filter === f.key && s.segmentTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content */}
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          {filter === '미납' ? (
            actionMembers.length === 0 ? (
              <View style={s.empty}><Text style={s.emptyText}>납부가 필요한 회원이 없어요</Text></View>
            ) : (
              actionMembers.map(m => {
                const isUnpaid = m.type === 'unpaid';
                const overdue = isUnpaid && isOverdue(m.dueDate);
                return (
                  <View key={m.key} style={s.unpaidCard}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <Text style={s.unpaidName}>{m.name}</Text>
                        {overdue && (
                          <View style={s.overdueBadge}>
                            <Text style={s.overdueBadgeText}>연체</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.unpaidSub}>
                        {isUnpaid
                          ? `미납 ${(m.unpaidAmount ?? 0).toLocaleString()}원${m.dueDate ? ` · 기한 ${m.dueDate}` : ''}`
                          : `잔여 ${m.remainingCredits}회`}
                      </Text>
                    </View>
                    <TouchableOpacity style={s.payBtn} onPress={() => openPayModal(m)}>
                      <Text style={s.payBtnText}>{isUnpaid ? '납부' : '결제'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )
          ) : (
            displayPayments.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyText}>
                  {filter === '부분납' ? '부분 납부 내역이 없어요'
                    : filter === '완납' ? '완료된 결제 내역이 없어요'
                    : `${monthNum}월 결제 내역이 없어요`}
                </Text>
              </View>
            ) : (
              displayPayments.map(renderPaymentCard)
            )
          )}
        </View>
      </ScrollView>

      {/* 납부 모달 */}
      <Modal visible={payModal} transparent animationType="slide" onRequestClose={() => setPayModal(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setPayModal(false)}>
          <TouchableOpacity style={s.modalSheet} activeOpacity={1} onPress={() => {}}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>납부 처리</Text>
            {payTarget && (
              <>
                <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: CREAM, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="person-outline" size={16} color={WARM_GREY} />
                  <Text style={{ fontSize: 13, color: WARM_GREY, width: 52 }}>회원</Text>
                  <Text style={{ flex: 1, fontSize: 15, color: DARK_BROWN, fontWeight: '600' }}>{payTarget.name}</Text>
                  {payTarget.type === 'unpaid' && (
                    <Text style={{ fontSize: 14, fontWeight: '800', color: DARK_BROWN }}>{(payTarget.unpaidAmount ?? 0).toLocaleString()}원</Text>
                  )}
                </View>
                <Text style={{ fontSize: 13, fontWeight: '700', color: WARM_GREY, marginHorizontal: 16, marginBottom: 8 }}>
                  레슨권 선택{payTarget.type === 'unpaid' ? ' (선택사항)' : ''}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                  {packages.length === 0 ? (
                    <Text style={{ fontSize: 13, color: Colors.placeholder, paddingVertical: 12 }}>등록된 레슨권이 없습니다</Text>
                  ) : packages.map(pkg => {
                    const isSel = selectedPackage?.id === pkg.id;
                    return (
                      <TouchableOpacity key={pkg.id} onPress={() => setSelectedPackage(isSel ? null : pkg)}
                        style={{ borderWidth: 1.5, borderColor: isSel ? TERRA : WARM_BEIGE, borderRadius: 10, padding: 12, minWidth: 130, backgroundColor: isSel ? TERRA : '#fff' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: isSel ? '#fff' : DARK_BROWN, marginBottom: 4 }}>{pkg.title}</Text>
                        <Text style={{ fontSize: 12, color: isSel ? 'rgba(255,255,255,0.8)' : WARM_GREY }}>{pkg.total_credits}회 · {pkg.price.toLocaleString()}원</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {selectedPackage && (
                  <Text style={{ fontSize: 12, color: WARM_GREY, marginHorizontal: 16, marginTop: 4, marginBottom: 4 }}>
                    결제 금액: <Text style={{ fontWeight: '800', color: DARK_BROWN }}>{selectedPackage.price.toLocaleString()}원</Text> · {selectedPackage.total_credits}회 추가
                  </Text>
                )}
                <Text style={{ fontSize: 13, fontWeight: '700', color: WARM_GREY, marginHorizontal: 16, marginTop: 12, marginBottom: 10 }}>납부 방법</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 }}>
                  {METHODS.map(m => (
                    <TouchableOpacity key={m} style={[s.methodBtn, selectedMethod === m && s.methodBtnActive]} onPress={() => setSelectedMethod(m)}>
                      <Ionicons name={METHOD_ICONS[m] as any} size={22} color={selectedMethod === m ? '#fff' : WARM_GREY} />
                      <Text style={[s.methodBtnText, selectedMethod === m && { color: '#fff' }]}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={[s.confirmBtn, (saving || !selectedMethod || (payTarget.type === 'low_credit' && !selectedPackage)) && { backgroundColor: Colors.placeholder }]}
                  onPress={confirmPayment}
                  disabled={saving || !selectedMethod || (payTarget.type === 'low_credit' && !selectedPackage)}
                >
                  <Text style={s.confirmBtnText}>
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
          <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => { setEditModal(false); setEditTarget(null); }}>
            <TouchableOpacity style={[s.modalSheet, { paddingBottom: Math.max(32, insets.bottom + 16) }]} activeOpacity={1} onPress={() => {}}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>결제 수정</Text>
              <ScrollView style={{ paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
                <Text style={s.editLbl}>내용</Text>
                <TextInput style={s.editInput} value={editDesc} onChangeText={setEditDesc} placeholder="레슨권명 등" placeholderTextColor={Colors.placeholder} />
                <Text style={s.editLbl}>청구금액 (원)</Text>
                <TextInput style={s.editInput} value={editAmount} onChangeText={setEditAmount} keyboardType="numeric" placeholder="예: 150000" placeholderTextColor={Colors.placeholder} />
                <Text style={s.editLbl}>납부 상태</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {(['미납', '부분납부', '납부완료'] as PaymentStatus[]).map(st => (
                    <TouchableOpacity key={st} style={[s.segmentItem, editStatus === st && s.segmentItemActive, { flex: 1 }]} onPress={() => setEditStatus(st)}>
                      <Text style={[s.segmentText, editStatus === st && s.segmentTextActive]}>{getStatusLabel(st)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {editStatus === '부분납부' && (
                  <>
                    <Text style={s.editLbl}>실납부금액 (원)</Text>
                    <TextInput style={s.editInput} value={editPaidAmount} onChangeText={setEditPaidAmount} keyboardType="numeric" placeholderTextColor={Colors.placeholder} />
                  </>
                )}
                <Text style={s.editLbl}>납부 방법</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  {METHODS.map(m => (
                    <TouchableOpacity key={m} style={[s.methodBtn, editMethod === m && s.methodBtnActive]} onPress={() => setEditMethod(m)}>
                      <Ionicons name={METHOD_ICONS[m] as any} size={20} color={editMethod === m ? '#fff' : WARM_GREY} />
                      <Text style={[s.methodBtnText, editMethod === m && { color: '#fff' }]}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.editLbl}>납부기한 (YYYY-MM-DD)</Text>
                <TextInput style={s.editInput} value={editDueDate} onChangeText={setEditDueDate} placeholder="2026-06-30" placeholderTextColor={Colors.placeholder} />
                {editStatus !== '미납' && (
                  <>
                    <Text style={s.editLbl}>납부일 (YYYY-MM-DD)</Text>
                    <TextInput style={s.editInput} value={editPaidDate} onChangeText={setEditPaidDate} placeholder="2026-06-15" placeholderTextColor={Colors.placeholder} />
                  </>
                )}
                <TouchableOpacity style={[s.confirmBtn, { marginTop: 8, marginBottom: 16 }]} onPress={saveEditPayment} disabled={editSaving}>
                  <Text style={s.confirmBtnText}>{editSaving ? '저장 중...' : '수정 저장'}</Text>
                </TouchableOpacity>
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  header: { paddingHorizontal: 20, paddingBottom: 6 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: DARK_BROWN, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 14, color: WARM_GREY, marginTop: 3 },

  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 20 },
  monthBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: WARM_BEIGE },
  monthText: { fontSize: 17, fontWeight: '700', color: DARK_BROWN, minWidth: 110, textAlign: 'center' },

  methodCards: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 12 },
  methodCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: WARM_BEIGE, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  methodCardLabel: { fontSize: 12, fontWeight: '600', color: WARM_GREY, marginBottom: 6 },
  methodCardAmount: { fontSize: 13, fontWeight: '800', color: DARK_BROWN, marginBottom: 2 },
  methodCardCount: { fontSize: 11, color: WARM_GREY },

  revenueCard: {
    marginHorizontal: 16, marginBottom: 16, backgroundColor: TERRA, borderRadius: 20, padding: 20,
    shadowColor: TERRA, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  revenueTitle: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  revenueNote: { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  revenueAmount: { fontSize: 32, fontWeight: '800', color: '#fff', marginTop: 8, letterSpacing: -1 },

  segmentWrap: { flexDirection: 'row', backgroundColor: '#fff', marginHorizontal: 16, borderRadius: 14, padding: 4, borderWidth: 1, borderColor: WARM_BEIGE, marginBottom: 4 },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segmentItemActive: { backgroundColor: TERRA },
  segmentText: { fontSize: 13, fontWeight: '600', color: WARM_GREY },
  segmentTextActive: { color: '#fff', fontWeight: '700' },

  unpaidCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: WARM_BEIGE, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  unpaidName: { fontSize: 15, fontWeight: '700', color: DARK_BROWN },
  unpaidSub: { fontSize: 13, color: WARM_GREY, marginTop: 2 },
  overdueBadge: { backgroundColor: '#FEF2F2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  overdueBadgeText: { fontSize: 11, fontWeight: '700', color: '#EF4444' },
  payBtn: { backgroundColor: TERRA, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  payBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  payCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: WARM_BEIGE,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  payRow1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  payName: { fontSize: 16, fontWeight: '700', color: DARK_BROWN },
  payAmount: { fontSize: 18, fontWeight: '800', color: DARK_BROWN },
  payDesc: { fontSize: 13, color: WARM_GREY, marginBottom: 10 },
  payRow3: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  payMeta: { fontSize: 13, color: WARM_GREY },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  editBtn: { alignSelf: 'flex-end', marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CREAM, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  editBtnText: { fontSize: 12, color: WARM_GREY, fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyText: { fontSize: 15, color: WARM_GREY, fontWeight: '500' },

  methodBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: CREAM, borderWidth: 1.5, borderColor: WARM_BEIGE, gap: 6 },
  methodBtnActive: { backgroundColor: TERRA, borderColor: TERRA },
  methodBtnText: { fontSize: 13, fontWeight: '700', color: WARM_GREY },
  confirmBtn: { margin: 16, marginTop: 0, backgroundColor: TERRA, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, backgroundColor: WARM_BEIGE, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: DARK_BROWN, textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: WARM_BEIGE },
  editLbl: { fontSize: 13, fontWeight: '700', color: WARM_GREY, marginTop: 14, marginBottom: 6 },
  editInput: { borderWidth: 1.5, borderColor: WARM_BEIGE, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: DARK_BROWN, backgroundColor: CREAM },
});
