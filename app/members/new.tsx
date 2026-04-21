import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { MemberLevel } from '../../types';

const LEVELS: MemberLevel[] = ['입문', '초급', '중급', '고급', '선수'];

export default function NewMemberScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [level, setLevel] = useState<MemberLevel>('초급');
  const [joinDate, setJoinDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!name.trim()) { Alert.alert('입력 오류', '이름을 입력해주세요.'); return; }
    if (!phone.trim()) { Alert.alert('입력 오류', '전화번호를 입력해주세요.'); return; }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { error } = await supabase.from('members').insert({
      coach_id: user.id,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      birth_date: birthDate || null,
      level,
      join_date: joinDate,
      notes: notes.trim() || null,
      is_active: true,
    });

    setLoading(false);
    if (error) {
      Alert.alert('오류', '회원 등록에 실패했습니다.');
    } else {
      Alert.alert('완료', '회원이 등록되었습니다.', [{ text: '확인', onPress: () => router.back() }]);
    }
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
});
