import { useState, useRef, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  Modal, Keyboard,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { MemberLevel } from '../../types';
import { Colors } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';
import { ScheduleSection, ScheduleType, DayTimes, DateEntry } from '../../components/ScheduleSection';
import { buildMemberUpsertPayload, MEMBER_LEVELS } from './member-form';
import { getCurrentSubscription, canAddMember } from '../../lib/subscription';
import { syncRevenueCatToDb } from '../../lib/purchases';
import { IS_BETA } from '../../lib/beta';

const LEVELS: MemberLevel[] = MEMBER_LEVELS;
const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const PRESET_COLORS = [Colors.primary, Colors.info, Colors.navy, Colors.destructive, '#ea580c', '#0891b2', '#65a30d'];
const PACKAGE_DURATIONS = ['30', '60', '90'];

function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

/** KST(한국 시간) 기준 날짜 문자열 반환 */
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

/** 충돌 체크: 요일별 다중 시간 지원 */
async function checkConflicts(
  coachId: string,
  scheduleDays: number[],
  dayTimes: DayTimes,
  lessonDuration: number,
  excludeMemberId?: string,
): Promise<{ date: string; memberName: string; startTime: string }[]> {
  const allConflicts: { date: string; memberName: string; startTime: string }[] = [];

  for (const day of scheduleDays) {
    const times = dayTimes[day] ?? [];
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

      const { data: existing } = await supabase
        .from('lessons')
        .select('id, date, start_time, end_time, lesson_members(member_id, member:members(name))')
        .eq('coach_id', coachId)
        .in('date', checkDates);

      for (const lesson of (existing ?? []) as any[]) {
        if (!lesson.lesson_members || lesson.lesson_members.length === 0) continue;
        const lessonDate = new Date(lesson.date + 'T00:00:00');
        if (lessonDate.getDay() !== day) continue;
        const [lh, lm] = lesson.start_time.slice(0, 5).split(':').map(Number);
        const [eh, em] = lesson.end_time.slice(0, 5).split(':').map(Number);
        const lStart = lh * 60 + lm;
        const lEnd = eh * 60 + em;
        if (newStart < lEnd && newEnd > lStart) {
          for (const lmRow of lesson.lesson_members ?? []) {
            if (excludeMemberId && lmRow.member_id === excludeMemberId) continue;
            const mName = lmRow.member?.name ?? '다른 회원';
            if (!allConflicts.find(cf => cf.date === lesson.date && cf.memberName === mName && cf.startTime === lesson.start_time.slice(0, 5))) {
              allConflicts.push({ date: lesson.date, memberName: mName, startTime: lesson.start_time.slice(0, 5) });
            }
          }
        }
      }
    }
  }
  return allConflicts;
}

async function checkConflictsForDates(
  coachId: string,
  entries: DateEntry[],
  lessonDuration: number,
): Promise<{ date: string; memberName: string; startTime: string }[]> {
  const allConflicts: { date: string; memberName: string; startTime: string }[] = [];
  const dates = [...new Set(entries.map(e => e.date))];
  if (!dates.length) return allConflicts;
  const { data: existing } = await supabase
    .from('lessons')
    .select('id, date, start_time, end_time, lesson_members(member_id, member:members(name))')
    .eq('coach_id', coachId)
    .in('date', dates);
  for (const entry of entries) {
    const [hh, mm] = entry.time.split(':').map(Number);
    const newStart = hh * 60 + mm;
    const newEnd = newStart + lessonDuration;
    for (const lesson of (existing ?? []) as any[]) {
      if (lesson.date !== entry.date) continue;
      if (!lesson.lesson_members?.length) continue;
      const lStart = timeToMinutes(lesson.start_time);
      const lEnd = timeToMinutes(lesson.end_time);
      if (newStart < lEnd && newEnd > lStart) {
        for (const lmRow of lesson.lesson_members) {
          const mName = lmRow.member?.name ?? '다른 회원';
          if (!allConflicts.find(cf => cf.date === lesson.date && cf.startTime === lesson.start_time.slice(0, 5))) {
            allConflicts.push({ date: lesson.date, memberName: mName, startTime: lesson.start_time.slice(0, 5) });
          }
        }
      }
    }
  }
  return allConflicts;
}

/** 고정 스케줄 기반 레슨 자동 생성 (요일별 다중 시간 지원, 과거 스케줄 포함) */
async function generateScheduleLessons(params: {
  coachId: string; memberId: string; memberName: string;
  scheduleDays: number[]; dayTimes: DayTimes; lessonDuration: number;
  totalCredits: number; remainingCredits?: number; joinDate: string;
  repeatType?: 'none' | 'weekly' | 'custom';
  repeatInterval?: number;
}) {
  const {
    coachId, memberId, memberName, scheduleDays, dayTimes,
    lessonDuration, totalCredits, remainingCredits, joinDate,
    repeatType = 'weekly', repeatInterval = 1,
  } = params;
  if (!scheduleDays.length) return;

  const startDate = new Date(joinDate + 'T00:00:00+09:00');
  const todayKST = kstToday();
  const isHistorical = startDate < todayKST;
  const interval = repeatType === 'custom' ? Math.max(1, repeatInterval) : 1;

  // 남은 횟수 기준으로 생성할 미래/과거 레슨 수 계산
  const futureLimit = remainingCredits !== undefined
    ? remainingCredits
    : (totalCredits > 0 ? totalCredits : 12);
  const pastLimit = isHistorical && remainingCredits !== undefined
    ? Math.max(0, totalCredits - remainingCredits)
    : 0;

  const dates: { date: string; time: string }[] = [];

  if (repeatType === 'none') {
    // '안 함': 오늘 이후 첫 번째 매칭 날짜/시간 1개만
    const cursor = new Date(isHistorical ? todayKST : startDate);
    let iter = 0;
    while (dates.length === 0 && iter < 30) {
      const dow = cursor.getDay();
      if (scheduleDays.includes(dow)) {
        const times = dayTimes[dow] ?? [];
        if (times.length > 0) dates.push({ date: toKSTDateStr(cursor), time: times[0] });
      }
      cursor.setDate(cursor.getDate() + 1);
      iter++;
    }
  } else {
    // Phase 1: 과거 스케줄 (레슨 시작일 ~ 오늘 이전, 사용된 횟수만큼)
    if (pastLimit > 0) {
      const cursor = new Date(startDate);
      const maxIter = pastLimit * 14 * (interval + 1) + 100;
      let pastCount = 0;
      let iter = 0;
      while (pastCount < pastLimit && iter < maxIter) {
        if (cursor >= todayKST) break;
        const dow = cursor.getDay();
        if (scheduleDays.includes(dow)) {
          const weekOffset = Math.floor(
            (cursor.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
          );
          if (weekOffset % interval === 0) {
            for (const time of (dayTimes[dow] ?? [])) {
              if (pastCount < pastLimit) {
                dates.push({ date: toKSTDateStr(cursor), time });
                pastCount++;
              }
            }
          }
        }
        cursor.setDate(cursor.getDate() + 1);
        iter++;
      }
    }

    // Phase 2: 미래 스케줄 (오늘 이후, 남은 횟수만큼)
    if (futureLimit > 0) {
      const cursor = new Date(isHistorical ? todayKST : startDate);
      const maxIter = futureLimit * 14 * (interval + 1) + 100;
      let futureCount = 0;
      let iter = 0;
      while (futureCount < futureLimit && iter < maxIter) {
        const dow = cursor.getDay();
        if (scheduleDays.includes(dow)) {
          const weekOffset = Math.floor(
            (cursor.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
          );
          if (weekOffset % interval === 0) {
            for (const time of (dayTimes[dow] ?? [])) {
              if (futureCount < futureLimit) {
                dates.push({ date: toKSTDateStr(cursor), time });
                futureCount++;
              }
            }
          }
        }
        cursor.setDate(cursor.getDate() + 1);
        iter++;
      }
    }
  }

  let successCount = 0;
  const errors: string[] = [];
  for (const { date, time } of dates) {
    const [hh, mm] = time.split(':').map(Number);
    const endMin = hh * 60 + mm + lessonDuration;
    const startSt = time + ':00';
    const endSt = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0') + ':00';

    const { data: lesson, error: lErr } = await supabase.from('lessons')
      .insert({ coach_id: coachId, title: memberName, date, start_time: startSt, end_time: endSt, source: 'auto' })
      .select('id').single();
    if (lErr || !lesson) { errors.push(lErr?.message ?? 'unknown'); continue; }
    const { error: lmErr } = await supabase.from('lesson_members').insert({ lesson_id: lesson.id, member_id: memberId });
    if (!lmErr) successCount++;
  }
  return { successCount, errors };
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


function formatDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export default function NewMemberScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<any>(null);

  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setIsKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setIsKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useFocusEffect(useCallback(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from('lesson_packages').select('*')
        .eq('coach_id', user.id).order('created_at', { ascending: false });
      const pkgs = data ?? [];
      setLessonPackages(pkgs);

      const pendingId = await AsyncStorage.getItem('pending_new_package_id');
      if (pendingId) {
        await AsyncStorage.removeItem('pending_new_package_id');
        const pkg = pkgs.find(p => p.id === pendingId);
        if (pkg) {
          setSelectedPackageId(pkg.id);
          setTotalCredits(String(pkg.total_credits ?? 10));
          setRemainingCredits(String(pkg.total_credits ?? 10));
          setLessonDuration(String(pkg.duration_minutes ?? 60));
        }
      }
    });
  }, []));

  // 연결 요청(새 회원으로 등록)에서 넘어온 경우 프리필 + 등록 후 자동 연결
  const params = useLocalSearchParams();
  const fromRequestId = typeof params.fromRequestId === 'string' ? params.fromRequestId : null;
  const [name, setName] = useState(typeof params.prefillName === 'string' ? params.prefillName : '');
  const [phone, setPhone] = useState(typeof params.prefillPhone === 'string' ? params.prefillPhone : '');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [level, setLevel] = useState<MemberLevel | null>(null); // 미선택 시 저장하지 않음
  const [joinDate, setJoinDate] = useState(toKSTDateStr(new Date()));
  const [lessonStartDate, setLessonStartDate] = useState(toKSTDateStr(new Date()));
  const [notes, setNotes] = useState('');
  // 체험 회원 토글
  const [isTrial, setIsTrial] = useState(false);
  function toggleTrial(v: boolean) {
    setIsTrial(v);
    if (v) {
      setScheduleType('by_date');
      setByDateEntries([]);
    } else {
      setScheduleType('regular');
    }
  }
  // 추가 정보(이메일/생년월일/가입일/레벨/메모) 펼침
  const [extraInfoOpen, setExtraInfoOpen] = useState(false);

  // 일정 방식
  const [scheduleType, setScheduleType] = useState<ScheduleType>('regular');
  const [byDateEntries, setByDateEntries] = useState<DateEntry[]>([]);
  const [packageHighlight, setPackageHighlight] = useState(false);
  const [packageSectionY, setPackageSectionY] = useState(0);

  // 요일 및 요일별 시간 (다중 시간 지원)
  const [scheduleDays, setScheduleDays] = useState<number[]>([]);
  const [dayTimes, setDayTimes] = useState<DayTimes>({});

  const [lessonDuration, setLessonDuration] = useState('60');
  const [totalCredits, setTotalCredits] = useState('');
  const [remainingCredits, setRemainingCredits] = useState('');
  const [lessonPackages, setLessonPackages] = useState<any[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 체험 레슨 설정 (레슨권 섹션)
  const [trialDuration, setTrialDuration] = useState('60');
  const [trialDurationCustom, setTrialDurationCustom] = useState('');
  const [trialFee, setTrialFee] = useState('');
  const TRIAL_DURATION_PRESETS = ['20', '30', '40', '50', '60'];
  const isTrialCustomDuration = !TRIAL_DURATION_PRESETS.includes(trialDuration);

  // 반복 설정
  const [repeatType, setRepeatType] = useState<'none' | 'weekly' | 'custom'>('weekly');
  const [repeatInterval, setRepeatInterval] = useState<1 | 2 | 3 | 4>(1);
  const [repeatModalVisible, setRepeatModalVisible] = useState(false);
  const [customRepeatVisible, setCustomRepeatVisible] = useState(false);
  const [repeatAdvancedOpen, setRepeatAdvancedOpen] = useState(false);

  // 레슨권 인라인 생성 모달
  const [createPackageModalVisible, setCreatePackageModalVisible] = useState(false);
  const [newPkgCredits, setNewPkgCredits] = useState('10');
  const [newPkgDuration, setNewPkgDuration] = useState('60');
  const [newPkgPrice, setNewPkgPrice] = useState('');
  const [newPkgTitle, setNewPkgTitle] = useState('');
  const [newPkgTitleEdited, setNewPkgTitleEdited] = useState(false);
  const [newPkgColor, setNewPkgColor] = useState(Colors.primary);
  const [creatingPackage, setCreatingPackage] = useState(false);
  const suggestedPkgTitle = `${parseInt(newPkgCredits) || 10}회 ${parseInt(newPkgDuration) || 60}분 레슨권`;
  const newPkgTitleValue = newPkgTitleEdited ? newPkgTitle : suggestedPkgTitle;

  function openCreatePackageModal() {
    router.push('/lesson-packages/new?fromMemberNew=true');
  }

  async function handleCreatePackage() {
    const title = newPkgTitleValue.trim();
    if (!title) { Alert.alert('입력 오류', '레슨권 이름을 입력해주세요.'); return; }
    if (!newPkgPrice.trim() || isNaN(Number(newPkgPrice))) { Alert.alert('입력 오류', '금액을 숫자로 입력해주세요.'); return; }

    setCreatingPackage(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCreatingPackage(false); return; }

    // lesson-packages/new.tsx 와 동일한 payload
    const payload = {
      coach_id: user.id,
      title,
      days: [],
      price: parseInt(newPkgPrice) || 0,
      total_credits: parseInt(newPkgCredits) || 10,
      duration_minutes: parseInt(newPkgDuration) || 60,
      color: newPkgColor,
      notes: null,
      is_active: true,
    };
    const { data: created, error } = await supabase.from('lesson_packages').insert(payload).select('*').single();
    setCreatingPackage(false);
    if (error || !created) {
      console.error('lesson_packages error:', JSON.stringify(error));
      Alert.alert('오류', error?.message || '레슨권 저장에 실패했습니다.');
      return;
    }
    setLessonPackages(prev => [created, ...prev.filter(p => p.id !== created.id)]);
    setSelectedPackageId(created.id);
    setTotalCredits(String(created.total_credits ?? 10));
    setRemainingCredits(String(created.total_credits ?? 10));
    setLessonDuration(String(created.duration_minutes ?? 60));
    setCreatePackageModalVisible(false);
  }

  // 빈 시간대 모달
  const [slotsModalVisible, setSlotsModalVisible] = useState(false);
  const [slotsModalDay, setSlotsModalDay] = useState<number | null>(null);
  const [slotsData, setSlotsData] = useState<{ time: string; available: boolean }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsDateStr, setSlotsDateStr] = useState('');

  async function fetchAvailableSlots(day: number) {
    const today = new Date();
    const todayDow = today.getDay();
    const diff = (day - todayDow + 7) % 7;
    const target = new Date(today);
    target.setDate(today.getDate() + (diff === 0 ? 7 : diff)); // 이번주 같은 요일이면 다음주로
    const dateStr = toKSTDateStr(target);
    setSlotsDateStr(dateStr);
    setSlotsModalDay(day);
    setLoadingSlots(true);
    setSlotsModalVisible(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoadingSlots(false); return; }

    const [{ data: existingLessons }, { data: availData }] = await Promise.all([
      supabase.from('lessons').select('start_time, end_time').eq('coach_id', user.id).eq('date', dateStr),
      supabase.from('coach_availability').select('*').eq('coach_id', user.id).maybeSingle(),
    ]);

    // 요일별 가용 시간 범위 결정 (available_times 우선, 레거시 폴백)
    let availStartMin: number | null = null;
    let availEndMin: number | null = null;
    if (availData) {
      const times = (availData as any).available_times as Record<number, { start: string; end: string }> | null | undefined;
      const dayTime = times?.[day];
      if (dayTime) {
        availStartMin = timeToMinutes(dayTime.start);
        availEndMin = timeToMinutes(dayTime.end);
      } else if ((availData.available_days ?? []).includes(day)) {
        availStartMin = timeToMinutes((availData.available_start ?? '09:00:00').slice(0, 5));
        availEndMin = timeToMinutes((availData.available_end ?? '18:00:00').slice(0, 5));
      }
    }

    const selectedPkg = lessonPackages.find(p => p.id === selectedPackageId);
    const dur = selectedPkg?.duration_minutes ?? (parseInt(lessonDuration) || 60);

    const slots: { time: string; available: boolean }[] = [];
    for (let h = 6; h < 23; h++) {
      for (const m of [0, 30]) {
        const startMin = h * 60 + m;
        const endMin = startMin + dur;
        if (endMin > 23 * 60) continue;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const hasConflict = (existingLessons ?? []).some((l: any) => {
          const ls = timeToMinutes(l.start_time);
          const le = timeToMinutes(l.end_time);
          return startMin < le && endMin > ls;
        });
        const outsideAvail = availStartMin !== null && availEndMin !== null
          ? (startMin < availStartMin || endMin > availEndMin)
          : false;
        slots.push({ time: timeStr, available: !hasConflict && !outsideAvail });
      }
    }
    setSlotsData(slots);
    setLoadingSlots(false);
  }

  function handleSelectPackage(pkg: any) {
    if (selectedPackageId === pkg.id) {
      setSelectedPackageId(null);
      setTotalCredits('');
      setRemainingCredits('');
      setLessonDuration('60');
    } else {
      setSelectedPackageId(pkg.id);
      const credits = String(pkg.total_credits ?? 10);
      setTotalCredits(credits);
      setRemainingCredits(credits); // 신규 회원 기본값: 전체 횟수
      setLessonDuration(String(pkg.duration_minutes ?? 60));
    }
  }

  // 모든 선택 요일에 최소 1개 이상 시간이 있는 경우
  const allDaysHaveTimes = scheduleDays.length > 0 && scheduleDays.every(d => (dayTimes[d]?.length ?? 0) > 0);

  // 첫 레슨 날짜가 오늘인데 오늘 요일의 모든 시간이 이미 지났으면 내일부터 생성
  const todayStr = toKSTDateStr(new Date());
  const todayDow = kstToday().getDay();
  const nowKstMinutes = (() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kst.getUTCHours() * 60 + kst.getUTCMinutes();
  })();
  const todayTimesAllPast = lessonStartDate === todayStr
    && scheduleDays.includes(todayDow)
    && (dayTimes[todayDow]?.length ?? 0) > 0
    && dayTimes[todayDow].every(t => timeToMinutes(t) <= nowKstMinutes);
  const effectiveStartDate = todayTimesAllPast
    ? toKSTDateStr(new Date(kstToday().getTime() + 24 * 60 * 60 * 1000))
    : lessonStartDate;

  // 등록 요약
  const selectedPackage = lessonPackages.find(p => p.id === selectedPackageId);
  const summaryDuration = selectedPackage?.duration_minutes ?? (parseInt(lessonDuration) || 60);
  const summaryCredits = parseInt(totalCredits) || 0;
  const summaryRemaining = remainingCredits !== '' ? (parseInt(remainingCredits) || 0) : summaryCredits;
  const regularReady = scheduleType === 'regular' && allDaysHaveTimes;
  const byDateReady = scheduleType === 'by_date' && byDateEntries.length > 0;
  const hasScheduleEntries = regularReady || byDateReady;

  const scheduleSummary = (() => {
    if (scheduleType === 'later') return '일정은 나중에 추가할 수 있어요';
    if (scheduleType === 'by_date') return byDateEntries.length > 0 ? `날짜 ${byDateEntries.length}개 직접 선택` : '';
    if (!regularReady) return '';
    const sameTimes = scheduleDays.every(d => dayTimes[d].join(',') === dayTimes[scheduleDays[0]].join(','));
    const prefix = repeatType === 'custom' && repeatInterval > 1 ? `${repeatInterval}주마다` : repeatType === 'none' ? '1회' : '매주';
    if (sameTimes) {
      return `${prefix} ${scheduleDays.map(d => DAYS_KR[d]).join('·')} ${dayTimes[scheduleDays[0]].join('·')}·${summaryDuration}분`;
    }
    return `${prefix} ${scheduleDays.map(d => `${DAYS_KR[d]} ${dayTimes[d].join('·')}`).join(', ')} · ${summaryDuration}분`;
  })();

  const firstLessonDate = (() => {
    if (byDateReady) return byDateEntries[0].date;
    if (!regularReady) return null;
    const cursor = new Date(effectiveStartDate + 'T00:00:00+09:00');
    for (let i = 0; i < 14; i++) {
      const dow = new Date(cursor.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
      if (scheduleDays.includes(dow)) return toKSTDateStr(cursor);
      cursor.setTime(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return null;
  })();

  // 생성될 일정 수 (정기: 남은 횟수 기준, 날짜별: 선택한 날짜 수)
  const estimatedLessonCount = byDateReady
    ? byDateEntries.length
    : (regularReady && !isTrial && selectedPackageId && summaryCredits > 0)
      ? (repeatType === 'none' ? 1 : summaryRemaining)
      : 0;

  async function doSave(userId: string) {
    const credits = parseInt(totalCredits) || 0;
    const remainingCreditsInt = remainingCredits !== '' ? (parseInt(remainingCredits) || 0) : credits;
    const selectedPkg = lessonPackages.find(p => p.id === selectedPackageId);
    const duration = selectedPkg?.duration_minutes ?? (parseInt(lessonDuration) || 60);

    const scheduleTimesJson: Record<string, string[]> = {};
    let firstDayTime: string | null = null;
    if (scheduleType === 'regular') {
      for (const d of scheduleDays) {
        if (dayTimes[d]?.length) scheduleTimesJson[String(d)] = dayTimes[d];
      }
      firstDayTime = scheduleDays.length > 0 && dayTimes[scheduleDays[0]]?.[0] ? dayTimes[scheduleDays[0]][0] : null;
    }

    const basicPayload = buildMemberUpsertPayload({
      name,
      phone,
      email,
      birthDate,
      joinDate,
      level,
      notes,
    });

    const { data: newMember, error } = await supabase.from('members').insert({
      coach_id: userId,
      ...basicPayload,
      is_active: true,
      fixed_schedule_days: scheduleType === 'regular' ? scheduleDays : [],
      fixed_schedule_time: firstDayTime,
      fixed_schedule_times: scheduleType === 'regular' && Object.keys(scheduleTimesJson).length > 0 ? scheduleTimesJson : null,
      fixed_lesson_duration: duration,
      total_credits: isTrial ? 0 : credits,
      remaining_credits: isTrial ? 0 : remainingCreditsInt,
      lesson_package_id: isTrial ? null : (selectedPackageId || null),
      is_trial: isTrial,
      trial_started_at: isTrial ? (byDateEntries[0]?.date ?? toKSTDateStr(new Date())) : null,
      trial_lesson_count: 0,
    }).select('id').single();
    if (error || !newMember) { setLoading(false); Alert.alert('오류', '회원 등록에 실패했습니다.'); return; }

    // 연결 요청에서 넘어온 경우: 신규 회원으로 연결 처리(best-effort)
    if (fromRequestId) {
      await supabase.rpc('process_connection_request', {
        p_id: fromRequestId, p_action: 'process_new', p_member_id: newMember.id,
      });
    }

    let genResult: { successCount: number; errors: string[] } | null | undefined = null;
    if (scheduleType === 'regular' && allDaysHaveTimes && credits > 0) {
      genResult = await generateScheduleLessons({
        coachId: userId, memberId: newMember.id, memberName: name.trim(),
        scheduleDays, dayTimes, lessonDuration: duration, totalCredits: credits,
        remainingCredits: remainingCreditsInt,
        joinDate: effectiveStartDate,
        repeatType, repeatInterval,
      });
    } else if (scheduleType === 'by_date' && byDateEntries.length > 0) {
      const triaDur = isTrial ? (parseInt(trialDuration) || 60) : duration;
      const entries = isTrial ? byDateEntries.slice(0, 1) : byDateEntries;
      let successCount = 0;
      const errors: string[] = [];
      for (const entry of entries) {
        const [hh, mm] = entry.time.split(':').map(Number);
        const endMin = hh * 60 + mm + triaDur;
        const startSt = entry.time + ':00';
        const endSt = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`;
        const { data: lesson, error: lErr } = await supabase.from('lessons')
          .insert({ coach_id: userId, title: name.trim(), date: entry.date, start_time: startSt, end_time: endSt })
          .select('id').single();
        if (lErr || !lesson) { errors.push(lErr?.message ?? 'unknown'); continue; }
        const { error: lmErr } = await supabase.from('lesson_members').insert({ lesson_id: lesson.id, member_id: newMember.id });
        if (!lmErr) successCount++;
      }
      genResult = { successCount, errors };
    }
    setLoading(false);

    const genCount = genResult?.successCount ?? 0;
    const genErrors = genResult?.errors ?? [];

    let msg = genCount > 0 ? `일정 ${genCount}개가 생성됐습니다.` : '일정 없이 등록됐습니다.';
    if (genErrors.length > 0) {
      msg += genCount > 0 ? ` (${genErrors.length}건 실패)` : `\n일정 생성 실패: ${genErrors[0]}`;
    } else if (scheduleType === 'regular' && scheduleDays.length > 0 && !allDaysHaveTimes) {
      msg += '\n고정 스케줄을 저장하려면 각 요일별 시간을 설정해야 합니다.';
    }
    // 등록 폼으로 되돌아오지 않도록 replace 사용
    Alert.alert('회원 등록 완료', msg, [
      { text: '회원 보기', onPress: () => router.replace(`/members/${newMember.id}` as any) },
      { text: '스케줄 보기', onPress: () => router.replace('/(tabs)/schedule' as any) },
      { text: '확인', onPress: () => router.back() },
    ]);

    const { data: { user: u } } = await supabase.auth.getUser();
    if (u) {
      const POPUP_KEY = `@kerri_availability_popup_shown_${u.id}`;
      const [{ count: memberCount }, { data: avail }, alreadyShown] = await Promise.all([
        supabase.from('members').select('id', { count: 'exact', head: true }).eq('coach_id', u.id).eq('is_active', true),
        supabase.from('coach_availability').select('id').eq('coach_id', u.id).maybeSingle(),
        AsyncStorage.getItem(POPUP_KEY),
      ]);
      if ((memberCount ?? 0) >= 2 && !avail && !alreadyShown) {
        Alert.alert(
          '레슨 가능 시간 설정',
          '회원이 2명 이상입니다.\n회원이 레슨을 신청할 수 있는 가능 시간대를 설정해보세요.',
          [
            { text: '나중에', style: 'cancel', onPress: async () => { await AsyncStorage.setItem(POPUP_KEY, '1'); router.back(); } },
            { text: '지금 설정', onPress: async () => { await AsyncStorage.setItem(POPUP_KEY, '1'); router.push('/settings/availability'); } },
          ]
        );
      }
    }
  }

  async function handleSave() {
    if (!name.trim()) { Alert.alert('입력 오류', '이름을 입력해주세요.'); return; }
    if (!phone.trim()) { Alert.alert('입력 오류', '전화번호를 입력해주세요.'); return; }

    // 정규 회원 레슨권 필수 검증 (회원 insert 전)
    if (!isTrial) {
      if (lessonPackages.length === 0) {
        Alert.alert(
          '먼저 레슨권을 만들어 주세요',
          '등록된 레슨권이 없어요.\n레슨권을 먼저 만들어야 회원을 등록할 수 있어요.',
          [
            { text: '취소', style: 'cancel' },
            { text: '레슨권 만들기', onPress: openCreatePackageModal },
          ]
        );
        return;
      }
      if (!selectedPackageId) {
        Alert.alert(
          '레슨권을 선택해 주세요',
          '회원을 등록하려면 사용할 레슨권이 필요해요.\n입력한 회원 정보는 그대로 유지됩니다.',
          [
            { text: '취소', style: 'cancel' },
            {
              text: '레슨권 선택하기',
              onPress: () => {
                scrollViewRef.current?.scrollTo({ y: packageSectionY, animated: true });
                setPackageHighlight(true);
                setTimeout(() => setPackageHighlight(false), 1200);
              },
            },
          ]
        );
        return;
      }
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // 플랜별 회원 한도 체크 (IS_BETA에서는 건너뜀)
    if (!IS_BETA) {
      await syncRevenueCatToDb(user.id);
      const subscription = await getCurrentSubscription();
      const ok = await canAddMember(user.id, subscription);
      if (!ok) {
        setLoading(false);
        router.push({ pathname: '/subscription/select-plan', params: { reason: 'member_limit' } } as any);
        return;
      }
    }

    if (scheduleType === 'regular' && allDaysHaveTimes) {
      const selectedPkg2 = lessonPackages.find(p => p.id === selectedPackageId);
      const duration = selectedPkg2?.duration_minutes ?? (parseInt(lessonDuration) || 60);
      const conflicts = await checkConflicts(user.id, scheduleDays, dayTimes, duration);
      if (conflicts.length > 0) {
        setLoading(false);
        const conflictMsg = conflicts.slice(0, 3).map(cf => {
          const d = new Date(cf.date + 'T00:00:00');
          return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }) + ' ' + cf.startTime + ' - ' + cf.memberName;
        }).join('\n') + (conflicts.length > 3 ? ('\n외 ' + (conflicts.length - 3) + '건') : '');
        Alert.alert(
          '⚠️ 시간 충돌',
          '선택한 시간대에 이미 레슨이 있습니다:\n\n' + conflictMsg + '\n\n그래도 등록하시겠어요?',
          [
            { text: '시간 변경', style: 'cancel' },
            { text: '그대로 등록', style: 'destructive', onPress: async () => { setLoading(true); await doSave(user.id); } },
          ]
        );
        return;
      }
    } else if (scheduleType === 'by_date' && byDateEntries.length > 0) {
      const selectedPkg2 = lessonPackages.find(p => p.id === selectedPackageId);
      const duration = isTrial ? (parseInt(trialDuration) || 60) : (selectedPkg2?.duration_minutes ?? (parseInt(lessonDuration) || 60));
      const conflicts = await checkConflictsForDates(user.id, isTrial ? byDateEntries.slice(0, 1) : byDateEntries, duration);
      if (conflicts.length > 0) {
        setLoading(false);
        const conflictMsg = conflicts.slice(0, 3).map(cf => {
          const d = new Date(cf.date + 'T00:00:00');
          return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }) + ' ' + cf.startTime + ' - ' + cf.memberName;
        }).join('\n') + (conflicts.length > 3 ? ('\n외 ' + (conflicts.length - 3) + '건') : '');
        Alert.alert(
          '⚠️ 시간 충돌',
          '선택한 날짜에 이미 레슨이 있습니다:\n\n' + conflictMsg + '\n\n그래도 등록하시겠어요?',
          [
            { text: '날짜 변경', style: 'cancel' },
            { text: '그대로 등록', style: 'destructive', onPress: async () => { setLoading(true); await doSave(user.id); } },
          ]
        );
        return;
      }
    }
    await doSave(user.id);
  }

  const saveLabel = isTrial ? '체험 회원 등록하기' : (scheduleType !== 'later' && hasScheduleEntries ? '회원 등록하고 일정 만들기' : '회원 등록하기');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SettingsHeader title="회원 등록" />
      <ScrollView ref={scrollViewRef} style={styles.container} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">

        {/* 기본 정보 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <View style={trialStyles.toggleRow}>
            <TouchableOpacity
              style={[trialStyles.toggleBtn, !isTrial && trialStyles.toggleBtnActive]}
              onPress={() => toggleTrial(false)}
            >
              <Ionicons name="person-circle" size={16} color={!isTrial ? '#fff' : Colors.mutedFg} />
              <Text style={[trialStyles.toggleBtnText, !isTrial && trialStyles.toggleBtnTextActive]}>정규 회원</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[trialStyles.toggleBtn, isTrial && trialStyles.toggleBtnTrial]}
              onPress={() => toggleTrial(true)}
            >
              <Ionicons name="star-half" size={16} color={isTrial ? '#fff' : Colors.mutedFg} />
              <Text style={[trialStyles.toggleBtnText, isTrial && trialStyles.toggleBtnTextActive]}>체험 회원</Text>
            </TouchableOpacity>
          </View>
          {isTrial && (
            <View style={[trialStyles.trialNotice, { marginBottom: 12 }]}>
              <Ionicons name="information-circle-outline" size={14} color="#52616B" />
              <Text style={trialStyles.trialNoticeText}>체험 회원은 1회 레슨만 생성돼요. 아래에서 레슨 설정을 완료해주세요.</Text>
            </View>
          )}
          <Text style={styles.label}>이름 *</Text>
          <TextInput style={styles.input} placeholder="홍길동" value={name} onChangeText={setName} />
          <Text style={styles.label}>전화번호 *</Text>
          <TextInput style={styles.input} placeholder="010-0000-0000" value={phone} onChangeText={v => setPhone(formatPhone(v))} keyboardType="phone-pad" />

          {/* 추가 정보 (접힘) */}
          <TouchableOpacity style={styles.accordionHeader} onPress={() => setExtraInfoOpen(v => !v)} activeOpacity={0.7}>
            <Text style={styles.accordionHeaderText}>추가 정보 입력</Text>
            <Text style={styles.accordionHint}>이메일 · 생년월일 · 가입일 · 레벨 · 메모</Text>
            <Ionicons name={extraInfoOpen ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.mutedFg} />
          </TouchableOpacity>
          {extraInfoOpen && (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>이메일</Text>
              <TextInput style={styles.input} placeholder="example@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              <Text style={styles.label}>생년월일</Text>
              <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={birthDate} onChangeText={v => setBirthDate(formatDate(v))} />
              <Text style={styles.label}>가입일</Text>
              <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={joinDate} onChangeText={v => setJoinDate(formatDate(v))} />
              <Text style={styles.label}>레벨 <Text style={styles.labelHint}>(선택 안 하면 저장하지 않아요)</Text></Text>
              <View style={[styles.levelRow, { marginBottom: 12 }]}>
                {LEVELS.map(l => (
                  <TouchableOpacity key={l} style={[styles.levelBtn, level === l && styles.levelBtnActive]} onPress={() => setLevel(prev => prev === l ? null : l)}>
                    <Text style={[styles.levelBtnText, level === l && styles.levelBtnTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>메모</Text>
              <TextInput style={[styles.input, styles.textArea]} placeholder="특이사항, 목표, 참고사항 등"
                value={notes} onChangeText={setNotes} multiline numberOfLines={4} textAlignVertical="top" />
            </View>
          )}
        </View>

        {/* 레슨권 선택 */}
        {isTrial ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>체험 레슨 설정</Text>
          <View style={[styles.packageCard, { width: '100%', borderColor: '#52616B', borderWidth: 2, backgroundColor: '#52616B' + '12' }]}>
            <View style={styles.packageCardHeader}>
              <View style={[styles.packageDot, { backgroundColor: '#52616B' }]} />
              <Text style={[styles.packageTitle, { color: Colors.foreground }]}>체험 레슨권</Text>
              <View style={[styles.packageCheckmark, { backgroundColor: '#52616B' }]}>
                <Ionicons name="checkmark" size={13} color="#fff" />
              </View>
            </View>
            <Text style={styles.packageMeta}>1회 체험 레슨</Text>
          </View>
          <Text style={[styles.label, { marginTop: 12 }]}>소요 시간</Text>
          <View style={[styles.intervalRow, { marginBottom: isTrialCustomDuration ? 8 : 12, flexWrap: 'wrap' }]}>
            {TRIAL_DURATION_PRESETS.map(d => (
              <TouchableOpacity
                key={d}
                style={[styles.intervalBtn, trialDuration === d && styles.intervalBtnActive]}
                onPress={() => { setTrialDuration(d); setTrialDurationCustom(''); }}
              >
                <Text style={[styles.intervalBtnText, trialDuration === d && styles.intervalBtnTextActive]}>{d}분</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.intervalBtn, isTrialCustomDuration && styles.intervalBtnActive]}
              onPress={() => {
                setTrialDuration(trialDurationCustom || 'custom');
              }}
            >
              <Text style={[styles.intervalBtnText, isTrialCustomDuration && styles.intervalBtnTextActive]}>직접 입력</Text>
            </TouchableOpacity>
          </View>
          {isTrialCustomDuration && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="예: 45"
                value={trialDurationCustom}
                onChangeText={v => {
                  const num = v.replace(/[^0-9]/g, '');
                  setTrialDurationCustom(num);
                  if (num && parseInt(num) >= 1) setTrialDuration(num);
                }}
                keyboardType="number-pad"
              />
              <Text style={{ fontSize: 15, color: Colors.mutedFg, fontWeight: '600' }}>분</Text>
            </View>
          )}
          <Text style={styles.label}>체험 레슨비 <Text style={styles.labelHint}>(선택)</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="예: 30000"
            value={trialFee}
            onChangeText={setTrialFee}
            keyboardType="number-pad"
          />
        </View>
        ) : (
        <View
          style={[styles.section, packageHighlight && styles.sectionHighlight]}
          onLayout={(e) => setPackageSectionY(e.nativeEvent.layout.y)}
        >
          <Text style={styles.sectionTitle}>레슨권 선택</Text>
          {lessonPackages.length === 0 ? (
            <View style={styles.noPackageBox}>
              <Ionicons name="receipt-outline" size={24} color={Colors.iconMuted} />
              <Text style={styles.noPackageText}>등록된 레슨권이 없어요</Text>
            </View>
          ) : (
            <View style={styles.packageGrid}>
              {lessonPackages.map(pkg => {
                const isSelected = selectedPackageId === pkg.id;
                const pkgColor = pkg.color || Colors.primary;
                return (
                  <TouchableOpacity
                    key={pkg.id}
                    style={[
                      styles.packageCard,
                      isSelected
                        ? { borderColor: pkgColor, backgroundColor: pkgColor + '22', borderWidth: 2.5 }
                        : { borderColor: Colors.border },
                    ]}
                    onPress={() => handleSelectPackage(pkg)} activeOpacity={0.8}
                  >
                    <View style={styles.packageCardHeader}>
                      <View style={[styles.packageDot, { backgroundColor: pkgColor }]} />
                      <Text style={styles.packageTitle} numberOfLines={1}>{pkg.title}</Text>
                      {isSelected ? (
                        <View style={[styles.packageCheckmark, { backgroundColor: pkgColor }]}>
                          <Ionicons name="checkmark" size={13} color="#fff" />
                        </View>
                      ) : (
                        <View style={styles.packageCheckEmpty} />
                      )}
                    </View>
                    <Text style={styles.packageMeta} numberOfLines={1}>
                      {pkg.total_credits ? `총 ${pkg.total_credits}회` : (pkg.duration_days ? `${pkg.duration_days}일 이용` : '-')} · 1회 {pkg.duration_minutes ?? 60}분
                    </Text>
                    <Text style={[styles.packagePrice, { color: pkgColor }]}>{(pkg.price ?? 0).toLocaleString()}원</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <TouchableOpacity style={styles.newPackageBtn} onPress={openCreatePackageModal}>
            <Text style={styles.newPackageBtnText}>＋ 새 레슨권 만들기</Text>
          </TouchableOpacity>
          {totalCredits !== '' && (
            <>
              <View style={styles.remainingInputRow}>
                <View>
                  <Text style={styles.remainingInputLabel}>현재 남은 횟수</Text>
                  <Text style={styles.remainingInputHint}>기존 회원 이전 시 실제 남은 횟수 입력</Text>
                </View>
                <View style={styles.remainingInputWrap}>
                  <TextInput
                    style={styles.remainingInput}
                    keyboardType="number-pad"
                    value={remainingCredits}
                    onChangeText={setRemainingCredits}
                    placeholder={totalCredits}
                    maxLength={4}
                    selectTextOnFocus
                  />
                  <Text style={styles.remainingUnit}>회</Text>
                </View>
              </View>
              {remainingCredits !== '' && totalCredits !== '' && (() => {
                const total = parseInt(totalCredits) || 0;
                const rem = Math.min(parseInt(remainingCredits) || 0, total);
                const used = total - rem;
                if (used <= 0) return null;
                return (
                  <View style={styles.usageSummary}>
                    <Ionicons name="stats-chart-outline" size={13} color={Colors.navy} />
                    <Text style={styles.usageSummaryText}>
                      총 {total}회 중 {used}회 사용 · {rem}회 남음
                    </Text>
                    {allDaysHaveTimes && (
                      <Text style={styles.usageSummaryHint}>· 과거 스케줄 {used}회 생성</Text>
                    )}
                  </View>
                );
              })()}
            </>
          )}
        </View>
        )}

        {/* 일정 설정 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>언제 레슨하나요?</Text>
          <ScheduleSection
            scheduleType={scheduleType}
            onScheduleTypeChange={setScheduleType}
            scheduleDays={scheduleDays}
            onDaysChange={setScheduleDays}
            dayTimes={dayTimes}
            onDayTimesChange={setDayTimes}
            byDateEntries={byDateEntries}
            onByDateEntriesChange={setByDateEntries}
            startDate={lessonStartDate}
            onStartDateChange={setLessonStartDate}
            startDateLabel="첫 레슨 날짜"
            onDayAdded={(day) => setTimeout(() => fetchAvailableSlots(day), 0)}
            hideRegularOption={isTrial}
            lessonDuration={isTrial ? parseInt(trialDuration) : undefined}
          />
          {todayTimesAllPast && scheduleType === 'regular' && (
            <View style={styles.inlineNotice}>
              <Ionicons name="information-circle-outline" size={14} color={Colors.mutedFg} />
              <Text style={styles.inlineNoticeText}>오늘 이미 지난 시간이면 내일로 조정됩니다</Text>
            </View>
          )}
        </View>

        {/* 등록 요약 */}
        <View style={styles.summaryBox}>
          <Text style={styles.summaryTitle} numberOfLines={1}>
            {name.trim() || '이름 미입력'} · {isTrial ? '체험 회원' : (selectedPackage?.title ?? '레슨권 미선택')}
          </Text>
          {isTrial ? (
            <>
              {byDateEntries[0] ? <Text style={styles.summaryLine}>{new Date(byDateEntries[0].date + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} {byDateEntries[0].time} · {trialDuration}분</Text> : null}
              <Text style={styles.summaryCount}>체험 레슨 1회 생성됩니다.</Text>
            </>
          ) : (
            <>
              {scheduleSummary !== '' && <Text style={styles.summaryLine}>{scheduleSummary}</Text>}
              {scheduleType !== 'later' && firstLessonDate && (
                <Text style={styles.summaryLine}>
                  첫 레슨 {new Date(firstLessonDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                </Text>
              )}
              {estimatedLessonCount > 0 && (
                <Text style={styles.summaryCount}>총 {estimatedLessonCount}개의 일정이 생성됩니다.</Text>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* 하단 고정 저장 버튼 — 키보드 열리면 숨김 */}
      {!isKeyboardVisible && (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity style={[styles.saveBtn, loading && { opacity: 0.7 }]} onPress={handleSave} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{saveLabel}</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* 레슨권 인라인 생성 모달 */}
      <Modal visible={createPackageModalVisible} transparent animationType="slide" onRequestClose={() => setCreatePackageModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>새 레슨권 만들기</Text>
                <TouchableOpacity onPress={() => setCreatePackageModalVisible(false)} disabled={creatingPackage}>
                  <Ionicons name="close" size={22} color={Colors.foreground} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>횟수</Text>
                <TextInput style={styles.input} value={newPkgCredits} onChangeText={setNewPkgCredits} keyboardType="number-pad" placeholder="10" />

                <Text style={styles.label}>1회 레슨 시간</Text>
                <View style={[styles.intervalRow, { marginBottom: 12 }]}>
                  {PACKAGE_DURATIONS.map(d => (
                    <TouchableOpacity
                      key={d}
                      style={[styles.intervalBtn, newPkgDuration === d && styles.intervalBtnActive]}
                      onPress={() => setNewPkgDuration(d)}
                    >
                      <Text style={[styles.intervalBtnText, newPkgDuration === d && styles.intervalBtnTextActive]}>{d}분</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>금액 (원)</Text>
                <TextInput style={styles.input} value={newPkgPrice} onChangeText={setNewPkgPrice} keyboardType="number-pad" placeholder="예: 300000" />

                <Text style={styles.label}>상품명</Text>
                <TextInput
                  style={styles.input}
                  value={newPkgTitleValue}
                  onChangeText={v => { setNewPkgTitleEdited(true); setNewPkgTitle(v); }}
                  placeholder={suggestedPkgTitle}
                />

                <Text style={styles.label}>카드 색상</Text>
                <View style={styles.colorRow}>
                  {PRESET_COLORS.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.colorSwatch, { backgroundColor: c }, newPkgColor === c && styles.colorSwatchSelected]}
                      onPress={() => setNewPkgColor(c)}
                    >
                      {newPkgColor === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 4 }}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setCreatePackageModalVisible(false)} disabled={creatingPackage}>
                  <Text style={styles.modalCancelBtnText}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: newPkgColor }]} onPress={handleCreatePackage} disabled={creatingPackage}>
                  {creatingPackage ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveBtnText}>레슨권 저장</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 반복 설정 모달 */}
      <Modal visible={repeatModalVisible} transparent animationType="slide" onRequestClose={() => setRepeatModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setRepeatModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>반복</Text>
              <TouchableOpacity onPress={() => setRepeatModalVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>
            {(['none', 'weekly', 'custom'] as const).map((opt) => {
              const label = opt === 'none' ? '안 함' : opt === 'weekly' ? '매주' : '사용자 지정';
              const isActive = repeatType === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={styles.repeatOption}
                  onPress={() => {
                    setRepeatType(opt);
                    if (opt === 'custom') {
                      setRepeatModalVisible(false);
                      setCustomRepeatVisible(true);
                    } else {
                      setRepeatModalVisible(false);
                    }
                  }}
                >
                  <Text style={[styles.repeatOptionText, isActive && styles.repeatOptionTextActive]}>{label}</Text>
                  {isActive && <Ionicons name="checkmark" size={20} color={Colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 사용자 지정 모달 */}
      <Modal visible={customRepeatVisible} transparent animationType="slide" onRequestClose={() => setCustomRepeatVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCustomRepeatVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>사용자 지정</Text>
              <TouchableOpacity onPress={() => setCustomRepeatVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 20, gap: 16 }}>
              <Text style={styles.label}>반복 간격</Text>
              <View style={styles.intervalRow}>
                {([1, 2, 3, 4] as const).map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.intervalBtn, repeatInterval === n && styles.intervalBtnActive]}
                    onPress={() => setRepeatInterval(n)}
                  >
                    <Text style={[styles.intervalBtnText, repeatInterval === n && styles.intervalBtnTextActive]}>
                      {n}주마다
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.customRepeatHint}>
                레슨권 횟수 소진 시 자동 종료됩니다.
              </Text>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={() => setCustomRepeatVisible(false)}
              >
                <Text style={styles.confirmBtnText}>확인</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 빈 시간대 모달 */}
      <Modal visible={slotsModalVisible} transparent animationType="slide" onRequestClose={() => setSlotsModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
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
                      style={[
                        styles.slotBtn,
                        slot.available ? styles.slotBtnFree : styles.slotBtnBusy,
                      ]}
                      onPress={() => {
                        if (slotsModalDay !== null) {
                          setDayTimes(prev => {
                            const times = [...(prev[slotsModalDay] ?? [])];
                            if (!times.includes(slot.time)) {
                              times.push(slot.time);
                              times.sort();
                            }
                            return { ...prev, [slotsModalDay]: times };
                          });
                          setSlotsModalVisible(false);
                        }
                      }}
                    >
                      <Text style={[styles.slotBtnText, !slot.available && styles.slotBtnTextBusy]}>
                        {slot.time}
                      </Text>
                      {!slot.available && (
                        <Text style={styles.slotBusyLabel}>레슨중</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ fontSize: 14, color: Colors.mutedFg, paddingHorizontal: 16, paddingBottom: 8 }}>
                  * 빈 시간 탭하면 바로 추가됩니다
                </Text>
              </ScrollView>
            )}
            <TouchableOpacity
              style={[styles.loginBtn, { margin: 16, marginTop: 4 }]}
              onPress={() => setSlotsModalVisible(false)}
            >
              <Text style={styles.loginBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  section: { backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 16, marginTop: 12, padding: 14 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  accordionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: Colors.mutedBg, borderWidth: 1, borderColor: Colors.border },
  accordionHeaderText: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  accordionHint: { flex: 1, fontSize: 12, color: Colors.placeholder },
  inlineNotice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6, marginBottom: 12 },
  inlineNoticeText: { fontSize: 13, color: Colors.mutedFg },
  repeatSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  repeatSummaryValue: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, marginBottom: 6 },
  labelHint: { fontSize: 13, fontWeight: '400', color: Colors.placeholder },
  input: { backgroundColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.foreground, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  textArea: { minHeight: 100, paddingTop: 10 },
  levelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  levelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.mutedBg },
  levelBtnActive: { backgroundColor: Colors.primary },
  levelBtnText: { fontSize: 14, color: Colors.mutedFg, fontWeight: '600' },
  levelBtnTextActive: { color: '#fff' },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 16 },
  dayBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.mutedBg, justifyContent: 'center', alignItems: 'center' },
  dayBtnActive: { backgroundColor: Colors.primary },
  dayBtnText: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  dayBtnTextActive: { color: '#fff' },
  // 요일별 시간 목록
  dayTimeList: { gap: 10, marginBottom: 4 },
  dayTimeBlock: { backgroundColor: Colors.mutedBg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.border, gap: 6 },
  dayTimeBlockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayTimeBadge: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  dayTimeBadgeEmpty: { backgroundColor: Colors.border },
  dayTimeBadgeSet: { backgroundColor: Colors.primary },
  dayTimeBadgeText: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  dayTimeBadgeTextSet: { color: '#fff' },
  addTimeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: Colors.primaryLight, borderRadius: 8, borderWidth: 1, borderColor: Colors.successBorder },
  addTimeBtnText: { fontSize: 13, color: Colors.navy, fontWeight: '600' },
  dayTimeEmpty: { fontSize: 13, color: Colors.placeholder, paddingHorizontal: 4, paddingBottom: 2 },
  dayTimeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: Colors.border, gap: 8 },
  dayTimeValue: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.foreground },
  timeAction: { padding: 2 },
  dayTimeHint: { fontSize: 14, color: Colors.warning, marginTop: 4 },
  packageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  packageCard: { width: '47%', borderRadius: 12, borderWidth: 1.5, padding: 10, backgroundColor: '#fff', gap: 3 },
  packageCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  packageDot: { width: 8, height: 8, borderRadius: 4 },
  packageCheckmark: { width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  packageCheckEmpty: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border },
  packageTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.foreground },
  packageMeta: { fontSize: 12, color: Colors.mutedFg },
  packagePrice: { fontSize: 14, fontWeight: '800' },
  newPackageBtn: { marginTop: 10, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, alignItems: 'center', backgroundColor: Colors.primaryLight },
  newPackageBtnText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  noPackageBox: { alignItems: 'center', paddingVertical: 14, gap: 6 },
  noPackageText: { fontSize: 14, fontWeight: '600', color: Colors.placeholder },
  remainingInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 2 },
  remainingInputLabel: { fontSize: 13, fontWeight: '700', color: Colors.foreground, marginBottom: 2 },
  remainingInputHint: { fontSize: 12, color: Colors.mutedFg },
  remainingInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.mutedBg, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 6 },
  remainingInput: { fontSize: 20, fontWeight: '800', color: Colors.foreground, minWidth: 48, textAlign: 'center' },
  remainingUnit: { fontSize: 14, color: Colors.mutedFg, fontWeight: '600', marginLeft: 4 },
  usageSummary: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, backgroundColor: Colors.navy + '10', borderRadius: 8, padding: 10, marginTop: 8 },
  usageSummaryText: { fontSize: 13, color: Colors.navy, fontWeight: '600' },
  usageSummaryHint: { fontSize: 12, color: Colors.primary, fontWeight: '500' },
  datePickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  datePickerText: { flex: 1, fontSize: 15, color: Colors.foreground },
  todayTag: { backgroundColor: Colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  todayTagText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  summaryBox: { marginHorizontal: 16, marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.primary + '40', gap: 4 },
  summaryTitle: { fontSize: 15, fontWeight: '800', color: Colors.foreground },
  summaryLine: { fontSize: 13, color: Colors.foreground },
  summaryCount: { fontSize: 13, fontWeight: '700', color: Colors.primary, marginTop: 2 },
  footer: { backgroundColor: Colors.background, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  spinnerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 12 },
  spinnerCol: { flex: 1, alignItems: 'center' },
  spinnerLabel: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  spinnerList: { height: 220 },
  spinnerItem: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginBottom: 2, alignItems: 'center' },
  spinnerItemSelected: { backgroundColor: Colors.primary },
  spinnerItemText: { fontSize: 22, fontWeight: '600', color: Colors.mutedFg },
  spinnerItemTextSelected: { color: '#fff', fontWeight: '800' },
  spinnerColon: { fontSize: 28, fontWeight: '800', color: Colors.foreground, paddingHorizontal: 8, paddingTop: 28 },
  confirmBtn: { margin: 16, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnDisabled: { backgroundColor: Colors.iconMuted },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  slotBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center', minWidth: 74,
  },
  slotBtnFree: { backgroundColor: Colors.primary + '18', borderColor: Colors.primary },
  slotBtnBusy: { backgroundColor: Colors.mutedBg, borderColor: Colors.border, opacity: 0.45 },
  slotBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  slotBtnTextBusy: { color: Colors.mutedFg },
  slotBusyLabel: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  loginBtn: { backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  loginBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  // 반복 설정
  repeatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  repeatRowValue: { fontSize: 15, color: Colors.foreground, fontWeight: '500' },
  repeatOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  repeatOptionText: { fontSize: 16, color: Colors.foreground },
  repeatOptionTextActive: { color: Colors.primary, fontWeight: '700' },
  intervalRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  intervalBtn: { flex: 1, minWidth: 70, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', backgroundColor: Colors.mutedBg },
  intervalBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  intervalBtnText: { fontSize: 14, fontWeight: '600', color: Colors.mutedFg },
  intervalBtnTextActive: { color: Colors.primary },
  customRepeatHint: { fontSize: 14, color: Colors.mutedFg, textAlign: 'center' },
  sectionHighlight: { borderWidth: 2, borderColor: Colors.primary },
  colorRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginBottom: 8 },
  colorSwatch: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  colorSwatchSelected: { borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  modalCancelBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: Colors.mutedBg },
  modalCancelBtnText: { fontWeight: '700', fontSize: 14, color: Colors.primary },
  modalSaveBtn: { flex: 2, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  modalSaveBtnText: { fontWeight: '700', fontSize: 14, color: '#fff' },
});
const trialStyles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.mutedBg,
  },
  toggleBtnActive: { borderColor: '#C0755A', backgroundColor: '#C0755A' },
  toggleBtnTrial: { borderColor: '#52616B', backgroundColor: '#52616B' },
  toggleBtnText: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg },
  toggleBtnTextActive: { color: '#fff' },
  trialNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: '#F0F3F5', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#C5CDD3',
  },
  trialNoticeText: { fontSize: 14, color: '#3A4A55', flex: 1, lineHeight: 18 },
});
