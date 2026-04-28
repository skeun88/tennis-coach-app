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

// 시간 옵션: 06:00 ~ 22:00, 30분 단위
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:00`);
  if (h < 22) TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:30`);
}

/** 회원 등록 후 고정 스케줄에 맞게 향후 레슨 자동 생성 */
async function generateScheduleLessons(params: {
  coachId: string;
  memberId: string;
  memberName: string;
  scheduleDays: number[];
  scheduleTime: string;
  lessonDuration: number;
  totalCredits: number;
  joinDate: string;
}) {
  const { coachId, memberId, memberName, scheduleDays, scheduleTime, lessonDuration, totalCredits, joinDate } = params;
  if (scheduleDays.length === 0 || !scheduleTime || totalCredits <= 0) return;

  const [hh, mm] = scheduleTime.split(':').map(Number);
  const endMinutes = hh * 60 + mm + lessonDuration;
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

  const start = new Date(joinDate + 'T00:00:00');
  const dates: string[] = [];
  let count = 0;
  const cursor = new Date(start);

  while (count < totalCredits) {
    if (scheduleDays.includes(cursor.getDay())) {
      dates.push(cursor.toISOString().split('T')[0]);
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
    if (count >= totalCredits || dates.length > totalCredits * 10) break;
  }

  for (const date of dates) {
    const { data: lesson, error: lErr } = await supabase
      .from('lessons')
      .insert({
        coach_id: coachId,
        title: `${memberName} 레슨`,
        date,
        start_time: scheduleTime + ':00',
        end_time: endTime + ':00',
      })
      .select('id')
      .single();

    if (lErr || !lesson) continue;

    await supabase.from('lesson_members').insert({
      lesson_id: lesson.id,
      member_id: memberId,
    });
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
  const [scheduleTime, setScheduleTime] = useState('');
  const [lessonDuration, setLessonDuration] = useState('60');
  const [totalCredits, setTotalCredits] = useState('');
  const [lessonPackages, setLessonPackages] = useState<any[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 시간 스피너 모달
  const [timePickerVisible, setTimePickerVisible] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('lesson_packages')
        .select('*')
        .eq('coach_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      setLessonPackages(data ?? []);
    })();
  }, []);

  function toggleDay(idx: number) {
    setScheduleDays(prev =>
      prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort()
    );
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

  async function handleSave() {
    if (!name.trim()) { Alert.alert('입력 오류', '이름을 입력해주세요.'); return; }
    if (!phone.trim()) { Alert.alert('입력 오류', '전화번호를 입력해주세요.'); return; }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const credits = parseInt(totalCredits) || 0;
    const duration = parseInt(lessonDuration) || 60;

    const { data: newMember, error } = await supabase.from('members').insert({
      coach_id: user.id,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      birth_date: birthDate || null,
      level,
      join_date: joinDate,
      notes: notes.trim() || null,
      is_active: true,
      fixed_schedule_days: scheduleDays,
      fixed_schedule_time: scheduleTime || null,
      fixed_lesson_duration: duration,
      total_credits: credits,
      remaining_credits: credits,
      lesson_package_id: selectedPackageId || null,
    }).select('id').single();

    if (error || !newMember) {
      setLoading(false);
      Alert.alert('오류', '회원 등록에 실패했습니다.');
      return;
    }

    // 고정 스케줄 기반 레슨 자동 생성
    if (scheduleDays.length > 0 && scheduleTime && credits > 0) {
      await generateScheduleLessons({
        coachId: user.id,
        memberId: newMember.id,
        memberName: name.trim(),
        scheduleDays,
        scheduleTime,
        lessonDuration: duration,
        totalCredits: credits,
        joinDate,
      });
    }

    setLoading(false);
    Alert.alert(
      '완료',
      scheduleDays.length > 0 && scheduleTime && credits > 0
        ? `회원이 등록되고 ${credits}개의 레슨이 스케줄에 추가되었습니다.`
        : '회원이 등록되었습니다.',
      [{ text: '확인', onPress: () => router.back() }]
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>레벨</Text>
          <View style={styles.levelRow}>
            {LEVELS.map(l => (
              <TouchableOpacity
                key={l}
                style={[styles.levelBtn, level === l && styles.levelBtnActive]}
                onPress={() => setLevel(l)}
              >
                <Text style={[styles.levelBtnText, level === l && styles.levelBtnTextActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>고정 레슨 스케줄</Text>
          <Text style={styles.label}>레슨 요일</Text>
          <View style={styles.dayRow}>
            {DAYS_KR.map((d, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.dayBtn, scheduleDays.includes(i) && styles.dayBtnActive]}
                onPress={() => toggleDay(i)}
              >
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
                const daysLabel = pkg.days?.length > 0
                  ? pkg.days.map((d: number) => ['일','월','화','수','목','금','토'][d]).join(', ')
                  : null;
                return (
                  <TouchableOpacity
                    key={pkg.id}
                    style={[styles.packageCard, { borderColor: pkg.color }, isSelected && { backgroundColor: pkg.color + '18' }]}
                    onPress={() => handleSelectPackage(pkg)}
                    activeOpacity={0.8}
                  >
                    {isSelected && (
                      <View style={[styles.packageCheckmark, { backgroundColor: pkg.color }]}>
                        <Ionicons name="checkmark" size={12} color="#fff" />
                      </View>
                    )}
                    <View style={[styles.packageColorBar, { backgroundColor: pkg.color }]} />
                    <Text style={styles.packageTitle} numberOfLines={2}>{pkg.title}</Text>
                    {daysLabel && <Text style={styles.packageMeta}>{daysLabel}</Text>}
                    <Text style={styles.packageMeta}>{pkg.duration_minutes}분 · {pkg.total_credits}회</Text>
                    <Text style={[styles.packagePrice, { color: pkg.color }]}>
                      {pkg.price.toLocaleString()}원
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <Text style={[styles.label, { marginTop: 12 }]}>
            {selectedPackageId ? '횟수 조정 (선택사항)' : '총 레슨 횟수 직접 입력'}
          </Text>
          <TextInput
            style={styles.input}
            placeholder="예: 10"
            value={totalCredits}
            onChangeText={setTotalCredits}
            keyboardType="number-pad"
          />
          {totalCredits !== '' && (
            <View style={styles.creditPreview}>
              <Ionicons name="layers-outline" size={16} color="#1a7a4a" />
              <Text style={styles.creditPreviewText}>
                {totalCredits}회 레슨권 등록
                {scheduleDays.length > 0 && scheduleTime ? ` · 스케줄 자동 생성` : ''}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>메모</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="특이사항, 목표, 참고사항 등"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>회원 등록</Text>}
        </TouchableOpacity>
      </ScrollView>

      {/* 시간 스피너 모달 */}
      <Modal
        visible={timePickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTimePickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>레슨 시작 시간</Text>
              <TouchableOpacity onPress={() => setTimePickerVisible(false)}>
                <Ionicons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={TIME_OPTIONS}
              keyExtractor={item => item}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = item === scheduleTime;
                return (
                  <TouchableOpacity
                    style={[styles.timeOption, isSelected && styles.timeOptionSelected]}
                    onPress={() => {
                      setScheduleTime(item);
                      setTimePickerVisible(false);
                    }}
                  >
                    <Text style={[styles.timeOptionText, isSelected && styles.timeOptionTextSelected]}>
                      {item}
                    </Text>
                    {isSelected && <Ionicons name="checkmark" size={18} color="#1a7a4a" />}
                  </TouchableOpacity>
                );
              }}
            />
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
  input: {
    backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: '#1a1a1a', marginBottom: 12, borderWidth: 1, borderColor: '#eee',
  },
  textArea: { minHeight: 100, paddingTop: 10 },
  levelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  levelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f0f0f0' },
  levelBtnActive: { backgroundColor: '#1a7a4a' },
  levelBtnText: { fontSize: 14, color: '#888', fontWeight: '600' },
  levelBtnTextActive: { color: '#fff' },
  saveBtn: {
    backgroundColor: '#1a7a4a', margin: 16, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  dayBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  dayBtnActive: { backgroundColor: '#1a7a4a' },
  dayBtnText: { fontSize: 13, fontWeight: '700', color: '#888' },
  dayBtnTextActive: { color: '#fff' },
  creditPreview: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0fdf4', borderRadius: 8, padding: 10, marginTop: -4 },
  creditPreviewText: { fontSize: 14, color: '#1a7a4a', fontWeight: '600' },
  noPackageBox: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  noPackageText: { fontSize: 14, fontWeight: '600', color: '#aaa' },
  noPackageSubText: { fontSize: 12, color: '#ccc' },
  packageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  packageCard: {
    width: '47%', borderRadius: 12, borderWidth: 2, padding: 12,
    position: 'relative', overflow: 'hidden', backgroundColor: '#fff',
  },
  packageCheckmark: {
    position: 'absolute', top: 8, right: 8,
    width: 20, height: 20, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  packageColorBar: { height: 3, borderRadius: 2, marginBottom: 8 },
  packageTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  packageMeta: { fontSize: 11, color: '#888', marginBottom: 2 },
  packagePrice: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  // 시간 선택
  timeSelector: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#eee', marginBottom: 12,
  },
  timeSelectorText: { flex: 1, fontSize: 15, color: '#1a1a1a', fontWeight: '600' },
  timePlaceholder: { color: '#aaa', fontWeight: '400' },
  // 모달
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '60%', paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  timeOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  timeOptionSelected: { backgroundColor: '#f0fdf4' },
  timeOptionText: { fontSize: 16, color: '#444', fontWeight: '500' },
  timeOptionTextSelected: { color: '#1a7a4a', fontWeight: '700' },
});
