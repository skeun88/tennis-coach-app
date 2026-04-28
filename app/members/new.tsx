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

const LEVELS: MemberLevel[] = ['입문', '초급', '중급', '고급', '선수'];
const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const HOURS = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0')); // 06~22
const MINUTES = ['00', '10', '20', '30', '40', '50'];

/** 충돌 체크: 같은 코치의 같은 시간대에 다른 레슨 있는지 확인 */
async function checkConflicts(
  coachId: string,
  scheduleDays: number[],
  scheduleTime: string,
  lessonDuration: number,
  excludeMemberId?: string,
): Promise<{ date: string; memberName: string; startTime: string }[]> {
  if (!scheduleDays.length || !scheduleTime) return [];
  const [hh, mm] = scheduleTime.split(':').map(Number);
  const newStart = hh * 60 + mm;
  const newEnd = newStart + lessonDuration;

  // 선택한 요일에 해당하는 날짜만 수집 (향후 60일)
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const checkDates: string[] = [];
  const checkDatesSet = new Set<number>(); // 요일 빠른 조회용
  const cur = new Date(today);
  for (let i = 0; i < 60; i++) {
    if (scheduleDays.includes(cur.getDay())) {
      checkDates.push(cur.toISOString().split('T')[0]);
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (!checkDates.length) return [];

  const { data: existing } = await supabase
    .from('lessons')
    .select('id, date, start_time, end_time, lesson_members(member_id, member:members(name))')
    .eq('coach_id', coachId)
    .in('date', checkDates);

  const conflicts: { date: string; memberName: string; startTime: string }[] = [];
  for (const lesson of (existing ?? []) as any[]) {
    // lesson_members 없는 레슨은 충돌 무시
    if (!lesson.lesson_members || lesson.lesson_members.length === 0) continue;

    // 날짜가 실제로 선택 요일인지 이중 검증
    const lessonDate = new Date(lesson.date + 'T00:00:00');
    if (!scheduleDays.includes(lessonDate.getDay())) continue;

    const [lh, lm] = lesson.start_time.slice(0, 5).split(':').map(Number);
    const [eh, em] = lesson.end_time.slice(0, 5).split(':').map(Number);
    const lStart = lh * 60 + lm;
    const lEnd = eh * 60 + em;
    if (newStart < lEnd && newEnd > lStart) {
      for (const lmRow of lesson.lesson_members ?? []) {
        if (excludeMemberId && lmRow.member_id === excludeMemberId) continue;
        const mName = lmRow.member?.name ?? '다른 회원';
        if (!conflicts.find(cf => cf.date === lesson.date && cf.memberName === mName)) {
          conflicts.push({ date: lesson.date, memberName: mName, startTime: lesson.start_time.slice(0, 5) });
        }
      }
    }
  }
  return conflicts;
}

/** 고정 스케줄 기반 레슨 자동 생성 */
async function generateScheduleLessons(params: {
  coachId: string; memberId: string; memberName: string;
  scheduleDays: number[]; scheduleTime: string; lessonDuration: number;
  totalCredits: number; joinDate: string;
}) {
  const { coachId, memberId, memberName, scheduleDays, scheduleTime, lessonDuration, totalCredits, joinDate } = params;
  if (!scheduleDays.length || !scheduleTime || totalCredits <= 0) return;
  const [hh, mm] = scheduleTime.split(':').map(Number);
  const endMin = hh * 60 + mm + lessonDuration;
  const startSt = scheduleTime + ':00';
  const endSt = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0') + ':00';
  const cursor = new Date(joinDate + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (cursor < today) cursor.setTime(today.getTime());
  const dates: string[] = [];
  let iter = 0;
  while (dates.length < totalCredits && iter < totalCredits * 14) {
    if (scheduleDays.includes(cursor.getDay())) dates.push(cursor.toISOString().split('T')[0]);
    cursor.setDate(cursor.getDate() + 1); iter++;
  }
  for (const date of dates) {
    const { data: lesson, error: lErr } = await supabase.from('lessons')
      .insert({ coach_id: coachId, title: memberName + ' 레슨', date, start_time: startSt, end_time: endSt })
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
  const [joinDate, setJoinDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [scheduleDays, setScheduleDays] = useState<number[]>([]);
  const [selectedHour, setSelectedHour] = useState('');
  const [selectedMinute, setSelectedMinute] = useState('00');
  const [lessonDuration, setLessonDuration] = useState('60');
  const [totalCredits, setTotalCredits] = useState('');
  const [lessonPackages, setLessonPackages] = useState<any[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);

  const scheduleTime = selectedHour ? (selectedHour + ':' + selectedMinute) : '';

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
    setScheduleDays(prev => prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort());
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

  async function doSave(userId: string) {
    const credits = parseInt(totalCredits) || 0;
    const duration = parseInt(lessonDuration) || 60;
    const { data: newMember, error } = await supabase.from('members').insert({
      coach_id: userId, name: name.trim(), phone: phone.trim(),
      email: email.trim() || null, birth_date: birthDate || null,
      level, join_date: joinDate, notes: notes.trim() || null, is_active: true,
      fixed_schedule_days: scheduleDays,
      fixed_schedule_time: scheduleTime || null,
      fixed_lesson_duration: duration,
      total_credits: credits, remaining_credits: credits,
      lesson_package_id: selectedPackageId || null,
    }).select('id').single();
    if (error || !newMember) { setLoading(false); Alert.alert('오류', '회원 등록에 실패했습니다.'); return; }
    if (scheduleDays.length > 0 && scheduleTime && credits > 0) {
      await generateScheduleLessons({
        coachId: userId, memberId: newMember.id, memberName: name.trim(),
        scheduleDays, scheduleTime, lessonDuration: duration, totalCredits: credits, joinDate,
      });
    }
    setLoading(false);
    Alert.alert('완료',
      scheduleDays.length > 0 && scheduleTime && credits > 0
        ? (credits + '개 레슨이 스케줄에 추가됐습니다.')
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

    // 충돌 체크
    if (scheduleDays.length > 0 && scheduleTime) {
      const duration = parseInt(lessonDuration) || 60;
      const conflicts = await checkConflicts(user.id, scheduleDays, scheduleTime, duration);
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
          <Text style={styles.label}>레슨 요일</Text>
          <View style={styles.dayRow}>
            {DAYS_KR.map((d, i) => (
              <TouchableOpacity key={i} style={[styles.dayBtn, scheduleDays.includes(i) && styles.dayBtnActive]} onPress={() => toggleDay(i)}>
                <Text style={[styles.dayBtnText, scheduleDays.includes(i) && styles.dayBtnTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>레슨 시작 시간</Text>
          <TouchableOpacity style={styles.timeSelector} onPress={() => setTimePickerVisible(true)}>
            <Ionicons name="time-outline" size={18} color={scheduleTime ? '#1a7a4a' : '#aaa'} />
            <Text style={[styles.timeSelectorText, !scheduleTime && styles.timePlaceholder]}>
              {scheduleTime || '시간 선택'}
            </Text>
            <Ionicons name="chevron-down" size={16} color="#aaa" />
          </TouchableOpacity>
        </View>

        {/* 레슨권 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>레슨권 선택</Text>
          {lessonPackages.length === 0 ? (
            <View style={styles.noPackageBox}>
              <Ionicons name="receipt-outline" size={24} color="#ccc" />
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
          <Text style={[styles.label, { marginTop: 12 }]}>총 레슨 횟수</Text>
          <TextInput style={styles.input} placeholder="예: 10" value={totalCredits} onChangeText={setTotalCredits} keyboardType="number-pad" />
          {totalCredits !== '' && (
            <View style={styles.creditPreview}>
              <Ionicons name="layers-outline" size={16} color="#1a7a4a" />
              <Text style={styles.creditPreviewText}>
                {totalCredits}회 레슨권{scheduleDays.length > 0 && scheduleTime ? ' · 스케줄 자동 생성' : ''}
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
              <Text style={styles.modalTitle}>레슨 시작 시간</Text>
              <TouchableOpacity onPress={() => setTimePickerVisible(false)}>
                <Ionicons name="close" size={22} color="#888" />
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
                    const isSelected = item === selectedHour;
                    return (
                      <TouchableOpacity style={[styles.spinnerItem, isSelected && styles.spinnerItemSelected]} onPress={() => setSelectedHour(item)}>
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
                    const isSelected = item === selectedMinute;
                    return (
                      <TouchableOpacity style={[styles.spinnerItem, isSelected && styles.spinnerItemSelected]} onPress={() => setSelectedMinute(item)}>
                        <Text style={[styles.spinnerItemText, isSelected && styles.spinnerItemTextSelected]}>{item}</Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.confirmBtn, !selectedHour && styles.confirmBtnDisabled]}
              onPress={() => {
                if (!selectedHour) { Alert.alert('', '시간을 선택해주세요.'); return; }
                setTimePickerVisible(false);
              }}
            >
              <Text style={styles.confirmBtnText}>
                {selectedHour ? (selectedHour + ':' + selectedMinute + ' 선택') : '시간을 선택하세요'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  section: { backgroundColor: '#fff', borderRadius: 12, margin: 16, marginBottom: 0, padding: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  input: { backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#1a1a1a', marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  textArea: { minHeight: 100, paddingTop: 10 },
  levelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  levelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f0f0f0' },
  levelBtnActive: { backgroundColor: '#1a7a4a' },
  levelBtnText: { fontSize: 14, color: '#888', fontWeight: '600' },
  levelBtnTextActive: { color: '#fff' },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  dayBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  dayBtnActive: { backgroundColor: '#1a7a4a' },
  dayBtnText: { fontSize: 13, fontWeight: '700', color: '#888' },
  dayBtnTextActive: { color: '#fff' },
  timeSelector: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#eee', marginBottom: 12 },
  timeSelectorText: { flex: 1, fontSize: 15, color: '#1a1a1a', fontWeight: '600' },
  timePlaceholder: { color: '#aaa', fontWeight: '400' },
  packageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  packageCard: { width: '47%', borderRadius: 12, borderWidth: 2, padding: 12, position: 'relative', overflow: 'hidden', backgroundColor: '#fff' },
  packageCheckmark: { position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  packageColorBar: { height: 3, borderRadius: 2, marginBottom: 8 },
  packageTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  packageMeta: { fontSize: 11, color: '#888', marginBottom: 2 },
  packagePrice: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  noPackageBox: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  noPackageText: { fontSize: 14, fontWeight: '600', color: '#aaa' },
  noPackageSubText: { fontSize: 12, color: '#ccc' },
  creditPreview: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0fdf4', borderRadius: 8, padding: 10, marginTop: -4 },
  creditPreviewText: { fontSize: 14, color: '#1a7a4a', fontWeight: '600' },
  saveBtn: { backgroundColor: '#1a7a4a', margin: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  spinnerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 12 },
  spinnerCol: { flex: 1, alignItems: 'center' },
  spinnerLabel: { fontSize: 12, fontWeight: '700', color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  spinnerList: { height: 220 },
  spinnerItem: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginBottom: 2, alignItems: 'center' },
  spinnerItemSelected: { backgroundColor: '#1a7a4a' },
  spinnerItemText: { fontSize: 22, fontWeight: '600', color: '#555' },
  spinnerItemTextSelected: { color: '#fff', fontWeight: '800' },
  spinnerColon: { fontSize: 28, fontWeight: '800', color: '#1a1a1a', paddingHorizontal: 8, paddingTop: 28 },
  confirmBtn: { margin: 16, backgroundColor: '#1a7a4a', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnDisabled: { backgroundColor: '#ccc' },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
