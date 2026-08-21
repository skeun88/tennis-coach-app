import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, ScrollView, FlatList, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors, Radius, Shadow } from '../../lib/theme';
import { useSubscription } from '../../hooks/useSubscription';
import { notifyMemberAbsent, notifyReregister, notifyLessonCountUpdate } from '../../lib/notifications';
import PlanUpsellModal from "../../components/PlanUpsellModal";
import CoachQRModal from '../../components/CoachQRModal';
import OnboardingModal from '../../components/OnboardingModal';

const ABSENCE_REASONS = ['개인사정', '부상', '일정충돌', '무단결석', '기타'] as const;
const DEDUCTION_TYPES = ['정상차감', '미차감', '보강예정'] as const;

interface Stats {
  totalMembers: number;
  todayLessons: number;
  unpaidMembers: number;   // 잔여횟수 0회
  expiringMembers: number; // 잔여횟수 2회 이하(1~2회)
}

interface TodayMemberCard {
  lessonId: string;
  lessonPackageName: string;
  startTime: string;
  memberId: string;
  memberName: string;
  memberLevel: string;
  remainingCredits: number;
  attended: boolean;
  isAbsent: boolean;
  deductCredit: boolean;
  absenceReason?: string | null;
  deductionType?: string | null;
  attendanceId?: string;
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<Stats>({
    totalMembers: 0, todayLessons: 0, unpaidMembers: 0, expiringMembers: 0,
  });
  const [todayCards, setTodayCards] = useState<TodayMemberCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAttendance, setLoadingAttendance] = useState<string | null>(null);
  const [coachEmail, setCoachEmail] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [autoGenSuggestion, setAutoGenSuggestion] = useState<{memberId: string; name: string; time: string}[]>([]);

  // 결석 모달
  const [absenceModal, setAbsenceModal] = useState(false);
  const [absenceCard, setAbsenceCard] = useState<TodayMemberCard | null>(null);
  const [selectedReason, setSelectedReason] = useState('');
  const [selectedDeduction, setSelectedDeduction] = useState('');
  const [savingAbsence, setSavingAbsence] = useState(false);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [homeUpsellVisible, setHomeUpsellVisible] = useState(false);
  const [showChatHint, setShowChatHint] = useState(false);
  const { canUse, subscription } = useSubscription();

  // today를 state로 관리: 자정이 지나면 자동 갱신
  const [today, setToday] = useState(() => new Date().toISOString().split('T')[0]);

  // 미납/만료 모달 상태
  const [unpaidModal, setUnpaidModal] = useState(false);
  const [expiringModal, setExpiringModal] = useState(false);
  const [unpaidMemberList, setUnpaidMemberList] = useState<{id:string;name:string;level:string;remaining_credits:number}[]>([]);
  const [expiringMemberList, setExpiringMemberList] = useState<{id:string;name:string;level:string;remaining_credits:number}[]>([]);

  // QR 모달
  const [qrModalVisible, setQrModalVisible] = useState(false);

  // 레슨권 등록 유도 모달
  const [noPackageModal, setNoPackageModal] = useState(false);

  // ④ 이탈 위험
  interface ChurnRiskMember { id: string; name: string; level: string; lastAttended: string | null; }
  const [churnRiskList, setChurnRiskList] = useState<ChurnRiskMember[]>([]);
  const [churnModal, setChurnModal] = useState(false);

  // ⑤ 재등록
  const [sendingNotif, setSendingNotif] = useState<string | null>(null);

  // ① 체험 회원
  const [trialCount, setTrialCount] = useState(0);
  const [trialModal, setTrialModal] = useState(false);
  interface TrialMember { id: string; name: string; trial_started_at: string | null; trial_lesson_count: number; }
  const [trialMembers, setTrialMembers] = useState<TrialMember[]>([]);

  // ③ 관심 회원 (member_interest)
  interface InterestMember { id: string; name: string | null; phone: string | null; package_title: string | null; created_at: string; packageId: string | null; }
  const [interestList, setInterestList] = useState<InterestMember[]>([]);
  const [interestModal, setInterestModal] = useState(false);

  async function loadAll(targetDate?: string) {
    const date = targetDate ?? today;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCoachEmail(user.email ?? '');
    setUserId(user.id);

    // 레슨권 없으면 모달 (최초 1회 — AsyncStorage로 dismissed 기록)
    const dismissed = await AsyncStorage.getItem(`no_package_modal_dismissed_${user.id}`);
    if (!dismissed) {
      const { count: pkgCount } = await supabase
        .from('lesson_packages')
        .select('id', { count: 'exact', head: true })
        .eq('coach_id', user.id);
      if ((pkgCount ?? 0) === 0) {
        setNoPackageModal(true);
      }
    }

    const [membersRes, lessonsRes] = await Promise.all([
      supabase.from('members').select('id, name, level, remaining_credits, is_active, is_trial').eq('coach_id', user.id),
      supabase.from('lessons').select('id').eq('coach_id', user.id).eq('date', date),
    ]);

    const members = membersRes.data ?? [];
    const activeMembers = members.filter((m: any) => m.is_active !== false);
    setStats({
      totalMembers: activeMembers.length,
      todayLessons: lessonsRes.data?.length ?? 0,
      unpaidMembers: activeMembers.filter((m: any) => (m.remaining_credits ?? 0) === 0 && !m.is_trial).length,
      expiringMembers: activeMembers.filter((m: any) => {
        const rc = m.remaining_credits ?? 0;
        return rc > 0 && rc <= 2 && !m.is_trial;
      }).length,
    });

    // ④ 이탈 위험
    await loadChurnRisk(user.id, activeMembers as any[]);

    // ① 체험 회원
    const trials = activeMembers.filter((m: any) => m.is_trial);
    setTrialCount(trials.length);
    setTrialMembers(trials.map((m: any) => ({
      id: m.id, name: m.name,
      trial_started_at: m.trial_started_at ?? null,
      trial_lesson_count: m.trial_lesson_count ?? 0,
    })));

    // ③ 관심 회원 (member_interest)
    const { data: interests } = await supabase
      .from('member_interest')
      .select('id, name, phone, package_id, created_at, lesson_packages(title)')
      .eq('coach_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setInterestList((interests ?? []).map((i: any) => ({
      id: i.id, name: i.name, phone: i.phone,
      package_title: i.lesson_packages?.title ?? null,
      packageId: i.package_id ?? null,
      created_at: i.created_at,
    })));

    await loadTodayCards(user.id, date);
    await checkAutoGenSchedule(user.id);
    // AI 코칭 모델 카운트
    const { count } = await supabase
      .from('tennis_knowledge')
      .select('id', { count: 'exact', head: true })
      .eq('coach_id', user.id);
    setKnowledgeCount(count ?? 0);
  }

  async function loadChurnRisk(coachId: string, activeMembers: { id: string; name: string; level: string; is_trial?: boolean }[]) {
    if (activeMembers.length === 0) { setChurnRiskList([]); return; }
    const threeWeeksAgo = new Date();
    threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
    const cutoff = threeWeeksAgo.toISOString().split('T')[0];

    // 각 회원의 마지막 출석 날짜를 동시에 가져오기 (join with lessons)
    const memberIds = activeMembers.filter(m => !m.is_trial).map(m => m.id);
    if (memberIds.length === 0) { setChurnRiskList([]); return; }

    const { data: recentAttendance } = await supabase
      .from('attendance')
      .select('member_id, lessons!inner(date)')
      .in('member_id', memberIds)
      .gte('lessons.date' as any, cutoff);

    const attendedRecently = new Set((recentAttendance ?? []).map((a: any) => a.member_id));
    const atRisk = activeMembers
      .filter(m => !m.is_trial && !attendedRecently.has(m.id))
      .map(m => ({ id: m.id, name: m.name, level: m.level, lastAttended: null }));

    // 마지막 출석일 데이터 쭄우기 (셀택)
    if (atRisk.length > 0) {
      const { data: lastAttData } = await supabase
        .from('attendance')
        .select('member_id, lessons!inner(date)')
        .in('member_id', atRisk.map(m => m.id));

      const lastAttMap: Record<string, string> = {};
      for (const row of lastAttData ?? []) {
        const mid = (row as any).member_id;
        const d = (row as any).lessons?.date ?? null;
        if (d && !lastAttMap[mid]) lastAttMap[mid] = d;
      }
      setChurnRiskList(atRisk.map(m => ({ ...m, lastAttended: lastAttMap[m.id] ?? null })));
    } else {
      setChurnRiskList([]);
    }
  }

  async function loadTodayCards(uid: string, targetDate?: string) {
    const date = targetDate ?? today;
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, title, start_time')
      .eq('coach_id', uid)
      .eq('date', date)
      .order('start_time');

    if (!lessons || lessons.length === 0) {
      setTodayCards([]);
      return;
    }

    const lessonIds = lessons.map(l => l.id);

    const { data: lessonMembers } = await supabase
      .from('lesson_members')
      .select('lesson_id, member_id, member:members(id, name, level, remaining_credits, lesson_package_id, lesson_packages(title))')
      .in('lesson_id', lessonIds);

    const { data: attendances } = await supabase
      .from('attendance')
      .select('id, lesson_id, member_id, status, deduct_credit, absence_reason, deduction_type')
      .in('lesson_id', lessonIds);

    const attendanceMap = new Map<string, {
      id: string; status: string; deduct_credit: boolean;
      absence_reason: string | null; deduction_type: string | null;
    }>();
    for (const a of attendances ?? []) {
      attendanceMap.set(`${a.lesson_id}:${a.member_id}`, {
        id: a.id, status: a.status, deduct_credit: a.deduct_credit,
        absence_reason: a.absence_reason, deduction_type: a.deduction_type,
      });
    }

    const cards: TodayMemberCard[] = [];
    for (const lm of lessonMembers ?? []) {
      const lesson = lessons.find(l => l.id === lm.lesson_id);
      const member = lm.member as any;
      if (!lesson || !member) continue;
      const key = `${lm.lesson_id}:${lm.member_id}`;
      const att = attendanceMap.get(key);
      const pkgName = member.lesson_packages?.title ?? null;
      cards.push({
        lessonId: lm.lesson_id,
        lessonPackageName: pkgName ?? lesson.title,
        startTime: lesson.start_time,
        memberId: lm.member_id,
        memberName: member.name,
        memberLevel: member.level,
        remainingCredits: member.remaining_credits ?? 0,
        attended: att?.status === '출석',
        isAbsent: att?.status === '결석',
        deductCredit: att?.deduct_credit ?? false,
        absenceReason: att?.absence_reason ?? null,
        deductionType: att?.deduction_type ?? null,
        attendanceId: att?.id,
      });
    }

    cards.sort((a, b) => {
      if (a.startTime < b.startTime) return -1;
      if (a.startTime > b.startTime) return 1;
      return a.memberName.localeCompare(b.memberName);
    });

    setTodayCards(cards);
  }

  async function checkAutoGenSchedule(uid: string) {
    const todayDayOfWeek = new Date().getDay();
    const { data: membersWithSchedule } = await supabase
      .from('members')
      .select('id, name, fixed_schedule_days, fixed_schedule_time, fixed_schedule_times')
      .eq('coach_id', uid)
      .eq('is_active', true)
      .not('fixed_schedule_days', 'is', null);
    if (!membersWithSchedule) return;
    const suggestions = membersWithSchedule
      .filter(m => m.fixed_schedule_days && m.fixed_schedule_days.includes(todayDayOfWeek))
      .map(m => {
        const fst = (m as any).fixed_schedule_times;
        const time = fst?.[String(todayDayOfWeek)] ?? (m.fixed_schedule_time as string | null)?.slice(0, 5) ?? null;
        if (!time) return null;
        return { memberId: m.id, name: m.name, time };
      })
      .filter(Boolean) as { memberId: string; name: string; time: string }[];
    setAutoGenSuggestion(suggestions);
  }

  async function handleAutoGenLessons() {
    if (!userId || autoGenSuggestion.length === 0) return;
    for (const s of autoGenSuggestion) {
      const { data: member } = await supabase
        .from('members')
        .select('fixed_schedule_time, fixed_lesson_duration')
        .eq('id', s.memberId)
        .single();
      if (!member) continue;
      const todayDow2 = new Date().getDay();
      const fst2 = (member as any).fixed_schedule_times;
      const startTime = fst2?.[String(todayDow2)] ?? (member.fixed_schedule_time as string | null)?.slice(0, 5);
      if (!startTime) continue;
      const durationMins = (member.fixed_lesson_duration as number) ?? 60;
      const [h, m] = startTime.split(':').map(Number);
      const endDate = new Date(2000, 0, 1, h, m + durationMins);
      const endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;

      const { data: existingLesson } = await supabase
        .from('lessons')
        .select('id')
        .eq('coach_id', userId)
        .eq('date', today)
        .eq('start_time', startTime + ':00')
        .maybeSingle();

      let lessonId: string;
      if (existingLesson) {
        lessonId = existingLesson.id;
      } else {
        const { data: lesson } = await supabase.from('lessons').insert({
          coach_id: userId,
          title: `${today} 레슨`,
          date: today,
          start_time: startTime,
          end_time: endTime,
        }).select().single();
        if (!lesson) continue;
        lessonId = lesson.id;
      }

      const { data: already } = await supabase
        .from('lesson_members')
        .select('id')
        .eq('lesson_id', lessonId)
        .eq('member_id', s.memberId)
        .maybeSingle();
      if (!already) {
        await supabase.from('lesson_members').insert({ lesson_id: lessonId, member_id: s.memberId });
      }
    }
    await loadAll();
  }

  async function loadUnpaidMembers() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('members')
      .select('id, name, level, remaining_credits')
      .eq('coach_id', user.id)
      .eq('is_active', true)
      .eq('remaining_credits', 0)
      .order('name');
    setUnpaidMemberList(data ?? []);
  }

  async function loadExpiringMembers() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('members')
      .select('id, name, level, remaining_credits')
      .eq('coach_id', user.id)
      .eq('is_active', true)
      .gt('remaining_credits', 0)
      .lte('remaining_credits', 2)
      .order('remaining_credits');
    setExpiringMemberList(data ?? []);
  }

  useFocusEffect(useCallback(() => { loadAll(); }, []));

  // 자정 다음날 자동 갱신 타이머
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    const timer = setTimeout(() => {
      const newDate = new Date().toISOString().split('T')[0];
      setToday(newDate);
      loadAll(newDate);
    }, msUntilMidnight);

    return () => clearTimeout(timer);
  }, [today]);

  useEffect(() => {
    AsyncStorage.getItem('chat_hint_dismissed').then(val => {
      if (!val) setShowChatHint(true);
    });
  }, []);

  function dismissChatHint() {
    setShowChatHint(false);
    AsyncStorage.setItem('chat_hint_dismissed', '1');
  }

  // Realtime: lessons/members 변경 시 홈 즉시 갱신 (새 회원 등록 등)
  useEffect(() => {
    let channel: any = null;
    let coachId: string | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      coachId = user.id;

      channel = supabase
        .channel('home_realtime_' + user.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lessons' }, (payload) => {
          const row = payload.new as any;
          if (row.coach_id !== coachId) return;
          loadAll();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'members' }, (payload) => {
          const row = payload.new as any;
          if (row.coach_id !== coachId) return;
          loadAll();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'members' }, (payload) => {
          const row = payload.new as any;
          if (row.coach_id !== coachId) return;
          loadAll();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payments' }, (payload) => {
          const row = payload.new as any;
          if (row.coach_id !== coachId) return;
          loadAll();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payments' }, (payload) => {
          const row = payload.new as any;
          if (row.coach_id !== coachId) return;
          loadAll();
        })
        .subscribe();
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);


  async function handleSignOut() {
    Alert.alert('로그아웃', '로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  // 출석 처리 (출석 버튼)
  async function handleAttend(card: TodayMemberCard) {
    if (!userId) return;
    const key = `${card.lessonId}:${card.memberId}`;
    setLoadingAttendance(key);
    try {
      if (card.attended) {
        // 출석 되돌리기
        if (card.attendanceId) {
          await supabase.from('attendance').delete().eq('id', card.attendanceId);
          // deduct_credit이 true였을 때만 +1 복구 (atomic RPC 사용 — stale read 방지)
          if (card.deductCredit) {
            await supabase.rpc('adjust_remaining_credits', { p_member_id: card.memberId, p_delta: 1 });
          }
          const { data: currMem } = await supabase.from('members').select('lesson_count').eq('id', card.memberId).maybeSingle();
          await supabase.from('members')
            .update({ lesson_count: Math.max(0, (currMem?.lesson_count ?? 0) - 1) })
            .eq('id', card.memberId);
        }
      } else {
        // 출석 처리 (결석→출석 or 미처리→출석)
        const wasDeducted = card.deductCredit;
        await supabase.from('attendance').upsert({
          lesson_id: card.lessonId,
          member_id: card.memberId,
          status: '출석',
          deduct_credit: true,
          absence_reason: null,
          deduction_type: null,
        }, { onConflict: 'lesson_id,member_id' });
        // 이전에 차감 안 됐을 때만 차감 (atomic RPC 사용 — stale read 방지)
        if (!wasDeducted) {
          await supabase.rpc('adjust_remaining_credits', { p_member_id: card.memberId, p_delta: -1 });
          if (card.remainingCredits === 0) {
            Alert.alert('잔여 레슨 횟수가 없습니다.', '이 회원의 레슨 횟수가 없습니다.\n충전이 필요합니다.');
          }

          // PN-11: 회원에게 레슨 횟수 안내
          const newRemaining = Math.max(0, card.remainingCredits - 1);
          notifyLessonCountUpdate(card.memberId, newRemaining).catch(() => {});

          // PN-04: 잔여 1회 시 코치에게 재등록 알림
          if (newRemaining === 1 && userId) {
            notifyReregister(userId, card.memberName, card.memberId).catch(() => {});
          }
        }
        // 멤버앱 출석 횟수 동기화 (lesson_count +1)
        const { data: mem } = await supabase.from('members').select('lesson_count').eq('id', card.memberId).maybeSingle();
        await supabase.from('members')
          .update({ lesson_count: (mem?.lesson_count ?? 0) + 1 })
          .eq('id', card.memberId);
      }
      await loadTodayCards(userId);
    } catch {
      Alert.alert('오류', '출석 처리 중 오류가 발생했습니다.');
    } finally {
      setLoadingAttendance(null);
    }
  }

  // 결석 버튼 클릭
  async function handleAbsenceBtn(card: TodayMemberCard) {
    if (card.isAbsent) {
      // 결석 되돌리기
      if (!userId || !card.attendanceId) return;
      const key = `${card.lessonId}:${card.memberId}`;
      setLoadingAttendance(key);
      try {
        await supabase.from('attendance').delete().eq('id', card.attendanceId);
        if (card.deductCredit) {
          await supabase.rpc('adjust_remaining_credits', { p_member_id: card.memberId, p_delta: 1 });
        }
        await loadTodayCards(userId);
      } finally {
        setLoadingAttendance(null);
      }
    } else {
      // 결석 모달 오픈
      setAbsenceCard(card);
      setSelectedReason('');
      setSelectedDeduction('');
      setAbsenceModal(true);
    }
  }

  async function handleAbsenceSave() {
    if (!userId || !absenceCard || !selectedReason || !selectedDeduction) return;
    const card = absenceCard;
    setSavingAbsence(true);
    const key = `${card.lessonId}:${card.memberId}`;
    setLoadingAttendance(key);
    try {
      const willDeduct = selectedDeduction === '정상차감';
      const wasDeducted = card.deductCredit;

      await supabase.from('attendance').upsert({
        lesson_id: card.lessonId,
        member_id: card.memberId,
        status: '결석',
        deduct_credit: willDeduct,
        absence_reason: selectedReason,
        deduction_type: selectedDeduction,
      }, { onConflict: 'lesson_id,member_id' });

      // 크레딧 조정 (atomic RPC — stale read 방지)
      if (willDeduct && !wasDeducted) {
        await supabase.rpc('adjust_remaining_credits', { p_member_id: card.memberId, p_delta: -1 });
      } else if (!willDeduct && wasDeducted) {
        await supabase.rpc('adjust_remaining_credits', { p_member_id: card.memberId, p_delta: 1 });
      }

      // PN-13: 결석 알림
      try { await notifyMemberAbsent(card.memberId); } catch (e) { console.error('[PUSH] 결석 알림 실패:', e); }
      setAbsenceModal(false);
      setAbsenceCard(null);
      setSelectedReason('');
      setSelectedDeduction('');
      await loadTodayCards(userId);
    } catch {
      Alert.alert('오류', '처리 중 오류가 발생했습니다.');
    } finally {
      setSavingAbsence(false);
      setLoadingAttendance(null);
    }
  }

  const LEVEL_COLOR: Record<string, string> = Colors.level;

  return (
    <View style={styles.screenWrapper}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadAll(); setRefreshing(false); }}
            tintColor="#C0755A"
          />
        }
      >
        {/* ── 헤더 ── */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View>
            <Text style={styles.headerDate}>
              {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
            </Text>
            <Text style={styles.headerGreeting}>
              안녕하세요, {coachEmail ? coachEmail.split('@')[0] : '코치'}님 👋
            </Text>
          </View>
          <View style={styles.headerIcons}>
            {userId ? (
              <TouchableOpacity onPress={() => setQrModalVisible(true)} style={styles.iconBtn}>
                <Ionicons name="qr-code-outline" size={22} color="#3E2B22" />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => router.push('/settings/notifications')} style={styles.iconBtn}>
              <Ionicons name="notifications-outline" size={22} color="#3E2B22" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 섹션1: 오늘 레슨 배너 ── */}
        <TouchableOpacity
          style={styles.todayBannerCard}
          onPress={() => router.push('/(tabs)/schedule')}
          activeOpacity={0.85}
        >
          <View style={styles.todayBannerLeft}>
            <Text style={styles.todayBannerLabel}>오늘 레슨</Text>
            <Text style={styles.todayBannerCount}>{stats.todayLessons}회</Text>
            {todayCards.length > 0 && (
              <Text style={styles.todayBannerFirst}>
                첫 레슨 {todayCards[0].startTime.slice(0, 5)} · {todayCards[0].memberName}
              </Text>
            )}
          </View>
          <View style={styles.todayBannerRight}>
            <Ionicons name="tennisball-outline" size={52} color="rgba(255,255,255,0.25)" />
          </View>
        </TouchableOpacity>

        {/* ── 섹션2: 3개 스탯 카드 ── */}
        <View style={styles.statsRow3}>
          <TouchableOpacity style={styles.stat3Card} onPress={() => router.push('/(tabs)/members')} activeOpacity={0.85}>
            <Text style={styles.stat3Value}>{stats.totalMembers}</Text>
            <Text style={styles.stat3Label}>전체 회원</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.stat3Card, stats.unpaidMembers > 0 && styles.stat3CardAlert]}
            activeOpacity={0.85}
            onPress={() => { loadUnpaidMembers(); setUnpaidModal(true); }}
          >
            <Text style={[styles.stat3Value, stats.unpaidMembers > 0 && { color: '#D9534F' }]}>
              {stats.unpaidMembers}
            </Text>
            <Text style={[styles.stat3Label, stats.unpaidMembers > 0 && { color: '#D9534F' }]}>미납</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.stat3Card, stats.expiringMembers > 0 && styles.stat3CardWarn]}
            activeOpacity={0.85}
            onPress={() => { loadExpiringMembers(); setExpiringModal(true); }}
          >
            <Text style={[styles.stat3Value, stats.expiringMembers > 0 && { color: '#D97706' }]}>
              {stats.expiringMembers}
            </Text>
            <Text style={[styles.stat3Label, stats.expiringMembers > 0 && { color: '#D97706' }]}>만료예정</Text>
          </TouchableOpacity>
        </View>

        {/* ── 섹션3: 알림 카드들 ── */}
        {interestList.length > 0 && (
          <TouchableOpacity style={styles.alertCard} onPress={() => setInterestModal(true)} activeOpacity={0.85}>
            <View style={[styles.alertIconWrap, { backgroundColor: '#EDE0D4' }]}>
              <Ionicons name="person-add" size={18} color="#C0755A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>관심 회원 {interestList.length}명</Text>
              <Text style={styles.alertSub}>QR 스캔 후 레슨권 선택한 회원</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#8B7355" />
          </TouchableOpacity>
        )}
        {churnRiskList.length > 0 && (
          <TouchableOpacity style={styles.alertCard} onPress={() => setChurnModal(true)} activeOpacity={0.85}>
            <View style={[styles.alertIconWrap, { backgroundColor: '#FEE2E2' }]}>
              <Ionicons name="warning" size={18} color="#D9534F" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>이탈 위험 {churnRiskList.length}명</Text>
              <Text style={styles.alertSub}>3주 이상 레슨 기록 없음</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#8B7355" />
          </TouchableOpacity>
        )}
        {trialCount > 0 && (
          <TouchableOpacity style={styles.alertCard} onPress={() => setTrialModal(true)} activeOpacity={0.85}>
            <View style={[styles.alertIconWrap, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="star-half" size={18} color="#D97706" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>체험 중 {trialCount}명</Text>
              <Text style={styles.alertSub}>정규 전환 안내 확인</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#8B7355" />
          </TouchableOpacity>
        )}

        {/* ── 섹션4: AI 코칭 모델 ── */}
        <TouchableOpacity
          style={styles.aiCard}
          activeOpacity={0.85}
          onPress={() => {
            if (!canUse('ai_analysis')) {
              setHomeUpsellVisible(true);
            } else {
              router.push('/(tabs)/profile');
            }
          }}
        >
          <View style={styles.aiCardLeft}>
            <View style={styles.aiIconWrap}>
              <Ionicons name="bulb" size={20} color="#C0755A" />
            </View>
            <View>
              <Text style={styles.aiCardTitle}>내 AI 코칭 모델</Text>
              <Text style={styles.aiCardDesc}>코칭 스타일 {knowledgeCount}개 등록됨</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {!canUse('ai_analysis') && (
              <View style={styles.proBadge}><Text style={styles.proBadgeText}>PRO</Text></View>
            )}
            <Ionicons name="chevron-forward" size={18} color="#8B7355" />
          </View>
        </TouchableOpacity>

        {/* ── 섹션5: 오늘 레슨 상세 ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>오늘 레슨 상세</Text>
          <TouchableOpacity onPress={() => router.push('/lessons/new')}>
            <Ionicons name="add-circle-outline" size={22} color="#C0755A" />
          </TouchableOpacity>
        </View>

        {todayCards.length === 0 && autoGenSuggestion.length > 0 && (
          <View style={styles.autoGenBanner}>
            <View style={styles.autoGenHeader}>
              <Ionicons name="flash" size={18} color="#C0755A" />
              <Text style={styles.autoGenTitle}>오늘 고정 스케줄 회원이 있어요</Text>
            </View>
            {autoGenSuggestion.map(s => (
              <View key={s.memberId} style={styles.autoGenItem}>
                <Text style={styles.autoGenTime}>{s.time}</Text>
                <Text style={styles.autoGenName}>{s.name}</Text>
              </View>
            ))}
            <TouchableOpacity style={styles.autoGenBtn} onPress={handleAutoGenLessons}>
              <Text style={styles.autoGenBtnText}>레슨 자동 생성</Text>
            </TouchableOpacity>
          </View>
        )}

        {todayCards.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={40} color="#C4B49E" />
            <Text style={styles.emptyText}>오늘 예정된 레슨이 없습니다</Text>
            <TouchableOpacity style={styles.addLessonBtn} onPress={() => router.push('/lessons/new')}>
              <Text style={styles.addLessonBtnText}>레슨 추가하기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.lessonCardsList}>
            {todayCards.map(card => {
              const cardKey = `${card.lessonId}:${card.memberId}`;
              const isLoading = loadingAttendance === cardKey;

              return (
                <TouchableOpacity
                  key={cardKey}
                  style={[
                    styles.lessonCard,
                    card.attended && styles.lessonCardAttended,
                    card.isAbsent && styles.lessonCardAbsent,
                  ]}
                  onPress={() => router.push(`/members/${card.memberId}`)}
                  activeOpacity={0.85}
                >
                  <View style={styles.lessonTimeBadge}>
                    <Text style={styles.lessonTimeText}>{card.startTime.slice(0, 5)}</Text>
                  </View>

                  <View style={styles.lessonInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <Text style={styles.lessonMemberName}>{card.memberName}</Text>
                      <View style={[styles.levelBadge, { backgroundColor: `${LEVEL_COLOR[card.memberLevel] ?? '#8B7355'}22` }]}>
                        <Text style={[styles.levelText, { color: LEVEL_COLOR[card.memberLevel] ?? '#8B7355' }]}>
                          {card.memberLevel}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.lessonPackageName} numberOfLines={1}>{card.lessonPackageName}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="layers-outline" size={12} color={card.remainingCredits <= 1 ? '#D9534F' : '#8B7355'} />
                      <Text style={[styles.creditsText, { color: card.remainingCredits <= 1 ? '#D9534F' : '#8B7355' }]}>
                        잔여 {card.remainingCredits}회
                      </Text>
                      {card.isAbsent && card.deductionType && (
                        <View style={styles.deductionBadge}>
                          <Text style={styles.deductionBadgeText}>{card.deductionType}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {isLoading ? (
                    <ActivityIndicator size="small" color="#C0755A" style={{ marginLeft: 8 }} />
                  ) : (
                    <View style={styles.attendBtns}>
                      <TouchableOpacity
                        style={[styles.attendBtn, card.attended && styles.attendBtnActive]}
                        onPress={() => handleAttend(card)}
                      >
                        <Ionicons
                          name={card.attended ? 'checkmark-circle' : 'checkmark-circle-outline'}
                          size={28}
                          color={card.attended ? '#fff' : '#C0755A'}
                        />
                        <Text style={[styles.attendBtnLabel, card.attended && { color: '#fff' }]}>출석</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.absentBtn, card.isAbsent && styles.absentBtnActive]}
                        onPress={() => handleAbsenceBtn(card)}
                      >
                        <Ionicons
                          name={card.isAbsent ? 'close-circle' : 'close-circle-outline'}
                          size={28}
                          color={card.isAbsent ? '#fff' : '#D9534F'}
                        />
                        <Text style={[styles.absentBtnLabel, card.isAbsent && { color: '#fff' }]}>결석</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <PlanUpsellModal
          visible={homeUpsellVisible}
          onClose={() => setHomeUpsellVisible(false)}
          context="ai_coaching_model"
          currentPlanId={subscription?.plan_id ?? 'free'}
        />
        <OnboardingModal
          visible={noPackageModal}
          onRegister={() => { setNoPackageModal(false); router.push('/lesson-packages/new'); }}
          onDismiss={async () => {
            setNoPackageModal(false);
            if (userId) await AsyncStorage.setItem(`no_package_modal_dismissed_${userId}`, '1');
          }}
        />
        {userId ? (
          <CoachQRModal
            visible={qrModalVisible}
            onClose={() => setQrModalVisible(false)}
            coachId={userId}
            coachName={coachEmail.split('@')[0]}
          />
        ) : null}

        {/* 이탈 위험 모달 */}
        <Modal visible={churnModal} transparent animationType="slide" onRequestClose={() => setChurnModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { paddingBottom: Math.max(40, insets.bottom + 20) }]}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>최근 레슨이 없는 회원</Text>
                  <Text style={{ fontSize: 14, color: '#8B7355', marginTop: 2 }}>3주 이상 레슨 기록 없음</Text>
                </View>
                <TouchableOpacity onPress={() => setChurnModal(false)}>
                  <Ionicons name="close" size={22} color="#8B7355" />
                </TouchableOpacity>
              </View>
              {churnRiskList.length === 0 ? (
                <Text style={{ fontSize: 14, color: '#C4B49E', padding: 20, textAlign: 'center' }}>해당 회원이 없어요 🎉</Text>
              ) : (
                <FlatList
                  data={churnRiskList}
                  keyExtractor={item => item.id}
                  style={{ maxHeight: 400 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.modalMemberRow}
                      onPress={() => { setChurnModal(false); router.push(`/members/${item.id}`); }}
                    >
                      <View style={styles.modalMemberAvatar}>
                        <Text style={styles.modalMemberAvatarText}>{item.name.slice(0, 1)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.modalMemberName}>{item.name}</Text>
                        <Text style={styles.modalMemberSub}>
                          {item.lastAttended ? `마지막 출석: ${item.lastAttended}` : '출석 기록 없음'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#8B7355" />
                    </TouchableOpacity>
                  )}
                />
              )}
            </View>
          </View>
        </Modal>

        {/* 체험 회원 모달 */}
        <Modal visible={trialModal} transparent animationType="slide" onRequestClose={() => setTrialModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { paddingBottom: Math.max(40, insets.bottom + 20) }]}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>체험 중 회원</Text>
                  <Text style={{ fontSize: 14, color: '#8B7355', marginTop: 2 }}>정규 전환 후보 회원</Text>
                </View>
                <TouchableOpacity onPress={() => setTrialModal(false)}>
                  <Ionicons name="close" size={22} color="#8B7355" />
                </TouchableOpacity>
              </View>
              <FlatList
                data={trialMembers}
                keyExtractor={item => item.id}
                style={{ maxHeight: 400 }}
                ListEmptyComponent={<Text style={{ fontSize: 14, color: '#C4B49E', padding: 20, textAlign: 'center' }}>체험 회원이 없어요</Text>}
                renderItem={({ item }) => {
                  const daysSince = item.trial_started_at
                    ? Math.floor((Date.now() - new Date(item.trial_started_at).getTime()) / 86400000)
                    : null;
                  return (
                    <TouchableOpacity
                      style={styles.modalMemberRow}
                      onPress={() => { setTrialModal(false); router.push(`/members/${item.id}`); }}
                    >
                      <View style={[styles.modalMemberAvatar, { backgroundColor: '#D97706' }]}>
                        <Text style={styles.modalMemberAvatarText}>{item.name.slice(0, 1)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.modalMemberName}>{item.name}</Text>
                        <Text style={styles.modalMemberSub}>
                          {daysSince !== null ? `D+${daysSince}일` : '체험 중'} · {item.trial_lesson_count}회 진행
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#8B7355" />
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          </View>
        </Modal>

        {/* 관심 회원 모달 */}
        <Modal visible={interestModal} transparent animationType="slide" onRequestClose={() => setInterestModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { paddingBottom: Math.max(40, insets.bottom + 20) }]}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>관심 회원</Text>
                  <Text style={{ fontSize: 14, color: '#8B7355', marginTop: 2 }}>QR 스캔 후 레슨권 선택한 회원</Text>
                </View>
                <TouchableOpacity onPress={() => setInterestModal(false)}>
                  <Ionicons name="close" size={22} color="#8B7355" />
                </TouchableOpacity>
              </View>
              <FlatList
                data={interestList}
                keyExtractor={item => item.id}
                style={{ maxHeight: 440 }}
                ListEmptyComponent={<Text style={{ fontSize: 14, color: '#C4B49E', padding: 20, textAlign: 'center' }}>관심 회원이 없어요</Text>}
                renderItem={({ item }) => (
                  <View style={styles.modalMemberRow}>
                    <View style={[styles.modalMemberAvatar, { backgroundColor: '#C0755A' }]}>
                      <Ionicons name="person" size={16} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalMemberName}>{item.name ?? '이름 미입력'}</Text>
                      <Text style={styles.modalMemberSub}>{item.package_title ?? '레슨권 미선택'}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        style={styles.interestRegBtn}
                        onPress={() => {
                          setInterestModal(false);
                          router.push({ pathname: '/members/new', params: { fromInterestId: item.id, packageId: item.packageId ?? '' } } as any);
                        }}
                      >
                        <Text style={styles.interestRegBtnText}>등록</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.interestDismissBtn}
                        onPress={async () => {
                          await supabase.from('member_interest').update({ status: 'dismissed' }).eq('id', item.id);
                          setInterestList(prev => prev.filter(i => i.id !== item.id));
                        }}
                      >
                        <Text style={styles.interestDismissBtnText}>무시</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            </View>
          </View>
        </Modal>
      </ScrollView>

      {/* FAB */}
      {showChatHint && (
        <View style={[styles.chatHintBubble, { bottom: insets.bottom + 92 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.chatHintText}>앱 사용법 외에도 드릴·테니스 이론 등</Text>
            <Text style={styles.chatHintText}>무엇이든 물어보세요</Text>
          </View>
          <TouchableOpacity onPress={dismissChatHint} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={16} color="#C0755A" />
          </TouchableOpacity>
        </View>
      )}
      <TouchableOpacity style={[styles.chatFab, { bottom: insets.bottom + 24 }]} onPress={() => { dismissChatHint(); router.push('/(tabs)/chat'); }}>
        <Ionicons name="chatbubble-ellipses" size={24} color="#fff" />
      </TouchableOpacity>

      {/* 미납 회원 모달 */}
      <Modal visible={unpaidModal} transparent animationType="slide" onRequestClose={() => setUnpaidModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>미납 회원</Text>
                <Text style={{ fontSize: 14, color: '#8B7355', marginTop: 2 }}>잔여 0회 회원</Text>
              </View>
              <TouchableOpacity onPress={() => setUnpaidModal(false)}>
                <Ionicons name="close" size={22} color="#8B7355" />
              </TouchableOpacity>
            </View>
            {unpaidMemberList.length === 0 ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <Ionicons name="checkmark-circle-outline" size={40} color="#C0755A" />
                <Text style={{ fontSize: 14, color: '#C4B49E', marginTop: 12 }}>미납 회원이 없어요 🎉</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 400 }}>
                {unpaidMemberList.map(m => (
                  <TouchableOpacity
                    key={m.id}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EDE0D4', gap: 12 }}
                    onPress={() => { setUnpaidModal(false); router.push(`/members/${m.id}`); }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDE0D4', justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: '#3E2B22' }}>{m.name.slice(0,1)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#3E2B22' }}>{m.name}</Text>
                      <Text style={{ fontSize: 14, color: '#8B7355', marginTop: 2 }}>{m.level} · 잔여 {m.remaining_credits}회</Text>
                    </View>
                    <View style={{ backgroundColor: '#EDE0D4', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#3E2B22' }}>0회</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={{ margin: 16, backgroundColor: '#C0755A', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }} onPress={() => setUnpaidModal(false)}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 만료 예정 회원 모달 */}
      <Modal visible={expiringModal} transparent animationType="slide" onRequestClose={() => setExpiringModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>만료 예정 회원</Text>
                <Text style={{ fontSize: 14, color: '#8B7355', marginTop: 2 }}>잔여 1~2회 회원</Text>
              </View>
              <TouchableOpacity onPress={() => setExpiringModal(false)}>
                <Ionicons name="close" size={22} color="#8B7355" />
              </TouchableOpacity>
            </View>
            {expiringMemberList.length === 0 ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <Ionicons name="checkmark-circle-outline" size={40} color="#C0755A" />
                <Text style={{ fontSize: 14, color: '#C4B49E', marginTop: 12 }}>만료 예정 회원이 없어요 🎉</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 400 }}>
                {expiringMemberList.map(m => (
                  <TouchableOpacity
                    key={m.id}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EDE0D4', gap: 12 }}
                    onPress={() => { setExpiringModal(false); router.push(`/members/${m.id}`); }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDE0D4', justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: '#3E2B22' }}>{m.name.slice(0,1)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#3E2B22' }}>{m.name}</Text>
                      <Text style={{ fontSize: 14, color: '#8B7355', marginTop: 2 }}>{m.level}</Text>
                    </View>
                    <View style={{ backgroundColor: '#EDE0D4', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#3E2B22' }}>잔여 {m.remaining_credits}회</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={{ margin: 16, backgroundColor: '#C0755A', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }} onPress={() => setExpiringModal(false)}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 결석 바텀시트 */}
      <Modal visible={absenceModal} transparent animationType="slide" onRequestClose={() => setAbsenceModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>결석 처리</Text>
              <TouchableOpacity onPress={() => setAbsenceModal(false)}>
                <Ionicons name="close" size={22} color="#8B7355" />
              </TouchableOpacity>
            </View>
            {absenceCard && (
              <View style={styles.modalMemberInfo}>
                <Ionicons name="person-circle-outline" size={20} color="#C0755A" />
                <Text style={styles.modalMemberName}>{absenceCard.memberName}</Text>
                <Text style={styles.modalMemberSub}>{absenceCard.startTime.slice(0, 5)} · {absenceCard.lessonPackageName}</Text>
              </View>
            )}
            <Text style={styles.modalSectionLabel}>결석 사유</Text>
            <View style={styles.optionGrid}>
              {ABSENCE_REASONS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.optionChip, selectedReason === r && styles.optionChipActive]}
                  onPress={() => setSelectedReason(r)}
                >
                  <Text style={[styles.optionChipText, selectedReason === r && styles.optionChipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.modalSectionLabel}>처리 방식</Text>
            <View style={styles.deductionRow}>
              {DEDUCTION_TYPES.map(d => {
                const color = d === '정상차감' ? '#D9534F' : d === '보강예정' ? '#3B82F6' : '#22C55E';
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.deductionChip, selectedDeduction === d && { backgroundColor: color, borderColor: color }]}
                    onPress={() => setSelectedDeduction(d)}
                  >
                    <Text style={[styles.deductionChipText, selectedDeduction === d && { color: '#fff' }]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedDeduction === '정상차감' && (
              <Text style={styles.deductionHint}>잔여 횟수 1회 차감됩니다</Text>
            )}
            {(selectedDeduction === '미차감' || selectedDeduction === '보강예정') && (
              <Text style={[styles.deductionHint, { color: '#3B82F6' }]}>잔여 횟수 차감 없이 결석 처리됩니다</Text>
            )}
            <TouchableOpacity
              style={[styles.saveBtn, (!selectedReason || !selectedDeduction || savingAbsence) && styles.saveBtnDis]}
              onPress={handleAbsenceSave}
              disabled={!selectedReason || !selectedDeduction || savingAbsence}
            >
              {savingAbsence
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveBtnText}>저장</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: { flex: 1, backgroundColor: '#F7F0E9' },
  container: { flex: 1, backgroundColor: '#F7F0E9' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingBottom: 20, backgroundColor: '#F7F0E9',
  },
  headerDate: { fontSize: 15, color: '#8B7355', fontWeight: '500', marginBottom: 6 },
  headerGreeting: { fontSize: 26, fontWeight: '700', color: '#3E2B22' },
  headerIcons: { flexDirection: 'row', gap: 8, marginTop: 6 },
  iconBtn: { padding: 8, borderRadius: 20, backgroundColor: 'rgba(62,43,34,0.08)' },

  todayBannerCard: {
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: '#C0755A', borderRadius: 20,
    padding: 20, flexDirection: 'row', alignItems: 'center',
    overflow: 'hidden',
  },
  todayBannerLeft: { flex: 1 },
  todayBannerLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '600', marginBottom: 4 },
  todayBannerCount: { fontSize: 40, fontWeight: '800', color: '#fff', marginBottom: 6 },
  todayBannerFirst: { fontSize: 14, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  todayBannerRight: { marginLeft: 12 },

  statsRow3: { flexDirection: 'row', marginHorizontal: 16, gap: 8, marginBottom: 14 },
  stat3Card: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16,
    padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  stat3CardAlert: { borderColor: '#FCA5A5', backgroundColor: '#FFF5F5' },
  stat3CardWarn: { borderColor: '#FCD34D', backgroundColor: '#FFFBF0' },
  stat3Value: { fontSize: 26, fontWeight: '800', color: '#3E2B22', marginBottom: 4 },
  stat3Label: { fontSize: 12, color: '#8B7355', fontWeight: '500' },

  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#fff', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  alertIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { fontSize: 14, fontWeight: '700', color: '#3E2B22' },
  alertSub: { fontSize: 12, color: '#8B7355', marginTop: 2 },

  aiCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FBF2EF', borderRadius: 16,
    padding: 14, marginHorizontal: 16, marginTop: 6, marginBottom: 22,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  aiCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  aiIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDE0D4', alignItems: 'center', justifyContent: 'center' },
  aiCardTitle: { fontSize: 14, fontWeight: '700', color: '#3E2B22' },
  aiCardDesc: { fontSize: 13, color: '#8B7355', marginTop: 2 },
  proBadge: { backgroundColor: '#3E2B22', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  proBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#3E2B22' },

  lessonCardsList: { paddingHorizontal: 16, marginBottom: 16 },
  lessonCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  lessonCardAttended: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  lessonCardAbsent: { backgroundColor: '#fff1f2', borderColor: '#fecdd3' },
  lessonTimeBadge: { marginRight: 12, minWidth: 52, justifyContent: 'center' },
  lessonTimeText: { fontSize: 15, fontWeight: '700', color: '#3E2B22' },
  lessonInfo: { flex: 1 },
  lessonMemberName: { fontSize: 15, fontWeight: '700', color: '#3E2B22' },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  levelText: { fontSize: 11, fontWeight: '600' },
  lessonPackageName: { fontSize: 13, color: '#8B7355', marginBottom: 4 },
  creditsText: { fontSize: 13, fontWeight: '500' },
  deductionBadge: { backgroundColor: '#fee2e2', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  deductionBadgeText: { fontSize: 12, color: '#D9534F', fontWeight: '700' },

  attendBtns: { flexDirection: 'row', gap: 6, marginLeft: 10 },
  attendBtn: {
    width: 52, minHeight: 48, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#C0755A',
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent',
  },
  attendBtnActive: { backgroundColor: '#C0755A', borderColor: '#C0755A' },
  attendBtnLabel: { fontSize: 11, fontWeight: '700', color: '#C0755A' },
  absentBtn: {
    width: 52, minHeight: 48, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#EF4444',
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent',
  },
  absentBtnActive: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  absentBtnLabel: { fontSize: 11, fontWeight: '700', color: '#D9534F' },

  emptyCard: {
    alignItems: 'center', backgroundColor: '#fff', borderRadius: 18,
    marginHorizontal: 16, padding: 40, marginBottom: 16,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  emptyText: { fontSize: 14, color: '#8B7355', fontWeight: '500', marginTop: 12, marginBottom: 16 },
  addLessonBtn: {
    backgroundColor: '#C0755A', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
  },
  addLessonBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  autoGenBanner: {
    backgroundColor: '#FBF2EF', borderRadius: 16,
    marginHorizontal: 16, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  autoGenHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  autoGenTitle: { fontSize: 15, fontWeight: '700', color: '#3E2B22' },
  autoGenItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  autoGenTime: { fontSize: 14, fontWeight: '700', color: '#3E2B22', minWidth: 44 },
  autoGenName: { fontSize: 14, color: '#3E2B22', fontWeight: '500' },
  autoGenBtn: { marginTop: 10, backgroundColor: '#C0755A', borderRadius: 10, padding: 10, alignItems: 'center' },
  autoGenBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  chatHintBubble: {
    position: 'absolute', right: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    maxWidth: 260, borderWidth: 1, borderColor: '#EDE0D4',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  chatHintText: { fontSize: 13, color: '#8B7355', lineHeight: 20 },
  chatFab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#C0755A', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#EDE0D4',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#3E2B22' },
  modalMemberInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: '#F7F0E9', marginHorizontal: 16, borderRadius: 12, marginTop: 12,
  },
  modalMemberName: { fontSize: 15, fontWeight: '700', color: '#3E2B22' },
  modalMemberSub: { fontSize: 13, color: '#8B7355', marginLeft: 2 },
  modalSectionLabel: { fontSize: 13, fontWeight: '700', color: '#8B7355', marginTop: 16, marginBottom: 8, marginHorizontal: 20 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 20 },
  optionChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#F7F0E9', borderWidth: 1.5, borderColor: '#EDE0D4',
  },
  optionChipActive: { backgroundColor: '#3E2B22', borderColor: '#3E2B22' },
  optionChipText: { fontSize: 13, fontWeight: '600', color: '#8B7355' },
  optionChipTextActive: { color: '#fff' },
  deductionRow: { flexDirection: 'row', gap: 8, marginHorizontal: 20 },
  deductionChip: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#F7F0E9', borderWidth: 1.5, borderColor: '#EDE0D4',
  },
  deductionChipText: { fontSize: 13, fontWeight: '700', color: '#8B7355' },
  deductionHint: { fontSize: 13, color: '#D9534F', marginHorizontal: 20, marginTop: 8, fontWeight: '500' },
  saveBtn: {
    margin: 16, marginTop: 20, backgroundColor: '#C0755A',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  saveBtnDis: { backgroundColor: '#C4B49E' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  modalMemberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#EDE0D4',
  },
  modalMemberAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#C0755A', alignItems: 'center', justifyContent: 'center',
  },
  modalMemberAvatarText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  interestRegBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#C0755A' },
  interestRegBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  interestDismissBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F7F0E9', borderWidth: 1, borderColor: '#EDE0D4' },
  interestDismissBtnText: { fontSize: 13, fontWeight: '600', color: '#8B7355' },
});
