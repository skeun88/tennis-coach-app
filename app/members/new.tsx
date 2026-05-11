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

const LEVELS: MemberLevel[] = ['입문', '초급', '중급', '고급', '선수'];
const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const HOURS = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0')); // 06~22
const MINUTES = ['00', '10', '20', '30', '40', '50'];

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
}) {
  const { coachId, memberId, memberName, scheduleDays, dayTimes, lessonDuration, totalCredits, joinDate } = params;
  if (!scheduleDays.length || totalCredits <= 0) return;

  const cursor = new Date(joinDate + 'T00:00:00+09:00');
  const todayForGen = kstToday();
  if (cursor < todayForGen) cursor.setTime(todayForGen.getTime());

  const dates: { date: string; time: string }[] = [];
  let iter = 0;
  const maxIter = totalCredits * 14 * 3 + 100;
  while (dates.length < totalCredits && iter < maxIter) {
    const dow = cursor.getDay();
    if (scheduleDays.includes(dow)) {
      const times = dayTimes[dow] ?? [];
      for (const time of times) {
        if (dates.length < totalCredits) {
          dates.push({ date: toKSTDateStr(cursor), time });
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    iter++;
  }

  for (const { date, time } of dates) {
    const [hh, mm] = time.split(':').map(Number);
    const endMin = hh * 60 + mm + lessonDuration;
    const startSt = time + ':00';
    const endSt = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0') + ':00';

    const { data: lesson, error: lErr } = await supabase.from('lessons')
      .insert({ coach_id: coachId, title: memberName, date, start_time: startSt, end_time: endSt })
      .select('id').single();
    if (lErr || !lesson) continue;
    await supabase.from('lesson_members').insert({ lesson_id: lesson.id, member_id: memberId });
  }
}

export default function NewMemberScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [level, setLevel] = useState<MemberLevel>('초급');
  const [joinDate, setJoinDate] = useState(toKSTDateStr(new Date()));
  const [lessonStartDate, setLessonStartDate] = useState(toKSTDateStr(new Date()));
  const [notes, setNotes] = useState('');

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

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('lesson_packages').select('*')
        .eq('coach_id', user.id).eq('is_active', true).order('created_at', { ascending: false });
      setLessonPackages(data ?? []);
    })();
  }, []);

  function toggleDay(idx: number) {
    setScheduleDays(prev => {
      if (prev.includes(idx)) {
        setDayTimes(dt => { const n = { ...dt }; delete n[idx]; return n; });
        return prev.filter(d => d !== idx);
      }
      return [...prev, idx].sort();
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
    } else {
      setSelectedPackageId(pkg.id);
      setTotalCredits(String(pkg.total_credits));
      setLessonDuration(String(pkg.duration_minutes));
    }
  }

  // 모든 선택 요일에 최소 1개 이상 시간이 있는 경우
  const allDaysHaveTimes = scheduleDays.length > 0 && scheduleDays.every(d => (dayTimes[d]?.length ?? 0) > 0);

  async function doSave(userId: string) {
    const credits = parseInt(totalCredits) || 0;
    const duration = parseInt(lessonDuration) || 60;

    // fixed_schedule_times: { dayIndex: ["HH:MM", ...] }
    const scheduleTimesJson: Record<string, string[]> = {};
    for (const d of scheduleDays) {
      if (dayTimes[d]?.length) scheduleTimesJson[String(d)] = dayTimes[d];
    }
    // backward compat: first day's first time
    const firstDayTime = scheduleDays.length > 0 && dayTimes[scheduleDays[0]]?.[0] ? dayTimes[scheduleDays[0]][0] : null;

    const { data: newMember, error } = await supabase.from('members').insert({
      coach_id: userId, name: name.trim(), phone: phone.trim(),
      email: email.trim() || null, birth_date: birthDate || null,
      level, join_date: joinDate, notes: notes.trim() || null, is_active: true,
      fixed_schedule_days: scheduleDays,
      fixed_schedule_time: firstDayTime,
      fixed_schedule_times: Object.keys(scheduleTimesJson).length > 0 ? scheduleTimesJson : null,
      fixed_lesson_duration: duration,
      total_credits: credits, remaining_credits: credits,
      lesson_package_id: selectedPackageId || null,
    }).select('id').single();
    if (error || !newMember) { setLoading(false); Alert.alert('오류', '회원 등록에 실패했습니다.'); return; }

    if (allDaysHaveTimes && credits > 0) {
      await generateScheduleLessons({
        coachId: userId, memberId: newMember.id, memberName: name.trim(),
        scheduleDays, dayTimes, lessonDuration: duration, totalCredits: credits, joinDate: lessonStartDate,
      });
    }
    setLoading(false);

    const totalSlots = scheduleDays.reduce((sum, d) => sum + (dayTimes[d]?.length ?? 0), 0);
    Alert.alert('완료',
      allDaysHaveTimes && credits > 0
        ? (`${credits}개 레슨이 스케줄에 추가됐습니다. (요일당 최대 ${totalSlots > scheduleDays.length ? '다중' : '1'}타임)`)
        : '회원이 등록됐습니다.',
      [{ text: '확인', onPress: () => router.back() }]
    );
  }

  async function handleSave() {
    if (!name.trim()) { Alert.alert('입력 오류', '이름을 입력해주세요.'); return; }
    if (!phone.trim()) { Alert.alert('입력 오류', '전화번호를 입력해주세요.'); return; }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    if (allDaysHaveTimes) {
      const duration = parseInt(lessonDuration) || 60;
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

        {/* 기본 정보 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <Text style={styles.label}>이름 *</Text>
          <TextInput style={styles.input} placeholder="홍길동" value={name} onChangeText={setName} />
          <Text style={styles.label}>전화번호 *</Text>
          <TextInput style={styles.input} placeholder="010-0000-0000" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Text style={styles.label}>이메일</Text>
          <TextInput style={styles.input} placeholder="example@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Text style={styles.label}>생년월일</Text>
          <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={birthDate} onChangeText={setBirthDate} />
          <Text style={styles.label}>가입일</Text>
          <TextInput style={styles.input} value={joinDate} onChangeText={setJoinDate} />
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
          <Text style={styles.sectionTitle}>고정 레슨 스케줄</Text>
          <Text style={styles.label}>레슨 시작일</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            value={lessonStartDate}
            onChangeText={setLessonStartDate}
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
        </View>

        {/* 레슨권 */}
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
  labelHint: { fontSize: 11, fontWeight: '400', color: Colors.placeholder },
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
  dayTimeHint: { fontSize: 12, color: Colors.warning, marginTop: 4 },
  packageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  packageCard: { width: '47%', borderRadius: 12, borderWidth: 2, padding: 12, position: 'relative', overflow: 'hidden', backgroundColor: '#fff' },
  packageCheckmark: { position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  packageColorBar: { height: 3, borderRadius: 2, marginBottom: 8 },
  packageTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  packageMeta: { fontSize: 11, color: Colors.mutedFg, marginBottom: 2 },
  packagePrice: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  noPackageBox: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  noPackageText: { fontSize: 14, fontWeight: '600', color: Colors.placeholder },
  noPackageSubText: { fontSize: 12, color: Colors.iconMuted },
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
  spinnerLabel: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  spinnerList: { height: 220 },
  spinnerItem: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginBottom: 2, alignItems: 'center' },
  spinnerItemSelected: { backgroundColor: Colors.primary },
  spinnerItemText: { fontSize: 22, fontWeight: '600', color: Colors.mutedFg },
  spinnerItemTextSelected: { color: '#fff', fontWeight: '800' },
  spinnerColon: { fontSize: 28, fontWeight: '800', color: Colors.foreground, paddingHorizontal: 8, paddingTop: 28 },
  confirmBtn: { margin: 16, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnDisabled: { backgroundColor: Colors.iconMuted },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
