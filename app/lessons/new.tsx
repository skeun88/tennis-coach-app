import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Member } from '../../types';

export default function NewLessonScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [location, setLocation] = useState('');
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
    if (!title.trim()) { Alert.alert('입력 오류', '레슨 제목을 입력해주세요.'); return; }
    if (!date || !startTime || !endTime) { Alert.alert('입력 오류', '날짜와 시간을 입력해주세요.'); return; }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: lesson, error } = await supabase.from('lessons').insert({
      coach_id: user.id,
      title: title.trim(),
      date,
      start_time: startTime + ':00',
      end_time: endTime + ':00',
      location: location.trim() || null,
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
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>레슨 정보</Text>

          <Text style={styles.label}>레슨 제목 *</Text>
          <TextInput style={styles.input} placeholder="예: 오전 기초반" value={title} onChangeText={setTitle} />

          <Text style={styles.label}>날짜 *</Text>
          <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} />

          <View style={styles.timeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>시작 시간 *</Text>
              <TextInput style={styles.input} placeholder="HH:MM" value={startTime} onChangeText={setStartTime} />
            </View>
            <View style={styles.timeSep}><Text style={styles.timeSepText}>~</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>종료 시간 *</Text>
              <TextInput style={styles.input} placeholder="HH:MM" value={endTime} onChangeText={setEndTime} />
            </View>
          </View>

          <Text style={styles.label}>장소</Text>
          <TextInput style={styles.input} placeholder="코트 이름 또는 주소" value={location} onChangeText={setLocation} />

          <Text style={styles.label}>메모</Text>
          <TextInput style={[styles.input, styles.textArea]} placeholder="특이사항..." value={notes} onChangeText={setNotes} multiline numberOfLines={3} textAlignVertical="top" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>참여 회원 ({selectedMembers.size}명)</Text>
          {/* 검색 */}
          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={16} color="#aaa" style={{ marginRight: 6 }} />
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
                    <View style={[styles.memberAvatar, selected && { backgroundColor: '#1a7a4a' }]}>
                      <Text style={[styles.memberAvatarText, selected && { color: '#fff' }]}>{m.name.slice(0, 1)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{m.name}</Text>
                      <Text style={styles.memberLevel}>{m.level}</Text>
                    </View>
                    <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? '#1a7a4a' : '#ccc'} />
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
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  section: { backgroundColor: '#fff', borderRadius: 12, margin: 16, marginBottom: 0, padding: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  input: {
    backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: '#1a1a1a', marginBottom: 12, borderWidth: 1, borderColor: '#eee',
  },
  textArea: { minHeight: 80, paddingTop: 10 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  timeSep: { paddingTop: 30 },
  timeSepText: { fontSize: 18, color: '#888' },
  noMember: { fontSize: 14, color: '#aaa', textAlign: 'center', paddingVertical: 20 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 10,
    marginBottom: 8, borderWidth: 1, borderColor: '#eee',
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14, color: '#1a1a1a' },
  memberList: { maxHeight: 220 },  // 높이 고정 (~4명 보임), 넘치면 스크롤
  memberRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0', borderRadius: 8,
    paddingHorizontal: 4,
  },
  memberRowSelected: { backgroundColor: '#f0fdf4' },
  memberAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#e5e7eb',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  memberAvatarText: { fontSize: 15, fontWeight: '700', color: '#555' },
  memberName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  memberLevel: { fontSize: 12, color: '#888', marginTop: 2 },
  saveBtn: {
    backgroundColor: '#1a7a4a', margin: 16, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
