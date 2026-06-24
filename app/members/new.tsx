import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  Modal, FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { MemberLevel } from '../../types';
import { Colors } from '../../lib/theme';
import { getCurrentSubscription, FREE_MEMBER_LIMIT, getMemberCount, isSubscriptionActive } from '../../lib/subscription';

const LEVELS: MemberLevel[] = ['입문', '초급', '중급', '상급', '선수'];
const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const HOURS = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0')); // 06~22
const MINUTES = ['00', '10', '20', '30', '40', '50'];

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

// dayTimes: { dayIndex -> ["HH:MM", "HH:MM", ...] }
type DayTimes = Record<number, string[]>;

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

/** 고정 스케줄 기반 레슨 자동 생성 (요일별 다중 시간 지원) */
async function generateScheduleLessons(params: {
  coachId: string; memberId: string; memberName: string;
  scheduleDays: number[]; dayTimes: DayTimes; lessonDuration: number;
  totalCredits: number; joinDate: string;
  repeatType?: 'none' | 'weekly' | 'custom';
  repeatInterval?: number; // weeks (custom 전용)
}) {
  const {
    coachId, memberId, memberName, scheduleDays, dayTimes,
    lessonDuration, totalCredits, joinDate,
    repeatType = 'weekly', repeatInterval = 1,
  } = params;
  if (!scheduleDays.length || totalCredits <= 0) return;

  const startDate = new Date(joinDate + 'T00:00:00+09:00');
  const todayForGen = kstToday();
  const cursor = new Date(startDate);
  if (cursor < todayForGen) cursor.setTime(todayForGen.getTime());

  // '안 함': 첫 번째 매칭 날짜/시간 1개만
  const limit = repeatType === 'none' ? 1 : totalCredits;
  const interval = repeatType === 'custom' ? Math.max(1, repeatInterval) : 1;

  const dates: { date: string; time: string }[] = [];
  let iter = 0;
  const maxIter = limit * 14 * (interval + 1) + 100;
  while (dates.length < limit && iter < maxIter) {
    const dow = cursor.getDay();
    if (scheduleDays.includes(dow)) {
      // 주 간격 체크 (custom: interval주마다)
      const weekOffset = Math.floor(
        (cursor.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      const inValidWeek = weekOffset % interval === 0;
      if (inValidWeek) {
        const times = dayTimes[dow] ?? [];
        for (const time of times) {
          if (dates.length < limit) {
            dates.push({ date: toKSTDateStr(cursor), time });
          }
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    iter++;
  }

  let successCount = 0;
  const errors: string[] = [];
  for (const { date, time } of dates) {
    const [hh, mm] = time.split(':').map(Number);
    const endMin = hh * 60 + mm + lessonDuration;
    const startSt = time + ':00';
    const endSt = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0') + ':00';

    const { data: lesson, error: lErr } = await supabase.from('lessons')
      .insert({ coach_id: coachId, title: memberName, date, start_time: startSt, end_time: endSt })
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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [level, setLevel] = useState<MemberLevel>('초급');
  const [joinDate, setJoinDate] = useState(toKSTDateStr(new Date()));
  const [lessonStartDate, setLessonStartDate] = useState(toKSTDateStr(new Date()));
  const [notes, setNotes] = useState('');
  // 체험 회원 토글
  const [isTrial, setIsTrial] = useState(false);

  // 요일 및 요일별 시간 (다중 시간 지원)
  const [scheduleDays, setScheduleDays] = useState<number[]>([]);
  const [dayTimes, setDayTimes] = useState<DayTimes>({}); // day -> ["HH:MM", ...]

  // 시간 피커 모달
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editingTimeIndex, setEditingTimeIndex] = useState<number | null>(null); // null = 새 시간 추가
  const [tempHour, setTempHour] = useState('');
  const [tempMinute, setTempMinute] = useState('00');
  const [timePickerVisible, setTimePickerVisible] = useState(false);

  const [lessonDuration, setLessonDuration] = useState('60');
  const [totalCredits, setTotalCredits] = useState('');
  const [lessonPackages, setLessonPackages] = useState<any[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 반복 설정
  const [repeatType, setRepeatType] = useState<'none' | 'weekly' | 'custom'>('weekly');
  const [repeatInterval, setRepeatInterval] = useState<1 | 2 | 3 | 4>(1);
  const [repeatModalVisible, setRepeatModalVisible] = useState(false);
  const [customRepeatVisible, setCustomRepeatVisible] = useState(false);

  // 빈 시간대 모달
  const [slotsModalVisible, setSlotsModalVisible] = useState(false);
  const [slotsModalDay, setSlotsModalDay] = useState<number | null>(null);
  const [slotsData, setSlotsData] = useState<{ time: string; available: boolean }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsDateStr, setSlotsDateStr] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('lesson_packages').select('*')
        .eq('coach_id', user.id).order('created_at', { ascending: false });
      setLessonPackages(data ?? []);
    })();
  }, []);

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

    const { data: existingLessons } = await supabase
      .from('lessons')
      .select('start_time, end_time')
      .eq('coach_id', user.id)
      .eq('date', dateStr);

    const selectedPkg = lessonPackages.find(p => p.id === selectedPackageId);
    const dur = selectedPkg?.duration_minutes ?? (parseInt(lessonDuration) || 60);

    const slots: { time: string; available: boolean }[] = [];
    for (let h = 6; h < 22; h++) {
      for (const m of [0, 30]) {
        const startMin = h * 60 + m;
        const endMin = startMin + dur;
        if (endMin > 22 * 60) continue;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const hasConflict = (existingLessons ?? []).some((l: any) => {
          const ls = timeToMinutes(l.start_time);
          const le = timeToMinutes(l.end_time);
          return startMin < le && endMin > ls;
        });
        slots.push({ time: timeStr, available: !hasConflict });
      }
    }
    setSlotsData(slots);
    setLoadingSlots(false);
  }

  function toggleDay(idx: number) {
    setScheduleDays(prev => {
      if (prev.includes(idx)) {
        setDayTimes(dt => { const n = { ...dt }; delete n[idx]; return n; });
        return prev.filter(d => d !== idx);
      }
      const newDays = [...prev, idx].sort();
      // 요일 선택 시 빈 시간대 모달 표시
      setTimeout(() => fetchAvailableSlots(idx), 0);
      return newDays;
    });
  }

  function openTimePicker(day: number, timeIndex: number | null = null) {
    setEditingDay(day);
    setEditingTimeIndex(timeIndex);
    if (timeIndex !== null) {
      const existing = dayTimes[day]?.[timeIndex];
      if (existing) {
        setTempHour(existing.split(':')[0]);
        setTempMinute(existing.split(':')[1] || '00');
      } else {
        setTempHour(''); setTempMinute('00');
      }
    } else {
      setTempHour(''); setTempMinute('00');
    }
    setTimePickerVisible(true);
  }

  function confirmTime() {
    if (!tempHour || editingDay === null) return;
    const newTime = `${tempHour}:${tempMinute}`;
    setDayTimes(prev => {
      const times = [...(prev[editingDay] ?? [])];
      if (editingTimeIndex !== null) {
        times[editingTimeIndex] = newTime;
      } else {
        times.push(newTime);
      }
      times.sort();
      return { ...prev, [editingDay]: times };
    });
    setTimePickerVisible(false);
    setEditingDay(null);
    setEditingTimeIndex(null);
  }

  function removeTime(day: number, timeIndex: number) {
    setDayTimes(prev => {
      const times = [...(prev[day] ?? [])];
      times.splice(timeIndex, 1);
      return { ...prev, [day]: times };
    });
  }

  function handleSelectPackage(pkg: any) {
    if (selectedPackageId === pkg.id) {
      setSelectedPackageId(null);
      setTotalCredits('');
      setLessonDuration('60');
    } else {
      setSelectedPackageId(pkg.id);
      setTotalCredits(String(pkg.total_credits ?? 10));
      setLessonDuration(String(pkg.duration_minutes ?? 60));
    }
  }

  // 모든 선택 요일에 최소 1개 이상 시간이 있는 경우
  const allDaysHaveTimes = scheduleDays.length > 0 && scheduleDays.every(d => (dayTimes[d]?.length ?? 0) > 0);

  async function doSave(userId: string) {
    const credits = parseInt(totalCredits) || 0;
    const selectedPkg = lessonPackages.find(p => p.id === selectedPackageId);
    const duration = selectedPkg?.duration_minutes ?? (parseInt(lessonDuration) || 60);

    // fixed_schedule_times: { dayIndex: ["HH:MM", ...] }
    const scheduleTimesJson: Record<string, string[]> = {};
    for (const d of scheduleDays) {
      if (dayTimes[d]?.length) scheduleTimesJson[String(d)] = dayTimes[d];
    }
    // backward compat: first day's first time
    const firstDayTime = scheduleDays.length > 0 && dayTimes[scheduleDays[0]]?.[0] ? dayTimes[scheduleDays[0]][0] : null;

    const { data: newMember, error } = await supabase.from('members').insert({
      coach_id: userId, name: name.trim(), phone: phone.trim(),
      birth_date: birthDate || null,
      level, join_date: joinDate, notes: notes.trim() || null, is_active: true,
      fixed_schedule_days: scheduleDays,
      fixed_schedule_time: firstDayTime,
      fixed_schedule_times: Object.keys(scheduleTimesJson).length > 0 ? scheduleTimesJson : null,
      fixed_lesson_duration: duration,
      total_credits: isTrial ? 0 : credits,
      remaining_credits: isTrial ? 0 : credits,
      lesson_package_id: isTrial ? null : (selectedPackageId || null),
      is_trial: isTrial,
      trial_started_at: isTrial ? toKSTDateStr(new Date()) : null,
      trial_lesson_count: 0,
    }).select('id').single();
    if (error || !newMember) { setLoading(false); Alert.alert('오류', '회원 등록에 실패했습니다.'); return; }

    let genResult: { successCount: number; errors: string[] } | null | undefined = null;
    if (allDaysHaveTimes && credits > 0) {
      genResult = await generateScheduleLessons({
        coachId: userId, memberId: newMember.id, memberName: name.trim(),
        scheduleDays, dayTimes, lessonDuration: duration, totalCredits: credits, joinDate: lessonStartDate,
        repeatType, repeatInterval,
      });
    }
    setLoading(false);

    const genCount = genResult?.successCount ?? 0;
    const genErrors = genResult?.errors ?? [];
    let msg = '회원이 등록됐습니다.';
    if (allDaysHaveTimes && credits > 0) {
      if (genCount > 0) {
        msg = `${genCount}개 레슨이 스케줄에 추가됐습니다. (${duration}분 레슨)`;
      } else {
        msg = `회원 등록 완료. 레슨 스케줄 생성 실패${genErrors.length ? ': ' + genErrors[0] : ''}`;
      }
    }
    Alert.alert('완료', msg, [{ text: '확인', onPress: () => router.back() }]);
  }

  async function handleSave() {
    if (!name.trim()) { Alert.alert('입력 오류', '이름을 입력해주세요.'); return; }
    if (!phone.trim()) { Alert.alert('입력 오류', '전화번호를 입력해주세요.'); return; }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Free 플랜: 회원 3명 초과 시 구독 필요
    const memberCount = await getMemberCount(user.id);
    if (memberCount >= FREE_MEMBER_LIMIT) {
      const subscription = await getCurrentSubscription();
      const active = isSubscriptionActive(subscription);
      const isPaidPlan = subscription?.plan_id === 'basic' || subscription?.plan_id === 'pro';
      if (!active || !isPaidPlan) {
        setLoading(false);
        Alert.alert(
          '구독이 필요합니다',
          `Free 플랜은 회원 ${FREE_MEMBER_LIMIT}명까지 등록 가능합니다.\n베이직 또는 프로 플랜으로 업그레이드 후 무제한 등록하세요.`,
          [
            { text: '나중에', style: 'cancel' },
            { text: '플랜 보기', onPress: () => router.push('/subscription/select-plan') },
          ]
        );
        return;
      }
    }

    if (allDaysHaveTimes) {
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
    }
    await doSave(user.id);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* 정규 / 체험 토글 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>회원 유형</Text>
          <View style={trialStyles.toggleRow}>
            <TouchableOpacity
              style={[trialStyles.toggleBtn, !isTrial && trialStyles.toggleBtnActive]}
              onPress={() => setIsTrial(false)}
            >
              <Ionicons name="person-circle" size={16} color={!isTrial ? '#fff' : Colors.mutedFg} />
              <Text style={[trialStyles.toggleBtnText, !isTrial && trialStyles.toggleBtnTextActive]}>정규 회원</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[trialStyles.toggleBtn, isTrial && trialStyles.toggleBtnTrial]}
              onPress={() => setIsTrial(true)}
            >
              <Ionicons name="star-half" size={16} color={isTrial ? '#fff' : Colors.mutedFg} />
              <Text style={[trialStyles.toggleBtnText, isTrial && trialStyles.toggleBtnTextActive]}>체험 회원</Text>
            </TouchableOpacity>
          </View>
          {isTrial && (
            <View style={trialStyles.trialNotice}>
              <Ionicons name="information-circle-outline" size={14} color="#D97706" />
              <Text style={trialStyles.trialNoticeText}>체험 회원은 크레딧 없이 등록돼요. 레슨 시작 후 7일에 알림이 옴.</Text>
            </View>
          )}
        </View>

        {/* 기본 정보 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <Text style={styles.label}>이름 *</Text>
          <TextInput style={styles.input} placeholder="홍길동" value={name} onChangeText={setName} />
          <Text style={styles.label}>전화번호 *</Text>
          <TextInput style={styles.input} placeholder="010-0000-0000" value={phone} onChangeText={v => setPhone(formatPhone(v))} keyboardType="phone-pad" />
          <Text style={styles.label}>생년월일</Text>
          <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={birthDate} onChangeText={v => setBirthDate(formatDate(v))} />
          <Text style={styles.label}>가입일</Text>
          <TextInput style={styles.input} value={joinDate} onChangeText={v => setJoinDate(formatDate(v))} />
        </View>

        {/* 레벨 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>레벨</Text>
          <View style={styles.levelRow}>
            {LEVELS.map(l => (
              <TouchableOpacity key={l} style={[styles.levelBtn, level === l && styles.levelBtnActive]} onPress={() => setLevel(l)}>
                <Text style={[styles.levelBtnText, level === l && styles.levelBtnTextActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 고정 레슨 스케줄 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>레슨 스케줄</Text>
          <Text style={styles.label}>레슨 시작일</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            value={lessonStartDate}
            onChangeText={v => setLessonStartDate(formatDate(v))}
          />
          <Text style={styles.label}>레슨 요일</Text>
          <View style={styles.dayRow}>
            {DAYS_KR.map((d, i) => (
              <TouchableOpacity key={i} style={[styles.dayBtn, scheduleDays.includes(i) && styles.dayBtnActive]} onPress={() => toggleDay(i)}>
                <Text style={[styles.dayBtnText, scheduleDays.includes(i) && styles.dayBtnTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 요일별 시간 설정 (다중 타임 지원) */}
          {scheduleDays.length > 0 && (
            <View style={styles.dayTimeList}>
              <Text style={styles.label}>요일별 시작 시간 <Text style={styles.labelHint}>(타임 여러개 추가 가능)</Text></Text>
              {scheduleDays.map(day => {
                const times = dayTimes[day] ?? [];
                return (
                  <View key={day} style={styles.dayTimeBlock}>
                    <View style={styles.dayTimeBlockHeader}>
                      <View style={[styles.dayTimeBadge, times.length > 0 ? styles.dayTimeBadgeSet : styles.dayTimeBadgeEmpty]}>
                        <Text style={[styles.dayTimeBadgeText, times.length > 0 ? styles.dayTimeBadgeTextSet : {}]}>{DAYS_KR[day]}</Text>
                      </View>
                      <TouchableOpacity style={styles.addTimeBtn} onPress={() => openTimePicker(day, null)}>
                        <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                        <Text style={styles.addTimeBtnText}>시간 추가</Text>
                      </TouchableOpacity>
                    </View>
                    {times.length === 0 && (
                      <Text style={styles.dayTimeEmpty}>시간을 추가해주세요</Text>
                    )}
                    {times.map((time, idx) => (
                      <View key={idx} style={styles.dayTimeRow}>
                        <Ionicons name="time" size={15} color={Colors.primary} />
                        <Text style={styles.dayTimeValue}>{time}</Text>
                        <TouchableOpacity onPress={() => openTimePicker(day, idx)} style={styles.timeAction}>
                          <Ionicons name="pencil-outline" size={15} color={Colors.mutedFg} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => removeTime(day, idx)} style={styles.timeAction}>
                          <Ionicons name="close-circle-outline" size={17} color="#ff4444" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                );
              })}
              {!allDaysHaveTimes && (
                <Text style={styles.dayTimeHint}>⚑ 모든 요일에 최소 1개 시간을 설정해야 스케줄이 자동 생성됩니다</Text>
              )}
            </View>
          )}

          {/* 반복 설정 행 */}
          <Text style={[styles.label, { marginTop: 14 }]}>반복</Text>
          <TouchableOpacity style={styles.repeatRow} onPress={() => setRepeatModalVisible(true)}>
            <Text style={styles.repeatRowValue}>
              {repeatType === 'none' ? '안 함'
                : repeatType === 'weekly' ? '매주'
                : `${repeatInterval}주마다 (사용자 지정)`}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.mutedFg} />
          </TouchableOpacity>
        </View>

        {/* 레슨권 (체험 회원이면 스킵) */}
        {!isTrial && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>레슨권 선택</Text>
          {lessonPackages.length === 0 ? (
            <View style={styles.noPackageBox}>
              <Ionicons name="receipt-outline" size={24} color={Colors.iconMuted} />
              <Text style={styles.noPackageText}>등록된 레슨권이 없어요</Text>
              <Text style={styles.noPackageSubText}>설정에서 레슨권을 먼저 등록해주세요</Text>
            </View>
          ) : (
            <View style={styles.packageGrid}>
              {lessonPackages.map(pkg => {
                const isSelected = selectedPackageId === pkg.id;
                return (
                  <TouchableOpacity
                    key={pkg.id}
                    style={[styles.packageCard, { borderColor: pkg.color }, isSelected && { backgroundColor: pkg.color + '18' }]}
                    onPress={() => handleSelectPackage(pkg)} activeOpacity={0.8}
                  >
                    {isSelected && (
                      <View style={[styles.packageCheckmark, { backgroundColor: pkg.color }]}>
                        <Ionicons name="checkmark" size={12} color="#fff" />
                      </View>
                    )}
                    <View style={[styles.packageColorBar, { backgroundColor: pkg.color }]} />
                    <Text style={styles.packageTitle} numberOfLines={2}>{pkg.title}</Text>
                    <Text style={styles.packageMeta}>{pkg.duration_minutes}분</Text>
                    <Text style={[styles.packagePrice, { color: pkg.color }]}>{pkg.price.toLocaleString()}원</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {totalCredits !== '' && (
            <View style={styles.creditPreview}>
              <Ionicons name="layers-outline" size={16} color={Colors.primary} />
              <Text style={styles.creditPreviewText}>
                {totalCredits}회 레슨권{allDaysHaveTimes ? ' · 스케줄 자동 생성' : ''}
              </Text>
            </View>
          )}
        </View>
        )}

        {/* 메모 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>메모</Text>
          <TextInput style={[styles.input, styles.textArea]} placeholder="특이사항, 목표, 참고사항 등"
            value={notes} onChangeText={setNotes} multiline numberOfLines={4} textAlignVertical="top" />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>회원 등록</Text>}
        </TouchableOpacity>
      </ScrollView>

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

      {/* 시간 스피너 모달 */}
      <Modal visible={timePickerVisible} transparent animationType="slide" onRequestClose={() => setTimePickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingDay !== null
                  ? `${DAYS_KR[editingDay]}요일 ${editingTimeIndex !== null ? '시간 수정' : '시간 추가'}`
                  : '시작 시간'}
              </Text>
              <TouchableOpacity onPress={() => setTimePickerVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>

            <View style={styles.spinnerRow}>
              {/* Hour */}
              <View style={styles.spinnerCol}>
                <Text style={styles.spinnerLabel}>시</Text>
                <FlatList
                  data={HOURS} keyExtractor={item => item}
                  showsVerticalScrollIndicator={false} style={styles.spinnerList}
                  renderItem={({ item }) => {
                    const isSelected = item === tempHour;
                    return (
                      <TouchableOpacity style={[styles.spinnerItem, isSelected && styles.spinnerItemSelected]} onPress={() => setTempHour(item)}>
                        <Text style={[styles.spinnerItemText, isSelected && styles.spinnerItemTextSelected]}>{item}</Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
              <Text style={styles.spinnerColon}>:</Text>
              {/* Minute */}
              <View style={styles.spinnerCol}>
                <Text style={styles.spinnerLabel}>분</Text>
                <FlatList
                  data={MINUTES} keyExtractor={item => item}
                  showsVerticalScrollIndicator={false} style={styles.spinnerList}
                  renderItem={({ item }) => {
                    const isSelected = item === tempMinute;
                    return (
                      <TouchableOpacity style={[styles.spinnerItem, isSelected && styles.spinnerItemSelected]} onPress={() => setTempMinute(item)}>
                        <Text style={[styles.spinnerItemText, isSelected && styles.spinnerItemTextSelected]}>{item}</Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.confirmBtn, !tempHour && styles.confirmBtnDisabled]}
              onPress={confirmTime}
            >
              <Text style={styles.confirmBtnText}>
                {tempHour ? `${tempHour}:${tempMinute} 선택` : '시간을 선택하세요'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  section: { backgroundColor: '#fff', borderRadius: 12, margin: 16, marginBottom: 0, padding: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
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
  packageCard: { width: '47%', borderRadius: 12, borderWidth: 2, padding: 12, position: 'relative', overflow: 'hidden', backgroundColor: '#fff' },
  packageCheckmark: { position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  packageColorBar: { height: 3, borderRadius: 2, marginBottom: 8 },
  packageTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  packageMeta: { fontSize: 13, color: Colors.mutedFg, marginBottom: 2 },
  packagePrice: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  noPackageBox: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  noPackageText: { fontSize: 14, fontWeight: '600', color: Colors.placeholder },
  noPackageSubText: { fontSize: 14, color: Colors.iconMuted },
  creditPreview: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primaryLight, borderRadius: 8, padding: 10, marginTop: 8 },
  creditPreviewText: { fontSize: 14, color: Colors.navy, fontWeight: '600' },
  saveBtn: { backgroundColor: Colors.primary, margin: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
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
});
const trialStyles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.mutedBg,
  },
  toggleBtnActive: { borderColor: Colors.navy, backgroundColor: Colors.navy },
  toggleBtnTrial: { borderColor: '#D97706', backgroundColor: '#D97706' },
  toggleBtnText: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg },
  toggleBtnTextActive: { color: '#fff' },
  trialNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: '#FFFBEB', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  trialNoticeText: { fontSize: 14, color: '#92400E', flex: 1, lineHeight: 18 },
});
