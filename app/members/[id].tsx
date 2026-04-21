import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Member, MemberLevel, Attendance, Payment, MemberNote } from '../../types';

const LEVELS: MemberLevel[] = ['입문', '초급', '중급', '고급', '선수'];
const LEVEL_COLORS: Record<MemberLevel, string> = {
  '입문': '#94a3b8', '초급': '#22c55e', '중급': '#3b82f6', '고급': '#f59e0b', '선수': '#ef4444',
};

type Tab = 'info' | 'attendance' | 'payment' | 'notes';

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

  // Sub data
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [memberNotes, setMemberNotes] = useState<MemberNote[]>([]);
  const [newNote, setNewNote] = useState('');

  async function loadMember() {
    const { data } = await supabase.from('members').select('*').eq('id', id).single();
    if (data) {
      setMember(data);
      setName(data.name); setPhone(data.phone);
      setEmail(data.email ?? ''); setLevel(data.level);
      setNotes(data.notes ?? '');
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
    const { error } = await supabase.from('members').update({
      name, phone, email: email || null, level, notes: notes || null,
    }).eq('id', id!);
    if (error) Alert.alert('오류', '저장에 실패했습니다.');
    else { setEditing(false); loadMember(); }
  }

  async function handleDeactivate() {
    Alert.alert('비활성화', `${member?.name}님을 비활성화하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '비활성화', style: 'destructive', onPress: async () => {
          await supabase.from('members').update({ is_active: false }).eq('id', id!);
          router.back();
        }
      }
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

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color="#1a7a4a" /></View>;
  if (!member) return <View style={styles.loader}><Text>회원을 찾을 수 없습니다</Text></View>;

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'info', label: '정보', icon: 'person-outline' },
    { key: 'attendance', label: '출석', icon: 'checkbox-outline' },
    { key: 'payment', label: '결제', icon: 'card-outline' },
    { key: 'notes', label: '메모', icon: 'document-text-outline' },
  ];

  const ATTENDANCE_STATUS_COLOR: Record<string, string> = { '출석': '#22c55e', '결석': '#ef4444', '지각': '#f59e0b', '조퇴': '#3b82f6' };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={[styles.bigAvatar, { backgroundColor: LEVEL_COLORS[member.level as MemberLevel] ?? '#94a3b8' }]}>
          <Text style={styles.bigAvatarText}>{member.name.slice(0, 1)}</Text>
        </View>
        <Text style={styles.profileName}>{member.name}</Text>
        <View style={styles.profileBadgeRow}>
          <View style={[styles.levelBadge, { backgroundColor: (LEVEL_COLORS[member.level as MemberLevel] ?? '#94a3b8') + '33' }]}>
            <Text style={[styles.levelText, { color: LEVEL_COLORS[member.level as MemberLevel] ?? '#94a3b8' }]}>{member.level}</Text>
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
            <Ionicons name={t.icon as any} size={16} color={tab === t.key ? '#1a7a4a' : '#888'} />
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

                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                    <Ionicons name="create-outline" size={16} color="#1a7a4a" />
                    <Text style={styles.editBtnText}>수정</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deactivateBtn} onPress={handleDeactivate}>
                    <Text style={styles.deactivateBtnText}>비활성화</Text>
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
                <Text style={styles.editLabel}>메모</Text>
                <TextInput style={[styles.editInput, { minHeight: 80 }]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" />

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
                  <View style={[styles.statusDot, { backgroundColor: ATTENDANCE_STATUS_COLOR[a.status] ?? '#888' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attendanceTitle}>{lesson?.title ?? '레슨'}</Text>
                    <Text style={styles.attendanceDate}>{lesson?.date} {lesson?.start_time?.slice(0, 5)}</Text>
                  </View>
                  <Text style={[styles.attendanceStatus, { color: ATTENDANCE_STATUS_COLOR[a.status] ?? '#888' }]}>{a.status}</Text>
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
                  <Text style={[styles.paymentStatus, { color: p.status === '납부완료' ? '#22c55e' : '#ef4444' }]}>{p.status}</Text>
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

            {memberNotes.map(n => (
              <View key={n.id} style={styles.noteCard}>
                <Text style={styles.noteContent}>{n.content}</Text>
                <View style={styles.noteFooter}>
                  <Text style={styles.noteDate}>{new Date(n.created_at).toLocaleDateString('ko-KR')}</Text>
                  <TouchableOpacity onPress={() => Alert.alert('삭제', '이 메모를 삭제하시겠습니까?', [
                    { text: '취소', style: 'cancel' },
                    { text: '삭제', style: 'destructive', onPress: () => deleteNote(n.id) },
                  ])}>
                    <Ionicons name="trash-outline" size={16} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {memberNotes.length === 0 && <View style={styles.emptyCard}><Text style={styles.emptyText}>메모가 없습니다</Text></View>}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={16} color="#888" style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileHeader: { backgroundColor: '#1a7a4a', alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  bigAvatar: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 10, borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)' },
  bigAvatarText: { fontSize: 30, fontWeight: '800', color: '#fff' },
  profileName: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 8 },
  profileBadgeRow: { flexDirection: 'row', gap: 8 },
  levelBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  levelText: { fontSize: 13, fontWeight: '700' },
  inactiveBadge: { backgroundColor: 'rgba(239,68,68,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  inactiveText: { color: '#ef4444', fontSize: 13, fontWeight: '700' },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  aiBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#1a7a4a' },
  tabLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  tabLabelActive: { color: '#1a7a4a' },
  content: { flex: 1, backgroundColor: '#f5f7fa' },
  card: { backgroundColor: '#fff', margin: 16, borderRadius: 12, padding: 16 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  infoLabel: { fontSize: 11, color: '#888', marginBottom: 2 },
  infoValue: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: '#1a7a4a', borderRadius: 10, paddingVertical: 10 },
  editBtnText: { color: '#1a7a4a', fontWeight: '700', fontSize: 14 },
  deactivateBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#ef4444', borderRadius: 10, paddingVertical: 10 },
  deactivateBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 14 },
  editLabel: { fontSize: 12, color: '#888', fontWeight: '600', marginBottom: 4, marginTop: 8 },
  editInput: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, color: '#1a1a1a', marginBottom: 4, borderWidth: 1, borderColor: '#eee' },
  levelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  levelBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f0f0f0' },
  levelBtnActive: { backgroundColor: '#1a7a4a' },
  levelBtnText: { fontSize: 13, color: '#888', fontWeight: '600' },
  levelBtnTextActive: { color: '#fff' },
  saveBtn: { flex: 1, backgroundColor: '#1a7a4a', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cancelBtn: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { color: '#666', fontWeight: '700', fontSize: 14 },
  attendanceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  attendanceTitle: { fontSize: 14, color: '#1a1a1a', fontWeight: '600' },
  attendanceDate: { fontSize: 12, color: '#888', marginTop: 2 },
  attendanceStatus: { fontSize: 13, fontWeight: '700' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  paymentDesc: { fontSize: 14, color: '#1a1a1a', fontWeight: '600', marginBottom: 2 },
  paymentDate: { fontSize: 12, color: '#888' },
  paymentAmount: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  paymentStatus: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  noteInputCard: { backgroundColor: '#fff', margin: 16, marginBottom: 0, borderRadius: 12, padding: 12 },
  noteInput: { backgroundColor: '#f5f5f5', borderRadius: 8, padding: 10, fontSize: 14, color: '#1a1a1a', minHeight: 70, marginBottom: 8 },
  noteAddBtn: { backgroundColor: '#1a7a4a', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  noteAddBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  noteCard: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 8, borderRadius: 10, padding: 12 },
  noteContent: { fontSize: 14, color: '#1a1a1a', lineHeight: 20 },
  noteFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  noteDate: { fontSize: 11, color: '#aaa' },
  emptyCard: { margin: 16, padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center' },
});
