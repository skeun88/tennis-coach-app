import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList,
  RefreshControl, Alert, Modal, TextInput, ActivityIndicator,
  PanResponder, Animated, Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import * as Notifications from 'expo-notifications';
import { Lesson } from '../../types';
import { Colors, Radius } from '../../lib/theme';

type ViewTab = '일일' | '주간' | '월간';

interface LessonWithMembers extends Lesson {
  memberNames: string[];
  memberIds: string[];
}
interface WeekLesson {
  date: string;
  lessons: LessonWithMembers[];
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const HOUR_HEIGHT = 100; // px per hour
const START_HOUR = 6;
const END_HOUR = 23;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => i + START_HOUR);
const SPINNER_HOURS = Array.from({ length: 18 }, (_, i) => String(i + 6).padStart(2, '0')); // 06~23
const SPINNER_MINUTES = ['00', '10', '20', '30', '40', '50'];
const DURATION_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];

// 스케줄 화면 전용 팔레트 (크림/테라코타)
const S_BG = '#F7F0E9';
const S_TERRA = '#C0755A';
const S_TEXT = '#3E2B22';
const S_TEXT_MUTED = '#A08070';
const S_BORDER = '#E0CFBF';
const S_CARD_BG = '#FFFFFF';
const S_SEG_BG = 'rgba(0,0,0,0.07)';      // 세그먼트 컨트롤 배경
const S_SCH_BG = '#FAEDE7';               // 예정 카드 배경
const S_SCH_FG = '#C0755A';               // 예정 카드 글씨
const S_DONE_BG = '#EDE8E4';              // 완료 카드 배경
const S_DONE_FG = '#9E8070';              // 완료 카드 글씨

function toKSTDateStr(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}
function getTodayKST(): string { return toKSTDateStr(new Date()); }
function getWeekDates(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 3 + i);
    return toKSTDateStr(d);
  });
}
function getThisWeekDates(): string[] {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    return toKSTDateStr(d);
  });
}

function getOffsetWeekDates(offset: number): string[] {
  const now = new Date();
  const day = now.getDay(); // 0=일
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((day + 6) % 7) + offset * 7); // 월요일 시작
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    return toKSTDateStr(d);
  });
}

// 특정 날짜가 포함된 주(월~일) 반환
function getWeekDatesForDate(dateStr: string): string[] {
  const d = new Date(dateStr + 'T12:00:00+09:00');
  const dow = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((dow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(mon); dd.setDate(mon.getDate() + i);
    return toKSTDateStr(dd);
  });
}

function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}
function minutesToTime(m: number): string {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
function yToMinutes(y: number): number {
  // y=0 -> START_HOUR:00, snapped to 10min
  const rawMin = (y / HOUR_HEIGHT) * 60 + START_HOUR * 60;
  return Math.round(rawMin / 10) * 10;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<ViewTab>('주간');
  const [lessons, setLessons] = useState<LessonWithMembers[]>([]);
  const [weekData, setWeekData] = useState<WeekLesson[]>([]);
  const [monthLessons, setMonthLessons] = useState<Map<string, LessonWithMembers[]>>(new Map());
  const [monthAbsenceCount, setMonthAbsenceCount] = useState(0);
  const [activeMemberIds, setActiveMemberIds] = useState<Set<string>>(new Set());
  const [monthYear, setMonthYear] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [refreshing, setRefreshing] = useState(false);
  const [today, setToday] = useState(getTodayKST);
  const [selectedDate, setSelectedDate] = useState(getTodayKST);
  const selectedDateRef = useRef(getTodayKST());
  const [weekDates, setWeekDates] = useState(getWeekDates);
  const [thisWeekDates, setThisWeekDates] = useState(getThisWeekDates);
  const [weekOffset, setWeekOffset] = useState(0); // 주간 뷰 주 이동 오프셋
  const [selectedMonthDate, setSelectedMonthDate] = useState<string | null>(null);

  // 새 레슨 등록 모달
  const [newModal, setNewModal] = useState(false);
  const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
  const [newHour, setNewHour] = useState('10');
  const [newMinute, setNewMinute] = useState('00');
  const [newDuration, setNewDuration] = useState(60);
  const [savingNew, setSavingNew] = useState(false);
  const [members, setMembers] = useState<{id: string; name: string; pkg_duration?: number}[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [hourPickerVisible, setHourPickerVisible] = useState(false);
  const [minutePickerVisible, setMinutePickerVisible] = useState(false);
  const [durationPickerVisible, setDurationPickerVisible] = useState(false);

  // 예약 요청
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [requestModal, setRequestModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [rejectMsg, setRejectMsg] = useState('');

  // 토스트에서 "확인하기" 눌러서 왔을 때 파라미터 처리
  const params = useLocalSearchParams<{
    highlightDate?: string; highlightTime?: string;
    highlightEnd?: string; highlightMember?: string; requestId?: string;
  }>();
  useEffect(() => {
    if (!params.highlightDate || !params.highlightTime) return;
    setActiveTab('일일');
    setSelectedDate(params.highlightDate);
    loadDayLessons(params.highlightDate);
    // 해당 시간으로 스크롤
    const [h, m] = params.highlightTime.slice(0, 5).split(':').map(Number);
    const scrollMin = Math.max(6 * 60, h * 60 + m - 30);
    const y = ((scrollMin - 6 * 60) / 60) * 100;
    setTimeout(() => dayScrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true }), 500);
    // pending 요청 로드 후 해당 요청 모달 오픈
    setTimeout(async () => {
      await loadPendingRequests();
      if (params.requestId) {
        const { data } = await supabase.from('lesson_requests')
          .select('*, member:members(name)').eq('id', params.requestId).maybeSingle();
        if (data) { setSelectedRequest(data); setRequestModal(true); }
      }
    }, 700);
  }, [params.requestId]);

  // 드래그 상태
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTargetMin, setDragTargetMin] = useState(0);
  const [weekDraggingId, setWeekDraggingId] = useState<string | null>(null);
  const [weekAttendanceMap, setWeekAttendanceMap] = useState<Map<string, 'scheduled' | 'completed' | 'absent'>>(new Map());
  const dayScrollRef = useRef<any>(null);

  // 출석 상태 맵 (lessonId → 'scheduled' | 'completed' | 'absent')
  const [attendanceMap, setAttendanceMap] = useState<Map<string, 'scheduled' | 'completed' | 'absent'>>(new Map());

  async function attachMemberNames(lessonList: Lesson[]): Promise<LessonWithMembers[]> {
    if (!lessonList.length) return [];
    const ids = lessonList.map(l => l.id);
    const { data: lm } = await supabase
      .from('lesson_members')
      .select('lesson_id, member_id, member:members(name)')
      .in('lesson_id', ids);
    const nameMap = new Map<string, string[]>();
    const idMap = new Map<string, string[]>();
    for (const row of lm ?? []) {
      // member_id는 name 유무와 무관하게 항상 기록
      if (!idMap.has(row.lesson_id)) idMap.set(row.lesson_id, []);
      idMap.get(row.lesson_id)!.push(row.member_id);
      const n = (row.member as any)?.name;
      if (!n) continue;
      if (!nameMap.has(row.lesson_id)) nameMap.set(row.lesson_id, []);
      nameMap.get(row.lesson_id)!.push(n);
    }
    return lessonList.map(l => ({ ...l, memberNames: nameMap.get(l.id) ?? [], memberIds: idMap.get(l.id) ?? [] }));
  }

  async function loadPendingRequests() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('lesson_requests')
      .select('*, member:members(name)')
      .eq('coach_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setPendingRequests(data ?? []);
  }

  async function handleAcceptRequest(req: any) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // 레슨 생성
    const memberName = req.member?.name ?? '회원';
    const { data: lesson, error: le } = await supabase.from('lessons').insert({
      coach_id: user.id, title: memberName,
      date: req.requested_date, start_time: req.start_time, end_time: req.end_time,
    }).select('id').single();
    if (le || !lesson) { Alert.alert('오류', '레슨 생성 실패'); return; }
    await supabase.from('lesson_members').insert({ lesson_id: lesson.id, member_id: req.member_id });
    // 요청 상태 업데이트
    await supabase.from('lesson_requests').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', req.id);
    // 회원에게 메시지 알림
    await supabase.from('messages').insert({
      coach_id: user.id, member_id: req.member_id, sender_type: 'coach',
      content: `✅ ${req.requested_date} ${req.start_time.slice(0,5)} 레슨 예약이 수락됐습니다! 🎾`,
    });
    setRequestModal(false);
    loadPendingRequests();
    loadDayLessons(selectedDate);
    Alert.alert('수락 완료', `${memberName}님 레슨이 스케줄에 등록됐어요.`);
  }

  async function handleRejectRequest(req: any) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('lesson_requests').update({ status: 'rejected', responded_at: new Date().toISOString(), reject_message: rejectMsg.trim() || null }).eq('id', req.id);
    // 회원에게 거절 알림 (메시지)
    const rejMsg = rejectMsg.trim()
      ? `❌ 레슨 예약 요청이 거절됐습니다.
${rejectMsg.trim()}`
      : `❌ ${req.requested_date} ${req.start_time.slice(0,5)} 레슨 예약 요청이 거절됐습니다. 다른 시간을 선택해주세요.`;
    await supabase.from('messages').insert({
      coach_id: user.id, member_id: req.member_id, sender_type: 'coach',
      content: rejMsg,
    });
    setRejectMsg('');
    setRequestModal(false);
    loadPendingRequests();
    Alert.alert('거절 완료', '회원에게 메시지가 전송됐습니다.');
  }

  function scrollToCurrentTime() {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentMin = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
    // 현재 시간보다 30분 전부터 보이도록 스크롤
    const scrollMin = Math.max(START_HOUR * 60, currentMin - 30);
    const y = ((scrollMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    setTimeout(() => {
      dayScrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
    }, 300);
  }

  async function loadDayLessons(date: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('lessons').select('*').eq('coach_id', user.id).eq('date', date).order('start_time');
    const withNames = await attachMemberNames(data ?? []);
    setLessons(withNames);

    // 출석 상태 로드
    if (withNames.length > 0) {
      const ids = withNames.map(l => l.id);
      const { data: att } = await supabase.from('attendance').select('lesson_id, status').in('lesson_id', ids);
      const newMap = new Map<string, 'scheduled' | 'completed' | 'absent'>();
      for (const a of att ?? []) {
        const cur = newMap.get(a.lesson_id);
        if (a.status === '결석') {
          newMap.set(a.lesson_id, 'absent');
        } else if ((a.status === '출석' || a.status === '지각' || a.status === '조퇴') && cur !== 'absent') {
          newMap.set(a.lesson_id, 'completed');
        }
      }
      setAttendanceMap(newMap);
    } else {
      setAttendanceMap(new Map());
    }

    // 오늘이면 현재 시간으로 스크롤, 다른 날이면 첫 레슨으로 스크롤
    const todayStr = toKSTDateStr(new Date());
    if (date === todayStr) {
      scrollToCurrentTime();
    } else {
      const firstLesson = (data ?? []).sort((a: any, b: any) => a.start_time.localeCompare(b.start_time))[0];
      if (firstLesson) {
        const mins = timeToMinutes(firstLesson.start_time) - 30;
        const y = ((Math.max(START_HOUR * 60, mins) - START_HOUR * 60) / 60) * HOUR_HEIGHT;
        setTimeout(() => dayScrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true }), 300);
      }
    }
  }

  async function loadWeekLessons(wDates: string[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('lessons').select('*').eq('coach_id', user.id)
      .gte('date', wDates[0]).lte('date', wDates[6]).order('start_time');
    const withNames = await attachMemberNames(data ?? []);
    const map = new Map<string, LessonWithMembers[]>();
    for (const d of wDates) map.set(d, []);
    for (const l of withNames) { if (map.has(l.date)) map.get(l.date)!.push(l); }
    setWeekData(wDates.map(d => ({ date: d, lessons: map.get(d) ?? [] })));

    // 출석 상태 로드
    if (withNames.length > 0) {
      const ids = withNames.map(l => l.id);
      const { data: att } = await supabase.from('attendance').select('lesson_id, status').in('lesson_id', ids);
      const newMap = new Map<string, 'scheduled' | 'completed' | 'absent'>();
      for (const a of att ?? []) {
        const cur = newMap.get(a.lesson_id);
        if (a.status === '결석') {
          newMap.set(a.lesson_id, 'absent');
        } else if ((a.status === '출석' || a.status === '지각' || a.status === '조퇴') && cur !== 'absent') {
          newMap.set(a.lesson_id, 'completed');
        }
      }
      setWeekAttendanceMap(newMap);
    } else {
      setWeekAttendanceMap(new Map());
    }
  }


  async function loadMonthLessons(year: number, month: number) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0);
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    const { data } = await supabase.from('lessons').select('*')
      .eq('coach_id', user.id).gte('date', firstDay).lte('date', lastDayStr).order('start_time');
    const withNames = await attachMemberNames(data ?? []);
    const map = new Map<string, LessonWithMembers[]>();
    for (const l of withNames) {
      if (!map.has(l.date)) map.set(l.date, []);
      map.get(l.date)!.push(l);
    }
    setMonthLessons(map);

    // 결석 수 계산
    const lessonIds = withNames.map(l => l.id);
    if (lessonIds.length > 0) {
      const { data: absentAtt } = await supabase.from('attendance').select('id').in('lesson_id', lessonIds).eq('status', '결석');
      setMonthAbsenceCount(absentAtt?.length ?? 0);
    } else {
      setMonthAbsenceCount(0);
    }

    // 활성 회원 ID 목록 (비활성/삭제된 회원 제외)
    const { data: activeMembers } = await supabase
      .from('members').select('id').eq('coach_id', user.id).eq('is_active', true);
    setActiveMemberIds(new Set((activeMembers ?? []).map((m: any) => m.id)));
  }

  // 알림 응답 리스너 (출석 체크 확인 팝업)
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true,
      }),
    });

    const sub = Notifications.addNotificationResponseReceivedListener(async response => {
      const data = response.notification.request.content.data as any;
      if (data?.type !== 'attendance_check') return;
      const date = data.date as string;

      // 미체크 레슨 조회
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: dayLessons } = await supabase
        .from('lessons').select('id, title, lesson_members(member_id, member:members(name))')
        .eq('coach_id', user.id).eq('date', date);
      if (!dayLessons?.length) return;

      const lessonIds = dayLessons.map((l: any) => l.id);
      const { data: checkedAtt } = await supabase.from('attendance')
        .select('lesson_id, member_id').in('lesson_id', lessonIds);

      const checkedSet = new Set((checkedAtt ?? []).map((a: any) => `${a.lesson_id}_${a.member_id}`));
      const unchecked: string[] = [];
      for (const lesson of (dayLessons as any[])) {
        for (const lm of (lesson.lesson_members ?? [])) {
          if (!checkedSet.has(`${lesson.id}_${lm.member_id}`)) {
            unchecked.push(lm.member?.name ?? '회원');
          }
        }
      }

      if (unchecked.length === 0) return;

      Alert.alert(
        '📋 미체크 레슨 확인',
        `${unchecked.join(', ')}님 출석 체크가 안 됐어요.
이 레슨은 크레딧 차감 없이 처리할까요?`,
        [
          { text: '체크하러 가기', onPress: () => setSelectedDate(date) },
          {
            text: '차감 없이 OK',
            style: 'destructive',
            onPress: () => {
              // 출석 미기록 그대로 → 차감 없음 (deduct_credit: false 로 attendance 추가)
            },
          },
        ]
      );
    });
    return () => sub.remove();
  }, []);

  // selectedDate 최신값을 ref로 추적 (useFocusEffect stale closure 방지)
  selectedDateRef.current = selectedDate;

  useFocusEffect(useCallback(() => {
    const newToday = getTodayKST();
    const newThisWeek = getThisWeekDates();
    setToday(newToday); setThisWeekDates(newThisWeek);
    if (activeTab === '일일') {
      // 선택된 날짜 기준으로 주간 스트립 업데이트 (강제 리셋 없음)
      const curDate = selectedDateRef.current;
      const weekForCurDate = getWeekDatesForDate(curDate);
      setWeekDates(weekForCurDate);
      loadDayLessons(curDate);
    }
    else if (activeTab === '주간') loadWeekLessons(newThisWeek);
    else { const d = new Date(); loadMonthLessons(d.getFullYear(), d.getMonth()); }
    loadPendingRequests();
    // 회원 목록 로드
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: rawMembers } = await supabase.from('members')
        .select('id, name, lesson_package_id, lesson_packages(duration_minutes)')
        .eq('coach_id', user.id).eq('is_active', true).order('name');
      const data = (rawMembers ?? []).map((m: any) => ({
        id: m.id, name: m.name,
        pkg_duration: m.lesson_packages?.duration_minutes ?? null,
      }));
      setMembers(data ?? []);
    })();
    // Realtime 불안정 대비: 15초 폴링으로 pending 요청 확인
    const pollInterval = setInterval(() => {
      loadPendingRequests();
    }, 15000);
    return () => clearInterval(pollInterval);
  }, [activeTab]));

  // lesson_requests Realtime 구독 - 새 예약 요청 즉시 감지
  useEffect(() => {
    let myCoachId: string | null = null;
    let ch: any = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      myCoachId = user.id;

      ch = supabase.channel('lesson_requests_coach_' + user.id)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'lesson_requests',
        }, async (payload) => {
          const req = payload.new as any;
          // 내 coach_id 요청만 처리
          if (req.coach_id !== myCoachId) return;
          const { data: mem } = await supabase.from('members').select('name').eq('id', req.member_id).maybeSingle();
          const newReq = { ...req, member: { name: mem?.name ?? '회원' } };
          setPendingRequests(prev => [newReq, ...prev]);
          setSelectedRequest(newReq);
          setRequestModal(true);
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            // 구독 성공 후 혹시 놓친 pending 요청 다시 로드
            loadPendingRequests();
          }
        });
    });

    return () => {
      if (ch) supabase.removeChannel(ch);
    };
  }, []);

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date); loadDayLessons(date);
  }, []);

  function handleDayNav(delta: number) {
    const d = new Date(selectedDate + 'T12:00:00+09:00');
    d.setDate(d.getDate() + delta);
    const newDate = toKSTDateStr(d);
    setWeekDates(getWeekDatesForDate(newDate));
    handleSelectDate(newDate);
  }

  function getDateNavLabel(): string {
    if (activeTab === '일일') {
      return new Date(selectedDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
    } else if (activeTab === '주간') {
      const dates = getOffsetWeekDates(weekOffset);
      return new Date(dates[0] + 'T00:00:00').toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
    } else {
      return new Date(monthYear.year, monthYear.month, 1).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
    }
  }

  function handleNavPrev() {
    if (activeTab === '일일') { handleDayNav(-1); }
    else if (activeTab === '주간') {
      const newOffset = weekOffset - 1; setWeekOffset(newOffset); loadWeekLessons(getOffsetWeekDates(newOffset));
    } else {
      const d = monthYear.month === 0 ? { year: monthYear.year - 1, month: 11 } : { year: monthYear.year, month: monthYear.month - 1 };
      setMonthYear(d); loadMonthLessons(d.year, d.month);
    }
  }

  function handleNavNext() {
    if (activeTab === '일일') { handleDayNav(1); }
    else if (activeTab === '주간') {
      const newOffset = weekOffset + 1; setWeekOffset(newOffset); loadWeekLessons(getOffsetWeekDates(newOffset));
    } else {
      const d = monthYear.month === 11 ? { year: monthYear.year + 1, month: 0 } : { year: monthYear.year, month: monthYear.month + 1 };
      setMonthYear(d); loadMonthLessons(d.year, d.month);
    }
  }

  // ── 시간 그리드 탭 → 새 레슨 등록 ──────────────────────────
  function handleGridTap(y: number) {
    const mins = yToMinutes(y);
    const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 10, mins));
    const h = Math.floor(clamped / 60);
    const m = Math.round((clamped % 60) / 10) * 10;
    setNewHour(String(h).padStart(2, '0'));
    setNewMinute(String(m).padStart(2, '0'));
    setNewDuration(60);
    setNewMemberIds([]);
    setMemberSearch('');
    setNewModal(true);
  }

  async function handleSaveNew() {
    if (newMemberIds.length === 0) { Alert.alert('오류', '회원을 선택해주세요.'); return; }
    const startMin = parseInt(newHour) * 60 + parseInt(newMinute);
    const endMin = startMin + newDuration;
    const startSt = minutesToTime(startMin) + ':00';
    const endSt = minutesToTime(endMin) + ':00';
    setSavingNew(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingNew(false); return; }
    // 오버랩 체크
    const { data: existing } = await supabase.from('lessons').select('id, start_time, end_time')
      .eq('coach_id', user.id).eq('date', selectedDate);
    const overlap = (existing ?? []).find((l: any) => {
      const ls = timeToMinutes(l.start_time), le = timeToMinutes(l.end_time);
      return startMin < le && endMin > ls;
    });
    if (overlap) {
      setSavingNew(false);
      Alert.alert('시간 충돌', minutesToTime(timeToMinutes((overlap as any).start_time)) + '~' + minutesToTime(timeToMinutes((overlap as any).end_time)) + ' 레슨과 시간이 겹칩니다.\n다른 시간을 선택해주세요.');
      return;
    }
    const selectedNames = members.filter(m => newMemberIds.includes(m.id)).map(m => m.name);
    const title = selectedNames.join(', ');
    const { data: lesson, error } = await supabase.from('lessons').insert({
      coach_id: user.id, title,
      date: selectedDate, start_time: startSt, end_time: endSt,
    }).select('id').single();
    if (error || !lesson) { setSavingNew(false); Alert.alert('오류', '등록 실패'); return; }
    // lesson_members 연결
    for (const memberId of newMemberIds) {
      await supabase.from('lesson_members').insert({ lesson_id: lesson.id, member_id: memberId });
    }
    setSavingNew(false);
    setNewModal(false);
    loadDayLessons(selectedDate);
    // 당일 마지막 레슨 체크 알림 스케줄
    scheduleEndOfDayNotification(selectedDate);
  }

  async function scheduleEndOfDayNotification(date: string) {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;

      // 해당 날짜의 모든 레슨 조회 → 가장 마지막 레슨 end_time 기준
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: dayLessons } = await supabase.from('lessons').select('end_time')
        .eq('coach_id', user.id).eq('date', date).order('end_time', { ascending: false });
      if (!dayLessons || dayLessons.length === 0) return;

      const lastEnd = dayLessons[0].end_time.slice(0, 5); // "HH:MM"
      const [hh, mm] = lastEnd.split(':').map(Number);

      const trigger = new Date(date + 'T00:00:00');
      trigger.setHours(hh, mm + 5, 0, 0); // 마지막 레슨 끝 5분 후
      if (trigger <= new Date()) return; // 이미 지난 시간이면 스킵

      // 기존 같은 날 알림 취소 후 재스케줄
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '📋 오늘 레슨 출석 체크',
          body: '오늘 레슨 출석 체크가 완료됐나요? 미확인 회원이 있으면 앱을 열어 확인해주세요.',
          data: { type: 'attendance_check', date },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
      });
    } catch (e) {
      // 알림 스케줄 실패는 조용히 무시
    }
  }

  // ── 드래그 앤 드랍 ────────────────────────────────────────────
  async function handleWeekDropLesson(lessonId: string, sourceDateStr: string, targetDateStr: string, newStartMinutes: number) {
    const sourceLessons = weekData.find(d => d.date === sourceDateStr)?.lessons ?? [];
    const lesson = sourceLessons.find(l => l.id === lessonId);
    if (!lesson) return;
    const oldStartMin = timeToMinutes(lesson.start_time);
    const duration = timeToMinutes(lesson.end_time) - oldStartMin;
    const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 10, newStartMinutes));
    if (sourceDateStr === targetDateStr && Math.abs(clamped - oldStartMin) < 5) return;
    const newStartStr = minutesToTime(clamped);
    const newEndStr = minutesToTime(clamped + duration);
    const targetDayLessons = weekData.find(d => d.date === targetDateStr)?.lessons ?? [];
    const overlap = targetDayLessons.find(l => {
      if (l.id === lessonId) return false;
      const ls = timeToMinutes(l.start_time), le = timeToMinutes(l.end_time);
      return clamped < le && (clamped + duration) > ls;
    });
    if (overlap) {
      const overlapName = overlap.memberNames.length > 0 ? overlap.memberNames.join(', ') : overlap.title;
      Alert.alert('시간 충돌', `${overlapName} 레슨(${minutesToTime(timeToMinutes(overlap.start_time))}~${minutesToTime(timeToMinutes(overlap.end_time))})과 겹칩니다.`);
      return;
    }
    const dateChangeLabel = sourceDateStr !== targetDateStr ? `\n${targetDateStr}` : '';
    Alert.alert(
      '시간 변경',
      lesson.title + dateChangeLabel + '\n' + minutesToTime(oldStartMin) + ' → ' + newStartStr + '\n\n변경하시겠어요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '변경', onPress: async () => {
            await supabase.from('lessons').update({
              date: targetDateStr,
              start_time: newStartStr + ':00',
              end_time: newEndStr + ':00',
            }).eq('id', lessonId);
            loadWeekLessons(getOffsetWeekDates(weekOffset));
          },
        },
      ]
    );
  }

  async function handleDropLesson(lessonId: string, newStartMinutes: number) {
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return;
    const oldStartMin = timeToMinutes(lesson.start_time);
    const duration = timeToMinutes(lesson.end_time) - oldStartMin;
    const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 10, newStartMinutes));
    if (Math.abs(clamped - oldStartMin) < 5) return; // 변화 없음
    const newStartStr = minutesToTime(clamped);
    const newEndStr = minutesToTime(clamped + duration);

    // 충돌 감지
    const overlap = lessons.find(l => {
      if (l.id === lessonId) return false;
      const ls = timeToMinutes(l.start_time), le = timeToMinutes(l.end_time);
      return clamped < le && (clamped + duration) > ls;
    });
    if (overlap) {
      const overlapName = overlap.memberNames.length > 0 ? overlap.memberNames.join(', ') : overlap.title;
      Alert.alert(
        '시간 충돌',
        `${overlapName} 레슨(${minutesToTime(timeToMinutes(overlap.start_time))}~${minutesToTime(timeToMinutes(overlap.end_time))})과 겹칩니다.\n다른 시간으로 이동해주세요.`
      );
      return;
    }

    Alert.alert(
      '시간 변경',
      lesson.title + '\n' + minutesToTime(oldStartMin) + ' → ' + newStartStr + '\n\n변경하시겠어요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '변경', onPress: async () => {
            await supabase.from('lessons').update({
              start_time: newStartStr + ':00',
              end_time: newEndStr + ':00',
            }).eq('id', lessonId);
            loadDayLessons(selectedDate);
          },
        },
      ]
    );
  }


  /** 겹치는 레슨들을 컬럼으로 분배해 좌우 나란히 배치 */
  function computeColumns(lessonList: LessonWithMembers[]): Map<string, { col: number; totalCols: number }> {
    const result = new Map<string, { col: number; totalCols: number }>();
    const sorted = [...lessonList].sort((a, b) => a.start_time.localeCompare(b.start_time));

    // 그룹 단위로 겹치는 레슨 묶기
    const groups: LessonWithMembers[][] = [];
    let current: LessonWithMembers[] = [];
    let groupEnd = 0;

    for (const lesson of sorted) {
      const start = timeToMinutes(lesson.start_time);
      const end = timeToMinutes(lesson.end_time);
      if (current.length === 0 || start < groupEnd) {
        current.push(lesson);
        groupEnd = Math.max(groupEnd, end);
      } else {
        if (current.length > 0) groups.push(current);
        current = [lesson];
        groupEnd = end;
      }
    }
    if (current.length > 0) groups.push(current);

    for (const group of groups) {
      // 컬럼 배정 (greedy)
      const cols: number[] = []; // cols[i] = 해당 컬럼의 마지막 end minute
      for (const lesson of group) {
        const start = timeToMinutes(lesson.start_time);
        const end = timeToMinutes(lesson.end_time);
        let assigned = -1;
        for (let i = 0; i < cols.length; i++) {
          if (cols[i] <= start) { assigned = i; cols[i] = end; break; }
        }
        if (assigned === -1) { assigned = cols.length; cols.push(end); }
        result.set(lesson.id, { col: assigned, totalCols: 0 }); // totalCols 나중에 업데이트
      }
      const totalCols = cols.length;
      for (const lesson of group) {
        const prev = result.get(lesson.id)!;
        result.set(lesson.id, { col: prev.col, totalCols });
      }
    }
    return result;
  }

  // ── 예약 요청 배너 렌더 ──────────────────────────
  function renderRequestBanner() {
    if (pendingRequests.length === 0) return null;
    return (
      <TouchableOpacity
        style={styles.requestBanner}
        onPress={() => { setSelectedRequest(pendingRequests[0]); setRequestModal(true); }}
        activeOpacity={0.85}
      >
        <View style={styles.requestBannerLeft}>
          <Ionicons name="calendar-outline" size={18} color={Colors.foreground} />
          <Text style={styles.requestBannerText}>
            레슨 예약 요청 {pendingRequests.length}건 대기 중
          </Text>
        </View>
        <View style={styles.requestBannerBadge}>
          <Text style={styles.requestBannerBadgeText}>{pendingRequests.length}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // ── 일일 뷰 그리드 렌더 ──────────────────────────────────────
  function renderDayGrid() {
    const gridHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT;

    return (
      <ScrollView ref={dayScrollRef} style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        scrollEnabled={draggingId === null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadDayLessons(selectedDate); setRefreshing(false); }} tintColor={Colors.navy} />}
      >
        <View style={{ height: gridHeight + 20, position: 'relative' }}>
          {/* 현재 시간 표시선 (오늘만) */}
          {selectedDate === today && (() => {
            const now = new Date();
            const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
            const curMin = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
            if (curMin < START_HOUR * 60 || curMin > END_HOUR * 60) return null;
            const lineY = ((curMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
            const nowTimeStr = minutesToTime(curMin);
            return (
              <View key="now-line" style={[styles.nowLine, { top: lineY }]}>
                <Text style={styles.nowTimeAboveLabel}>{nowTimeStr}</Text>
                <View style={styles.nowDot} />
                <View style={styles.nowLineBar} />
              </View>
            );
          })()}
          {/* 시간 라인들 */}
          {HOURS.map(h => (
            <View key={h} style={[styles.hourRow, { top: (h - START_HOUR) * HOUR_HEIGHT }]}>
              <Text style={styles.hourLabel} numberOfLines={1} ellipsizeMode="clip">{String(h).padStart(2, '0')}:00</Text>
              <View style={styles.hourLine} />
            </View>
          ))}
          {/* :30 보조 눈금 */}
          {HOURS.slice(0, -1).map(h => (
            <View key={`half-${h}`} style={[styles.halfHourLine, { top: (h - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }]} />
          ))}

          {/* 10분 단위 보조 눈금 (드래그 중) */}
          {draggingId !== null && HOURS.flatMap(h =>
            [10, 20, 30, 40, 50].map(m => {
              const lineY = ((h * 60 + m - START_HOUR * 60) / 60) * HOUR_HEIGHT;
              return <View key={`sub-${h}-${m}`} style={[styles.subHourLine, { top: lineY }]} />;
            })
          )}

          {/* 탭 가능한 빈 슬롯 오버레이 */}
          <TouchableOpacity
            style={[styles.gridTapOverlay, { height: gridHeight }]}
            activeOpacity={1}
            onPress={e => handleGridTap(e.nativeEvent.locationY)}
          />

          {/* 레슨 카드들 - 겹침 없이 컬럼 배치 */}
          {(() => {
            const colMap = computeColumns(lessons);
            const GRID_LEFT = 56;
            const GRID_RIGHT = 8;
            const GRID_WIDTH = Dimensions.get('window').width - GRID_LEFT - GRID_RIGHT;
            return lessons.map(lesson => {
              const startMin = timeToMinutes(lesson.start_time);
              const endMin = timeToMinutes(lesson.end_time);
              const top = (startMin - START_HOUR * 60) / 60 * HOUR_HEIGHT;
              const height = Math.max(52, (endMin - startMin) / 60 * HOUR_HEIGHT - 4);
              const isDragging = draggingId === lesson.id;
              const layout = colMap.get(lesson.id) ?? { col: 0, totalCols: 1 };
              const colWidth = (GRID_WIDTH - (layout.totalCols - 1) * 3) / layout.totalCols;
              const left = GRID_LEFT + layout.col * (colWidth + 3);
              const width = colWidth;

              const attStatus = attendanceMap.get(lesson.id);
              const cardBg = attStatus === 'absent' ? '#FFE8E8'
                : attStatus === 'completed' ? S_DONE_BG
                : S_SCH_BG;
              const cardNameColor = attStatus === 'absent' ? '#C0393A'
                : attStatus === 'completed' ? S_DONE_FG
                : S_SCH_FG;
              const cardTimeColor = attStatus === 'absent' ? '#C0393A'
                : attStatus === 'completed' ? S_TEXT_MUTED
                : S_TERRA;
              return (
                <DraggableLesson
                  key={lesson.id}
                  lesson={lesson}
                  top={top}
                  height={height}
                  left={left}
                  width={width}
                  isDragging={isDragging}
                  cardBg={cardBg}
                  cardNameColor={cardNameColor}
                  cardTimeColor={cardTimeColor}
                  onPress={() => router.push('/lessons/' + lesson.id as any)}
                  onDragEnd={(dy) => {
                    const deltaMin = Math.round((dy / HOUR_HEIGHT) * 60 / 10) * 10;
                    const newMin = startMin + deltaMin;
                    handleDropLesson(lesson.id, newMin);
                  }}
                  onDragStart={() => setDraggingId(lesson.id)}
                  onDragCancel={() => setDraggingId(null)}
                />
              );
            });
          })()}

          {/* 예약 요청 대기 카드들 (반투명 — 수락 전 모든 pending 요청) */}
          {pendingRequests
            .filter(req => req.requested_date === selectedDate)
            .map(req => {
              const startMin = timeToMinutes(req.start_time);
              const endMin = timeToMinutes(req.end_time ?? req.start_time);
              const top = (startMin - START_HOUR * 60) / 60 * HOUR_HEIGHT;
              const height = Math.max(56, (endMin - startMin) / 60 * HOUR_HEIGHT - 4);
              const GRID_LEFT = 56;
              const GRID_WIDTH = Dimensions.get('window').width - GRID_LEFT - 8;
              return (
                <TouchableOpacity
                  key={'pending-' + req.id}
                  activeOpacity={0.85}
                  style={{
                    position: 'absolute', top, left: GRID_LEFT, width: GRID_WIDTH, height,
                    backgroundColor: 'rgba(45,51,64,0.05)',
                    borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border,
                    borderStyle: 'dashed',
                    justifyContent: 'center', alignItems: 'center', gap: 3,
                  }}
                  onPress={() => { setSelectedRequest(req); setRequestModal(true); }}
                >
                  <Ionicons name="time-outline" size={15} color={Colors.mutedFg} />
                  <Text style={{ fontSize: 14, fontWeight: '800', color: Colors.foreground }}>예약 요청 대기중</Text>
                  <Text style={{ fontSize: 13, color: Colors.mutedFg }}>
                    {req.start_time?.slice(0,5)} ~ {req.end_time?.slice(0,5)}
                  </Text>
                  <Text style={{ fontSize: 13, color: Colors.warning }}>
                    {req.member?.name ?? '회원'} · 탭하여 수락/거절
                  </Text>
                </TouchableOpacity>
              );
            })
          }
        </View>
        <View style={{ height: 80 }} />
      </ScrollView>
    );
  }

  // ── 주간 뷰 (타임그리드) ─────────────────────────────────────
  function renderWeekGrid() {
    const { width: SCREEN_W } = Dimensions.get('window');
    const TIME_COL = 56;
    const COL_W = Math.floor((SCREEN_W - TIME_COL) / 7);
    const displayDates = getOffsetWeekDates(weekOffset);
    const gridHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT;
    const DAYS_KO = ['월', '화', '수', '목', '금', '토', '일'];

    // 레슨을 날짜별로 그룹핑
    const lessonsByDate = new Map<string, LessonWithMembers[]>();
    for (const dd of displayDates) lessonsByDate.set(dd, []);
    for (const d of weekData) { if (lessonsByDate.has(d.date)) lessonsByDate.set(d.date, d.lessons); }

    // 현재 시간선
    const nowKST = new Date(new Date().getTime() + 9 * 3600000);
    const nowMin = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes();
    const nowLineY = nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60
      ? ((nowMin - START_HOUR * 60) / 60) * HOUR_HEIGHT : null;
    const todayInView = displayDates.findIndex(d => d === today);

    return (
      <View style={{ flex: 1, backgroundColor: S_BG }}>
        {/* 요일 헤더 */}
        <View style={[styles.weekDayHeaderRow, { paddingLeft: TIME_COL }]}>
          {displayDates.map((date, i) => {
            const d = new Date(date + 'T00:00:00');
            const isToday = date === today;
            return (
              <View key={date} style={[styles.weekColHeader, { width: COL_W }, isToday && styles.weekColHeaderToday]}>
                <Text style={[styles.weekColDayName, isToday && { color: '#fff' }]}>{DAYS_KO[i]}</Text>
                <Text style={[styles.weekColDayNum, isToday && { color: '#fff', fontWeight: '900' as const }]}>{d.getDate()}</Text>
              </View>
            );
          })}
        </View>

        {/* 타임 그리드 */}
        <ScrollView
          ref={dayScrollRef}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          scrollEnabled={weekDraggingId === null}
          refreshControl={<RefreshControl refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadWeekLessons(displayDates); setRefreshing(false); }}
            tintColor={S_TERRA} />}
        >
          <View style={{ height: gridHeight + 20, position: 'relative', flexDirection: 'row' }}>
            {/* 시간 라벨 컬럼 */}
            <View style={{ width: TIME_COL }}>
              {HOURS.map(h => (
                <View key={h} style={[styles.weekHourLabel, { top: (h - START_HOUR) * HOUR_HEIGHT }]}>
                  <Text style={styles.hourLabel} numberOfLines={1} ellipsizeMode="clip">{String(h).padStart(2, '0')}:00</Text>
                </View>
              ))}
            </View>

            {/* 7개 day 컬럼 */}
            {displayDates.map((date, colIdx) => {
              const isToday = date === today;
              const colLessons = lessonsByDate.get(date) ?? [];
              const isDraggingInCol = weekDraggingId !== null && colLessons.some(l => l.id === weekDraggingId);
              const colMap = computeColumns(colLessons);
              return (
                <View key={date} style={[styles.weekDayColGrid, { width: COL_W, height: gridHeight },
                  isToday && { backgroundColor: S_TERRA + '14' }]}>
                  {/* 시간 구분선 */}
                  {HOURS.map(h => (
                    <View key={h} style={[styles.weekHourLine, { top: (h - START_HOUR) * HOUR_HEIGHT }]} />
                  ))}
                  {/* 10분 보조 눈금 (드래그 중인 컬럼만) */}
                  {isDraggingInCol && HOURS.flatMap(h =>
                    [10, 20, 30, 40, 50].map(m => {
                      const lineY = ((h * 60 + m - START_HOUR * 60) / 60) * HOUR_HEIGHT;
                      return <View key={`wsub-${h}-${m}`} style={[styles.weekSubHourLine, { top: lineY }]} />;
                    })
                  )}
                  {/* 현재 시간선 */}
                  {isToday && nowLineY !== null && (
                    <View style={[styles.weekNowLine, { top: nowLineY }]}>
                      <View style={styles.weekNowDot} />
                      <View style={styles.nowLineBar} />
                    </View>
                  )}
                  {/* 레슨 블록 */}
                  {colLessons.map(lesson => {
                    const startMin = timeToMinutes(lesson.start_time);
                    const endMin = timeToMinutes(lesson.end_time);
                    const top = (startMin - START_HOUR * 60) / 60 * HOUR_HEIGHT;
                    const height = Math.max(30, (endMin - startMin) / 60 * HOUR_HEIGHT - 2);
                    const layout = colMap.get(lesson.id) ?? { col: 0, totalCols: 1 };
                    const bWidth = (COL_W - 4 - (layout.totalCols - 1) * 2) / layout.totalCols;
                    const left = 2 + layout.col * (bWidth + 2);
                    const attStatus = weekAttendanceMap.get(lesson.id) ?? 'scheduled';
                    const isDragging = weekDraggingId === lesson.id;
                    return (
                      <WeekDraggableBlock
                        key={lesson.id}
                        lesson={lesson}
                        top={top}
                        height={height}
                        left={left}
                        width={bWidth}
                        isDragging={isDragging}
                        attStatus={attStatus}
                        onPress={() => router.push('/lessons/' + lesson.id as any)}
                        onDragEnd={(dy, dx) => {
                          const deltaMin = Math.round((dy / HOUR_HEIGHT) * 60 / 10) * 10;
                          const newMin = startMin + deltaMin;
                          const currentColX = colIdx * COL_W;
                          const targetColIdx = Math.min(6, Math.max(0, Math.floor((currentColX + dx + COL_W / 2) / COL_W)));
                          const targetDate = displayDates[targetColIdx];
                          handleWeekDropLesson(lesson.id, date, targetDate, newMin);
                        }}
                        onDragStart={() => setWeekDraggingId(lesson.id)}
                        onDragCancel={() => setWeekDraggingId(null)}
                      />
                    );
                  })}
                </View>
              );
            })}
          </View>
          <View style={{ height: 80 }} />
        </ScrollView>
      </View>
    );
  }

    // ── 월간 뷰 ───────────────────────────────────────────────────
  function renderMonthView() {
    const { year, month } = monthYear;
    const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0=일
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = new Date(year, month, 1).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });

    const cells: (number | null)[] = [
      ...Array(firstDayOfMonth).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    // pad to complete last row
    while (cells.length % 7 !== 0) cells.push(null);

    return (
      <ScrollView style={{ flex: 1, backgroundColor: S_BG }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadMonthLessons(year, month); setRefreshing(false); }} tintColor={S_TERRA} />}
      >
        {/* 요일 헤더 */}
        <View style={styles.monthDayHeaders}>
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <Text key={d} style={[styles.monthDayName, i === 0 && { color: Colors.destructive }, i === 6 && { color: Colors.info }]}>{d}</Text>
          ))}
        </View>

        {/* 날짜 그리드 */}
        <View style={styles.monthGrid}>
          {cells.map((day, idx) => {
            if (!day) return <View key={`empty-${idx}`} style={styles.monthCell} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayLessons = monthLessons.get(dateStr) ?? [];
            const isToday = dateStr === today;
            const isSun = idx % 7 === 0;
            const isSat = idx % 7 === 6;
            return (
              <TouchableOpacity
                key={dateStr}
                style={[styles.monthCell, isToday && styles.monthCellToday, selectedMonthDate === dateStr && styles.monthCellSelected]}
                onPress={() => setSelectedMonthDate(prev => prev === dateStr ? null : dateStr)}
              >
                <Text style={[
                  styles.monthCellDay,
                  isToday && styles.monthCellDayToday,
                  isSun && !isToday && { color: Colors.destructive },
                  isSat && !isToday && { color: Colors.info },
                ]}>{day}</Text>
                {dayLessons.length > 0 && (
                  <View style={styles.monthLessonDots}>
                    <View style={styles.monthDot} />
                    <Text style={styles.monthLessonCount}>{dayLessons.length}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 이번 달 레슨 요약 */}
        <View style={styles.monthSummary}>
          <View style={styles.monthSummaryItem}>
            <Text style={styles.monthSummaryNum}>{Array.from(monthLessons.values()).reduce((s, ls) => s + ls.length, 0)}</Text>
            <Text style={styles.monthSummaryLabel}>총 레슨</Text>
          </View>
          <View style={styles.monthSummaryDivider} />
          <View style={styles.monthSummaryItem}>
            <Text style={styles.monthSummaryNum}>{monthLessons.size}</Text>
            <Text style={styles.monthSummaryLabel}>레슨일</Text>
          </View>
          <View style={styles.monthSummaryDivider} />
          <View style={styles.monthSummaryItem}>
            <Text style={styles.monthSummaryNum}>{monthAbsenceCount}</Text>
            <Text style={styles.monthSummaryLabel}>결석</Text>
          </View>
        </View>
        {/* 선택된 날짜 인라인 레슨 목록 */}
        {selectedMonthDate && (() => {
          const dayLessons = monthLessons.get(selectedMonthDate) ?? [];
          const d = new Date(selectedMonthDate + 'T00:00:00');
          const label = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
          return (
            <View style={styles.monthInlineList}>
              <Text style={styles.monthInlineLabel}>{label}</Text>
              {dayLessons.length === 0 ? (
                <Text style={styles.monthInlineEmpty}>이 날 레슨 없음</Text>
              ) : dayLessons.map(lesson => (
                <TouchableOpacity key={lesson.id} style={styles.monthInlineItem} onPress={() => router.push('/lessons/' + lesson.id as any)}>
                  <View style={styles.monthInlineItemBar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.monthInlineItemName} numberOfLines={1}>
                      {lesson.memberNames.length > 0 ? lesson.memberNames.join(', ') : lesson.title}
                    </Text>
                    <Text style={styles.monthInlineItemTime}>
                      {lesson.start_time.slice(0, 5)} ~ {lesson.end_time.slice(0, 5)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={S_TEXT_MUTED} />
                </TouchableOpacity>
              ))}
            </View>
          );
        })()}
        <View style={{ height: 100 }} />
      </ScrollView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: S_BG }]}>
      {/* 통합 헤더 */}
      <View style={[styles.unifiedHeader, { paddingTop: insets.top + 8 }]}>
        <View style={styles.unifiedTitleRow}>
          <Text style={styles.unifiedTitle}>스케줄</Text>
          {pendingRequests.length > 0 && (
            <TouchableOpacity
              style={styles.requestBell}
              onPress={() => { setSelectedRequest(pendingRequests[0]); setRequestModal(true); }}
            >
              <Ionicons name="notifications" size={22} color={S_TERRA} />
              <View style={styles.requestBellBadge}>
                <Text style={styles.requestBellBadgeText}>{pendingRequests.length}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.segmentWrap}>
          <View style={styles.segmentControl}>
            {(['일일', '주간', '월간'] as ViewTab[]).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[styles.segmentItem, activeTab === tab && styles.segmentItemActive]}
                onPress={() => {
                  setActiveTab(tab);
                  if (tab === '일일') loadDayLessons(selectedDate);
                  else if (tab === '주간') loadWeekLessons(getOffsetWeekDates(weekOffset));
                  else loadMonthLessons(monthYear.year, monthYear.month);
                }}
              >
                <Text style={[styles.segmentText, activeTab === tab && styles.segmentTextActive]}>{tab}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.dateNavRow}>
          <TouchableOpacity style={styles.dateNavBtn} onPress={handleNavPrev}>
            <Ionicons name="chevron-back" size={18} color={S_TEXT} />
          </TouchableOpacity>
          <Text style={styles.dateNavLabel}>{getDateNavLabel()}</Text>
          <TouchableOpacity style={styles.dateNavBtn} onPress={handleNavNext}>
            <Ionicons name="chevron-forward" size={18} color={S_TEXT} />
          </TouchableOpacity>
        </View>

        {activeTab === '일일' && (
          <View style={styles.weekStrip}>
            {weekDates.map(date => {
              const d = new Date(date + 'T00:00:00');
              const isSelected = date === selectedDate;
              const isToday = date === today;
              return (
                <TouchableOpacity key={date} style={[styles.dayBtn, isSelected && styles.daySelected]} onPress={() => handleSelectDate(date)}>
                  <Text style={[styles.dayName, isSelected && styles.dayTextSelected]}>{DAYS[d.getDay()]}</Text>
                  <Text style={[styles.dayNum, isSelected && styles.dayTextSelected, isToday && !isSelected && styles.dayToday]}>{d.getDate()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {activeTab === '일일' ? (
        <>
          {renderRequestBanner()}
          {renderDayGrid()}
        </>
      ) : activeTab === '주간' ? (
        renderWeekGrid()
      ) : renderMonthView()}

      {/* FAB — Android 하단 nav bar 높이 반영 */}
      <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 24 }]} onPress={() => router.push('/lessons/new')}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* 새 레슨 등록 모달 */}
      <Modal visible={newModal} transparent animationType="slide" onRequestClose={() => setNewModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(40, insets.bottom + 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>새 레슨 등록</Text>
              <TouchableOpacity onPress={() => setNewModal(false)}><Ionicons name="close" size={22} color={Colors.mutedFg} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
              {/* 회원 선택 */}
              <Text style={styles.modalLabel}>회원 선택</Text>
              <TextInput style={styles.modalInput} placeholder="이름 검색..." value={memberSearch} onChangeText={setMemberSearch} />
              <ScrollView style={styles.memberList} nestedScrollEnabled>
                {members.filter(m => m.name.includes(memberSearch)).map(m => {
                  const selected = newMemberIds.includes(m.id);
                  return (
                    <TouchableOpacity key={m.id} style={[styles.memberItem, selected && styles.memberItemSelected]}
                      onPress={() => setNewMemberIds(prev => selected ? prev.filter(id => id !== m.id) : [...prev, m.id])}>
                      <Text style={[styles.memberItemText, selected && styles.memberItemTextSelected]}>{m.name}</Text>
                      {selected && <Ionicons name="checkmark" size={16} color={Colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {newMemberIds.length > 0 && (
                <Text style={styles.selectedNames}>{members.filter(m => newMemberIds.includes(m.id)).map(m => m.name).join(', ')}</Text>
              )}

              {/* 시작 시간 - Hour/Minute 스피너 */}
              <Text style={styles.modalLabel}>시작 시간</Text>
              <View style={styles.timeRow}>
                <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setHourPickerVisible(true); setMinutePickerVisible(false); setDurationPickerVisible(false); }}>
                  <Text style={styles.spinnerBtnLabel}>시</Text>
                  <Text style={styles.spinnerBtnValue}>{newHour}</Text>
                </TouchableOpacity>
                <Text style={styles.colonText}>:</Text>
                <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setMinutePickerVisible(true); setHourPickerVisible(false); setDurationPickerVisible(false); }}>
                  <Text style={styles.spinnerBtnLabel}>분</Text>
                  <Text style={styles.spinnerBtnValue}>{newMinute}</Text>
                </TouchableOpacity>
              </View>
              {hourPickerVisible && (
                <View style={styles.inlinePickerBox}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {SPINNER_HOURS.map(item => (
                      <TouchableOpacity key={item} style={[styles.inlinePickerItem, newHour === item && styles.inlinePickerItemActive]}
                        onPress={() => { setNewHour(item); setHourPickerVisible(false); }}>
                        <Text style={[styles.inlinePickerText, newHour === item && styles.inlinePickerTextActive]}>{item}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
              {minutePickerVisible && (
                <View style={styles.inlinePickerBox}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {SPINNER_MINUTES.map(item => (
                      <TouchableOpacity key={item} style={[styles.inlinePickerItem, newMinute === item && styles.inlinePickerItemActive]}
                        onPress={() => { setNewMinute(item); setMinutePickerVisible(false); }}>
                        <Text style={[styles.inlinePickerText, newMinute === item && styles.inlinePickerTextActive]}>{item}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* 레슨 시간 - 분 스피너 */}
              <Text style={styles.modalLabel}>레슨 시간</Text>
              <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setDurationPickerVisible(v => !v); setHourPickerVisible(false); setMinutePickerVisible(false); }}>
                <Text style={styles.spinnerBtnLabel}>분</Text>
                <Text style={styles.spinnerBtnValue}>{newDuration}분</Text>
              </TouchableOpacity>
              {durationPickerVisible && (
                <View style={styles.inlinePickerBox}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {DURATION_OPTIONS.map(item => (
                      <TouchableOpacity key={item} style={[styles.inlinePickerItem, newDuration === item && styles.inlinePickerItemActive]}
                        onPress={() => { setNewDuration(item); setDurationPickerVisible(false); }}>
                        <Text style={[styles.inlinePickerText, newDuration === item && styles.inlinePickerTextActive]}>{item}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <Text style={styles.timeSummary}>{newHour}:{newMinute} ~ {minutesToTime(parseInt(newHour) * 60 + parseInt(newMinute) + newDuration)}</Text>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveNew} disabled={savingNew}>
                {savingNew ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>등록</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>


      {/* 예약 요청 모달 */}
      <Modal visible={requestModal} transparent animationType="slide" onRequestClose={() => setRequestModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(40, insets.bottom + 20) }]}>
            <Text style={styles.modalTitle}>레슨 예약 요청</Text>
            {selectedRequest && (
              <>
                {/* 회원 정보 카드 */}
                <View style={styles.requestInfoCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.requestMemberName}>{selectedRequest.member?.name ?? '회원'}</Text>
                    {pendingRequests.length > 1 && (
                      <View style={{ backgroundColor: Colors.warning + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ fontSize: 13, color: Colors.warning, fontWeight: '700' }}>외 {pendingRequests.length - 1}건 대기중</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.requestDateTime}>
                    {selectedRequest.requested_date}{'  '}
                    {selectedRequest.start_time?.slice(0,5)} ~ {selectedRequest.end_time?.slice(0,5)}
                  </Text>
                  {selectedRequest.message ? (
                    <View style={styles.requestMsgBox}>
                      <Text style={styles.requestMsgLabel}>회원 메시지</Text>
                      <Text style={styles.requestMsgText}>{selectedRequest.message}</Text>
                    </View>
                  ) : null}
                </View>

                {/* 거절 시 메시지 입력 */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.mutedFg, marginBottom: 6 }}>
                    거절 메시지 (선택)
                  </Text>
                  <TextInput
                    style={{
                      backgroundColor: Colors.mutedBg, borderRadius: 10,
                      padding: 12, fontSize: 14, color: Colors.foreground,
                      minHeight: 60, textAlignVertical: 'top',
                      borderWidth: 1, borderColor: Colors.border,
                    }}
                    placeholder="회원에게 전달할 메시지를 입력하세요"
                    placeholderTextColor={Colors.placeholder}
                    value={rejectMsg}
                    onChangeText={setRejectMsg}
                    multiline
                    maxLength={200}
                  />
                </View>

                {/* 수락 / 거절 버튼 */}
                <View style={styles.requestBtnRow}>
                  <TouchableOpacity style={[styles.requestBtn, styles.requestBtnReject]}
                    onPress={() => handleRejectRequest(selectedRequest)}>
                    <Ionicons name="close-circle-outline" size={18} color={Colors.foreground} />
                    <Text style={[styles.requestBtnText, { color: Colors.destructive }]}>거절</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.requestBtn, styles.requestBtnAccept]}
                    onPress={() => handleAcceptRequest(selectedRequest)}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={[styles.requestBtnText, { color: '#fff' }]}>수락</Text>
                  </TouchableOpacity>
                </View>

                {/* 나중에 — 하단 중앙 */}
                <TouchableOpacity
                  style={{ alignItems: 'center', paddingVertical: 14 }}
                  onPress={() => { setRequestModal(false); setRejectMsg(''); }}
                >
                  <Text style={{ color: Colors.mutedFg, fontSize: 14, fontWeight: '500' }}>나중에 처리하기</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── 드래그 가능한 레슨 카드 컴포넌트 ──────────────────────────
function DraggableLesson({
  lesson, top, height, left, width, isDragging, onPress, onDragEnd, onDragStart, onDragCancel,
  cardBg, cardNameColor, cardTimeColor,
}: {
  lesson: LessonWithMembers; top: number; height: number; left: number; width: number; isDragging: boolean;
  onPress: () => void; onDragEnd: (dy: number) => void; onDragStart: () => void; onDragCancel: () => void;
  cardBg: string; cardNameColor: string; cardTimeColor: string;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const dragging = useRef(false);
  const [liveDragTime, setLiveDragTime] = useState<string | null>(null);

  // 콜백을 ref로 관리 → PanResponder가 항상 최신 콜백 참조
  const onDragEndRef = useRef(onDragEnd);
  const onDragStartRef = useRef(onDragStart);
  const onDragCancelRef = useRef(onDragCancel);
  const onPressRef = useRef(onPress);
  const lessonStartMinRef = useRef(timeToMinutes(lesson.start_time));
  useEffect(() => {
    onDragEndRef.current = onDragEnd;
    onDragStartRef.current = onDragStart;
    onDragCancelRef.current = onDragCancel;
    onPressRef.current = onPress;
    lessonStartMinRef.current = timeToMinutes(lesson.start_time);
  }, [onDragEnd, onDragStart, onDragCancel, onPress, lesson.start_time]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => dragging.current,
    onStartShouldSetPanResponderCapture: () => dragging.current,
    onMoveShouldSetPanResponder: (_, g) => dragging.current && Math.abs(g.dy) > 3,
    onMoveShouldSetPanResponderCapture: (_, g) => dragging.current && Math.abs(g.dy) > 3,
    onPanResponderGrant: () => {
      pan.setOffset({ x: 0, y: (pan.y as any)._value });
      pan.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: (_, g) => {
      pan.y.setValue(g.dy);
      const deltaMin = Math.round((g.dy / HOUR_HEIGHT) * 60 / 10) * 10;
      const newMin = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 10, lessonStartMinRef.current + deltaMin));
      setLiveDragTime(minutesToTime(newMin));
    },
    onPanResponderRelease: (_, g) => {
      if (!dragging.current) return;
      dragging.current = false;
      pan.flattenOffset();
      const dy = g.dy;
      pan.setValue({ x: 0, y: 0 });
      setLiveDragTime(null);
      onDragEndRef.current(dy);
      onDragCancelRef.current();
    },
    onPanResponderTerminate: () => {
      dragging.current = false;
      pan.setValue({ x: 0, y: 0 });
      setLiveDragTime(null);
      onDragCancelRef.current();
    },
    onShouldBlockNativeResponder: () => dragging.current,
  })).current;

  const duration = timeToMinutes(lesson.end_time) - timeToMinutes(lesson.start_time);
  const nameStr = lesson.memberNames.length > 0 ? lesson.memberNames.join(', ') : lesson.title.replace(/ 레슨$/, '');
  const startTimeStr = lesson.start_time.slice(0, 5);
  const isShort = duration <= 20 || height <= 44;

  return (
    <Animated.View
      style={[
        styles.lessonCard,
        { top, height, left, width, transform: [{ translateY: pan.y }], zIndex: isDragging ? 999 : 1, backgroundColor: cardBg },
        isShort && { padding: 3, paddingHorizontal: 5 },
        isDragging && styles.lessonCardDragging,
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={{ flex: 1 }}
        onPress={() => { if (!isDragging) onPressRef.current(); }}
        onLongPress={() => {
          dragging.current = true;
          onDragStartRef.current();
        }}
        delayLongPress={350}
        activeOpacity={0.85}
      >
        {isShort ? (
          <View style={styles.lessonCardShortBody}>
            <Text style={[styles.lessonCardTitleShort, { color: cardNameColor }]} numberOfLines={1}>{nameStr}</Text>
            <Text style={[styles.lessonCardTimeShort, { color: cardTimeColor }]} numberOfLines={1}>{startTimeStr}</Text>
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', gap: 2 }}>
            <Text style={[styles.lessonCardTitle, { color: cardNameColor }]} numberOfLines={1}>{nameStr}</Text>
            <Text style={[styles.lessonCardTime, { color: cardTimeColor }]} numberOfLines={1}>
              {startTimeStr}{duration >= 30 ? ` · ${duration}분` : ''}
            </Text>
          </View>
        )}
      </TouchableOpacity>
      {isDragging && liveDragTime && liveDragTime !== startTimeStr && (
        <View style={styles.dragTimeLabel}>
          <View style={styles.dragTimeLabelInner}>
            <Text style={styles.dragTimeLabelText}>{startTimeStr} → {liveDragTime}</Text>
          </View>
        </View>
      )}
      {isDragging && (
        <View style={styles.dragHandle}>
          <Ionicons name="reorder-three" size={16} color={cardNameColor} />
        </View>
      )}
    </Animated.View>
  );
}

// ── 주간 드래그 가능한 레슨 블록 ──────────────────────────────────
function WeekDraggableBlock({
  lesson, top, height, left, width, isDragging, attStatus, onPress, onDragEnd, onDragStart, onDragCancel,
}: {
  lesson: LessonWithMembers; top: number; height: number; left: number; width: number; isDragging: boolean;
  attStatus: 'scheduled' | 'completed' | 'absent';
  onPress: () => void; onDragEnd: (dy: number, dx: number) => void; onDragStart: () => void; onDragCancel: () => void;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const dragging = useRef(false);
  const [liveDragTime, setLiveDragTime] = useState<string | null>(null);

  const onDragEndRef = useRef(onDragEnd);
  const onDragStartRef = useRef(onDragStart);
  const onDragCancelRef = useRef(onDragCancel);
  const onPressRef = useRef(onPress);
  const lessonStartMinRef = useRef(timeToMinutes(lesson.start_time));
  useEffect(() => {
    onDragEndRef.current = onDragEnd;
    onDragStartRef.current = onDragStart;
    onDragCancelRef.current = onDragCancel;
    onPressRef.current = onPress;
    lessonStartMinRef.current = timeToMinutes(lesson.start_time);
  }, [onDragEnd, onDragStart, onDragCancel, onPress, lesson.start_time]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => dragging.current,
    onStartShouldSetPanResponderCapture: () => dragging.current,
    onMoveShouldSetPanResponder: (_, g) => dragging.current && Math.abs(g.dy) > 3,
    onMoveShouldSetPanResponderCapture: (_, g) => dragging.current && Math.abs(g.dy) > 3,
    onPanResponderGrant: () => {
      pan.setOffset({ x: 0, y: (pan.y as any)._value });
      pan.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: (_, g) => {
      pan.y.setValue(g.dy);
      const deltaMin = Math.round((g.dy / HOUR_HEIGHT) * 60 / 10) * 10;
      const newMin = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 10, lessonStartMinRef.current + deltaMin));
      setLiveDragTime(minutesToTime(newMin));
    },
    onPanResponderRelease: (_, g) => {
      if (!dragging.current) return;
      dragging.current = false;
      pan.flattenOffset();
      const dy = g.dy;
      const dx = g.dx;
      pan.setValue({ x: 0, y: 0 });
      setLiveDragTime(null);
      onDragEndRef.current(dy, dx);
      onDragCancelRef.current();
    },
    onPanResponderTerminate: () => {
      dragging.current = false;
      pan.setValue({ x: 0, y: 0 });
      setLiveDragTime(null);
      onDragCancelRef.current();
    },
    onShouldBlockNativeResponder: () => dragging.current,
  })).current;

  const duration = timeToMinutes(lesson.end_time) - timeToMinutes(lesson.start_time);
  const nameStr = lesson.memberNames.length > 0 ? lesson.memberNames.join(', ') : lesson.title.replace(/ 레슨$/, '');
  const startTimeStr = lesson.start_time.slice(0, 5);
  const isCompact = height < 44;

  const cardBg = attStatus === 'absent' ? '#FFE8E8'
    : attStatus === 'completed' ? S_DONE_BG
    : S_SCH_BG;
  const nameColor = attStatus === 'absent' ? '#C0393A'
    : attStatus === 'completed' ? S_DONE_FG
    : S_SCH_FG;
  const timeColor = attStatus === 'absent' ? '#C0393A'
    : attStatus === 'completed' ? S_TEXT_MUTED
    : S_TERRA;

  return (
    <Animated.View
      style={[
        styles.weekLessonBlock,
        {
          top, height, left, width,
          backgroundColor: cardBg,
          transform: [{ translateY: pan.y }],
          zIndex: isDragging ? 999 : 1,
        },
        isDragging && { opacity: 0.85, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 8 },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={{ flex: 1 }}
        onPress={() => { if (!isDragging) onPressRef.current(); }}
        onLongPress={() => { dragging.current = true; onDragStartRef.current(); }}
        delayLongPress={350}
        activeOpacity={0.8}
      >
        {isCompact ? (
          <View style={{ flex: 1, justifyContent: 'center', gap: 0 }}>
            <Text style={[styles.weekBlockNameSmall, { color: nameColor }]} numberOfLines={1}>{nameStr}</Text>
            <Text style={[styles.weekBlockTimeSmall, { color: timeColor }]} numberOfLines={1}>{startTimeStr}</Text>
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', gap: 1 }}>
            <Text style={[styles.weekBlockName, { color: nameColor }]} numberOfLines={1}>{nameStr}</Text>
            <Text style={[styles.weekBlockTime, { color: timeColor }]} numberOfLines={1}>
              {startTimeStr}{duration >= 30 ? ` · ${duration}분` : ''}
            </Text>
          </View>
        )}
      </TouchableOpacity>
      {isDragging && liveDragTime && liveDragTime !== startTimeStr && (
        <View style={[styles.dragTimeLabel, { top: -28 }]}>
          <View style={styles.dragTimeLabelInner}>
            <Text style={styles.dragTimeLabelText}>{startTimeStr} → {liveDragTime}</Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabRow: { flexDirection: 'row', backgroundColor: Colors.background, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: Radius.md, alignItems: 'center', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  tabBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.mutedFg },
  tabTextActive: { color: '#fff', fontWeight: '700' },
  weekStrip: { flexDirection: 'row', backgroundColor: S_BG, paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: S_BORDER, gap: 4, marginTop: 10 },
  dayBtn: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 10, backgroundColor: 'transparent' },
  daySelected: { backgroundColor: S_TERRA },
  dayName: { fontSize: 12, color: S_TEXT_MUTED, marginBottom: 2 },
  dayNum: { fontSize: 15, fontWeight: '700', color: S_TEXT },
  dayTextSelected: { color: '#fff' },
  dayToday: { color: S_TERRA },
  dateHeader: { fontSize: 20, fontWeight: '700', color: Colors.foreground, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, backgroundColor: Colors.background, borderBottomWidth: 1, borderBottomColor: Colors.border },
  // 그리드
  hourRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  hourLabel: { width: 56, fontSize: 11, color: Colors.placeholder, fontWeight: '600', textAlign: 'right', paddingRight: 6, flexShrink: 0 },
  hourLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  gridTapOverlay: { position: 'absolute', left: 56, right: 0, top: 0 },
  // 레슨 카드 (그리드)
  lessonCard: {
    position: 'absolute',
    borderRadius: 8, padding: 6, paddingHorizontal: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2,
    },
  lessonCardDragging: { opacity: 0.85, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 8 },
  lessonCardTime: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600', flexShrink: 0 },
  lessonCardTitle: { fontSize: 14, color: '#fff', fontWeight: '700', flexShrink: 1 },
  lessonCardMembers: { fontSize: 13, color: Colors.mutedFg, marginTop: 2 },
  dragHandle: { position: 'absolute', bottom: 3, right: 6 },
  // 주간 뷰
  weekScroll: { flex: 1 },
  weekDayCol: { width: 130, backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  weekDayColToday: { borderWidth: 2, borderColor: Colors.primary },
  weekDayHeader: { backgroundColor: Colors.background, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.border },
  weekDayHeaderToday: { backgroundColor: Colors.primary },
  weekDayName: { fontSize: 13, color: Colors.mutedFg, fontWeight: '600' },
  weekDayNameToday: { color: 'rgba(255,255,255,0.85)' },
  weekDayNum: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginTop: 2 },
  weekDayNumToday: { color: '#fff' },
  weekEmptySlot: { padding: 16, alignItems: 'center' },
  weekEmptyText: { fontSize: 20, color: Colors.border },
  weekLessonCard: { margin: 8, backgroundColor: Colors.card, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.primary },
  weekLessonTime: { fontSize: 13, color: Colors.mutedFg, fontWeight: '500', marginBottom: 2 },
  weekLessonTitle: { fontSize: 14, color: Colors.foreground, fontWeight: '600' },
  weekLessonMembers: { fontSize: 13, color: Colors.mutedFg, marginTop: 2 },
  // FAB
  fab: { position: 'absolute', bottom: 24, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  // 모달
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  modalLabel: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, marginBottom: 8, marginTop: 12 },
  modalInput: { backgroundColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.foreground, borderWidth: 1, borderColor: Colors.border },
  timeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  timeAdj: { flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  timeAdjText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  timeDisplay: { fontSize: 32, fontWeight: '800', color: Colors.navy, textAlign: 'center', marginBottom: 4 },
  timeSummary: { fontSize: 13, color: Colors.mutedFg, textAlign: 'center', marginBottom: 16 },
  durationBtn: { flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  durationBtnActive: { backgroundColor: Colors.primary },
  durationBtnText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  durationBtnTextActive: { color: '#fff' },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  nowLine: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  nowTimeAboveLabel: { position: 'absolute', left: 0, top: -14, width: 52, textAlign: 'right', paddingRight: 3, fontSize: 9, fontWeight: '800', color: Colors.destructive },
  nowDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.destructive, marginLeft: 42 },
  nowLineBar: { flex: 1, height: 2, backgroundColor: Colors.destructive, marginLeft: 2 },
  halfHourLine: { position: 'absolute', left: 56, right: 0, height: 1, backgroundColor: Colors.border, opacity: 0.4 },
  memberList: { maxHeight: 160, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, marginBottom: 8 },
  memberItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.mutedBg },
  memberItemSelected: { backgroundColor: Colors.primaryLight },
  memberItemText: { fontSize: 14, color: Colors.foreground },
  memberItemTextSelected: { color: Colors.navy, fontWeight: '700' },
  selectedNames: { fontSize: 14, color: Colors.navy, fontWeight: '600', marginBottom: 4, backgroundColor: Colors.primaryLight, padding: 8, borderRadius: 8 },
  spinnerBtn: { flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  spinnerBtnLabel: { fontSize: 13, color: Colors.placeholder, fontWeight: '600', marginBottom: 2 },
  spinnerBtnValue: { fontSize: 20, fontWeight: '800', color: Colors.navy },
  colonText: { fontSize: 24, fontWeight: '800', color: Colors.foreground, paddingHorizontal: 8, alignSelf: 'center', marginTop: 12 },
  inlinePickerBox: { backgroundColor: Colors.background, borderRadius: 10, padding: 8, marginTop: 6, marginBottom: 4 },
  inlinePickerItem: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, marginHorizontal: 3, alignItems: 'center' },
  inlinePickerItemActive: { backgroundColor: Colors.primary },
  inlinePickerText: { fontSize: 16, fontWeight: '600', color: Colors.mutedFg },
  inlinePickerTextActive: { color: '#fff', fontWeight: '800' },


  // 주간 타임그리드 스타일
  weekNavBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 8 },
  weekNavBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.mutedBg, justifyContent: 'center', alignItems: 'center' },
  weekNavTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: Colors.navy },
  weekTodayBtn: { backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  weekTodayBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  weekDayHeaderRow: { flexDirection: 'row', backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  weekColHeader: { alignItems: 'center', paddingVertical: 8, borderLeftWidth: 1, borderLeftColor: Colors.border },
  weekColHeaderToday: { backgroundColor: Colors.primary },
  weekColDayName: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  weekColDayNameToday: { color: 'rgba(255,255,255,0.8)' },
  weekColDayNum: { fontSize: 17, fontWeight: '800', color: Colors.foreground, marginTop: 1 },
  weekColDayNumToday: { color: Colors.white },
  weekHourLabel: { position: 'absolute', left: 0, right: 0, justifyContent: 'flex-start', alignItems: 'flex-end', paddingRight: 8, height: HOUR_HEIGHT },
  weekDayColGrid: { position: 'relative', borderLeftWidth: 1, borderLeftColor: Colors.border },
  weekHourLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.border },
  weekNowLine: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  weekNowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.destructive },
  weekSubHourLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.border, opacity: 0.35 },
  weekLessonBlock: { position: 'absolute', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2, overflow: 'hidden', justifyContent: 'space-between' },
  weekBlockName: { fontSize: 12, fontWeight: '700', color: Colors.white, lineHeight: 13 },
  weekBlockTime: { fontSize: 11, fontWeight: '700', color: 'rgba(255,220,210,0.9)', lineHeight: 13 },
  weekBlockNameSmall: { fontSize: 10, fontWeight: '700', color: Colors.white, lineHeight: 12 },
  weekBlockTimeSmall: { fontSize: 9, fontWeight: '600', color: 'rgba(255,220,210,0.9)', lineHeight: 11 },
  // 월간 뷰
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  monthNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.mutedBg, justifyContent: 'center', alignItems: 'center' },
  monthTitle: { fontSize: 17, fontWeight: '800', color: Colors.navy },
  monthDayHeaders: { flexDirection: 'row', backgroundColor: Colors.white, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: Colors.border },
  monthDayName: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700', color: Colors.mutedFg },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4, paddingTop: 4 },
  monthCell: { width: '14.28%', minHeight: 64, padding: 4, alignItems: 'center', borderRadius: 8 },
  monthCellToday: { backgroundColor: Colors.primary + '18' },
  monthCellDay: { fontSize: 15, fontWeight: '600', color: Colors.foreground, marginBottom: 3 },
  monthCellDayToday: { color: Colors.primary, fontWeight: '800' },
  monthLessonDots: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  monthDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary },
  monthLessonCount: { fontSize: 12, fontWeight: '700', color: Colors.primary, marginLeft: 1 },
  monthSummary: { flexDirection: 'row', marginHorizontal: 16, marginTop: 16, backgroundColor: Colors.white, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border },
  monthSummaryItem: { flex: 1, alignItems: 'center' },
  monthSummaryDivider: { width: 1, backgroundColor: Colors.border },
  monthSummaryNum: { fontSize: 22, fontWeight: '800', color: Colors.navy },
  monthSummaryLabel: { fontSize: 13, color: Colors.mutedFg, marginTop: 2 },

  requestBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.card, marginHorizontal: 12, marginTop: 8,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.foreground,
  },
  requestBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  requestBannerText: { color: Colors.foreground, fontWeight: '700', fontSize: 14 },
  requestBannerBadge: {
    backgroundColor: Colors.mutedBg, borderRadius: 12, minWidth: 24, height: 24,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  requestBannerBadgeText: { color: Colors.foreground, fontWeight: '900', fontSize: 13 },
  requestInfoCard: { backgroundColor: Colors.background, borderRadius: 12, padding: 16, marginBottom: 16 },
  requestMemberName: { fontSize: 18, fontWeight: '900', color: Colors.navy, marginBottom: 4 },
  requestDateTime: { fontSize: 14, color: Colors.primary, fontWeight: '700', marginBottom: 8 },
  requestMsgBox: { backgroundColor: '#fff', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: Colors.border },
  requestMsgLabel: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginBottom: 4 },
  requestMsgText: { fontSize: 14, color: Colors.foreground },
  requestMore: { fontSize: 14, color: Colors.mutedFg, textAlign: 'center', marginBottom: 12 },
  requestBtnRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  requestBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 14 },
  requestBtnReject: { backgroundColor: 'rgba(45,51,64,0.08)', borderWidth: 1.5, borderColor: Colors.border },
  requestBtnAccept: { backgroundColor: Colors.primary },
  requestBtnText: { fontSize: 16, fontWeight: '800' },
  // 일일 뷰 카드 추가 스타일
  lessonCardShortBody: { flex: 1, justifyContent: 'center', gap: 1 },
  lessonCardTitleShort: { fontSize: 11, color: '#fff', fontWeight: '700' },
  lessonCardTimeShort: { fontSize: 10, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  // 드래그 시간 레이블
  dragTimeLabel: { position: 'absolute', top: -30, left: 0, right: 0, alignItems: 'center', zIndex: 1000 },
  dragTimeLabelInner: { backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  dragTimeLabelText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  // 10분 보조 눈금
  subHourLine: { position: 'absolute', left: 56, right: 0, height: 1, backgroundColor: Colors.border, opacity: 0.35 },
  // 일일 뷰 헤더
  dayHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, backgroundColor: Colors.background, borderBottomWidth: 1, borderBottomColor: Colors.border },
  dayHeaderLeft: { flex: 1 },
  dayHeaderTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  dayHeaderHint: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  dayHeaderNav: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  dayNavBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.mutedBg, justifyContent: 'center', alignItems: 'center' },
  dayTodayBtn: { backgroundColor: Colors.primary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  dayTodayBtnText: { color: Colors.white, fontSize: 12, fontWeight: '700' },
  // 통합 헤더
  unifiedHeader: { backgroundColor: S_BG, borderBottomWidth: 1, borderBottomColor: S_BORDER, paddingHorizontal: 16, paddingBottom: 12 },
  unifiedTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  unifiedTitle: { fontSize: 26, fontWeight: '900', color: S_TEXT },
  requestBell: { position: 'relative', padding: 4 },
  requestBellBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: S_TERRA, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  requestBellBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  segmentWrap: { marginBottom: 10 },
  segmentControl: { flexDirection: 'row', backgroundColor: S_SEG_BG, borderRadius: 10, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segmentItemActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  segmentText: { fontSize: 14, fontWeight: '600', color: S_TEXT_MUTED },
  segmentTextActive: { color: S_TEXT, fontWeight: '700' },
  dateNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateNavBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: S_SEG_BG, justifyContent: 'center', alignItems: 'center' },
  dateNavLabel: { fontSize: 15, fontWeight: '700', color: S_TEXT, flex: 1, textAlign: 'center' },
  // 월간 인라인 레슨 목록
  monthCellSelected: { backgroundColor: S_TERRA + '22' },
  monthInlineList: { marginHorizontal: 16, marginTop: 12, backgroundColor: S_CARD_BG, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: S_BORDER },
  monthInlineLabel: { fontSize: 15, fontWeight: '800', color: S_TEXT, marginBottom: 10 },
  monthInlineEmpty: { fontSize: 14, color: S_TEXT_MUTED, textAlign: 'center', paddingVertical: 10 },
  monthInlineItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S_BORDER, gap: 10 },
  monthInlineItemBar: { width: 4, height: 36, borderRadius: 2, backgroundColor: S_TERRA },
  monthInlineItemName: { fontSize: 14, fontWeight: '700', color: S_TEXT },
  monthInlineItemTime: { fontSize: 13, color: S_TEXT_MUTED, marginTop: 2 },
});
