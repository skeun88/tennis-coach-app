import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Member } from '../../types';
import { Colors } from '../../lib/theme';

const HOURS = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0'));
const MINUTES = ['00', '10', '15', '20', '30', '40', '45', '50'];

export default function NewLessonScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startHour, setStartHour] = useState('10');
  const [startMinute, setStartMinute] = useState('00');
  const [endHour, setEndHour] = useState('11');
  const [endMinute, setEndMinute] = useState('00');
  const [startHourOpen, setStartHourOpen] = useState(false);
  const [startMinOpen, setStartMinOpen] = useState(false);
  const [endHourOpen, setEndHourOpen] = useState(false);
  const [endMinOpen, setEndMinOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadMembers() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('members').select('*').eq('coach_id', user.id).eq('is_active', true).order('name');
      setMembers(data ?? []);
    }
    loadMembers();
  }, []);

  function toggleMember(id: string) {
    setSelectedMembers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSave() {
    const startTime = `${startHour.padStart(2,'0')}:${startMinute}`;
    const endTime = `${endHour.padStart(2,'0')}:${endMinute}`;
    if (!title.trim()) { Alert.alert('입력 오류', '레슨 제목을 입력해주세요.'); return; }
    if (!date) { Alert.alert('입력 오류', '날짜를 입력해주세요.'); return; }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: lesson, error } = await supabase.from('lessons').insert({
      coach_id: user.id,
      title: title.trim(),
      date,
      start_time: startTime + ':00',
      end_time: endTime + ':00',
      notes: notes.trim() || null,
    }).select().single();

    if (error || !lesson) {
      Alert.alert('오류', '레슨 추가에 실패했습니다.');
      setLoading(false);
      return;
    }

    // Add selected members to lesson
    if (selectedMembers.size > 0) {
      const lessonMembers = Array.from(selectedMembers).map(memberId => ({
        lesson_id: lesson.id,
        member_id: memberId,
      }));
      await supabase.from('lesson_members').insert(lessonMembers);

      // Initialize attendance records
      const attendanceRecords = Array.from(selectedMembers).map(memberId => ({
        lesson_id: lesson.id,
        member_id: memberId,
        status: '출석',
      }));
      await supabase.from('attendance').insert(attendanceRecords);
    }

    setLoading(false);
    Alert.alert('완료', '레슨이 추가되었습니다.', [{ text: '확인', onPress: () => router.back() }]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{
        title: '레슨 추가',
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/schedule')}
            style={{ paddingLeft: 4, paddingRight: 8 }}
          >
            <Ionicons name="chevron-back" size={26} color={Colors.navy} />
          </TouchableOpacity>
        ),
      }} />
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>레슨 정보</Text>

          <Text style={styles.label}>레슨 제목 *</Text>
          <TextInput style={styles.input} placeholder="예: 오전 기초반" value={title} onChangeText={setTitle} />

          <Text style={styles.label}>날짜 *</Text>
          <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} />

          {/* 시작 시간 스피너 */}
          <Text style={styles.label}>시작 시간 *</Text>
          <View style={styles.timeRow}>
            <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setStartHourOpen(v => !v); setStartMinOpen(false); setEndHourOpen(false); setEndMinOpen(false); }}>
              <Text style={styles.spinnerLabel}>시</Text>
              <Text style={styles.spinnerValue}>{startHour.padStart(2,'0')}</Text>
            </TouchableOpacity>
            <Text style={styles.colonText}>:</Text>
            <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setStartMinOpen(v => !v); setStartHourOpen(false); setEndHourOpen(false); setEndMinOpen(false); }}>
              <Text style={styles.spinnerLabel}>분</Text>
              <Text style={styles.spinnerValue}>{startMinute}</Text>
            </TouchableOpacity>
          </View>
          {startHourOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
              {HOURS.map(h => (
                <TouchableOpacity key={h} style={[styles.pickerItem, startHour === h && styles.pickerItemActive]} onPress={() => { setStartHour(h); setStartHourOpen(false); }}>
                  <Text style={[styles.pickerText, startHour === h && styles.pickerTextActive]}>{h}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {startMinOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
              {MINUTES.map(m => (
                <TouchableOpacity key={m} style={[styles.pickerItem, startMinute === m && styles.pickerItemActive]} onPress={() => { setStartMinute(m); setStartMinOpen(false); }}>
                  <Text style={[styles.pickerText, startMinute === m && styles.pickerTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* 종료 시간 스피너 */}
          <Text style={[styles.label, { marginTop: 4 }]}>종료 시간 *</Text>
          <View style={styles.timeRow}>
            <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setEndHourOpen(v => !v); setStartHourOpen(false); setStartMinOpen(false); setEndMinOpen(false); }}>
              <Text style={styles.spinnerLabel}>시</Text>
              <Text style={styles.spinnerValue}>{endHour.padStart(2,'0')}</Text>
            </TouchableOpacity>
            <Text style={styles.colonText}>:</Text>
            <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setEndMinOpen(v => !v); setStartHourOpen(false); setStartMinOpen(false); setEndHourOpen(false); }}>
              <Text style={styles.spinnerLabel}>분</Text>
              <Text style={styles.spinnerValue}>{endMinute}</Text>
            </TouchableOpacity>
          </View>
          {endHourOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
              {HOURS.map(h => (
                <TouchableOpacity key={h} style={[styles.pickerItem, endHour === h && styles.pickerItemActive]} onPress={() => { setEndHour(h); setEndHourOpen(false); }}>
                  <Text style={[styles.pickerText, endHour === h && styles.pickerTextActive]}>{h}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {endMinOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
              {MINUTES.map(m => (
                <TouchableOpacity key={m} style={[styles.pickerItem, endMinute === m && styles.pickerItemActive]} onPress={() => { setEndMinute(m); setEndMinOpen(false); }}>
                  <Text style={[styles.pickerText, endMinute === m && styles.pickerTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <Text style={styles.label}>메모</Text>
          <TextInput style={[styles.input, styles.textArea]} placeholder="특이사항..." value={notes} onChangeText={setNotes} multiline numberOfLines={3} textAlignVertical="top" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>참여 회원 ({selectedMembers.size}명)</Text>
          {/* 검색 */}
          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={16} color={Colors.placeholder} style={{ marginRight: 6 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="회원 검색..."
              value={memberSearch}
              onChangeText={setMemberSearch}
              clearButtonMode="while-editing"
            />
          </View>
          {/* 회원 목록 - 높이 고정 + 스크롤 */}
          <ScrollView style={styles.memberList} nestedScrollEnabled={true}>
            {members.length === 0 && <Text style={styles.noMember}>등록된 회원이 없습니다</Text>}
            {members
              .filter(m => m.name.includes(memberSearch))
              .map(m => {
                const selected = selectedMembers.has(m.id);
                return (
                  <TouchableOpacity key={m.id} style={[styles.memberRow, selected && styles.memberRowSelected]} onPress={() => toggleMember(m.id)}>
                    <View style={[styles.memberAvatar, selected && { backgroundColor: Colors.primary }]}>
                      <Text style={[styles.memberAvatarText, selected && { color: '#fff' }]}>{m.name.slice(0, 1)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{m.name}</Text>
                      <Text style={styles.memberLevel}>{m.level}</Text>
                    </View>
                    <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? Colors.primary : Colors.iconMuted} />
                  </TouchableOpacity>
                );
              })}
          </ScrollView>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>레슨 추가</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  section: { backgroundColor: '#fff', borderRadius: 12, margin: 16, marginBottom: 0, padding: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.mutedFg, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, marginBottom: 6 },
  input: {
    backgroundColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: Colors.foreground, marginBottom: 12, borderWidth: 1, borderColor: Colors.border,
  },
  textArea: { minHeight: 80, paddingTop: 10 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  colonText: { fontSize: 20, fontWeight: '800', color: Colors.mutedFg },
  spinnerBtn: { flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  spinnerLabel: { fontSize: 12, color: Colors.placeholder, fontWeight: '600', marginBottom: 2 },
  spinnerValue: { fontSize: 22, fontWeight: '800', color: Colors.primary },
  pickerRow: { marginBottom: 8 },
  pickerItem: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, marginRight: 6, backgroundColor: Colors.mutedBg, borderWidth: 1, borderColor: Colors.border },
  pickerItemActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pickerText: { fontSize: 15, fontWeight: '600', color: Colors.mutedFg },
  pickerTextActive: { color: '#fff', fontWeight: '800' },
  noMember: { fontSize: 14, color: Colors.placeholder, textAlign: 'center', paddingVertical: 20 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 10,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14, color: Colors.foreground },
  memberList: { maxHeight: 220 },  // 높이 고정 (~4명 보임), 넘치면 스크롤
  memberRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.mutedBg, borderRadius: 8,
    paddingHorizontal: 4,
  },
  memberRowSelected: { backgroundColor: Colors.primaryLight },
  memberAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.border,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  memberAvatarText: { fontSize: 15, fontWeight: '700', color: Colors.mutedFg },
  memberName: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  memberLevel: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  saveBtn: {
    backgroundColor: Colors.primary, margin: 16, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
