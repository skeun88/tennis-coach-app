import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
  Modal, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Member, MemberLevel, Attendance, Payment, MemberNote } from '../../types';
import { Colors } from '../../lib/theme';

type DayTimes = Record<number, string[]>;

const LEVELS: MemberLevel[] = ['입문', '초급', '중급', '고급', '선수'];
const LEVEL_COLORS: Record<MemberLevel, string> = {
  '입문': Colors.level.입문, '초급': Colors.success, '중급': Colors.info, '고급': Colors.warning, '선수': Colors.destructive,
};

const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) {
  for (let m = 0; m < 60; m += 10) {
    if (h === 22 && m > 0) break;
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




type Tab = 'info' | 'attendance' | 'payment' | 'notes';


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
  if (scheduleDays.length === 0 || totalCredits <= 0) return 0;
  const cursor = new Date(startDate + 'T00:00:00+09:00');
  const todayKST2 = kstToday();
  if (cursor < todayKST2) cursor.setTime(todayKST2.getTime());
  const dates: { date: string; time: string }[] = [];
  let iter = 0;
  while (dates.length < totalCredits && iter < totalCredits * 14) {
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
      coach_id: coachId, title: memberName, date, start_time: startSt, end_time: endSt,
    }).select('id').single();
    if (lErr || !lesson) continue;
    await sb.from('lesson_members').insert({ lesson_id: lesson.id, member_id: memberId });
    created++;
  }
  return created;
}

export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [member, setMember] = useState<Member | null>(null);
  const [tab, setTab] = useState<Tab>('info');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  // Edit state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
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
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [tempHour, setTempHour] = useState('');
  const [tempMinute, setTempMinute] = useState('00');

  async function loadMember() {
    const { data } = await supabase.from('members').select('*').eq('id', id).single();
    if (data) {
      setMember(data);
      setName(data.name); setPhone(data.phone);
      setEmail(data.email ?? ''); setLevel(data.level);
      setNotes(data.notes ?? '');
      setScheduleDays((data as any).fixed_schedule_days ?? []);
      // 요일별 시간 로드 (fixed_schedule_times 우선, 없으면 fixed_schedule_time으로 동일 설정)
      const fst = (data as any).fixed_schedule_times;
      if (fst && typeof fst === 'object') {
        const loaded: DayTimes = {};
        for (const [k, v] of Object.entries(fst)) {
          // 하위 호환: 기존 string 값도 배열로 변환
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
      setLessonDuration(String((data as any).fixed_lesson_duration ?? 60));
      setTotalCredits(String((data as any).total_credits ?? 0));
      setRemainingCredits(String((data as any).remaining_credits ?? 0));
      // 레슨권 정보 로드
      const pkgId = (data as any).lesson_package_id;
      setSelectedPackageId(pkgId || null);
      if (pkgId) {
        const { data: pkg } = await supabase.from('lesson_packages').select('title, color, total_credits, price').eq('id', pkgId).single();
        setLessonPackage(pkg);
      }
    }
    // 레슨권 목록 로드 (수정 모드용)
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: pkgs } = await supabase.from('lesson_packages')
        .select('*').eq('coach_id', user.id).eq('is_active', true).order('created_at', { ascending: false });
      setLessonPackages(pkgs ?? []);
    }
    setLoading(false);
  }

  async function loadAttendance() {
    const { data } = await supabase
      .from('attendance')
      .select('*, lesson:lessons(title, date, start_time)')
      .eq('member_id', id)
      .order('created_at', { ascending: false })
      .limit(20);
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

  useEffect(() => { loadMember(); }, []);
  useEffect(() => {
    if (tab === 'attendance') loadAttendance();
    if (tab === 'payment') loadPayments();
    if (tab === 'notes') loadNotes();
  }, [tab]);

  async function handleSave() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const credits = parseInt(totalCredits) || 0;
    const duration = parseInt(lessonDuration) || 60;

    // 충돌 체크
    const allDaysHaveTimes2 = scheduleDays.length > 0 && scheduleDays.every(d => dayTimes[d] && dayTimes[d].length > 0);
    if (allDaysHaveTimes2) {
      const conflicts = await checkConflicts(supabase, user.id, scheduleDays, dayTimes, duration, id as string);
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
            { text: '그대로 저장', style: 'destructive', onPress: () => doActualSave(user.id, credits, duration) },
          ]
        );
        return;
      }
    }
    await doActualSave(user.id, credits, duration);
  }

  async function doActualSave(userId: string, credits: number, duration: number) {
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
      const todayStr = toKSTDateStr(new Date());
      const { data: futureL } = await supabase.from('lesson_members').select('lesson:lessons(date)').eq('member_id', id!);
      const futureLessons = (futureL ?? []).filter((r: any) => r.lesson?.date >= todayStr);
      const needed = credits - futureLessons.length;
      if (needed > 0 && (scheduleChanged || futureLessons.length === 0)) {
        const joinDate = (oldMember as any)?.join_date ?? todayStr;
        scheduledCount = await generateScheduleLessons(
          supabase, userId, id!, name, scheduleDays, dayTimes, duration, needed, joinDate,
        );
      }
    }
    setEditing(false);
    loadMember();
    if (scheduledCount > 0) Alert.alert('저장 완료', scheduledCount + '개 레슨이 스케줄에 추가되었습니다.');
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

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!member) return <View style={styles.loader}><Text>회원을 찾을 수 없습니다</Text></View>;

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'info', label: '정보', icon: 'person-outline' },
    { key: 'attendance', label: '출석', icon: 'checkbox-outline' },
    { key: 'payment', label: '결제', icon: 'card-outline' },
    { key: 'notes', label: '메모', icon: 'document-text-outline' },
  ];

  const ATTENDANCE_STATUS_COLOR: Record<string, string> = { '출석': Colors.success, '결석': Colors.destructive, '지각': Colors.warning, '조퇴': Colors.info };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={[styles.bigAvatar, { backgroundColor: LEVEL_COLORS[member.level as MemberLevel] ?? Colors.level.입문 }]}>
          <Text style={styles.bigAvatarText}>{member.name.slice(0, 1)}</Text>
        </View>
        <Text style={styles.profileName}>{member.name}</Text>
        <View style={styles.profileBadgeRow}>
          <View style={[styles.levelBadge, { backgroundColor: (LEVEL_COLORS[member.level as MemberLevel] ?? Colors.level.입문) + '33' }]}>
            <Text style={[styles.levelText, { color: LEVEL_COLORS[member.level as MemberLevel] ?? Colors.level.입문 }]}>{member.level}</Text>
          </View>
          {!member.is_active && <View style={styles.inactiveBadge}><Text style={styles.inactiveText}>비활성</Text></View>}
        </View>
        <TouchableOpacity
          style={styles.aiBtn}
          onPress={() => router.push({ pathname: '/members/ai-analysis', params: { memberId: member.id, memberName: member.name, memberLevel: member.level } })}
        >
          <Ionicons name="sparkles" size={14} color="#fff" />
          <Text style={styles.aiBtnText}>AI 레슨 분석</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
            <Ionicons name={t.icon as any} size={16} color={tab === t.key ? Colors.primary : Colors.mutedFg} />
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content}>
        {/* INFO TAB */}
        {tab === 'info' && (
          <View style={styles.card}>
            {!editing ? (
              <>
                <InfoRow icon="person-outline" label="이름" value={member.name} />
                <InfoRow icon="call-outline" label="전화번호" value={member.phone} />
                <InfoRow icon="mail-outline" label="이메일" value={member.email ?? '-'} />
                <InfoRow icon="calendar-outline" label="가입일" value={member.join_date} />
                <InfoRow icon="fitness-outline" label="레벨" value={member.level} />
                {member.notes && <InfoRow icon="document-text-outline" label="메모" value={member.notes} />}
                {((member as any).fixed_schedule_days?.length > 0) && (
                  <InfoRow
                    icon="time-outline"
                    label="고정 스케줄"
                    value={(() => {
                      const days: number[] = (member as any).fixed_schedule_days ?? [];
                      const fst = (member as any).fixed_schedule_times;
                      const lt = (member as any).fixed_schedule_time?.slice(0, 5);
                      return days.map(d => {
                        const raw = fst?.[String(d)];
                        const timesArr: string[] = Array.isArray(raw) ? raw : (raw ? [raw] : (lt ? [lt] : []));
                        return `${DAYS_KR[d]}${timesArr.length > 0 ? ' ' + timesArr.join('/') : ''}`;
                      }).join(' · ');
                    })()}
                  />
                )}
                <InfoRow icon="layers-outline" label="레슨권 잔여" value={`${(member as any).remaining_credits ?? 0}회 / 총 ${(member as any).total_credits ?? 0}회`} />
                <View style={styles.packageBanner}>
                  {lessonPackage ? (
                    <>
                      <View style={[styles.packageDot, { backgroundColor: lessonPackage.color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.packageTitle}>{lessonPackage.title}</Text>
                        <Text style={styles.packageMeta}>{lessonPackage.total_credits}회 · {lessonPackage.price.toLocaleString()}원</Text>
                      </View>
                      <Ionicons name="card-outline" size={18} color={Colors.primary} />
                    </>
                  ) : (
                    <>
                      <Ionicons name="card-outline" size={18} color={Colors.iconMuted} />
                      <Text style={[styles.packageMeta, { color: Colors.placeholder, marginLeft: 8 }]}>연결된 레슨권 없음</Text>
                      <TouchableOpacity onPress={() => setEditing(true)} style={{ marginLeft: 'auto' }}>
                        <Text style={{ fontSize: 12, color: Colors.primary, fontWeight: '600' }}>설정 →</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>

                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                    <Ionicons name="create-outline" size={16} color={Colors.primary} />
                    <Text style={styles.editBtnText}>수정</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.deactivateBtn, !member.is_active && { borderColor: Colors.success }]} onPress={handleToggleActive}>
                    <Text style={[styles.deactivateBtnText, !member.is_active && { color: Colors.success }]}>{member.is_active ? '비활성화' : '활성화'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.editLabel}>이름</Text>
                <TextInput style={styles.editInput} value={name} onChangeText={setName} />
                <Text style={styles.editLabel}>전화번호</Text>
                <TextInput style={styles.editInput} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
                <Text style={styles.editLabel}>이메일</Text>
                <TextInput style={styles.editInput} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                <Text style={styles.editLabel}>레벨</Text>
                <View style={styles.levelRow}>
                  {LEVELS.map(l => (
                    <TouchableOpacity key={l} style={[styles.levelBtn, level === l && styles.levelBtnActive]} onPress={() => setLevel(l)}>
                      <Text style={[styles.levelBtnText, level === l && styles.levelBtnTextActive]}>{l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.editLabel}>레슨 요일</Text>
                <View style={styles.dayRow}>
                  {DAYS_KR.map((d, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[styles.dayBtn2, scheduleDays.includes(i) && styles.dayBtn2Active]}
                      onPress={() => {
                        setScheduleDays(prev => {
                          if (prev.includes(i)) {
                            setDayTimes(dt => { const n = { ...dt }; delete n[i]; return n; });
                            return prev.filter(x => x !== i);
                          }
                          return [...prev, i].sort();
                        });
                      }}
                    >
                      <Text style={[styles.dayBtn2Text, scheduleDays.includes(i) && styles.dayBtn2TextActive]}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.editLabel}>요일별 시작 시간</Text>
                {scheduleDays.length === 0 && <Text style={{ fontSize: 13, color: Colors.placeholder, marginBottom: 8 }}>요일을 먼저 선택하세요</Text>}
                {scheduleDays.map(day => {
                  const times = dayTimes[day] ?? [];
                  return (
                    <View key={day} style={{ marginBottom: 8 }}>
                      {/* 헤더: 요일 + 추가 버튼 */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                        <View style={[styles.dayTimeBadge2, times.length > 0 ? styles.dayTimeBadge2Set : {}]}>
                          <Text style={[styles.dayTimeBadge2Text, times.length > 0 ? { color: '#fff' } : {}]}>{DAYS_KR[day]}</Text>
                        </View>
                        <Text style={{ flex: 1, fontSize: 13, color: Colors.mutedFg, marginLeft: 8 }}>
                          {times.length > 0 ? `${times.length}개 시간` : '시간 없음'}
                        </Text>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primaryLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}
                          onPress={() => {
                            setEditingDay(day);
                            setTempHour('');
                            setTempMinute('00');
                            setTimePickerVisible(true);
                          }}
                        >
                          <Ionicons name="add" size={14} color={Colors.primary} />
                          <Text style={{ fontSize: 12, color: Colors.primary, fontWeight: '700' }}>시간 추가</Text>
                        </TouchableOpacity>
                      </View>
                      {/* 시간 목록 */}
                      {times.map((t, ti) => (
                        <View key={ti} style={[styles.dayTimeRow2, { marginBottom: 4 }]}>
                          <Ionicons name="time" size={14} color={Colors.primary} style={{ marginRight: 6 }} />
                          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: Colors.foreground }}>{t}</Text>
                          <TouchableOpacity
                            onPress={() => {
                              setDayTimes(prev => ({
                                ...prev,
                                [day]: prev[day].filter((_, i) => i !== ti),
                              }));
                            }}
                            style={{ padding: 4 }}
                          >
                            <Ionicons name="close-circle" size={18} color={Colors.destructive} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      {times.length === 0 && (
                        <Text style={{ fontSize: 12, color: Colors.placeholder, marginLeft: 4, marginBottom: 2 }}>시간 추가 버튼을 눌러 시작 시간을 설정하세요</Text>
                      )}
                    </View>
                  );
                })}
                <Text style={styles.editLabel}>총 레슨권</Text>
                <TextInput style={styles.editInput} placeholder="0" value={totalCredits} onChangeText={setTotalCredits} keyboardType="number-pad" />
                <Text style={styles.editLabel}>잔여 레슨권</Text>
                <TextInput style={styles.editInput} placeholder="0" value={remainingCredits} onChangeText={setRemainingCredits} keyboardType="number-pad" />
                <Text style={styles.editLabel}>메모</Text>
                <TextInput style={[styles.editInput, { minHeight: 80 }]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" />

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
                          onPress={() => setSelectedPackageId(pkg.id)}
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
                          <Text style={[styles.editPkgPrice, { color: pkg.color }]}>{pkg.price.toLocaleString()}원</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
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

        {/* ATTENDANCE TAB */}
        {tab === 'attendance' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>최근 출석 기록 ({attendance.length}건)</Text>
            {attendance.length === 0 && <Text style={styles.emptyText}>출석 기록이 없습니다</Text>}
            {attendance.map(a => {
              const lesson = (a as any).lesson;
              return (
                <View key={a.id} style={styles.attendanceRow}>
                  <View style={[styles.statusDot, { backgroundColor: ATTENDANCE_STATUS_COLOR[a.status] ?? Colors.mutedFg }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attendanceTitle}>{lesson?.title ?? '레슨'}</Text>
                    <Text style={styles.attendanceDate}>{lesson?.date} {lesson?.start_time?.slice(0, 5)}</Text>
                  </View>
                  <Text style={[styles.attendanceStatus, { color: ATTENDANCE_STATUS_COLOR[a.status] ?? Colors.mutedFg }]}>{a.status}</Text>
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
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.paymentAmount}>{p.amount.toLocaleString()}원</Text>
                  <Text style={[styles.paymentStatus, { color: p.status === '납부완료' ? Colors.success : Colors.destructive }]}>{p.status}</Text>
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
      </ScrollView>
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
    </KeyboardAvoidingView>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={16} color={Colors.mutedFg} style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileHeader: { backgroundColor: Colors.primary, alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  bigAvatar: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 10, borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)' },
  bigAvatarText: { fontSize: 30, fontWeight: '800', color: '#fff' },
  profileName: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 8 },
  profileBadgeRow: { flexDirection: 'row', gap: 8 },
  levelBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  levelText: { fontSize: 13, fontWeight: '700' },
  inactiveBadge: { backgroundColor: 'rgba(239,68,68,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  inactiveText: { color: Colors.destructive, fontSize: 13, fontWeight: '700' },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  aiBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabLabel: { fontSize: 12, color: Colors.mutedFg, fontWeight: '600' },
  tabLabelActive: { color: Colors.primary },
  content: { flex: 1, backgroundColor: Colors.background },
  card: { backgroundColor: '#fff', margin: 16, borderRadius: 12, padding: 16 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.mutedBg },
  infoLabel: { fontSize: 11, color: Colors.mutedFg, marginBottom: 2 },
  infoValue: { fontSize: 15, color: Colors.foreground, fontWeight: '500' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 10, paddingVertical: 10 },
  editBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  deactivateBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.destructive, borderRadius: 10, paddingVertical: 10 },
  deactivateBtnText: { color: Colors.destructive, fontWeight: '700', fontSize: 14 },
  editLabel: { fontSize: 12, color: Colors.mutedFg, fontWeight: '600', marginBottom: 4, marginTop: 8 },
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
  attendanceDate: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  attendanceStatus: { fontSize: 13, fontWeight: '700' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.mutedBg },
  paymentDesc: { fontSize: 14, color: Colors.foreground, fontWeight: '600', marginBottom: 2 },
  paymentDate: { fontSize: 12, color: Colors.mutedFg },
  paymentAmount: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  paymentStatus: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  noteInputCard: { backgroundColor: '#fff', margin: 16, marginBottom: 0, borderRadius: 12, padding: 12 },
  noteInput: { backgroundColor: Colors.mutedBg, borderRadius: 8, padding: 10, fontSize: 14, color: Colors.foreground, minHeight: 70, marginBottom: 8 },
  noteAddBtn: { backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  noteAddBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  noteCard: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 8, borderRadius: 10, padding: 12 },
  noteContent: { fontSize: 14, color: Colors.foreground, lineHeight: 20, flex: 1 },

  // Timeline
  timelineContainer: { marginHorizontal: 16, marginTop: 8 },
  historyLabel: { fontSize: 12, color: Colors.mutedFg, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  timelineItem: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  timelineLine: { alignItems: 'center', width: 16 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary, marginTop: 18 },
  timelineBar: { width: 2, flex: 1, backgroundColor: Colors.successLight, marginTop: 2 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineDate: { fontSize: 11, color: Colors.mutedFg, fontWeight: '600', marginBottom: 6, marginTop: 14 },
  timelineTime: { color: Colors.placeholder, fontWeight: '400' },
  timelineCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  deleteNoteBtn: { padding: 2 },
  noteFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  noteDate: { fontSize: 11, color: Colors.placeholder },
  emptyCard: { margin: 16, padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 14, color: Colors.placeholder, textAlign: 'center' },
  packageBanner: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: Colors.background, borderRadius: 10, marginTop: 8, gap: 10 },
  packageDot: { width: 10, height: 10, borderRadius: 5 },
  packageTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  packageMeta: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  editPkgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  editPkgCard: { width: '47%', borderRadius: 10, borderWidth: 2, borderColor: Colors.border, padding: 10, position: 'relative', backgroundColor: '#fff' },
  editPkgCardNone: { borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  editPkgCardNoneSelected: { backgroundColor: Colors.mutedFg, borderColor: Colors.mutedFg },
  editPkgCheck: { position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.mutedFg, justifyContent: 'center', alignItems: 'center' },
  editPkgNoneText: { fontSize: 13, color: Colors.mutedFg, marginTop: 4, fontWeight: '600' },
  editPkgColorBar: { height: 3, borderRadius: 2, marginBottom: 6 },
  editPkgTitle: { fontSize: 13, fontWeight: '700', color: Colors.foreground, marginBottom: 2 },
  editPkgMeta: { fontSize: 11, color: Colors.mutedFg },
  editPkgPrice: { fontSize: 13, fontWeight: '800', marginTop: 4 },
  // per-day time rows
  dayTimeRow2: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.mutedBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border, gap: 10, marginBottom: 6 },
  dayTimeBadge2: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.border, justifyContent: 'center', alignItems: 'center' },
  dayTimeBadge2Set: { backgroundColor: Colors.primary },
  dayTimeBadge2Text: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg },
  // time picker modal styles
  modalOverlayTP: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheetTP: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeaderTP: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitleTP: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  spinnerRowTP: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 12 },
  spinnerColTP: { flex: 1, alignItems: 'center' },
  spinnerLabelTP: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  spinnerListTP: { height: 220 },
  spinnerItemTP: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginBottom: 2, alignItems: 'center' },
  spinnerItemTPSel: { backgroundColor: Colors.primary },
  spinnerItemTPText: { fontSize: 22, fontWeight: '600', color: Colors.mutedFg },
  spinnerItemTPTextSel: { color: '#fff', fontWeight: '800' },
  spinnerColonTP: { fontSize: 28, fontWeight: '800', color: Colors.foreground, paddingHorizontal: 8, paddingTop: 28 },
  confirmBtnTP: { margin: 16, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnTPDis: { backgroundColor: Colors.iconMuted },
  confirmBtnTPText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
