import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
  Modal, FlatList, Linking, Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter, Link, Stack, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Member, MemberLevel, Attendance, Payment, PaymentStatus, MemberNote } from '../../types';
import { Colors } from '../../lib/theme';
import { useSubscription } from '../../hooks/useSubscription';
import MemberIssueTags from '../../components/MemberIssueTags';
import PlanUpsellModal from '../../components/PlanUpsellModal';
import { notifyMemberMessage, notifyMemberReregister, notifyMemberAbsent } from '../../lib/notifications';
import { detectScheduleType, ScheduleType } from '../../lib/scheduleTypeUtils';
import { buildMemberUpsertPayload, MEMBER_BASIC_FIELD_KEYS, MEMBER_LEVELS } from './member-form';

type DayTimes = Record<number, string[]>;
type DateEntry = { date: string; startTime: string; duration: number };

const LEVELS: MemberLevel[] = MEMBER_LEVELS;
const LEVEL_COLORS: Record<MemberLevel, string> = {
  '입문': Colors.level.입문,
  '초급': Colors.level.초급,
  '중급': Colors.level.중급,
  '상급': Colors.level.상급,
  '선수': Colors.level.선수,
};
const LEVEL_BADGE: Record<string, { bg: string; text: string }> = {
  '입문': { bg: '#FBF2EF', text: '#C0755A' },
  '초급': { bg: '#F0E0D6', text: '#A86045' },
  '중급': { bg: '#E4C8B8', text: '#8A4A34' },
  '상급': { bg: '#D4A898', text: '#6B3522' },
  '선수': { bg: '#3E2B22', text: '#F7F0E9' },
};

const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 23; h++) {
  for (let m = 0; m < 60; m += 10) {
    if (h === 23 && m > 0) break;
    TIME_OPTIONS.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
  }
}

function toKSTDateStr(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

function kstToday(): Date {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toISOString().split('T')[0];
  return new Date(dateStr + 'T00:00:00+09:00');
}

function formatDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.startsWith('02')) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}





const ABSENCE_REASONS = ['개인사정', '부상', '일정충돌', '무단결석', '기타'] as const;
const DEDUCTION_TYPES = ['정상차감', '미차감', '보강예정'] as const;
type Tab = 'info' | 'attendance' | 'payment' | 'notes' | 'messages';


async function checkConflicts(
  sb: any,
  coachId: string,
  scheduleDays: number[],
  dayTimes: DayTimes,
  lessonDuration: number,
  excludeMemberId?: string,
): Promise<{ date: string; memberName: string; startTime: string }[]> {
  const allConflicts: { date: string; memberName: string; startTime: string }[] = [];
  for (const day of scheduleDays) {
    const times = dayTimes[day];
    if (!times || times.length === 0) continue;
    for (const time of times) {
    const [hh, mm] = time.split(':').map(Number);
    const newStart = hh * 60 + mm;
    const newEnd = newStart + lessonDuration;
    const todayKST = kstToday();
    const checkDates: string[] = [];
    const cur = new Date(todayKST);
    for (let i = 0; i < 60; i++) {
      if (cur.getDay() === day) checkDates.push(toKSTDateStr(cur));
      cur.setDate(cur.getDate() + 1);
    }
    if (!checkDates.length) continue;
    const { data: existing } = await sb
      .from('lessons')
      .select('id, date, start_time, end_time, lesson_members(member_id, member:members(name))')
      .eq('coach_id', coachId)
      .in('date', checkDates);
    for (const lesson of (existing ?? []) as any[]) {
      if (!lesson.lesson_members || lesson.lesson_members.length === 0) continue;
      const lessonDate = new Date(lesson.date + 'T00:00:00');
      if (lessonDate.getDay() !== day) continue;
      const [lh2, lm2] = lesson.start_time.slice(0, 5).split(':').map(Number);
      const [eh, em] = lesson.end_time.slice(0, 5).split(':').map(Number);
      const lStart = lh2 * 60 + lm2;
      const lEnd = eh * 60 + em;
      if (newStart < lEnd && newEnd > lStart) {
        for (const lmRow of lesson.lesson_members ?? []) {
          if (excludeMemberId && lmRow.member_id === excludeMemberId) continue;
          const mName = lmRow.member?.name ?? '다른 회원';
          if (!allConflicts.find((cf: any) => cf.date === lesson.date && cf.memberName === mName)) {
            allConflicts.push({ date: lesson.date, memberName: mName, startTime: lesson.start_time.slice(0, 5) });
          }
        }
      }
    }
    } // end for time
  }
  return allConflicts;
}

async function generateScheduleLessons(
  sb: any,
  coachId: string,
  memberId: string,
  memberName: string,
  scheduleDays: number[],
  dayTimes: DayTimes,
  lessonDuration: number,
  totalCredits: number,
  startDate: string,
): Promise<number> {
  if (scheduleDays.length === 0) return 0;
  const cursor = new Date(startDate + 'T00:00:00+09:00');
  const todayKST2 = kstToday();
  if (cursor < todayKST2) cursor.setTime(todayKST2.getTime());
  const dates: { date: string; time: string }[] = [];
  // 크레딧 0이면 기본 12회 생성
  const limit = totalCredits > 0 ? totalCredits : 12;
  let iter = 0;
  while (dates.length < limit && iter < limit * 14) {
    const dow = cursor.getDay();
    if (scheduleDays.includes(dow) && dayTimes[dow] && dayTimes[dow].length > 0) {
      for (const t of dayTimes[dow]) {
        dates.push({ date: toKSTDateStr(cursor), time: t });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    iter++;
  }
  let created = 0;
  for (const { date, time } of dates) {
    const [hh, mm] = time.split(':').map(Number);
    const endMin = hh * 60 + mm + lessonDuration;
    const startSt = time + ':00';
    const endSt = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0') + ':00';
    const { data: lesson, error: lErr } = await sb.from('lessons').insert({
      coach_id: coachId, title: memberName, date, start_time: startSt, end_time: endSt, source: 'auto',
    }).select('id').single();
    if (lErr || !lesson) continue;
    await sb.from('lesson_members').insert({ lesson_id: lesson.id, member_id: memberId });
    created++;
  }
  return created;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
function formatAttendanceDate(dateStr?: string, startTime?: string, endTime?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const day = DAY_NAMES[d.getDay()];
  const m = d.getMonth() + 1;
  const dt = d.getDate();
  const t = startTime?.slice(0, 5) ?? '';
  const e = endTime?.slice(0, 5) ?? '';
  return `${m}/${dt}(${day}) ${t}${e ? ' ~ ' + e : ''}`;
}

export default function MemberDetailScreen() {
  const { id, paymentDone, prevCredits, addedCredits, newCredits, packageTitle } = useLocalSearchParams<{
    id: string;
    paymentDone?: string;
    prevCredits?: string;
    addedCredits?: string;
    newCredits?: string;
    packageTitle?: string;
  }>();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  // pending: waiting for lesson package registration before generating schedule
  const awaitingLessonPkg = useRef(false);
  const pendingCoachIdRef = useRef<string | null>(null);
  const pendingScheduleDaysRef2 = useRef<number[]>([]);
  const pendingDayTimesRef2 = useRef<DayTimes>({});
  const pendingDurationRef2 = useRef<number>(60);
  const pendingNameRef2 = useRef<string>('');
  const pendingStartDateRef2 = useRef<string>('');

  useFocusEffect(useCallback(() => {
    if (!awaitingLessonPkg.current) return;
    const cId = pendingCoachIdRef.current;
    if (!cId || !id) return;
    (async () => {
      const { data: pkg } = await supabase
        .from('lesson_packages')
        .select('total_credits')
        .eq('coach_id', cId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!pkg) return;
      awaitingLessonPkg.current = false;
      const count = await generateScheduleLessons(
        supabase, cId, id!, pendingNameRef2.current,
        pendingScheduleDaysRef2.current, pendingDayTimesRef2.current,
        pendingDurationRef2.current, pkg.total_credits, pendingStartDateRef2.current,
      );
      loadMember();
      Alert.alert(
        '스케줄 생성 완료',
        count > 0 ? `${count}개 레슨이 스케줄에 추가됐습니다.` : '스케줄 생성 완료',
      );
    })();
  }, [id]));

  const [member, setMember] = useState<Member | null>(null);
  const [tab, setTab] = useState<Tab>('info');
  const [loading, setLoading] = useState(true);
  const [memberListUnreadCount, setMemberListUnreadCount] = useState(0);

  // 결제 완료 모달
  const [payDoneModal, setPayDoneModal] = useState(false);

  useEffect(() => {
    if (paymentDone === '1') {
      setPayDoneModal(true);
    }
  }, [paymentDone]);

  // 메시지 탭
  const [messages, setMessages] = useState<{id:string;sender_type:'coach'|'member';content:string;created_at:string}[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const msgListRef = React.useRef<any>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editingPackage, setEditingPackage] = useState(false);

  // Edit state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [joinDateEdit, setJoinDateEdit] = useState('');
  const [level, setLevel] = useState<MemberLevel>('초급');
  const [notes, setNotes] = useState('');

  // Schedule & credits
  const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const HOURS = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0'));
const MINUTES = ['00', '10', '20', '30', '40', '50'];
  const [scheduleDays, setScheduleDays] = useState<number[]>([]);
  const [dayTimes, setDayTimes] = useState<DayTimes>({});
  const [lessonDuration, setLessonDuration] = useState('60');
  const [totalCredits, setTotalCredits] = useState('0');
  const [remainingCredits, setRemainingCredits] = useState('0');

  // Sub data
  const [lessonPackage, setLessonPackage] = useState<{title: string; color: string; total_credits: number; price: number} | null>(null);
  const [lessonPackages, setLessonPackages] = useState<any[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [memberNotes, setMemberNotes] = useState<MemberNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [showProModal, setShowProModal] = useState(false);
  const { canUse, subscription } = useSubscription();
  const [sendingReregister, setSendingReregister] = useState(false);
  const [convertingTrial, setConvertingTrial] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [tempHour, setTempHour] = useState('');
  const [tempMinute, setTempMinute] = useState('00');

  // 스케줄 적용 시작일 캘린더 모달
  const [startDateModal, setStartDateModal] = useState(false);
  const [scheduleStartDate, setScheduleStartDate] = useState(toKSTDateStr(new Date()));
  const [startCalMonth, setStartCalMonth] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() });
  const [pendingSaveCtx, setPendingSaveCtx] = useState<{ userId: string; credits: number; duration: number } | null>(null);

  // 빈 시간대 모달 상태 (요일 선택 시)
  const [slotsModalVisible, setSlotsModalVisible] = useState(false);
  const [slotsModalDay, setSlotsModalDay] = useState<number | null>(null);
  const [slotsData, setSlotsData] = useState<{ time: string; available: boolean }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsDateStr, setSlotsDateStr] = useState('');

  // 일정 설정 상태
  const [futureLessons, setFutureLessons] = useState<any[]>([]);
  const [scheduleSheet, setScheduleSheet] = useState(false);
  const [byDateAddSheet, setByDateAddSheet] = useState(false);
  const [byDateAddEntries, setByDateAddEntries] = useState<DateEntry[]>([]);
  const [byDateAddCalMonth, setByDateAddCalMonth] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() });
  const byDateAddTempDateRef = useRef('');
  const [byDateAddView, setByDateAddView] = useState<'calendar' | 'timepicker'>('calendar');
  const [byDateAddTempHour, setByDateAddTempHour] = useState('');
  const [byDateAddTempMinute, setByDateAddTempMinute] = useState('00');
  const [byDateAddTempDuration, setByDateAddTempDuration] = useState(60);
  const [savingByDate, setSavingByDate] = useState(false);
  const [changeScopeSheet, setChangeScopeSheet] = useState(false);
  const [changeScopeLoading, setChangeScopeLoading] = useState(false);
  const [scheduleListSheet, setScheduleListSheet] = useState(false);

  // 출석 수정 상태
  const [editingAttId, setEditingAttId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<'출석' | '결석'>('출석');
  const [editStatus2, setEditStatus2] = useState<'출석' | '결석' | '보강예정'>('출석');
  const [editReason, setEditReason] = useState('');
  const [editDeduction, setEditDeduction] = useState('');
  const [editDeductCredit, setEditDeductCredit] = useState(false);
  const [savingAtt, setSavingAtt] = useState(false);

  // 통합 수정 모달
  const [showEditModal, setShowEditModal] = useState(false);
  const [editSchedType, setEditSchedType] = useState<'regular' | 'by_date' | 'later'>('later');

  // 결제 수정 모달
  type PaymentMethod = '계좌이체' | '카드' | '현금';
  const PAY_METHODS: PaymentMethod[] = ['계좌이체', '카드', '현금'];
  const PAY_METHOD_ICONS: Record<PaymentMethod, string> = { '계좌이체': 'phone-portrait-outline', '카드': 'card-outline', '현금': 'cash-outline' };
  const [payEditModal, setPayEditModal] = useState(false);
  const [payEditTarget, setPayEditTarget] = useState<Payment | null>(null);
  const [payEditDesc, setPayEditDesc] = useState('');
  const [payEditAmount, setPayEditAmount] = useState('');
  const [payEditPaidAmount, setPayEditPaidAmount] = useState('');
  const [payEditDueDate, setPayEditDueDate] = useState('');
  const [payEditPaidDate, setPayEditPaidDate] = useState('');
  const [payEditStatus, setPayEditStatus] = useState<PaymentStatus>('미납');
  const [payEditMethod, setPayEditMethod] = useState<PaymentMethod | ''>('');
  const [payEditSaving, setPayEditSaving] = useState(false);

  function openEditModal() {
    const schedType = member ? detectScheduleType(member as any, futureLessons.length > 0) : 'later';
    setEditSchedType(schedType);
    setShowEditModal(true);
  }

  async function handleSaveAll() {
    if (!name.trim()) { Alert.alert('입력 오류', '이름을 입력해주세요.'); return; }
    if (!phone.trim()) { Alert.alert('입력 오류', '전화번호를 입력해주세요.'); return; }
    setShowEditModal(false);
    handleSave();
  }

  function openPayEditModal(payment: Payment) {
    setPayEditTarget(payment);
    setPayEditDesc(payment.description);
    setPayEditAmount(String(payment.amount));
    setPayEditPaidAmount(String(payment.paid_amount));
    setPayEditDueDate(payment.due_date);
    setPayEditPaidDate(payment.paid_date ?? '');
    setPayEditStatus(payment.status);
    setPayEditMethod(((payment as any).payment_method as PaymentMethod) ?? '');
    setPayEditModal(true);
  }

  async function savePayEdit() {
    if (!payEditTarget) return;
    const amountStr = payEditAmount.trim();
    if (amountStr === '') { Alert.alert('오류', '금액을 입력해주세요.'); return; }
    const amountParsed = parseInt(amountStr, 10);
    if (isNaN(amountParsed)) { Alert.alert('오류', '금액은 숫자로 입력해주세요.'); return; }
    const dueDateStr = payEditDueDate.trim();
    if (!dueDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dueDateStr) || isNaN(new Date(dueDateStr).getTime())) {
      Alert.alert('오류', '납부기한을 YYYY-MM-DD 형식으로 입력해주세요.'); return;
    }
    setPayEditSaving(true);
    const amount = amountParsed;
    const paidParsed = parseInt(payEditPaidAmount.trim(), 10);
    const paidAmount = payEditStatus === '납부완료' ? amount : payEditStatus === '미납' ? 0 : (isNaN(paidParsed) ? payEditTarget.paid_amount : paidParsed);
    const paidDate = payEditStatus === '미납' ? null : (payEditPaidDate || new Date().toISOString().split('T')[0]);
    const { error } = await supabase.from('payments').update({
      description: payEditDesc, amount, paid_amount: paidAmount,
      due_date: payEditDueDate, paid_date: paidDate, status: payEditStatus,
      payment_method: payEditMethod || null,
    }).eq('id', payEditTarget.id).eq('member_id', payEditTarget.member_id);
    setPayEditSaving(false);
    if (error) { Alert.alert('오류', '저장에 실패했어요.\n' + error.message); return; }
    setPayEditModal(false);
    setPayEditTarget(null);
    loadPayments();
  }

  async function saveAttStatus(attId: string, memberId2: string, currentDeductCredit: boolean, currentRemaining: number) {
    setSavingAtt(true);
    const newDbStatus = editStatus2 === '보강예정' ? '결석' : editStatus2;
    const newDeductionType = editStatus2 === '보강예정' ? '보강예정' : editStatus2 === '결석' ? '정상차감' : null;
    await supabase.from('attendance').update({
      status: newDbStatus,
      deduct_credit: editDeductCredit,
      deduction_type: newDeductionType,
    }).eq('id', attId);
    // 차감 상태 변경 시에만 크레딧 조정 (중복 차감/복구 방지)
    if (editDeductCredit && !currentDeductCredit) {
      await supabase.rpc('adjust_remaining_credits', { p_member_id: memberId2, p_delta: -1 });
    } else if (!editDeductCredit && currentDeductCredit) {
      await supabase.rpc('adjust_remaining_credits', { p_member_id: memberId2, p_delta: 1 });
    }
    if (newDbStatus === '결석' && editStatus2 !== '보강예정') {
      try { await notifyMemberAbsent(memberId2); } catch (e) { console.error('[PUSH] 결석 알림 실패:', e); }
    }
    setSavingAtt(false);
    setEditingAttId(null);
    await loadAttendance();
    await loadMember();
  }

  async function handleAttendanceSave(
    attId: string,
    memberId2: string,
    currentDeductCredit: boolean,
    currentRemaining: number,
  ) {
    if (editStatus === '결석' && (!editReason || !editDeduction)) return;
    setSavingAtt(true);
    const willDeduct = editStatus === '출석' ? true : editDeduction === '정상차감';
    const absReason = editStatus === '출석' ? null : editReason;
    const deductionT = editStatus === '출석' ? null : editDeduction;
    await supabase.from('attendance').update({
      status: editStatus,
      deduct_credit: willDeduct,
      absence_reason: absReason,
      deduction_type: deductionT,
    }).eq('id', attId);
    if (willDeduct && !currentDeductCredit) {
      await supabase.rpc('adjust_remaining_credits', { p_member_id: memberId2, p_delta: -1 });
    } else if (!willDeduct && currentDeductCredit) {
      await supabase.rpc('adjust_remaining_credits', { p_member_id: memberId2, p_delta: 1 });
    }
    if (editStatus === '결석') {
      try { await notifyMemberAbsent(memberId2); } catch (e) { console.error('[PUSH] 결석 알림 실패:', e); }
    }
    setSavingAtt(false);
    setEditingAttId(null);
    loadAttendance();
    loadMember();
  }

  async function loadMember() {
    try {
      const { data } = await supabase.from('members').select('*').eq('id', id).single();
      if (data) {
        setMember(data);
        setName(data.name); setPhone(data.phone);
        setEmail(data.email ?? ''); setLevel(data.level);
        setNotes(data.notes ?? '');
        setBirthDate((data as any).birth_date ?? '');
        setJoinDateEdit(data.join_date ?? '');
        setScheduleDays((data as any).fixed_schedule_days ?? []);
        const fst = (data as any).fixed_schedule_times;
        if (fst && typeof fst === 'object') {
          const loaded: DayTimes = {};
          for (const [k, v] of Object.entries(fst)) {
            loaded[Number(k)] = Array.isArray(v) ? (v as string[]) : [String(v)];
          }
          setDayTimes(loaded);
        } else {
          const legacyTime = (data as any).fixed_schedule_time?.slice(0, 5);
          if (legacyTime) {
            const days: number[] = (data as any).fixed_schedule_days ?? [];
            const loaded: DayTimes = {};
            days.forEach((d: number) => { loaded[d] = [legacyTime]; });
            setDayTimes(loaded);
          }
        }
        if ((data as any).lesson_package_id) {
          const { data: pkgData } = await supabase.from('lesson_packages')
            .select('duration_minutes').eq('id', (data as any).lesson_package_id).maybeSingle();
          setLessonDuration(String(pkgData?.duration_minutes ?? (data as any).fixed_lesson_duration ?? 60));
        } else {
          setLessonDuration(String((data as any).fixed_lesson_duration ?? 60));
        }
        setTotalCredits(String((data as any).total_credits ?? 0));
        setRemainingCredits(String((data as any).remaining_credits ?? 0));
        const pkgId = (data as any).lesson_package_id;
        setSelectedPackageId(pkgId || null);
        if (pkgId) {
          const { data: pkg } = await supabase.from('lesson_packages').select('title, color, total_credits, price').eq('id', pkgId).maybeSingle();
          if (pkg) setLessonPackage({ ...pkg, color: pkg.color ?? '#888888', price: pkg.price ?? 0, total_credits: pkg.total_credits ?? 0 });
        }
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: pkgs } = await supabase.from('lesson_packages')
          .select('*').eq('coach_id', user.id).eq('is_active', true).order('created_at', { ascending: false });
        setLessonPackages(pkgs ?? []);
      }
    } catch (e) {
      console.error('[loadMember] error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function loadAttendance() {
    const { data } = await supabase
      .from('attendance')
      .select('*, lesson:lessons(title, date, start_time, end_time)')
      .eq('member_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    setAttendance(data ?? []);
  }

  async function loadPayments() {
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('member_id', id)
      .order('due_date', { ascending: false });
    setPayments(data ?? []);
  }

  async function loadNotes() {
    const { data } = await supabase
      .from('member_notes')
      .select('*')
      .eq('member_id', id)
      .order('created_at', { ascending: false });
    setMemberNotes(data ?? []);
  }

  async function loadFutureLessons() {
    if (!id) return;
    const { data: lmRows } = await supabase
      .from('lesson_members').select('lesson_id').eq('member_id', id);
    const lessonIds = (lmRows ?? []).map((r: any) => r.lesson_id as string);
    if (lessonIds.length === 0) { setFutureLessons([]); return; }
    const todayStr = toKSTDateStr(new Date());
    const { data } = await supabase
      .from('lessons').select('id, date, start_time, end_time, title')
      .in('id', lessonIds).gte('date', todayStr)
      .order('date', { ascending: true }).order('start_time', { ascending: true });
    setFutureLessons(data ?? []);
  }

  function closeByDateAddSheet() {
    setByDateAddView('calendar');
    setByDateAddSheet(false);
    setByDateAddEntries([]);
    byDateAddTempDateRef.current = '';
    setByDateAddCalMonth({ year: new Date().getFullYear(), month: new Date().getMonth() });
  }

  async function loadUnreadCount() {
    if (!id) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: unreadData } = await supabase
      .from('messages')
      .select('member_id')
      .eq('coach_id', user.id)
      .eq('sender_type', 'member')
      .is('read_at', null);

    const unreadMap: Record<string, number> = {};
    for (const row of (unreadData ?? []) as { member_id: string }[]) {
      unreadMap[row.member_id] = (unreadMap[row.member_id] ?? 0) + 1;
    }

    const memberUnread = unreadMap[id] ?? 0;
    setUnreadCount(memberUnread);
    setMemberListUnreadCount(memberUnread);
  }

  useEffect(() => { loadMember(); loadFutureLessons(); loadUnreadCount(); }, []);

  // 실시간 새 메시지 구독
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`member-messages-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `member_id=eq.${id}`,
      }, (payload) => {
        if ((payload.new as any)?.sender_type === 'member') {
          if (tab !== 'messages') {
            setUnreadCount(prev => prev + 1);
          } else {
            loadMessages();
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, tab]);

  useEffect(() => {
    if (tab === 'attendance') loadAttendance();
    if (tab === 'payment') loadPayments();
    if (tab === 'notes') loadNotes();
    if (tab === 'messages') loadMessages();
  }, [tab]);

  // 시간이 없는 요일은 자동으로 scheduleDays에서 제거
  useEffect(() => {
    setScheduleDays(prev => prev.filter(d => dayTimes[d] && dayTimes[d].length > 0));
  }, [dayTimes]);

  async function fetchAvailableSlots(day: number) {
    const today = new Date();
    const todayDow = today.getDay();
    const diff = (day - todayDow + 7) % 7;
    const target = new Date(today);
    target.setDate(today.getDate() + (diff === 0 ? 7 : diff));
    const dateStr = toKSTDateStr(target);
    setSlotsDateStr(dateStr);
    setSlotsModalDay(day);
    setLoadingSlots(true);
    setSlotsModalVisible(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoadingSlots(false); return; }
    const { data: existingLessons } = await supabase
      .from('lessons')
      .select('start_time, end_time')
      .eq('coach_id', user.id)
      .eq('date', dateStr);
    const dur = parseInt(lessonDuration) || 60;
    const slots: { time: string; available: boolean }[] = [];
    for (let h = 6; h < 23; h++) {
      for (const m of [0, 30]) {
        const startMin = h * 60 + m;
        const endMin = startMin + dur;
        if (endMin > 23 * 60) continue;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const hasConflict = (existingLessons ?? []).some((l: any) => {
          const [lh, lm] = l.start_time.slice(0,5).split(':').map(Number);
          const [eh, em] = l.end_time.slice(0,5).split(':').map(Number);
          const ls = lh * 60 + lm; const le = eh * 60 + em;
          return startMin < le && endMin > ls;
        });
        slots.push({ time: timeStr, available: !hasConflict });
      }
    }
    setSlotsData(slots);
    setLoadingSlots(false);
  }

  async function checkConflictsForDates(
    entries: DateEntry[],
    coachId: string,
  ): Promise<{ date: string; memberName: string; startTime: string }[]> {
    const conflicts: { date: string; memberName: string; startTime: string }[] = [];
    for (const entry of entries) {
      const [hh, mm] = entry.startTime.split(':').map(Number);
      const newStart = hh * 60 + mm;
      const newEnd = newStart + entry.duration;
      const { data: existing } = await supabase
        .from('lessons')
        .select('id, start_time, end_time, lesson_members(member_id, member:members(name))')
        .eq('coach_id', coachId).eq('date', entry.date);
      for (const lesson of (existing ?? []) as any[]) {
        const [lh, lm] = lesson.start_time.slice(0, 5).split(':').map(Number);
        const [eh, em] = lesson.end_time.slice(0, 5).split(':').map(Number);
        const lStart = lh * 60 + lm; const lEnd = eh * 60 + em;
        if (newStart < lEnd && newEnd > lStart) {
          for (const lmRow of lesson.lesson_members ?? []) {
            if (lmRow.member_id === id) continue;
            const mName = lmRow.member?.name ?? '다른 회원';
            if (!conflicts.find(cf => cf.date === entry.date && cf.memberName === mName)) {
              conflicts.push({ date: entry.date, memberName: mName, startTime: lesson.start_time.slice(0, 5) });
            }
          }
        }
      }
    }
    return conflicts;
  }

  async function doAddByDateLessons(coachId: string) {
    if (!member) return;
    setSavingByDate(true);
    const failedEntries: DateEntry[] = [];
    for (const entry of byDateAddEntries) {
      const [hh, mm] = entry.startTime.split(':').map(Number);
      const endMin = hh * 60 + mm + entry.duration;
      const startSt = entry.startTime + ':00';
      const endSt = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`;
      const { data: lesson, error: lErr } = await supabase.from('lessons').insert({
        coach_id: coachId, title: member.name, date: entry.date,
        start_time: startSt, end_time: endSt, source: 'manual',
      }).select('id').single();
      if (lErr || !lesson) { failedEntries.push(entry); continue; }
      await supabase.from('lesson_members').insert({ lesson_id: lesson.id, member_id: id });
    }
    setSavingByDate(false);
    const addedCount = byDateAddEntries.length;
    closeByDateAddSheet();
    await loadFutureLessons();
    await loadMember();
    if (failedEntries.length > 0) {
      Alert.alert('일부 저장 실패', `일부 일정을 저장하지 못했어요. (${failedEntries.length}건)`);
    } else {
      Alert.alert('완료', `${addedCount}개 일정이 추가됐어요.`);
    }
  }

  async function handleAddByDateLessons() {
    if (byDateAddEntries.length === 0 || savingByDate) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const conflicts = await checkConflictsForDates(byDateAddEntries, user.id);
    if (conflicts.length > 0) {
      const msg = conflicts.slice(0, 3).map(cf => {
        const d = new Date(cf.date + 'T00:00:00');
        return `${d.getMonth() + 1}/${d.getDate()} ${cf.startTime} - ${cf.memberName}`;
      }).join('\n') + (conflicts.length > 3 ? `\n외 ${conflicts.length - 3}건` : '');
      Alert.alert('시간 충돌', `다음 일정과 겹칩니다:\n\n${msg}\n\n그래도 추가하시겠어요?`, [
        { text: '취소', style: 'cancel' },
        { text: '추가', onPress: () => doAddByDateLessons(user.id) },
      ]);
      return;
    }
    await doAddByDateLessons(user.id);
  }

  async function handleToByDate(scope: 'forward' | 'also_future') {
    setChangeScopeLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setChangeScopeLoading(false); return; }

    if (scope === 'also_future') {
      const todayStr = toKSTDateStr(new Date());
      const { data: lmRows } = await supabase
        .from('lesson_members').select('lesson_id').eq('member_id', id!);
      const lessonIds = (lmRows ?? []).map((r: any) => r.lesson_id as string);
      if (lessonIds.length > 0) {
        const { data: futureLsns } = await supabase
          .from('lessons').select('id, date').in('id', lessonIds).gte('date', todayStr);
        const futureIds = (futureLsns ?? []).map((l: any) => l.id as string);
        if (futureIds.length > 0) {
          const { data: otherRows } = await supabase
            .from('lesson_members').select('lesson_id').in('lesson_id', futureIds).neq('member_id', id!);
          const sharedSet = new Set((otherRows ?? []).map((r: any) => r.lesson_id as string));
          const soloIds = futureIds.filter(lid => !sharedSet.has(lid));
          const sharedIds = futureIds.filter(lid => sharedSet.has(lid));
          if (sharedIds.length > 0) {
            await supabase.from('lesson_members').delete().in('lesson_id', sharedIds).eq('member_id', id!);
            await supabase.from('attendance').delete().in('lesson_id', sharedIds).eq('member_id', id!);
          }
          if (soloIds.length > 0) {
            await supabase.from('attendance').delete().in('lesson_id', soloIds);
            await supabase.from('lesson_members').delete().in('lesson_id', soloIds);
            await supabase.from('lessons').delete().in('id', soloIds);
          }
        }
      }
    }

    await supabase.from('members').update({
      fixed_schedule_days: [],
      fixed_schedule_times: null,
      fixed_schedule_time: null,
    }).eq('id', id!);

    setChangeScopeLoading(false);
    setChangeScopeSheet(false);
    setScheduleSheet(false);
    await loadMember();
    await loadFutureLessons();
    Alert.alert('변경 완료', '날짜별 일정으로 변경됐어요.');
  }

  function handleSelectPackage(pkg: any) {
    if (selectedPackageId === pkg.id) {
      // 같은 패키지 재클릭 → 선택 해제
      setSelectedPackageId(null);
    } else {
      // 다른 패키지 선택
      setSelectedPackageId(pkg.id);
      // 총 레슨권 수도 패키지 기준으로 자동 설정
      if (pkg.total_credits) setTotalCredits(String(pkg.total_credits));
      if (pkg.duration_minutes) setLessonDuration(String(pkg.duration_minutes));
    }
  }

  async function handleSaveBasicInfo() {
    if (!name.trim()) { Alert.alert('입력 오류', '이름을 입력해주세요.'); return; }
    if (!phone.trim()) { Alert.alert('입력 오류', '전화번호를 입력해주세요.'); return; }
    const basicPayload = buildMemberUpsertPayload({
      name,
      phone,
      email,
      birthDate,
      joinDate: joinDateEdit.trim() || member!.join_date,
      level,
      notes,
    });
    const { error } = await supabase.from('members').update(basicPayload).eq('id', id!);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
    setEditing(false);
    loadMember();
  }

  async function handleSavePackage() {
    const { error } = await supabase.from('members').update({
      lesson_package_id: selectedPackageId || null,
    }).eq('id', id!);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
    setEditingPackage(false);
    loadMember();
  }

  async function handleSave() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const credits = parseInt(totalCredits) || 0;
    const duration = parseInt(lessonDuration) || 60;

    // 스케줄 변경 여부 확인: 변경 시 적용 시작일 캘린더 먼저 표시
    const allDaysHaveTimes2 = scheduleDays.length > 0 && scheduleDays.every(d => dayTimes[d] && dayTimes[d].length > 0);
    const { data: oldMemberCheck } = await supabase.from('members')
      .select('fixed_schedule_days, fixed_schedule_times, fixed_schedule_time')
      .eq('id', id!).single();
    const oldDaysCheck: number[] = (oldMemberCheck as any)?.fixed_schedule_days ?? [];
    const oldTimesCheck = (() => {
      const fst = (oldMemberCheck as any)?.fixed_schedule_times;
      if (fst && typeof fst === 'object') {
        const r: DayTimes = {};
        for (const [k, v] of Object.entries(fst)) r[Number(k)] = Array.isArray(v) ? (v as string[]) : [String(v)];
        return r;
      }
      const lt = (oldMemberCheck as any)?.fixed_schedule_time?.slice(0, 5);
      if (lt) { const r: DayTimes = {}; oldDaysCheck.forEach((d: number) => { r[d] = [lt]; }); return r; }
      return {} as DayTimes;
    })();
    const scheduleTimesJsonCheck: Record<string, string[]> = {};
    for (const d of scheduleDays) { if (dayTimes[d]?.length) scheduleTimesJsonCheck[String(d)] = dayTimes[d]; }
    const willScheduleChange =
      JSON.stringify([...scheduleDays].sort()) !== JSON.stringify([...oldDaysCheck].sort()) ||
      JSON.stringify(scheduleTimesJsonCheck) !== JSON.stringify(Object.fromEntries(Object.entries(oldTimesCheck).map(([k, v]) => [k, v])));

    if (willScheduleChange && allDaysHaveTimes2 && credits > 0) {
      // 적용 시작일 선택 캘린더 모달 표시
      setScheduleStartDate(toKSTDateStr(new Date()));
      setStartCalMonth({ year: new Date().getFullYear(), month: new Date().getMonth() });
      setPendingSaveCtx({ userId: user.id, credits, duration });
      setStartDateModal(true);
      return;
    }
    // 스케줄 변경 없으면 바로 저장
    await proceedWithSave(user.id, credits, duration, toKSTDateStr(new Date()));
  }

  async function proceedWithSave(userId: string, credits: number, duration: number, startDate: string) {
    const allDaysHaveTimes2 = scheduleDays.length > 0 && scheduleDays.every(d => dayTimes[d] && dayTimes[d].length > 0);
    if (allDaysHaveTimes2) {
      const conflicts = await checkConflicts(supabase, userId, scheduleDays, dayTimes, duration, id as string);
      if (conflicts.length > 0) {
        const conflictMsg = conflicts.slice(0, 3).map((cf: any) => {
          const d = new Date(cf.date + 'T00:00:00');
          return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }) + ' ' + cf.startTime + ' - ' + cf.memberName;
        }).join('\n') + (conflicts.length > 3 ? ('\n' + '외 ' + (conflicts.length - 3) + '건') : '');
        Alert.alert(
          '시간 충돌',
          '선택한 시간대에 이미 레슨이 있습니다:\n\n' + conflictMsg + '\n\n그래도 저장하시겠어요?',
          [
            { text: '시간 변경', style: 'cancel' },
            { text: '그대로 저장', style: 'destructive', onPress: () => doActualSave(userId, credits, duration, startDate) },
          ]
        );
        return;
      }
    }
    await doActualSave(userId, credits, duration, startDate);
  }

  async function doActualSave(userId: string, credits: number, duration: number, startDate: string = toKSTDateStr(new Date())) {
    const { data: oldMember } = await supabase.from('members').select('fixed_schedule_days, fixed_schedule_time, fixed_schedule_times, join_date').eq('id', id!).single();
    const oldDays: number[] = (oldMember as any)?.fixed_schedule_days ?? [];
    const oldTimes: DayTimes = (() => {
      const fst = (oldMember as any)?.fixed_schedule_times;
      if (fst && typeof fst === 'object') {
        const r: DayTimes = {};
        for (const [k, v] of Object.entries(fst)) r[Number(k)] = Array.isArray(v) ? (v as string[]) : [String(v)];
        return r;
      }
      const lt = (oldMember as any)?.fixed_schedule_time?.slice(0, 5);
      if (lt) { const r: DayTimes = {}; oldDays.forEach((d: number) => { r[d] = [lt]; }); return r; }
      return {};
    })();

    // build new schedule times json
    const scheduleTimesJson: Record<string, string[]> = {};
    for (const d of scheduleDays) { if (dayTimes[d] && dayTimes[d].length > 0) scheduleTimesJson[String(d)] = dayTimes[d]; }
    const firstDayTime = scheduleDays.length > 0 && dayTimes[scheduleDays[0]] && dayTimes[scheduleDays[0]].length > 0 ? dayTimes[scheduleDays[0]][0] : null;

    const { error } = await supabase.from('members').update({
      name, phone, email: email || null, level, notes: notes || null,
      birth_date: birthDate.trim() || null,
      join_date: joinDateEdit.trim() || null,
      fixed_schedule_days: scheduleDays,
      fixed_schedule_time: firstDayTime,
      fixed_schedule_times: Object.keys(scheduleTimesJson).length > 0 ? scheduleTimesJson : null,
      fixed_lesson_duration: duration,
      total_credits: credits,
      remaining_credits: parseInt(remainingCredits) || 0,
      lesson_package_id: selectedPackageId || null,
    }).eq('id', id!);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }

    const allDaysHaveTimes3 = scheduleDays.length > 0 && scheduleDays.every(d => dayTimes[d] && dayTimes[d].length > 0);
    const scheduleChanged =
      JSON.stringify([...scheduleDays].sort()) !== JSON.stringify([...oldDays].sort()) ||
      JSON.stringify(scheduleTimesJson) !== JSON.stringify(Object.fromEntries(Object.entries(oldTimes).map(([k,v]) => [k, v])));
    let scheduledCount = 0;
    if (allDaysHaveTimes3 && credits > 0) {
      if (scheduleChanged) {
        // 스케줄 변경 시: 오늘 이후 레슨 삭제 후 재생성 (과거 레슨은 항상 보호)
        const todayStr2 = toKSTDateStr(new Date());
        const deleteFrom = startDate > todayStr2 ? startDate : todayStr2;
        const { data: futureLMrows } = await supabase
          .from('lesson_members')
          .select('lesson_id, lesson:lessons(id, date, coach_id, source)')
          .eq('member_id', id!);
        const futureLessonIds = (futureLMrows ?? [])
          .filter((r: any) => r.lesson?.date >= deleteFrom && r.lesson?.coach_id === userId && r.lesson?.source === 'auto')
          .map((r: any) => r.lesson_id as string);
        if (futureLessonIds.length > 0) {
          // 완료·결석 일정 보호 (삭제 금지)
          const { data: doneAttRows } = await supabase
            .from('attendance')
            .select('lesson_id')
            .in('lesson_id', futureLessonIds)
            .eq('member_id', id!)
            .in('status', ['출석', '결석']);
          const protectedSet = new Set((doneAttRows ?? []).map((r: any) => r.lesson_id as string));
          const deletableIds = futureLessonIds.filter(lid => !protectedSet.has(lid));
          if (deletableIds.length === 0) {
            // 삭제 가능한 일정 없음 - 새 일정만 추가
          } else {
          // 다른 회원이 함께 있는 레슨 확인
          const { data: otherMemberRows } = await supabase
            .from('lesson_members')
            .select('lesson_id')
            .in('lesson_id', deletableIds)
            .neq('member_id', id!);
          const sharedSet = new Set((otherMemberRows ?? []).map((r: any) => r.lesson_id as string));
          const soloIds = deletableIds.filter(lid => !sharedSet.has(lid));
          const sharedIds = deletableIds.filter(lid => sharedSet.has(lid));
          // 공유 레슨에서 이 회원만 제거
          if (sharedIds.length > 0) {
            await supabase.from('lesson_members').delete().in('lesson_id', sharedIds).eq('member_id', id!);
            await supabase.from('attendance').delete().in('lesson_id', sharedIds).eq('member_id', id!);
          }
          // 단독 레슨은 완전 삭제
          if (soloIds.length > 0) {
            await supabase.from('attendance').delete().in('lesson_id', soloIds);
            await supabase.from('lesson_members').delete().in('lesson_id', soloIds);
            await supabase.from('lessons').delete().in('id', soloIds);
          }
          } // end else (deletableIds.length > 0)
        }
        // 새 스케줄로 재생성 (startDate부터, 크레딧 0이면 기본 12회)
        scheduledCount = await generateScheduleLessons(
          supabase, userId, id!, name, scheduleDays, dayTimes, duration, credits > 0 ? credits : 12, startDate,
        );
      } else {
        // 스케줄 미변경: 부족한 레슨만 추가 (크레딧 0이면 기본 12회 기준)
        const todayForElse = toKSTDateStr(new Date());
        const { data: futureL } = await supabase.from('lesson_members').select('lesson:lessons(date)').eq('member_id', id!);
        const futureLessons = (futureL ?? []).filter((r: any) => r.lesson?.date >= todayForElse);
        const effectiveCredits = credits > 0 ? credits : 12;
        const needed = effectiveCredits - futureLessons.length;
        if (needed > 0 && futureLessons.length === 0) {
          const joinDate = (oldMember as any)?.join_date ?? todayForElse;
          scheduledCount = await generateScheduleLessons(
            supabase, userId, id!, name, scheduleDays, dayTimes, duration, needed, joinDate,
          );
        }
      }
    }
    setEditing(false);
    loadMember();
    if (allDaysHaveTimes3 && !credits) {
      // 레슨권 등록 후 돌아오면 useFocusEffect가 스케줄 자동 생성
      awaitingLessonPkg.current = true;
      pendingCoachIdRef.current = userId;
      pendingScheduleDaysRef2.current = scheduleDays;
      pendingDayTimesRef2.current = dayTimes;
      pendingDurationRef2.current = duration;
      pendingNameRef2.current = name;
      pendingStartDateRef2.current = startDate;
      Alert.alert(
        '레슨권을 먼저 등록해주세요',
        '고정 스케줄이 설정됐지만 레슨권이 없어서 스케줄이 생성되지 않았습니다.\n레슨권을 등록하면 스케줄이 자동으로 생성됩니다.',
        [
          { text: '레슨권 등록하러 가기', onPress: () => router.push('/lesson-packages/new') },
        ]
      );
    } else if (scheduledCount > 0) {
      Alert.alert('저장 완료', scheduledCount + '개 레슨이 스케줄에 추가되었습니다.');
    }

    // 고정스케줄이 있는 회원이 2명 이상 & 코치 가용시간 미설정 & 팝업 미노출 → 팝업
    if (scheduleDays.length > 0) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const POPUP_KEY = `@kerri_availability_popup_shown_${user.id}`;
        const [{ data: membersData }, { data: availability }, alreadyShown] = await Promise.all([
          supabase.from('members').select('id, fixed_schedule_days').eq('coach_id', user.id).not('fixed_schedule_days', 'is', null),
          supabase.from('coach_availability').select('id').eq('coach_id', user.id).maybeSingle(),
          AsyncStorage.getItem(POPUP_KEY),
        ]);
        const count = (membersData ?? []).filter((m: any) =>
          Array.isArray(m.fixed_schedule_days) && m.fixed_schedule_days.length > 0
        ).length;
        if (count >= 2 && !availability && !alreadyShown) {
          await AsyncStorage.setItem(POPUP_KEY, '1');
          Alert.alert(
            '레슨 가능 시간 설정',
            '고정 스케줄 회원이 2명 이상입니다.\n회원이 레슨을 신청할 수 있는 가능 시간대를 설정하면 신청 가능한 시간을 정확히 안내할 수 있어요.',
            [
              { text: '나중에', style: 'cancel' },
              { text: '지금 설정', onPress: () => router.push('/settings/availability') },
            ]
          );
        }
      }
    }
  }

  async function handleToggleActive() {
    if (!member) return;
    const isActive = member.is_active;
    const action = isActive ? '비활성화' : '활성화';
    const newStatus = !isActive;
    Alert.alert(action, `${member.name}님을 ${action}하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: action,
        style: isActive ? 'destructive' : 'default',
        onPress: async () => {
          await supabase.from('members').update({ is_active: newStatus }).eq('id', id!);
          loadMember();
        },
      },
    ]);
  }




  async function handleSendInvite() {
    if (!member) return;

    // ── Branch.io 딥링크 생성 ──────────────────────────────────
    // ⚠️  아래 두 값을 Branch 대시보드에서 발급받은 키로 교체하세요
    const APP_STORE_URL = 'https://apps.apple.com/kr/app/kerri-member/id6783235236';
    const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.kerri.memberapp';

    // 초대 코드도 함께 생성 (폴백용)
    let code = (member as any).invite_code as string | null;
    if (!code) {
      code = Math.random().toString(36).slice(2, 8).toUpperCase();
      await supabase.from('members').update({ invite_code: code }).eq('id', member.id);
    }

    const msg = `[KERRI 멤버 초대]\n${member.name} 회원님, 담당 코치가 KERRI 멤버로 초대했어요.\n앱에서 레슨 일정과 횟수, 레슨 기록을 확인해 보세요.\niPhone\n ${APP_STORE_URL}\nAndroid\n ${PLAY_STORE_URL}\n링크로 연결되지 않으면 앱을 다운로드한 후, 아래 초대 코드를 입력해 로그인해 주세요.\n초대 코드\n${code}`;
    const phone = member.phone.replace(/[^0-9]/g, '');
    const smsUrl = `sms:${phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(msg)}`;
    const canOpen = await Linking.canOpenURL(smsUrl);
    if (canOpen) {
      await Linking.openURL(smsUrl);
    } else {
      Alert.alert('초대 링크', `🍎 ${APP_STORE_URL}\n🤖 ${PLAY_STORE_URL}`);
    }
  }

  async function handleConvertTrial() {
    if (!member) return;
    Alert.alert(
      '정규 전환',
      `${member.name}님을 체험에서 정규 회원으로 전환할까요?\n전환 후 크레딧/레슨권은 수정 화면에서 설정할 수 있어요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '전환',
          onPress: async () => {
            setConvertingTrial(true);
            const { error } = await supabase.from('members').update({
              is_trial: false,
              trial_started_at: null,
            }).eq('id', member.id);
            setConvertingTrial(false);
            if (error) {
              Alert.alert('실패', '전환에 실패했어요.');
            } else {
              Alert.alert('전환 완료 ✅', `${member.name}님이 정규 회원으로 전환됩다. 수정 화면에서 레슨권을 설정해주세요.`);
              await loadMember();
            }
          },
        },
      ]
    );
  }

  async function handleSendReregisterNotif() {
    if (!member) return;
    setSendingReregister(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSendingReregister(false); return; }

    // member_notifications 테이블에 알림 레코드 저장 (인앱 알림)
    const { error } = await supabase.from('member_notifications').insert({
      coach_id: user.id,
      member_id: member.id,
      title: '레슨권이 곧 만료돼요',
      body: `레슨권이 곧 만료돼요. 코치님께 문의해보세요.`,
      type: 'reregister',
    });

    if (error) {
      Alert.alert('실패', '알림 발송에 실패했어요.');
      setSendingReregister(false);
      return;
    }

    // 푸시 발송 실패해도 인앱 알림 저장은 롤백하지 않음
    try { await notifyMemberReregister(member.id); } catch (e) { console.error('[PUSH] 재등록 안내 푸시 발송 실패:', e); }

    Alert.alert(
      '안내 발송 완료 📨',
      `${member.name}님에게 재등록 안내를 발송했어요.\n회원이 앱을 열면 확인할 수 있어요.`,
    );
    setSendingReregister(false);
  }

  async function handlePermanentDelete() {
    Alert.alert(
      '⚠️ 영구 삭제',
      `${member?.name}님의 모든 데이터(레슨, 출석, 결제, 메모 등)가 완전히 삭제됩니다.\n\n이 작업은 되돌릴 수 없습니다. 정말 삭제하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '영구 삭제',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              '최종 확인',
              '삭제 후 복구가 불가능합니다. 정말 삭제하시겠습니까?',
              [
                { text: '취소', style: 'cancel' },
                {
                  text: '네, 삭제합니다',
                  style: 'destructive',
                  onPress: async () => {
                    if (!id) return;
                    // 이 회원이 속한 레슨 ID 먼저 수집
                    const { data: memberLessonRows } = await supabase
                      .from('lesson_members').select('lesson_id').eq('member_id', id);
                    const lessonIds = (memberLessonRows ?? []).map((r: any) => r.lesson_id);

                    await supabase.from('member_notes').delete().eq('member_id', id);
                    await supabase.from('attendance').delete().eq('member_id', id);
                    await supabase.from('payments').delete().eq('member_id', id);
                    await supabase.from('lesson_members').delete().eq('member_id', id);
                    await supabase.from('messages').delete().eq('member_id', id);

                    // 멤버 제거 후 비어버린 레슨 슬롯 삭제 (다른 회원 없는 경우만)
                    if (lessonIds.length > 0) {
                      const { data: remaining } = await supabase
                        .from('lesson_members').select('lesson_id').in('lesson_id', lessonIds);
                      const stillUsed = new Set((remaining ?? []).map((r: any) => r.lesson_id));
                      const emptyIds = lessonIds.filter((lid: string) => !stillUsed.has(lid));
                      if (emptyIds.length > 0) {
                        await supabase.from('attendance').delete().in('lesson_id', emptyIds);
                        await supabase.from('lessons').delete().in('id', emptyIds);
                      }
                    }

                    await supabase.from('members').delete().eq('id', id);
                    router.replace('/(tabs)/members');
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  async function addNote() {
    if (!newNote.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('member_notes').insert({ member_id: id, coach_id: user.id, content: newNote.trim() });
    setNewNote('');
    loadNotes();
  }

  async function deleteNote(noteId: string) {
    await supabase.from('member_notes').delete().eq('id', noteId);
    loadNotes();
  }

  async function loadMessages() {
    const { data } = await supabase.from('messages').select('*')
      .eq('member_id', id).order('created_at', { ascending: true });
    setMessages(data ?? []);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('messages').update({ read_at: new Date().toISOString() })
        .eq('member_id', id).eq('coach_id', user.id).eq('sender_type', 'member').is('read_at', null);
      setUnreadCount(0);
      setMemberListUnreadCount(0);
    }
    setTimeout(() => msgListRef.current?.scrollToEnd({ animated: false }), 200);
  }

  async function sendMessage() {
    if (!msgInput.trim() || sendingMsg) return;
    const text = msgInput.trim();
    setMsgInput('');
    setSendingMsg(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('messages').insert({
        coach_id: user.id, member_id: id, sender_type: 'coach', content: text,
      });
      loadMessages();
      notifyMemberMessage(id as string, member?.name ?? '코치').catch(() => {});
    }
    setSendingMsg(false);
  }

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!member) return <View style={styles.loader}><Text>회원을 찾을 수 없습니다</Text></View>;

  // 일정 설정 computed values
  const isMemberTrial = (member as any).is_trial;
  const detectedScheduleType: ScheduleType = detectScheduleType(member as any, futureLessons.length > 0);
  const nextLesson = futureLessons[0] ?? null;
  const futureCount = futureLessons.length;
  const memberRemaining = (member as any).remaining_credits ?? 0;
  const unregisteredCount = Math.max(memberRemaining - futureCount, 0);

  // 출석 회차 계산: 날짜 오름차순으로 정렬 후 순번 부여
  const attendanceSortedAsc = [...attendance].sort((a, b) => {
    const aDate = (a as any).lesson?.date ?? '';
    const bDate = (b as any).lesson?.date ?? '';
    const aTime = (a as any).lesson?.start_time ?? '';
    const bTime = (b as any).lesson?.start_time ?? '';
    return aDate < bDate ? -1 : aDate > bDate ? 1 : aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  });
  const sessionNumMap = new Map(attendanceSortedAsc.map((a, i) => [a.id, i + 1]));
  const pkgTotalCredits = (member as any).total_credits ?? 0;

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'info', label: '정보', icon: 'person-outline' },
    { key: 'attendance', label: '출석', icon: 'checkbox-outline' },
    { key: 'payment', label: '결제', icon: 'card-outline' },
    { key: 'notes', label: '메모', icon: 'document-text-outline' },
    { key: 'messages', label: '메시지', icon: 'chatbubble-outline' },
  ];

  const ATTENDANCE_STATUS_COLOR: Record<string, string> = { '출석': Colors.primary, '결석': Colors.destructive, '지각': Colors.warning, '조퇴': Colors.accentWarm, '보강예정': Colors.accentWarm };

  return (
    <View style={{ flex: 1 }}>
      {/* 메시지 탭: 헤더 제목 변경 + 뒤로가기 → 탭 복귀 */}
      <Stack.Screen options={{
        title: tab === 'messages' ? member.name : '회원 상세',
        headerLeft: () => (
          <TouchableOpacity
            onPress={tab === 'messages'
              ? () => setTab('info')
              : () => router.canGoBack() ? router.back() : router.replace('/(tabs)/members')
            }
            style={{ paddingLeft: 4, paddingRight: 8 }}
          >
            <Ionicons name="chevron-back" size={26} color={Colors.primary} />
          </TouchableOpacity>
        ),
      }} />

      {/* Profile Header — 메시지 탭에서 숨김 */}
      {tab !== 'messages' && (
        <View style={styles.profileHeaderWrap}>
          <View style={styles.profileCard}>
            <View style={[styles.memberAvatar, { backgroundColor: LEVEL_BADGE[member.level]?.bg ?? '#FBF2EF' }]}>
              <Text style={[styles.memberAvatarText, { color: LEVEL_BADGE[member.level]?.text ?? '#C0755A' }]}>
                {member.name.slice(0, 1)}
              </Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={styles.profileName}>{member.name}</Text>
                <View style={[styles.levelBadge, { backgroundColor: LEVEL_BADGE[member.level]?.bg ?? '#FBF2EF' }]}>
                  <Text style={[styles.levelText, { color: LEVEL_BADGE[member.level]?.text ?? '#C0755A' }]}>{member.level}</Text>
                </View>
                {!member.is_active && <View style={styles.inactiveBadge}><Text style={styles.inactiveText}>비활성</Text></View>}
              </View>
              <Text style={styles.profilePhone}>{member.phone}</Text>
              <Text style={styles.profileMeta}>{member.email || '이메일 미등록'}</Text>
              <Text style={styles.profileMeta}>가입일 {member.join_date || '미등록'}</Text>
            </View>
            <TouchableOpacity
              style={styles.aiBtn}
              onPress={() => router.push({ pathname: '/members/ai-analysis', params: { memberId: member.id, memberName: member.name, memberLevel: member.level } })}
            >
              <Ionicons name="sparkles" size={13} color="#C0755A" />
              <Text style={styles.aiBtnText}>AI 레슨 기록</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ① 반복 이슈 태그 — 메시지 탭에서 숨김 */}
      {tab !== 'messages' && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
          <MemberIssueTags
            memberId={member.id}
            isPro={canUse('tagging')}
            onUpgrade={() => setShowProModal(true)}
          />
        </View>
      )}

      {/* Tabs — 메시지 탭에서 숨김 */}
      {tab !== 'messages' && (
        <View style={styles.tabRow}>
          {TABS.map(t => (
            <TouchableOpacity key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
              <View style={{ position: 'relative' }}>
                <Ionicons name={t.icon as any} size={16} color={tab === t.key ? Colors.primary : Colors.mutedFg} />
                {t.key === 'messages' && memberListUnreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{memberListUnreadCount > 99 ? '99+' : String(memberListUnreadCount)}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {tab !== 'messages' ? <ScrollView style={styles.content}>
        {/* INFO TAB */}
        {/* INFO TAB — 기본 정보 카드 */}
        {tab === 'info' && (
          <View style={styles.card}>
            <Text style={styles.cardSectionLabel}>기본 정보</Text>
            <Text style={styles.cardSectionCaption}>공통 필드 {MEMBER_BASIC_FIELD_KEYS.length}개를 등록/수정 화면과 동일하게 유지합니다.</Text>
            {!editing ? (
              <>
                <InfoRow icon="person-outline" label="이름" value={member.name} />
                <InfoRow icon="call-outline" label="전화번호" value={member.phone} />
                <InfoRow icon="mail-outline" label="이메일" value={member.email || '미등록'} />
                <InfoRow icon="gift-outline" label="생년월일" value={(member as any).birth_date || '미등록'} />
                <InfoRow icon="calendar-outline" label="가입일" value={member.join_date || '미등록'} />
                <InfoRow icon="fitness-outline" label="레벨" value={member.level} />
                <InfoRow icon="document-text-outline" label="메모" value={member.notes || '미등록'} multiline />
              </>
            ) : (
              <>
                <Text style={styles.editLabel}>이름</Text>
                <TextInput style={styles.editInput} value={name} onChangeText={setName} />
                <Text style={styles.editLabel}>전화번호</Text>
                <TextInput style={styles.editInput} value={phone} onChangeText={v => setPhone(formatPhone(v))} keyboardType="phone-pad" />
                <Text style={styles.editLabel}>이메일</Text>
                <TextInput style={styles.editInput} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                <Text style={styles.editLabel}>생년월일</Text>
                <TextInput style={styles.editInput} value={birthDate} onChangeText={v => setBirthDate(formatDate(v))} placeholder="YYYY-MM-DD" keyboardType="number-pad" />
                <Text style={styles.editLabel}>가입일</Text>
                <TextInput style={styles.editInput} value={joinDateEdit} onChangeText={v => setJoinDateEdit(formatDate(v))} placeholder="YYYY-MM-DD" keyboardType="number-pad" />
                <Text style={styles.editLabel}>레벨</Text>
                <View style={styles.levelRow}>
                  {MEMBER_LEVELS.map(l => (
                    <TouchableOpacity key={l} style={[styles.levelBtn, level === l && styles.levelBtnActive]} onPress={() => setLevel(l)}>
                      <Text style={[styles.levelBtnText, level === l && styles.levelBtnTextActive]}>{l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.editLabel}>메모</Text>
                <TextInput style={[styles.editInput, { minHeight: 80 }]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" />
                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSaveBasicInfo}>
                    <Text style={styles.saveBtnText}>저장</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                    <Text style={styles.cancelBtnText}>취소</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        {/* INFO TAB — 레슨 관리 카드 */}
        {tab === 'info' && !editing && (
          <View style={styles.card}>
            <Text style={styles.cardSectionLabel}>레슨 관리</Text>
            {!isMemberTrial && (() => {
              let mainText = '';
              let subText = '';
              let actionLabel = '';
              if (detectedScheduleType === 'regular') {
                const days: number[] = (member as any).fixed_schedule_days ?? [];
                const fst = (member as any).fixed_schedule_times;
                const lt = (member as any).fixed_schedule_time?.slice(0, 5);
                const schedSummary = days.map(d => {
                  const raw = fst?.[String(d)];
                  const timesArr: string[] = Array.isArray(raw) ? raw : (raw ? [raw] : (lt ? [lt] : []));
                  return `매주 ${DAYS_KR[d]}요일 ${timesArr.join('/')}`;
                }).join(' · ');
                mainText = `정기 일정 · ${schedSummary}`;
                if (nextLesson) {
                  const dl = new Date(nextLesson.date + 'T00:00:00');
                  subText = `다음 레슨 ${dl.getMonth() + 1}월 ${dl.getDate()}일 ${DAYS_KR[dl.getDay()]}요일 ${nextLesson.start_time.slice(0, 5)}`;
                }
                actionLabel = '변경 〉';
              } else if (detectedScheduleType === 'by_date') {
                mainText = `날짜별 일정 · 예정 ${futureCount}개`;
                if (nextLesson) {
                  const dl = new Date(nextLesson.date + 'T00:00:00');
                  subText = `다음 레슨 ${dl.getMonth() + 1}월 ${dl.getDate()}일 ${DAYS_KR[dl.getDay()]}요일 ${nextLesson.start_time.slice(0, 5)}`;
                }
                if (unregisteredCount > 0) subText += (subText ? ' · ' : '') + `미등록 ${unregisteredCount}회`;
                actionLabel = '관리 〉';
              } else {
                mainText = '등록된 일정이 없어요';
                subText = `잔여 ${memberRemaining}회의 일정을 등록해 주세요`;
                actionLabel = '일정 추가 〉';
              }
              return (
                <TouchableOpacity style={styles.scheduleSectionRow} onPress={() => setScheduleSheet(true)} activeOpacity={0.8}>
                  <View style={styles.scheduleSectionIconWrap}>
                    <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scheduleSectionLabel}>일정 설정</Text>
                    <Text style={styles.scheduleSectionMain} numberOfLines={2}>{mainText}</Text>
                    {!!subText && <Text style={styles.scheduleSectionSub} numberOfLines={1}>{subText}</Text>}
                  </View>
                  <Text style={styles.scheduleSectionAction}>{actionLabel}</Text>
                </TouchableOpacity>
              );
            })()}
            <InfoRow icon="layers-outline" label="레슨권 잔여" value={`${(member as any).remaining_credits ?? 0}회`} />
            {!editingPackage ? (
              <View style={styles.packageBanner}>
                {lessonPackage ? (
                  <>
                    <View style={[styles.packageDot, { backgroundColor: lessonPackage.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.packageTitle}>{lessonPackage.title}</Text>
                      <Text style={styles.packageMeta}>{lessonPackage.total_credits ?? 0}회 · {(lessonPackage.price ?? 0).toLocaleString()}원</Text>
                    </View>
                    <TouchableOpacity onPress={openEditModal}>
                      <Text style={{ fontSize: 13, color: Colors.primary, fontWeight: '600' }}>변경 →</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Ionicons name="card-outline" size={18} color={Colors.iconMuted} />
                    <Text style={[styles.packageMeta, { color: Colors.placeholder, marginLeft: 8 }]}>연결된 레슨권 없음</Text>
                    <TouchableOpacity onPress={openEditModal} style={{ marginLeft: 'auto' }}>
                      <Text style={{ fontSize: 14, color: Colors.primary, fontWeight: '600' }}>설정 →</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.editLabel}>레슨권 변경</Text>
                {lessonPackages.length === 0 ? (
                  <Text style={{ fontSize: 13, color: Colors.placeholder, marginBottom: 12 }}>등록된 레슨권이 없어요</Text>
                ) : (
                  <View style={styles.editPkgGrid}>
                    <TouchableOpacity
                      style={[styles.editPkgCard, styles.editPkgCardNone, !selectedPackageId && styles.editPkgCardNoneSelected]}
                      onPress={() => setSelectedPackageId(null)}
                    >
                      {!selectedPackageId && <View style={styles.editPkgCheck}><Ionicons name="checkmark" size={10} color="#fff" /></View>}
                      <Ionicons name="close-circle-outline" size={20} color={!selectedPackageId ? '#fff' : Colors.placeholder} />
                      <Text style={[styles.editPkgNoneText, !selectedPackageId && { color: '#fff' }]}>없음</Text>
                    </TouchableOpacity>
                    {lessonPackages.map(pkg => {
                      const isSelected = selectedPackageId === pkg.id;
                      return (
                        <TouchableOpacity
                          key={pkg.id}
                          style={[styles.editPkgCard, { borderColor: pkg.color }, isSelected && { backgroundColor: pkg.color + '18' }]}
                          onPress={() => handleSelectPackage(pkg)}
                          activeOpacity={0.8}
                        >
                          {isSelected && (
                            <View style={[styles.editPkgCheck, { backgroundColor: pkg.color }]}>
                              <Ionicons name="checkmark" size={10} color="#fff" />
                            </View>
                          )}
                          <View style={[styles.editPkgColorBar, { backgroundColor: pkg.color }]} />
                          <Text style={styles.editPkgTitle} numberOfLines={2}>{pkg.title}</Text>
                          <Text style={styles.editPkgMeta}>{pkg.duration_minutes}분 · {pkg.total_credits}회</Text>
                          <Text style={[styles.editPkgPrice, { color: pkg.color ?? Colors.primary }]}>{(pkg.price ?? 0).toLocaleString()}원</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSavePackage}>
                    <Text style={styles.saveBtnText}>저장</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingPackage(false)}>
                    <Text style={styles.cancelBtnText}>취소</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* 체험 회원 배너 */}
            {(member as any).is_trial && (
              <View style={styles.trialBanner}>
                <View style={styles.trialBannerLeft}>
                  <Ionicons name="star-half" size={16} color="#D97706" />
                  <View>
                    <Text style={styles.trialBannerTitle}>체험 회원</Text>
                    <Text style={styles.trialBannerSub}>
                      {(member as any).trial_started_at
                        ? `D+${Math.floor((Date.now() - new Date((member as any).trial_started_at + 'T00:00:00').getTime()) / 86400000)}일 · 체험 ${(member as any).trial_lesson_count ?? 0}회 진행`
                        : `체험 ${(member as any).trial_lesson_count ?? 0}회 진행`}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.convertBtn}
                  onPress={handleConvertTrial}
                  disabled={convertingTrial}
                >
                  {convertingTrial
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.convertBtnText}>정규 전환</Text>}
                </TouchableOpacity>
              </View>
            )}

            {/* 앱 초대 문자 버튼 */}
            <TouchableOpacity style={styles.inviteBtn} onPress={handleSendInvite}>
              <Ionicons name="paper-plane-outline" size={16} color={Colors.primary} />
              <Text style={styles.inviteBtnText}>회원앱 초대 문자 발송</Text>
            </TouchableOpacity>

            {/* 재등록 안내 알림 발송 버튼 (잔여 2회 이하 시 표시) */}
            {((member as any).remaining_credits ?? 0) <= 2 && (
              <TouchableOpacity
                style={styles.reregisterBtn}
                onPress={handleSendReregisterNotif}
                disabled={sendingReregister}
              >
                {sendingReregister ? (
                  <ActivityIndicator size="small" color="#D97706" />
                ) : (
                  <Ionicons name="notifications-outline" size={16} color="#D97706" />
                )}
                <Text style={styles.reregisterBtnText}>재등록 안내 보내기</Text>
              </TouchableOpacity>
            )}
          </View>
        )}


        {/* INFO TAB — 하단 액션 버튼 */}
        {tab === 'info' && !editing && (
          <View style={styles.actionBtnSection}>
            <TouchableOpacity style={styles.editBtn} onPress={openEditModal}>
              <Ionicons name="create-outline" size={16} color={Colors.primary} />
              <Text style={styles.editBtnText}>수정</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.deactivateBtn, !member.is_active && { borderColor: Colors.primary }]} onPress={handleToggleActive}>
              <Text style={[styles.deactivateBtnText, !member.is_active && { color: Colors.primary }]}>{member.is_active ? '비활성화' : '활성화'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deletePermBtn} onPress={handlePermanentDelete}>
              <Ionicons name="trash-outline" size={15} color={Colors.white} />
              <Text style={styles.deletePermBtnText}>영구삭제</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ATTENDANCE TAB — 출석/결석/보강예정 표시 + 수정 가능 */}
        {tab === 'attendance' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>출석 기록 ({attendance.length}건)</Text>
            {attendance.length === 0 && <Text style={styles.emptyText}>출석 기록이 없습니다</Text>}
            {attendance.map(a => {
              const lesson = (a as any).lesson;
              const isAbsent = a.status === '결석';
              const deductType = (a as any).deduction_type as string | null;
              const absReason = (a as any).absence_reason as string | null;
              const isMakeup = deductType === '보강예정';
              const displayStatus: '출석' | '결석' | '보강예정' = isAbsent
                ? (isMakeup ? '보강예정' : '결석')
                : '출석';
              const statusColor = displayStatus === '출석' ? Colors.primary
                : displayStatus === '보강예정' ? Colors.accentWarm
                : Colors.destructive;
              const dateLabel = formatAttendanceDate(lesson?.date, lesson?.start_time, lesson?.end_time);
              const isEditing = editingAttId === a.id;
              const sessionNum = sessionNumMap.get(a.id) ?? 0;

              // 수정 중일 때 크레딧 미리보기
              const creditPreviewAfter = isEditing && editDeductCredit !== a.deduct_credit
                ? editDeductCredit
                  ? (member?.remaining_credits ?? 0) - 1
                  : (member?.remaining_credits ?? 0) + 1
                : null;

              return (
                <View key={a.id} style={styles.attendanceRow}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <View style={{ flex: 1 }}>
                    {/* 날짜/시간 + 회차 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.foreground, flex: 1 }}>
                        {dateLabel}
                      </Text>
                      {!isEditing && pkgTotalCredits > 0 && sessionNum > 0 && (
                        <Text style={{ fontSize: 12, color: Colors.mutedFg, marginLeft: 6 }}>
                          {sessionNum}회차 / 총 {pkgTotalCredits}회
                        </Text>
                      )}
                    </View>
                    {isAbsent && absReason && !isEditing && (
                      <Text style={{ fontSize: 12, color: Colors.mutedFg }}>사유: {absReason}</Text>
                    )}
                    {/* 수정 UI */}
                    {isEditing && (
                      <View style={{ gap: 8, marginTop: 8 }}>
                        {/* 출석 상태 버튼 */}
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {(['출석', '결석', '보강예정'] as const).map(opt => {
                            const col = opt === '출석' ? Colors.primary : opt === '보강예정' ? Colors.accentWarm : Colors.destructive;
                            const isActive = editStatus2 === opt;
                            return (
                              <TouchableOpacity
                                key={opt}
                                style={{ flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center',
                                  backgroundColor: isActive ? col : Colors.mutedBg,
                                  borderWidth: 1.5, borderColor: isActive ? col : Colors.border }}
                                onPress={() => setEditStatus2(opt)}
                              >
                                <Text style={{ fontSize: 13, fontWeight: '700', color: isActive ? '#fff' : Colors.mutedFg }}>{opt}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        {/* 레슨권 횟수 차감 스위치 */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                          backgroundColor: Colors.mutedBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                          <Text style={{ fontSize: 13, color: Colors.foreground, fontWeight: '600' }}>레슨권 횟수 차감</Text>
                          <Switch
                            value={editDeductCredit}
                            onValueChange={setEditDeductCredit}
                            trackColor={{ false: Colors.border, true: Colors.primary }}
                            thumbColor={'#fff'}
                          />
                        </View>
                        {/* 크레딧 변경 미리보기 */}
                        {creditPreviewAfter !== null && (
                          <Text style={{ fontSize: 12, color: Colors.mutedFg, textAlign: 'center' }}>
                            잔여 {member?.remaining_credits ?? 0}회 → {creditPreviewAfter}회
                          </Text>
                        )}
                        {/* 저장/취소 버튼 */}
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={{ flex: 1, backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 8, alignItems: 'center', opacity: savingAtt ? 0.5 : 1 }}
                            onPress={() => saveAttStatus(a.id, a.member_id, a.deduct_credit, member?.remaining_credits ?? 0)}
                            disabled={savingAtt}
                          >
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{savingAtt ? '저장중...' : '저장'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{ flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
                            onPress={() => setEditingAttId(null)}
                          >
                            <Text style={{ color: Colors.mutedFg, fontWeight: '700', fontSize: 13 }}>취소</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                  {/* 상태 배지 + 수정 버튼 (수정 중 아닐 때) */}
                  {!isEditing && (
                    <View style={{ alignItems: 'flex-end', gap: 5 }}>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: statusColor + '20' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: statusColor }}>{displayStatus}</Text>
                      </View>
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 3,
                          backgroundColor: Colors.primaryLight, borderRadius: 6,
                          paddingHorizontal: 8, paddingVertical: 4 }}
                        onPress={() => {
                          setEditingAttId(a.id);
                          setEditStatus2(displayStatus);
                          setEditDeductCredit(a.deduct_credit);
                        }}
                      >
                        <Ionicons name="create-outline" size={12} color={Colors.primary} />
                        <Text style={{ fontSize: 13, color: Colors.primary, fontWeight: '700' }}>수정</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* PAYMENT TAB */}
        {tab === 'payment' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>결제 내역 ({payments.length}건)</Text>
            {payments.length === 0 && <Text style={styles.emptyText}>결제 내역이 없습니다</Text>}
            {payments.map(p => (
              <View key={p.id} style={styles.paymentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentDesc}>{p.description}</Text>
                  <Text style={styles.paymentDate}>납부기한: {p.due_date}</Text>
                  {p.paid_date && <Text style={styles.paymentDate}>납부일: {p.paid_date}</Text>}
                  {(p as any).payment_method && <Text style={styles.paymentDate}>납부방법: {(p as any).payment_method}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={styles.paymentAmount}>{p.amount.toLocaleString()}원</Text>
                  <Text style={[styles.paymentStatus, { color: p.status === '납부완료' ? Colors.primary : Colors.destructive }]}>{p.status}</Text>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.mutedBg, borderRadius: 7, paddingVertical: 4, paddingHorizontal: 8 }}
                    onPress={() => openPayEditModal(p)}
                  >
                    <Ionicons name="create-outline" size={11} color={Colors.mutedFg} />
                    <Text style={{ fontSize: 11, color: Colors.mutedFg, fontWeight: '600' }}>수정</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* NOTES TAB */}
        {tab === 'notes' && (
          <View>
            <View style={styles.noteInputCard}>
              <TextInput
                style={styles.noteInput}
                placeholder="새 메모 작성..."
                value={newNote}
                onChangeText={setNewNote}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
              <TouchableOpacity style={[styles.noteAddBtn, !newNote.trim() && { opacity: 0.5 }]} onPress={addNote} disabled={!newNote.trim()}>
                <Text style={styles.noteAddBtnText}>추가</Text>
              </TouchableOpacity>
            </View>

            {memberNotes.length === 0 ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>메모가 없습니다</Text></View>
            ) : (
              <View style={styles.timelineContainer}>
                <Text style={styles.historyLabel}>메모 히스토리 ({memberNotes.length}건)</Text>
                {memberNotes.map((n, index) => (
                  <View key={n.id} style={styles.timelineItem}>
                    {/* 타임라인 도트 & 라인 */}
                    <View style={styles.timelineLine}>
                      <View style={styles.timelineDot} />
                      {index < memberNotes.length - 1 && <View style={styles.timelineBar} />}
                    </View>
                    {/* 내용 */}
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineDate}>
                        {new Date(n.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                        {'  '}
                        <Text style={styles.timelineTime}>
                          {new Date(n.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </Text>
                      <View style={styles.timelineCard}>
                        <Text style={styles.noteContent}>{n.content}</Text>
                        <TouchableOpacity
                          style={styles.deleteNoteBtn}
                          onPress={() => Alert.alert('삭제', '이 메모를 삭제하시겠습니까?', [
                            { text: '취소', style: 'cancel' },
                            { text: '삭제', style: 'destructive', onPress: () => deleteNote(n.id) },
                          ])}
                        >
                          <Ionicons name="trash-outline" size={14} color={Colors.destructive} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView> : null}

      {/* 메시지 탭 — ScrollView 밖에서 flex:1 로 고정 */}
      {tab === 'messages' && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
        >
          {messages.length === 0 ? (
            <View style={[styles.emptyCard, { flex: 1, justifyContent: 'center' }]}>
              <Ionicons name="chatbubbles-outline" size={36} color={Colors.iconMuted} />
              <Text style={styles.emptyText}>아직 메시지가 없어요</Text>
              <Text style={[styles.emptyText, { fontSize: 14, marginTop: 4 }]}>회원에게 첫 메시지를 보내보세요</Text>
            </View>
          ) : (
            <FlatList
              ref={msgListRef}
              data={messages}
              keyExtractor={item => item.id}
              contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
              onContentSizeChange={() => msgListRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item, index }) => {
                const isMe = item.sender_type === 'coach';
                const prev = index > 0 ? messages[index - 1] : null;
                const d = new Date(item.created_at);
                const dateStr = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
                const prevDateStr = prev ? new Date(prev.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }) : null;
                const showDate = dateStr !== prevDateStr;
                return (
                  <>
                    {showDate && (
                      <View style={{ alignItems: 'center', marginVertical: 10 }}>
                        <Text style={{ fontSize: 14, color: Colors.mutedFg, backgroundColor: Colors.border, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 }}>{dateStr}</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end', marginBottom: 8, gap: 8 }}>
                      {!isMe && (
                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primary + '30', justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: Colors.primary }}>{member?.name?.slice(0,1)}</Text>
                        </View>
                      )}
                      <View style={{ maxWidth: '75%', borderRadius: 14, padding: 10, backgroundColor: isMe ? Colors.primary : '#fff', borderBottomRightRadius: isMe ? 4 : 14, borderBottomLeftRadius: isMe ? 14 : 4 }}>
                        <Text style={{ fontSize: 14, color: isMe ? '#fff' : Colors.foreground, lineHeight: 20 }}>{item.content}</Text>
                        <Text style={{ fontSize: 12, color: isMe ? 'rgba(255,255,255,0.6)' : Colors.mutedFg, marginTop: 3, textAlign: 'right' }}>
                          {d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                    </View>
                  </>
                );
              }}
            />
          )}
          {/* 입력창 — 키보드 바로 위에 고정 (KAV가 올려주므로 insets.bottom만 적용) */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#fff', padding: 10, paddingBottom: Math.max(10, insets.bottom), borderTopWidth: 1, borderTopColor: Colors.border, gap: 8 }}>
            <TextInput
              style={{ flex: 1, fontSize: 14, color: Colors.foreground, backgroundColor: Colors.mutedBg, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 80 }}
              value={msgInput}
              onChangeText={setMsgInput}
              placeholder="메시지 입력..."
              placeholderTextColor={Colors.placeholder}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: (!msgInput.trim() || sendingMsg) ? Colors.iconMuted : Colors.primary, justifyContent: 'center', alignItems: 'center' }}
              onPress={sendMessage}
              disabled={!msgInput.trim() || sendingMsg}
            >
              {sendingMsg ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
      {/* ─── 통합 수정 모달 ─── */}
      <Modal visible={showEditModal} animationType="slide" onRequestClose={() => setShowEditModal(false)}>
        <View style={{ flex: 1, backgroundColor: Colors.background }}>
          {/* 헤더 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: '#fff' }}>
            <TouchableOpacity onPress={() => setShowEditModal(false)} style={{ padding: 4, minWidth: 40 }}>
              <Ionicons name="close" size={24} color={Colors.mutedFg} />
            </TouchableOpacity>
            <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground }}>회원 정보 수정</Text>
            <TouchableOpacity onPress={handleSaveAll} style={{ padding: 4, minWidth: 40, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.primary }}>저장</Text>
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">

              {/* 1. 기본 정보 */}
              <View style={[styles.card, { marginTop: 16 }]}>
                <Text style={styles.cardSectionLabel}>기본 정보</Text>
                <Text style={styles.editLabel}>이름</Text>
                <TextInput style={styles.editInput} value={name} onChangeText={setName} />
                <Text style={styles.editLabel}>전화번호</Text>
                <TextInput style={styles.editInput} value={phone} onChangeText={v => setPhone(formatPhone(v))} keyboardType="phone-pad" />
                <Text style={styles.editLabel}>이메일</Text>
                <TextInput style={styles.editInput} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                <Text style={styles.editLabel}>생년월일</Text>
                <TextInput style={styles.editInput} value={birthDate} onChangeText={v => setBirthDate(formatDate(v))} placeholder="YYYY-MM-DD" keyboardType="number-pad" />
                <Text style={styles.editLabel}>가입일</Text>
                <TextInput style={styles.editInput} value={joinDateEdit} onChangeText={v => setJoinDateEdit(formatDate(v))} placeholder="YYYY-MM-DD" keyboardType="number-pad" />
                <Text style={styles.editLabel}>레벨</Text>
                <View style={styles.levelRow}>
                  {MEMBER_LEVELS.map(l => (
                    <TouchableOpacity key={l} style={[styles.levelBtn, level === l && styles.levelBtnActive]} onPress={() => setLevel(l)}>
                      <Text style={[styles.levelBtnText, level === l && styles.levelBtnTextActive]}>{l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.editLabel}>메모</Text>
                <TextInput style={[styles.editInput, { minHeight: 80 }]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" />
              </View>

              {/* 2. 레슨권 */}
              <View style={styles.card}>
                <Text style={styles.cardSectionLabel}>레슨권</Text>
                {lessonPackage && (
                  <View style={{ marginBottom: 12, padding: 12, backgroundColor: Colors.background, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={[styles.packageDot, { backgroundColor: lessonPackage.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.packageTitle}>{lessonPackage.title}</Text>
                      <Text style={styles.packageMeta}>{lessonPackage.total_credits}회 · {(lessonPackage.price ?? 0).toLocaleString()}원</Text>
                      <Text style={{ fontSize: 12, color: Colors.primary, marginTop: 2 }}>잔여 {(member as any).remaining_credits ?? 0}회</Text>
                    </View>
                  </View>
                )}
                {lessonPackages.length === 0 ? (
                  <Text style={{ fontSize: 13, color: Colors.placeholder, marginBottom: 12 }}>등록된 레슨권이 없어요</Text>
                ) : (
                  <View style={styles.editPkgGrid}>
                    <TouchableOpacity
                      style={[styles.editPkgCard, styles.editPkgCardNone, !selectedPackageId && styles.editPkgCardNoneSelected]}
                      onPress={() => setSelectedPackageId(null)}
                    >
                      {!selectedPackageId && <View style={styles.editPkgCheck}><Ionicons name="checkmark" size={10} color="#fff" /></View>}
                      <Ionicons name="close-circle-outline" size={20} color={!selectedPackageId ? '#fff' : Colors.placeholder} />
                      <Text style={[styles.editPkgNoneText, !selectedPackageId && { color: '#fff' }]}>없음</Text>
                    </TouchableOpacity>
                    {lessonPackages.map(pkg => {
                      const isSelected = selectedPackageId === pkg.id;
                      return (
                        <TouchableOpacity
                          key={pkg.id}
                          style={[styles.editPkgCard, { borderColor: pkg.color }, isSelected && { backgroundColor: pkg.color + '18' }]}
                          onPress={() => handleSelectPackage(pkg)}
                          activeOpacity={0.8}
                        >
                          {isSelected && (
                            <View style={[styles.editPkgCheck, { backgroundColor: pkg.color }]}>
                              <Ionicons name="checkmark" size={10} color="#fff" />
                            </View>
                          )}
                          <View style={[styles.editPkgColorBar, { backgroundColor: pkg.color }]} />
                          <Text style={styles.editPkgTitle} numberOfLines={2}>{pkg.title}</Text>
                          <Text style={styles.editPkgMeta}>{pkg.duration_minutes}분 · {pkg.total_credits}회</Text>
                          <Text style={[styles.editPkgPrice, { color: pkg.color ?? Colors.primary }]}>{(pkg.price ?? 0).toLocaleString()}원</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* 3. 레슨 스케줄 */}
              <View style={styles.card}>
                <Text style={styles.cardSectionLabel}>레슨 스케줄</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {(['regular', 'by_date', 'later'] as const).map(type => {
                    const label = type === 'regular' ? '정기 일정' : type === 'by_date' ? '날짜별 일정' : '나중에 설정';
                    const isActive = editSchedType === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                          backgroundColor: isActive ? Colors.primary : Colors.mutedBg,
                          borderWidth: 1.5, borderColor: isActive ? Colors.primary : Colors.border }}
                        onPress={() => {
                          setEditSchedType(type);
                          if (type !== 'regular') {
                            setScheduleDays([]);
                            setDayTimes({});
                          }
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: isActive ? '#fff' : Colors.mutedFg }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {editSchedType === 'regular' && (
                  <>
                    <Text style={styles.editLabel}>요일 선택</Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 16 }}>
                      {DAYS_KR.map((dayName, dayIdx) => {
                        const isDaySelected = scheduleDays.includes(dayIdx);
                        return (
                          <TouchableOpacity
                            key={dayIdx}
                            style={{ flex: 1, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
                              backgroundColor: isDaySelected ? Colors.primary : Colors.mutedBg }}
                            onPress={() => {
                              if (isDaySelected) {
                                setScheduleDays(prev => prev.filter(d => d !== dayIdx));
                                setDayTimes(prev => { const n = { ...prev }; delete n[dayIdx]; return n; });
                              } else {
                                setScheduleDays(prev => [...prev, dayIdx].sort());
                                fetchAvailableSlots(dayIdx);
                              }
                            }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '700', color: isDaySelected ? '#fff' : Colors.mutedFg }}>{dayName}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {scheduleDays.length === 0 && (
                      <Text style={{ fontSize: 13, color: Colors.placeholder, marginBottom: 12 }}>요일을 선택하세요</Text>
                    )}
                    {scheduleDays.map(dayIdx => {
                      const times = dayTimes[dayIdx] ?? [];
                      return (
                        <View key={dayIdx} style={{ marginBottom: 12 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, justifyContent: 'space-between' }}>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.foreground }}>{DAYS_KR[dayIdx]}요일</Text>
                            <TouchableOpacity
                              onPress={() => {
                                setEditingDay(dayIdx);
                                setTempHour('');
                                setTempMinute('00');
                                setTimePickerVisible(true);
                              }}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: Colors.primaryLight }}
                            >
                              <Ionicons name="add" size={14} color={Colors.primary} />
                              <Text style={{ fontSize: 13, color: Colors.primary, fontWeight: '600' }}>시간 추가</Text>
                            </TouchableOpacity>
                          </View>
                          {times.length === 0 ? (
                            <Text style={{ fontSize: 13, color: Colors.placeholder }}>시간을 추가해주세요</Text>
                          ) : (
                            times.map(t => (
                              <View key={t} style={[styles.dayTimeRow2, { marginBottom: 4 }]}>
                                <Ionicons name="time-outline" size={16} color={Colors.primary} />
                                <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foreground }}>{t}</Text>
                                <TouchableOpacity
                                  onPress={() => setDayTimes(prev => {
                                    const next = { ...prev, [dayIdx]: (prev[dayIdx] ?? []).filter(x => x !== t) };
                                    if (next[dayIdx].length === 0) delete next[dayIdx];
                                    return next;
                                  })}
                                >
                                  <Ionicons name="close-circle" size={18} color={Colors.destructive} />
                                </TouchableOpacity>
                              </View>
                            ))
                          )}
                        </View>
                      );
                    })}
                  </>
                )}

                {editSchedType === 'by_date' && (
                  <View style={{ padding: 12, backgroundColor: Colors.background, borderRadius: 10 }}>
                    <Text style={{ fontSize: 14, color: Colors.foreground, marginBottom: 4 }}>날짜별 일정은 스케줄 관리 화면에서 개별 날짜를 추가·수정합니다.</Text>
                    <Text style={{ fontSize: 12, color: Colors.mutedFg }}>현재 예정 레슨 {futureLessons.length}개</Text>
                  </View>
                )}

                {editSchedType === 'later' && (
                  <View style={{ padding: 12, backgroundColor: Colors.background, borderRadius: 10 }}>
                    <Text style={{ fontSize: 14, color: Colors.mutedFg }}>저장 후 일정 설정 화면에서 스케줄을 등록할 수 있습니다.</Text>
                  </View>
                )}
              </View>

              <View style={{ height: 60 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ─── 스케줄 적용 시작일 캘린더 모달 ─── */}
      <Modal visible={startDateModal} transparent animationType="slide" onRequestClose={() => setStartDateModal(false)}>
        <View style={styles.modalOverlayTP}>
          <View style={[styles.modalSheetTP, { maxHeight: '85%' }]}>
            <View style={styles.modalHeaderTP}>
              <View>
                <Text style={styles.modalTitleTP}>언제부터 반영할까요?</Text>
                <Text style={{ fontSize: 14, color: Colors.mutedFg, marginTop: 2 }}>선택한 날짜 이후 레슨이 새 스케줄로 교체됩니다</Text>
              </View>
              <TouchableOpacity onPress={() => setStartDateModal(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>

            {/* 선택된 날짜 표시 */}
            <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.primary + '12', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="calendar" size={18} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.primary }}>
                  {scheduleStartDate ? (() => {
                    const d = new Date(scheduleStartDate + 'T00:00:00');
                    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
                  })() : '날짜를 선택하세요'}
                </Text>
                {(() => {
                  const affected = futureLessons.filter(l => l.date >= scheduleStartDate);
                  if (affected.length > 0) {
                    return (
                      <Text style={{ fontSize: 12, color: Colors.primary, marginTop: 2 }}>
                        예정 레슨 {affected.length}개가 새 일정으로 교체됩니다
                      </Text>
                    );
                  }
                  return null;
                })()}
              </View>
              {scheduleStartDate === toKSTDateStr(new Date()) && (
                <View style={{ backgroundColor: Colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 13, color: '#fff', fontWeight: '700' }}>오늘</Text>
                </View>
              )}
            </View>

            {/* 인라인 캘린더 */}
            <ScrollView style={{ maxHeight: 360 }}>
              {(() => {
                const { year, month } = startCalMonth;
                const todayStr = toKSTDateStr(new Date());
                const firstDow = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const cells: (number | null)[] = [];
                for (let i = 0; i < firstDow; i++) cells.push(null);
                for (let d = 1; d <= daysInMonth; d++) cells.push(d);
                while (cells.length % 7 !== 0) cells.push(null);
                const MONTHS_KR = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
                const DAYS_LABEL = ['일','월','화','수','목','금','토'];
                return (
                  <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                    {/* 월 네비게이션 */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <TouchableOpacity
                        style={{ padding: 8 }}
                        onPress={() => setStartCalMonth(p => {
                          const m = p.month - 1;
                          return m < 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: m };
                        })}
                      >
                        <Ionicons name="chevron-back" size={20} color={Colors.primary} />
                      </TouchableOpacity>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: Colors.primary }}>{year}년 {MONTHS_KR[month]}</Text>
                      <TouchableOpacity
                        style={{ padding: 8 }}
                        onPress={() => setStartCalMonth(p => {
                          const m = p.month + 1;
                          return m > 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: m };
                        })}
                      >
                        <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                    {/* 요일 헤더 */}
                    <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                      {DAYS_LABEL.map((dl, di) => (
                        <Text key={di} style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700',
                          color: di === 0 ? Colors.destructive : di === 6 ? Colors.accentWarm : Colors.mutedFg,
                          paddingVertical: 4 }}>{dl}</Text>
                      ))}
                    </View>
                    {/* 날짜 그리드 */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                      {cells.map((day, ci) => {
                        if (!day) return <View key={ci} style={{ width: '14.28%', paddingVertical: 3 }} />;
                        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const isPast = dateStr < todayStr;
                        const isSelected = dateStr === scheduleStartDate;
                        const isToday = dateStr === todayStr;
                        const dow = ci % 7;
                        return (
                          <TouchableOpacity
                            key={ci}
                            disabled={isPast}
                            style={{ width: '14.28%', alignItems: 'center', paddingVertical: 3 }}
                            onPress={() => setScheduleStartDate(dateStr)}
                          >
                            <View style={{
                              width: 34, height: 34, borderRadius: 17,
                              justifyContent: 'center', alignItems: 'center',
                              backgroundColor: isSelected ? Colors.primary : isToday ? Colors.primary + '18' : 'transparent',
                            }}>
                              <Text style={{
                                fontSize: 14, fontWeight: isSelected || isToday ? '800' : '400',
                                color: isSelected ? '#fff'
                                  : isPast ? Colors.border
                                  : dow === 0 ? Colors.destructive
                                  : dow === 6 ? Colors.accentWarm
                                  : Colors.foreground,
                              }}>{day}</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })()}
            </ScrollView>

            {/* 버튼 */}
            <View style={{ flexDirection: 'row', gap: 8, margin: 16, marginTop: 8 }}>
              <TouchableOpacity
                style={{ flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: Colors.mutedBg }}
                onPress={() => setStartDateModal(false)}
              >
                <Text style={{ fontWeight: '700', fontSize: 14, color: Colors.primary }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: Colors.primary }}
                onPress={() => {
                  setStartDateModal(false);
                  if (pendingSaveCtx) {
                    proceedWithSave(pendingSaveCtx.userId, pendingSaveCtx.credits, pendingSaveCtx.duration, scheduleStartDate);
                    setPendingSaveCtx(null);
                  }
                }}
              >
                <Text style={{ fontWeight: '700', fontSize: 14, color: '#fff' }}>이 날부터 적용</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 빈 시간대 모달 (요일 선택 시 자동 표시) */}
      <Modal visible={slotsModalVisible} transparent animationType="slide" onRequestClose={() => setSlotsModalVisible(false)}>
        <View style={styles.modalOverlayTP}>
          <View style={styles.modalSheetTP}>
            <View style={styles.modalHeaderTP}>
              <View>
                <Text style={styles.modalTitleTP}>
                  {slotsModalDay !== null ? DAYS_KR[slotsModalDay] : ''}요일 빈 시간대
                </Text>
                {slotsDateStr ? <Text style={{ fontSize: 14, color: Colors.mutedFg, marginTop: 2 }}>{slotsDateStr} 기준</Text> : null}
              </View>
              <TouchableOpacity onPress={() => setSlotsModalVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            {loadingSlots ? (
              <ActivityIndicator color={Colors.primary} style={{ padding: 30 }} />
            ) : (
              <ScrollView style={{ maxHeight: 380 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
                  {slotsData.map(slot => (
                    <TouchableOpacity
                      key={slot.time}
                      disabled={!slot.available}
                      style={{
                        paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10,
                        backgroundColor: slot.available ? Colors.primary + '15' : Colors.mutedBg,
                        borderWidth: 1.5,
                        borderColor: slot.available ? Colors.primary : Colors.border,
                        alignItems: 'center', minWidth: 72,
                      }}
                      onPress={() => {
                        if (slotsModalDay !== null) {
                          setDayTimes(prev => {
                            const times = [...(prev[slotsModalDay] ?? [])];
                            if (!times.includes(slot.time)) { times.push(slot.time); times.sort(); }
                            return { ...prev, [slotsModalDay]: times };
                          });
                          setSlotsModalVisible(false);
                        }
                      }}
                    >
                      <Text style={{ fontSize: 15, fontWeight: '700', color: slot.available ? Colors.primary : Colors.placeholder }}>{slot.time}</Text>
                      {!slot.available && <Text style={{ fontSize: 12, color: Colors.placeholder, marginTop: 2 }}>레슨중</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ fontSize: 14, color: Colors.mutedFg, paddingHorizontal: 16, paddingBottom: 8 }}>
                  빈 시간 탭하면 바로 추가됩니다. 닫으면 직접 입력 가능해요.
                </Text>
              </ScrollView>
            )}
            <TouchableOpacity
              style={{ margin: 16, marginTop: 4, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              onPress={() => setSlotsModalVisible(false)}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 시간 피커 모달 */}
      <Modal visible={timePickerVisible} transparent animationType="slide" onRequestClose={() => setTimePickerVisible(false)}>
        <View style={styles.modalOverlayTP}>
          <View style={styles.modalSheetTP}>
            <View style={styles.modalHeaderTP}>
              <Text style={styles.modalTitleTP}>
                {editingDay !== null ? `${DAYS_KR[editingDay]}요일 시작 시간` : '시작 시간'}
              </Text>
              <TouchableOpacity onPress={() => setTimePickerVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            <View style={styles.spinnerRowTP}>
              <View style={styles.spinnerColTP}>
                <Text style={styles.spinnerLabelTP}>시</Text>
                <FlatList
                  data={HOURS} keyExtractor={item => item}
                  showsVerticalScrollIndicator={false} style={styles.spinnerListTP}
                  renderItem={({ item }) => {
                    const isSel = item === tempHour;
                    return (
                      <TouchableOpacity style={[styles.spinnerItemTP, isSel && styles.spinnerItemTPSel]} onPress={() => setTempHour(item)}>
                        <Text style={[styles.spinnerItemTPText, isSel && styles.spinnerItemTPTextSel]}>{item}</Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
              <Text style={styles.spinnerColonTP}>:</Text>
              <View style={styles.spinnerColTP}>
                <Text style={styles.spinnerLabelTP}>분</Text>
                <FlatList
                  data={MINUTES} keyExtractor={item => item}
                  showsVerticalScrollIndicator={false} style={styles.spinnerListTP}
                  renderItem={({ item }) => {
                    const isSel = item === tempMinute;
                    return (
                      <TouchableOpacity style={[styles.spinnerItemTP, isSel && styles.spinnerItemTPSel]} onPress={() => setTempMinute(item)}>
                        <Text style={[styles.spinnerItemTPText, isSel && styles.spinnerItemTPTextSel]}>{item}</Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            </View>
            <TouchableOpacity
              style={[styles.confirmBtnTP, !tempHour && styles.confirmBtnTPDis]}
              onPress={() => {
                if (!tempHour || editingDay === null) return;
                const newTime = `${tempHour}:${tempMinute}`;
                setDayTimes(prev => {
                  const existing = prev[editingDay] ?? [];
                  // 중복 시간 추가 방지
                  if (existing.includes(newTime)) return prev;
                  return { ...prev, [editingDay]: [...existing, newTime].sort() };
                });
                setTimePickerVisible(false);
                setEditingDay(null);
              }}
            >
              <Text style={styles.confirmBtnTPText}>
                {tempHour ? `${tempHour}:${tempMinute} 선택` : '시간을 선택하세요'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 일정 설정 바텀시트 */}
      <Modal visible={scheduleSheet} transparent animationType="slide" onRequestClose={() => setScheduleSheet(false)}>
        <TouchableOpacity style={styles.modalOverlayTP} activeOpacity={1} onPress={() => setScheduleSheet(false)}>
          <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation()}>
            <View style={[styles.modalSheetTP, { paddingBottom: 40 }]}>
              <View style={styles.modalHeaderTP}>
                <Text style={styles.modalTitleTP}>일정 설정</Text>
                <TouchableOpacity onPress={() => setScheduleSheet(false)}>
                  <Ionicons name="close" size={22} color={Colors.mutedFg} />
                </TouchableOpacity>
              </View>
              {detectedScheduleType === 'regular' && (
                <>
                  <TouchableOpacity style={styles.scheduleSheetItem} onPress={() => { setScheduleSheet(false); setScheduleListSheet(true); }}>
                    <Ionicons name="list-outline" size={20} color={Colors.primary} />
                    <Text style={styles.scheduleSheetItemText}>일정 확인</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.scheduleSheetItem} onPress={() => { setScheduleSheet(false); setByDateAddCalMonth({ year: new Date().getFullYear(), month: new Date().getMonth() }); setTimeout(() => setByDateAddSheet(true), 500); }}>
                    <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
                    <Text style={styles.scheduleSheetItemText}>새 일정 추가</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.scheduleSheetItem} onPress={() => { setScheduleSheet(false); openEditModal(); }}>
                    <Ionicons name="repeat-outline" size={20} color={Colors.primary} />
                    <Text style={styles.scheduleSheetItemText}>정기 일정 변경</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.scheduleSheetItem} onPress={() => {
                    setScheduleSheet(false);
                    if (futureLessons.length === 0) {
                      handleToByDate('forward');
                    } else {
                      setChangeScopeSheet(true);
                    }
                  }}>
                    <Ionicons name="calendar-number-outline" size={20} color={Colors.mutedFg} />
                    <Text style={[styles.scheduleSheetItemText, { color: Colors.foreground }]}>날짜별 일정으로 변경</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                  </TouchableOpacity>
                </>
              )}
              {detectedScheduleType === 'by_date' && (
                <>
                  <TouchableOpacity style={styles.scheduleSheetItem} onPress={() => { setScheduleSheet(false); setScheduleListSheet(true); }}>
                    <Ionicons name="list-outline" size={20} color={Colors.primary} />
                    <Text style={styles.scheduleSheetItemText}>일정 확인</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.scheduleSheetItem} onPress={() => { setScheduleSheet(false); setByDateAddCalMonth({ year: new Date().getFullYear(), month: new Date().getMonth() }); setTimeout(() => setByDateAddSheet(true), 500); }}>
                    <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
                    <Text style={styles.scheduleSheetItemText}>일정 추가</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.scheduleSheetItem} onPress={() => { setScheduleSheet(false); openEditModal(); }}>
                    <Ionicons name="repeat-outline" size={20} color={Colors.primary} />
                    <Text style={styles.scheduleSheetItemText}>정기 일정으로 변경</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                  </TouchableOpacity>
                </>
              )}
              {detectedScheduleType === 'later' && (
                <>
                  <TouchableOpacity style={styles.scheduleSheetItem} onPress={() => { setScheduleSheet(false); openEditModal(); }}>
                    <Ionicons name="repeat-outline" size={20} color={Colors.primary} />
                    <Text style={styles.scheduleSheetItemText}>정기 일정 추가</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.scheduleSheetItem} onPress={() => { setScheduleSheet(false); setByDateAddCalMonth({ year: new Date().getFullYear(), month: new Date().getMonth() }); setTimeout(() => setByDateAddSheet(true), 500); }}>
                    <Ionicons name="calendar-number-outline" size={20} color={Colors.primary} />
                    <Text style={styles.scheduleSheetItemText}>날짜별 일정 추가</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 날짜별 일정 추가 시트 (달력 + 시간선택 통합 — Modal 중첩 방지) */}
      <Modal visible={byDateAddSheet} transparent animationType="slide" onRequestClose={closeByDateAddSheet}>
        <View style={styles.modalOverlayTP}>
          <View style={[styles.modalSheetTP, { paddingBottom: 40 }]}>
            {byDateAddView === 'calendar' ? (
              <>
                {/* 헤더 */}
                <View style={styles.modalHeaderTP}>
                  <View>
                    <Text style={styles.modalTitleTP}>날짜별 일정 추가</Text>
                    {(() => {
                      const maxAddable = Math.max(0, parseInt(remainingCredits) - futureLessons.length);
                      return (
                        <Text style={{ fontSize: 13, color: byDateAddEntries.length >= maxAddable ? Colors.destructive : Colors.primary, marginTop: 2 }}>
                          {byDateAddEntries.length > 0 ? `${byDateAddEntries.length}개 선택` : '날짜를 눌러 일정 추가'}
                          {maxAddable > 0 ? ` / 최대 ${maxAddable}개` : ''}
                        </Text>
                      );
                    })()}
                  </View>
                  <TouchableOpacity onPress={closeByDateAddSheet}>
                    <Ionicons name="close" size={22} color={Colors.mutedFg} />
                  </TouchableOpacity>
                </View>

                {/* 선택된 일정 목록 */}
                {byDateAddEntries.length > 0 && (
                  <ScrollView style={{ maxHeight: 110 }} bounces={false}>
                    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                      {byDateAddEntries.map((entry, idx) => {
                        const d = new Date(entry.date + 'T00:00:00');
                        const label = `${d.getMonth() + 1}/${d.getDate()}(${DAYS_KR[d.getDay()]}) ${entry.startTime} · ${entry.duration}분`;
                        return (
                          <View key={idx} style={[styles.dayTimeRow2, { marginBottom: 4 }]}>
                            <Ionicons name="calendar-outline" size={14} color={Colors.primary} style={{ marginRight: 6 }} />
                            <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foreground }}>{label}</Text>
                            <TouchableOpacity onPress={() => setByDateAddEntries(prev => prev.filter((_, i) => i !== idx))} style={{ padding: 4 }}>
                              <Ionicons name="close-circle" size={18} color={Colors.destructive} />
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>
                )}

                {/* 달력 */}
                <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <TouchableOpacity onPress={() => setByDateAddCalMonth(prev => {
                      const d = new Date(prev.year, prev.month - 1, 1);
                      return { year: d.getFullYear(), month: d.getMonth() };
                    })} style={{ padding: 6 }}>
                      <Ionicons name="chevron-back" size={20} color={Colors.primary} />
                    </TouchableOpacity>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.foreground }}>
                      {byDateAddCalMonth.year}년 {byDateAddCalMonth.month + 1}월
                    </Text>
                    <TouchableOpacity onPress={() => setByDateAddCalMonth(prev => {
                      const d = new Date(prev.year, prev.month + 1, 1);
                      return { year: d.getFullYear(), month: d.getMonth() };
                    })} style={{ padding: 6 }}>
                      <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                    {['일','월','화','수','목','금','토'].map((d, i) => (
                      <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700',
                        color: i === 0 ? Colors.destructive : i === 6 ? Colors.accentWarm : Colors.mutedFg }}>{d}</Text>
                    ))}
                  </View>
                  {(() => {
                    const { year, month } = byDateAddCalMonth;
                    const firstDay = new Date(year, month, 1).getDay();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const todayStr2 = toKSTDateStr(new Date());
                    const maxAddable = Math.max(0, parseInt(remainingCredits) - futureLessons.length);
                    const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
                    while (cells.length % 7 !== 0) cells.push(null);
                    const rows: (number | null)[][] = [];
                    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
                    return rows.map((row, ri) => (
                      <View key={ri} style={{ flexDirection: 'row', marginBottom: 4 }}>
                        {row.map((day, di) => {
                          if (!day) return <View key={di} style={{ flex: 1, height: 40 }} />;
                          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const isPast = dateStr < todayStr2;
                          const existingEntry = byDateAddEntries.find(e => e.date === dateStr);
                          const isSelected = !!existingEntry;
                          const isToday = dateStr === todayStr2;
                          const atMax = !isSelected && byDateAddEntries.length >= maxAddable && maxAddable > 0;
                          const isDisabled = isPast || atMax;
                          return (
                            <TouchableOpacity
                              key={di}
                              disabled={isDisabled}
                              activeOpacity={0.7}
                              style={{ flex: 1, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center',
                                backgroundColor: isSelected ? Colors.primary : isToday ? Colors.primaryLight : 'transparent',
                                opacity: atMax ? 0.35 : 1 }}
                              onPress={() => {
                                byDateAddTempDateRef.current = dateStr;
                                if (existingEntry) {
                                  const [h, m] = existingEntry.startTime.split(':');
                                  setByDateAddTempHour(h);
                                  setByDateAddTempMinute(m);
                                  setByDateAddTempDuration(existingEntry.duration);
                                } else {
                                  setByDateAddTempHour('');
                                  setByDateAddTempMinute('00');
                                  setByDateAddTempDuration(parseInt(lessonDuration) || 60);
                                }
                                setByDateAddView('timepicker');
                              }}
                            >
                              <Text style={{ fontSize: 15, fontWeight: isSelected || isToday ? '800' : '400',
                                color: isPast || atMax ? Colors.placeholder : isSelected ? '#fff'
                                  : isToday ? Colors.primary
                                  : di === 0 ? Colors.destructive : di === 6 ? Colors.accentWarm : Colors.foreground }}>
                                {day}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ));
                  })()}
                </View>

                {/* 최대 개수 도달 안내 */}
                {(() => {
                  const maxAddable = Math.max(0, parseInt(remainingCredits) - futureLessons.length);
                  return maxAddable > 0 && byDateAddEntries.length >= maxAddable ? (
                    <Text style={{ fontSize: 12, color: Colors.destructive, textAlign: 'center', marginTop: 8, paddingHorizontal: 16 }}>
                      등록 가능한 일정을 모두 선택했어요
                    </Text>
                  ) : null;
                })()}

                {/* 하단 버튼 */}
                <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 12 }}>
                  <TouchableOpacity
                    style={{ flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: Colors.mutedBg }}
                    onPress={closeByDateAddSheet}
                  >
                    <Text style={{ fontWeight: '700', fontSize: 14, color: Colors.mutedFg }}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 2, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
                      backgroundColor: byDateAddEntries.length > 0 && !savingByDate ? Colors.primary : Colors.iconMuted }}
                    onPress={handleAddByDateLessons}
                    disabled={savingByDate || byDateAddEntries.length === 0}
                  >
                    {savingByDate
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={{ fontWeight: '700', fontSize: 14, color: '#fff' }}>
                          {byDateAddEntries.length > 0 ? `선택한 일정 ${byDateAddEntries.length}개 추가` : '날짜를 선택하세요'}
                        </Text>
                    }
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              /* 시간 선택 뷰 (달력 Modal 내부 — Modal 중첩 없음) */
              <>
                <View style={styles.modalHeaderTP}>
                  <Text style={styles.modalTitleTP}>
                    {byDateAddTempDateRef.current ? (() => {
                      const d = new Date(byDateAddTempDateRef.current + 'T00:00:00');
                      return `${d.getMonth() + 1}/${d.getDate()}(${DAYS_KR[d.getDay()]}) 레슨 시간 설정`;
                    })() : '레슨 시간 설정'}
                  </Text>
                  <TouchableOpacity onPress={() => setByDateAddView('calendar')}>
                    <Ionicons name="close" size={22} color={Colors.mutedFg} />
                  </TouchableOpacity>
                </View>

                {/* 시작 시간 피커 */}
                <Text style={[styles.spinnerLabelTP, { paddingHorizontal: 16, marginBottom: 4, textAlign: 'left' }]}>시작 시간</Text>
                <View style={styles.spinnerRowTP}>
                  <View style={styles.spinnerColTP}>
                    <Text style={styles.spinnerLabelTP}>시</Text>
                    <FlatList
                      data={HOURS} keyExtractor={item => item}
                      showsVerticalScrollIndicator={false} style={styles.spinnerListTP}
                      renderItem={({ item }) => {
                        const isSel = item === byDateAddTempHour;
                        return (
                          <TouchableOpacity style={[styles.spinnerItemTP, isSel && styles.spinnerItemTPSel]} onPress={() => setByDateAddTempHour(item)}>
                            <Text style={[styles.spinnerItemTPText, isSel && styles.spinnerItemTPTextSel]}>{item}</Text>
                          </TouchableOpacity>
                        );
                      }}
                    />
                  </View>
                  <Text style={styles.spinnerColonTP}>:</Text>
                  <View style={styles.spinnerColTP}>
                    <Text style={styles.spinnerLabelTP}>분</Text>
                    <FlatList
                      data={MINUTES} keyExtractor={item => item}
                      showsVerticalScrollIndicator={false} style={styles.spinnerListTP}
                      renderItem={({ item }) => {
                        const isSel = item === byDateAddTempMinute;
                        return (
                          <TouchableOpacity style={[styles.spinnerItemTP, isSel && styles.spinnerItemTPSel]} onPress={() => setByDateAddTempMinute(item)}>
                            <Text style={[styles.spinnerItemTPText, isSel && styles.spinnerItemTPTextSel]}>{item}</Text>
                          </TouchableOpacity>
                        );
                      }}
                    />
                  </View>
                </View>

                {/* 레슨 시간 선택 */}
                <Text style={[styles.spinnerLabelTP, { paddingHorizontal: 16, marginTop: 12, marginBottom: 8, textAlign: 'left' }]}>레슨 시간</Text>
                <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 }}>
                  {[30, 45, 60, 90, 120].map(min => {
                    const durLabel = min < 60 ? `${min}분` : min % 60 === 0 ? `${min / 60}시간` : `${Math.floor(min / 60)}시간 ${min % 60}분`;
                    return (
                      <TouchableOpacity
                        key={min}
                        onPress={() => setByDateAddTempDuration(min)}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                          backgroundColor: byDateAddTempDuration === min ? Colors.primary : Colors.mutedBg,
                          borderWidth: byDateAddTempDuration === min ? 0 : 1, borderColor: Colors.border }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700',
                          color: byDateAddTempDuration === min ? '#fff' : Colors.mutedFg }}>
                          {durLabel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* 삭제 버튼 (기존 선택된 날짜) */}
                {byDateAddEntries.some(e => e.date === byDateAddTempDateRef.current) && (
                  <TouchableOpacity
                    style={{ marginHorizontal: 16, marginBottom: 8, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: Colors.destructive + '15' }}
                    onPress={() => {
                      setByDateAddEntries(prev => prev.filter(e => e.date !== byDateAddTempDateRef.current));
                      setByDateAddView('calendar');
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.destructive }}>이 날짜 삭제</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.confirmBtnTP, !byDateAddTempHour && styles.confirmBtnTPDis]}
                  onPress={() => {
                    if (!byDateAddTempHour || !byDateAddTempDateRef.current) return;
                    const newEntry: DateEntry = {
                      date: byDateAddTempDateRef.current,
                      startTime: `${byDateAddTempHour}:${byDateAddTempMinute}`,
                      duration: byDateAddTempDuration,
                    };
                    setByDateAddEntries(prev => {
                      const filtered = prev.filter(e => e.date !== newEntry.date);
                      return [...filtered, newEntry].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.startTime < b.startTime ? -1 : 1);
                    });
                    setByDateAddView('calendar');
                  }}
                >
                  <Text style={styles.confirmBtnTPText}>
                    {byDateAddTempHour ? `${byDateAddTempHour}:${byDateAddTempMinute} · ${byDateAddTempDuration}분 선택` : '시간을 선택하세요'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* 일정 확인 시트 */}
      <Modal visible={scheduleListSheet} transparent animationType="slide" onRequestClose={() => setScheduleListSheet(false)}>
        <View style={styles.modalOverlayTP}>
          <View style={[styles.modalSheetTP, { paddingBottom: 40 }]}>
            <View style={styles.modalHeaderTP}>
              <View>
                <Text style={styles.modalTitleTP}>레슨 일정</Text>
                <Text style={{ fontSize: 13, color: Colors.mutedFg, marginTop: 2 }}>
                  {member?.name}님 · {futureLessons.length}개 예정
                </Text>
              </View>
              <TouchableOpacity onPress={() => setScheduleListSheet(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            {futureLessons.length === 0 ? (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Ionicons name="calendar-outline" size={36} color={Colors.iconMuted} />
                <Text style={{ fontSize: 15, color: Colors.placeholder, marginTop: 12, textAlign: 'center' }}>
                  등록된 레슨 일정이 없어요
                </Text>
                <Text style={{ fontSize: 13, color: Colors.placeholder, marginTop: 4, textAlign: 'center' }}>
                  일정 설정에서 새 일정을 추가하세요
                </Text>
              </View>
            ) : (
              <FlatList
                data={futureLessons}
                keyExtractor={item => item.id}
                style={{ maxHeight: 480 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}
                renderItem={({ item }) => {
                  const d = new Date(item.date + 'T00:00:00');
                  const dayLabel = DAY_NAMES[d.getDay()];
                  const dateLabel = `${d.getMonth() + 1}월 ${d.getDate()}일 (${dayLabel})`;
                  const startT = item.start_time?.slice(0, 5) ?? '';
                  const endT = item.end_time?.slice(0, 5) ?? '';
                  return (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
                        borderBottomWidth: 1, borderBottomColor: Colors.mutedBg, gap: 12 }}
                      onPress={() => { setScheduleListSheet(false); router.push(`/lessons/${item.id}`); }}
                      activeOpacity={0.7}
                    >
                      <View style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: Colors.primaryLight,
                        justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ fontSize: 14, fontWeight: '800', color: Colors.primary }}>{d.getDate()}</Text>
                        <Text style={{ fontSize: 11, color: Colors.primary, marginTop: -2 }}>{dayLabel}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.foreground }}>{dateLabel}</Text>
                        <Text style={{ fontSize: 13, color: Colors.mutedFg, marginTop: 2 }}>
                          {startT}{endT ? ` ~ ${endT}` : ''}
                        </Text>
                      </View>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: Colors.primary + '20', marginRight: 4 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.primary }}>예약됨</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* 날짜별 일정 변경 범위 선택 시트 */}
      <Modal visible={changeScopeSheet} transparent animationType="slide" onRequestClose={() => setChangeScopeSheet(false)}>
        <View style={styles.modalOverlayTP}>
          <View style={[styles.modalSheetTP, { paddingBottom: 40 }]}>
            <View style={styles.modalHeaderTP}>
              <View>
                <Text style={styles.modalTitleTP}>날짜별 일정으로 변경</Text>
                <Text style={{ fontSize: 13, color: Colors.mutedFg, marginTop: 2 }}>
                  예정 일정 {futureLessons.length}개가 있어요
                </Text>
              </View>
              <TouchableOpacity onPress={() => setChangeScopeSheet(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
              {/* 선택 1 */}
              <TouchableOpacity
                style={{ borderWidth: 2, borderColor: Colors.primary, borderRadius: 14, padding: 16, backgroundColor: Colors.primaryLight, opacity: changeScopeLoading ? 0.5 : 1 }}
                onPress={() => { setChangeScopeSheet(false); handleToByDate('forward'); }}
                disabled={changeScopeLoading}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: Colors.primary, marginBottom: 6 }}>
                  기존 예약은 그대로 두기
                </Text>
                <Text style={{ fontSize: 13, color: Colors.foreground, lineHeight: 19 }}>
                  이미 등록된 레슨은 유지하고, 다음에 추가하는 일정부터 새 방식으로 관리해요.
                </Text>
                <View style={{ marginTop: 12, alignSelf: 'flex-end', backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>새 방식 적용</Text>
                </View>
              </TouchableOpacity>

              {/* 선택 2 */}
              <TouchableOpacity
                style={{ borderWidth: 2, borderColor: Colors.border, borderRadius: 14, padding: 16, backgroundColor: '#fff', opacity: changeScopeLoading ? 0.5 : 1 }}
                onPress={() => {
                  const cnt = futureLessons.length;
                  const firstDate = futureLessons[0]?.date ?? '';
                  const lastDate = futureLessons[cnt - 1]?.date ?? '';
                  const rangeText = firstDate && lastDate ? `\n기간: ${firstDate} ~ ${lastDate}` : '';
                  Alert.alert(
                    '예정된 레슨 변경 확인',
                    `예정된 레슨 ${cnt}개가 취소됩니다.${rangeText}\n\n과거·완료 일정은 유지됩니다.\n\n계속하시겠어요?`,
                    [
                      { text: '취소', style: 'cancel' },
                      { text: '예정 레슨 변경', style: 'destructive', onPress: () => {
                        setChangeScopeSheet(false);
                        handleToByDate('also_future');
                      }},
                    ]
                  );
                }}
                disabled={changeScopeLoading}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: Colors.foreground, marginBottom: 6 }}>
                  예정된 레슨도 새 일정으로 변경
                </Text>
                <Text style={{ fontSize: 13, color: Colors.mutedFg, lineHeight: 19 }}>
                  아직 진행하지 않은 레슨 일정을 새로 선택한 날짜와 시간에 맞게 변경해요.
                </Text>
                <View style={{ marginTop: 12, alignSelf: 'flex-end', borderWidth: 1.5, borderColor: Colors.destructive, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
                  <Text style={{ color: Colors.destructive, fontWeight: '700', fontSize: 13 }}>예정 레슨 변경</Text>
                </View>
              </TouchableOpacity>
            </View>

            {changeScopeLoading && (
              <ActivityIndicator color={Colors.primary} style={{ padding: 16 }} />
            )}
          </View>
        </View>
      </Modal>

      {/* Plan Upsell 모달 */}
      <PlanUpsellModal
        visible={showProModal}
        onClose={() => setShowProModal(false)}
        context="tagging"
        currentPlanId={subscription?.plan_id ?? 'free'}
      />

      {/* 결제 수정 모달 */}
      <Modal visible={payEditModal} transparent animationType="slide" onRequestClose={() => { setPayEditModal(false); setPayEditTarget(null); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => { setPayEditModal(false); setPayEditTarget(null); }}>
            <TouchableOpacity style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Math.max(32, insets.bottom + 16) }} activeOpacity={1} onPress={() => {}}>
              <View style={{ width: 40, height: 4, backgroundColor: Colors.mutedBg, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />
              <Text style={{ fontSize: 18, fontWeight: '800', color: Colors.foreground, textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.mutedBg }}>결제 수정</Text>
              <ScrollView style={{ paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
                <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 14, marginBottom: 6 }}>내용</Text>
                <TextInput style={{ borderWidth: 1.5, borderColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.foreground, backgroundColor: Colors.mutedBg }} value={payEditDesc} onChangeText={setPayEditDesc} placeholder="레슨권명 등" placeholderTextColor={Colors.mutedFg} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 14, marginBottom: 6 }}>청구금액 (원)</Text>
                <TextInput style={{ borderWidth: 1.5, borderColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.foreground, backgroundColor: Colors.mutedBg }} value={payEditAmount} onChangeText={setPayEditAmount} keyboardType="numeric" placeholder="예: 150000" placeholderTextColor={Colors.mutedFg} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 14, marginBottom: 6 }}>납부 상태</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {(['미납', '부분납부', '납부완료'] as PaymentStatus[]).map(st => (
                    <TouchableOpacity key={st} style={[{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: payEditStatus === st ? Colors.primary : Colors.mutedBg }]} onPress={() => setPayEditStatus(st)}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: payEditStatus === st ? '#fff' : Colors.mutedFg }}>{st === '납부완료' ? '완납' : st === '부분납부' ? '부분납' : '미납'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {payEditStatus === '부분납부' && (
                  <>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 14, marginBottom: 6 }}>실납부금액 (원)</Text>
                    <TextInput style={{ borderWidth: 1.5, borderColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.foreground, backgroundColor: Colors.mutedBg }} value={payEditPaidAmount} onChangeText={setPayEditPaidAmount} keyboardType="numeric" placeholderTextColor={Colors.mutedFg} />
                  </>
                )}
                <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 14, marginBottom: 6 }}>납부 방법</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  {PAY_METHODS.map(m => (
                    <TouchableOpacity key={m} style={[{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, gap: 6 }, payEditMethod === m ? { backgroundColor: Colors.primary, borderColor: Colors.primary } : { backgroundColor: Colors.mutedBg, borderColor: Colors.mutedBg }]} onPress={() => setPayEditMethod(m)}>
                      <Ionicons name={PAY_METHOD_ICONS[m] as any} size={20} color={payEditMethod === m ? '#fff' : Colors.mutedFg} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: payEditMethod === m ? '#fff' : Colors.mutedFg }}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 14, marginBottom: 6 }}>납부기한 (YYYY-MM-DD)</Text>
                <TextInput style={{ borderWidth: 1.5, borderColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.foreground, backgroundColor: Colors.mutedBg }} value={payEditDueDate} onChangeText={setPayEditDueDate} placeholder="2026-06-30" placeholderTextColor={Colors.mutedFg} />
                {payEditStatus !== '미납' && (
                  <>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 14, marginBottom: 6 }}>납부일 (YYYY-MM-DD)</Text>
                    <TextInput style={{ borderWidth: 1.5, borderColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.foreground, backgroundColor: Colors.mutedBg }} value={payEditPaidDate} onChangeText={setPayEditPaidDate} placeholder="2026-06-15" placeholderTextColor={Colors.mutedFg} />
                  </>
                )}
                {(() => {
                  const amtOk = payEditAmount.trim() !== '' && !isNaN(parseInt(payEditAmount.trim(), 10));
                  const dtOk = /^\d{4}-\d{2}-\d{2}$/.test(payEditDueDate.trim()) && !isNaN(new Date(payEditDueDate.trim()).getTime());
                  const isValid = amtOk && dtOk;
                  return (
                    <TouchableOpacity style={{ margin: 16, marginTop: 20, marginBottom: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', opacity: (payEditSaving || !isValid) ? 0.4 : 1 }} onPress={savePayEdit} disabled={payEditSaving || !isValid}>
                      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{payEditSaving ? '저장 중...' : '수정 저장'}</Text>
                    </TouchableOpacity>
                  );
                })()}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* 결제 완료 모달 */}
      <Modal
        visible={payDoneModal}
        transparent
        animationType="fade"
        onRequestClose={() => setPayDoneModal(false)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 32,
        }}>
          <View style={{
            backgroundColor: '#fff',
            borderRadius: 20,
            padding: 28,
            width: '100%',
            alignItems: 'center',
          }}>
            {/* 체크 아이콘 */}
            <View style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: Colors.primary + '20',
              justifyContent: 'center', alignItems: 'center',
              marginBottom: 16,
            }}>
              <Ionicons name="checkmark-circle" size={40} color={Colors.primary} />
            </View>

            <Text style={{ fontSize: 18, fontWeight: '800', color: Colors.foreground, marginBottom: 6 }}>
              결제 완료
            </Text>
            {packageTitle ? (
              <Text style={{ fontSize: 14, color: Colors.mutedFg, marginBottom: 20, textAlign: 'center' }}>
                {packageTitle}
              </Text>
            ) : null}

            {/* 잔여 크레딧 변화 */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              backgroundColor: Colors.background, borderRadius: 12,
              paddingVertical: 16, paddingHorizontal: 20,
              width: '100%', justifyContent: 'center', marginBottom: 24,
            }}>
              {/* 이전 */}
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 26, fontWeight: '800', color: Colors.mutedFg }}>
                  {prevCredits ?? 0}
                </Text>
                <Text style={{ fontSize: 12, color: Colors.placeholder }}>이전 잔여</Text>
              </View>
              {/* 화살표 + 추가 */}
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Ionicons name="arrow-forward" size={18} color={Colors.mutedFg} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.primary }}>
                  +{addedCredits ?? 0}회
                </Text>
              </View>
              {/* 신규 */}
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 26, fontWeight: '800', color: Colors.foreground }}>
                  {newCredits ?? 0}
                </Text>
                <Text style={{ fontSize: 12, color: Colors.placeholder }}>현재 잔여</Text>
              </View>
            </View>

            <TouchableOpacity
              style={{
                backgroundColor: Colors.primary, borderRadius: 12,
                paddingVertical: 13, paddingHorizontal: 40,
              }}
              onPress={() => setPayDoneModal(false)}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function InfoRow({ icon, label, value, multiline = false }: { icon: string; label: string; value: string; multiline?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={16} color={Colors.mutedFg} style={{ marginRight: 10, marginTop: multiline ? 2 : 0 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, multiline && styles.infoValueMultiline]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileHeaderWrap: { backgroundColor: '#F7F0E9', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  profileCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 14,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#3E2B22', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  memberAvatar: { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  memberAvatarText: { fontSize: 22, fontWeight: '800' },
  profileName: { fontSize: 18, fontWeight: '800', color: '#3E2B22' },
  profilePhone: { fontSize: 13, color: '#8B7355', marginTop: 3 },
  profileMeta: { fontSize: 12, color: '#B39B83', marginTop: 2 },
  levelBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  levelText: { fontSize: 12, fontWeight: '700' },
  inactiveBadge: { backgroundColor: 'rgba(239,68,68,0.12)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  inactiveText: { color: Colors.destructive, fontSize: 12, fontWeight: '700' },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FBF2EF', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#EDE0D4' },
  aiBtnText: { color: '#C0755A', fontSize: 12, fontWeight: '700' },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabLabel: { fontSize: 14, color: Colors.mutedFg, fontWeight: '600' },
  tabLabelActive: { color: Colors.primary },
  content: { flex: 1, backgroundColor: '#F7F0E9' },
  card: { backgroundColor: '#fff', margin: 16, borderRadius: 18, padding: 16, shadowColor: '#3E2B22', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  actionBtnSection: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 4, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: 12 },
  cardSectionLabel: { fontSize: 13, fontWeight: '700', color: '#8B7355', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardSectionCaption: { fontSize: 12, color: Colors.mutedFg, marginTop: -4, marginBottom: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.mutedBg },
  infoLabel: { fontSize: 13, color: Colors.mutedFg, marginBottom: 2 },
  infoValue: { fontSize: 15, color: Colors.foreground, fontWeight: '500' },
  infoValueMultiline: { lineHeight: 21 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#C0755A', borderRadius: 12, paddingVertical: 11 },
  editBtnText: { color: '#C0755A', fontWeight: '700', fontSize: 14 },
  deactivateBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#8B7355', borderRadius: 12, paddingVertical: 11 },
  deactivateBtnText: { color: '#8B7355', fontWeight: '700', fontSize: 14 },
  deletePermBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: Colors.destructive, borderRadius: 12, paddingVertical: 11 },
  deletePermBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 10, paddingVertical: 11, marginBottom: 10 },
  inviteBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  reregisterBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: '#D97706', borderRadius: 10, paddingVertical: 11, marginBottom: 10, backgroundColor: '#FFFBEB' },
  reregisterBtnText: { color: '#D97706', fontWeight: '700', fontSize: 14 },
  trialBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#FDE68A' },
  trialBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trialBannerTitle: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  trialBannerSub: { fontSize: 14, color: '#B45309', marginTop: 1 },
  convertBtn: { backgroundColor: '#D97706', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  convertBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  editLabel: { fontSize: 14, color: Colors.mutedFg, fontWeight: '600', marginBottom: 4, marginTop: 8 },
  editInput: { backgroundColor: Colors.mutedBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, color: Colors.foreground, marginBottom: 4, borderWidth: 1, borderColor: Colors.border },
  levelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  levelBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.mutedBg },
  levelBtnActive: { backgroundColor: Colors.primary },
  levelBtnText: { fontSize: 13, color: Colors.mutedFg, fontWeight: '600' },
  levelBtnTextActive: { color: '#fff' },
  saveBtn: { flex: 1, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cancelBtn: { flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { color: Colors.mutedFg, fontWeight: '700', fontSize: 14 },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  dayBtn2: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.mutedBg, justifyContent: 'center', alignItems: 'center' },
  dayBtn2Active: { backgroundColor: Colors.primary },
  dayBtn2Text: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  dayBtn2TextActive: { color: '#fff' },
  attendanceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.mutedBg, gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  attendanceTitle: { fontSize: 14, color: Colors.foreground, fontWeight: '600' },
  attendanceDate: { fontSize: 14, color: Colors.mutedFg, marginTop: 2 },
  attendanceStatus: { fontSize: 13, fontWeight: '700' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.mutedBg },
  paymentDesc: { fontSize: 14, color: Colors.foreground, fontWeight: '600', marginBottom: 2 },
  paymentDate: { fontSize: 14, color: Colors.mutedFg },
  paymentAmount: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  paymentStatus: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  noteInputCard: { backgroundColor: '#fff', margin: 16, marginBottom: 0, borderRadius: 12, padding: 12 },
  noteInput: { backgroundColor: Colors.mutedBg, borderRadius: 8, padding: 10, fontSize: 14, color: Colors.foreground, minHeight: 70, marginBottom: 8 },
  noteAddBtn: { backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  noteAddBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  noteCard: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 8, borderRadius: 10, padding: 12 },
  noteContent: { fontSize: 14, color: Colors.foreground, lineHeight: 20, flex: 1 },

  // Timeline
  timelineContainer: { marginHorizontal: 16, marginTop: 8 },
  historyLabel: { fontSize: 14, color: Colors.mutedFg, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  timelineItem: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  timelineLine: { alignItems: 'center', width: 16 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary, marginTop: 18 },
  timelineBar: { width: 2, flex: 1, backgroundColor: Colors.primaryLight, marginTop: 2 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineDate: { fontSize: 13, color: Colors.mutedFg, fontWeight: '600', marginBottom: 6, marginTop: 14 },
  timelineTime: { color: Colors.placeholder, fontWeight: '400' },
  timelineCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  deleteNoteBtn: { padding: 2 },
  noteFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  noteDate: { fontSize: 13, color: Colors.placeholder },
  emptyCard: { margin: 16, padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 14, color: Colors.placeholder, textAlign: 'center' },
  packageBanner: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: Colors.background, borderRadius: 10, marginTop: 8, gap: 10 },
  packageDot: { width: 10, height: 10, borderRadius: 5 },
  packageTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  packageMeta: { fontSize: 14, color: Colors.mutedFg, marginTop: 2 },
  editPkgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  editPkgCard: { width: '47%', borderRadius: 10, borderWidth: 2, borderColor: Colors.border, padding: 10, position: 'relative', backgroundColor: '#fff' },
  editPkgCardNone: { borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  editPkgCardNoneSelected: { backgroundColor: Colors.mutedFg, borderColor: Colors.mutedFg },
  editPkgCheck: { position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.mutedFg, justifyContent: 'center', alignItems: 'center' },
  editPkgNoneText: { fontSize: 13, color: Colors.mutedFg, marginTop: 4, fontWeight: '600' },
  editPkgColorBar: { height: 3, borderRadius: 2, marginBottom: 6 },
  editPkgTitle: { fontSize: 13, fontWeight: '700', color: Colors.foreground, marginBottom: 2 },
  editPkgMeta: { fontSize: 13, color: Colors.mutedFg },
  editPkgPrice: { fontSize: 13, fontWeight: '800', marginTop: 4 },
  // per-day time rows
  dayTimeRow2: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.mutedBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border, gap: 10, marginBottom: 6 },
  dayTimeBadge2: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.border, justifyContent: 'center', alignItems: 'center' },
  dayTimeBadge2Set: { backgroundColor: Colors.primary },
  dayTimeBadge2Text: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg },
  // time picker modal styles
  modalOverlayTP: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheetTP: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeaderTP: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitleTP: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  spinnerRowTP: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 12 },
  spinnerColTP: { flex: 1, alignItems: 'center' },
  spinnerLabelTP: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  spinnerListTP: { height: 220 },
  spinnerItemTP: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginBottom: 2, alignItems: 'center' },
  spinnerItemTPSel: { backgroundColor: Colors.primary },
  spinnerItemTPText: { fontSize: 22, fontWeight: '600', color: Colors.mutedFg },
  spinnerItemTPTextSel: { color: '#fff', fontWeight: '800' },
  spinnerColonTP: { fontSize: 28, fontWeight: '800', color: Colors.foreground, paddingHorizontal: 8, paddingTop: 28 },
  confirmBtnTP: { margin: 16, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnTPDis: { backgroundColor: Colors.iconMuted },
  confirmBtnTPText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // 메시지 탭 배지
  unreadBadge: {
    position: 'absolute', top: -5, right: -7,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#C0755A',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 3,
  },
  unreadBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  // 일정 설정 행
  scheduleSectionRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.mutedBg,
    backgroundColor: '#FDF5F2', borderRadius: 10, paddingHorizontal: 12, marginTop: 8, minHeight: 64,
  },
  scheduleSectionIconWrap: { marginRight: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  scheduleSectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  scheduleSectionMain: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  scheduleSectionSub: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  scheduleSectionAction: { fontSize: 13, fontWeight: '700', color: Colors.primary, marginLeft: 8 },
  // 일정 바텀시트 아이템
  scheduleSheetItem: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.mutedBg, gap: 12,
  },
  scheduleSheetItemText: { flex: 1, fontSize: 16, fontWeight: '600', color: Colors.foreground },
});
