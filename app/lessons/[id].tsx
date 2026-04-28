import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Lesson, AttendanceStatus } from '../../types';

const STATUS_OPTIONS: AttendanceStatus[] = ['출석', '지각', '조퇴', '결석'];
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  '출석': '#22c55e', '결석': '#ef4444', '지각': '#f59e0b', '조퇴': '#3b82f6',
};

// 차감되는 상태 (출석/지각/조퇴/결석 모두 차감)
const DEDUCT_STATUSES: AttendanceStatus[] = ['출석', '지각', '조퇴', '결석'];

interface AttendanceRow {
  id: string;
  member_id: string;
  status: AttendanceStatus;
  deduct_credit: boolean;
  member: {
    id: string;
    name: string;
    level: string;
    remaining_credits: number;
  };
}

const SPINNER_HOURS = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0'));
const SPINNER_MINUTES = ['00', '10', '20', '30', '40', '50'];
const DURATION_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];

function minutesToTime(m: number): string {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

export default function LessonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [editModal, setEditModal] = useState(false);
  const [editHour, setEditHour] = useState('');
  const [editMinute, setEditMinute] = useState('00');
  const [editDuration, setEditDuration] = useState(60);
  const [savingEdit, setSavingEdit] = useState(false);
  const [hourPickerOpen, setHourPickerOpen] = useState(false);
  const [minutePickerOpen, setMinutePickerOpen] = useState(false);
  const [durationPickerOpen, setDurationPickerOpen] = useState(false);

  async function loadLesson() {
    const { data } = await supabase.from('lessons').select('*').eq('id', id).single();
    setLesson(data);
  }

  async function loadAttendance() {
    // lesson_members에 등록된 전체 회원 가져오기
    const { data: lmData } = await supabase
      .from('lesson_members')
      .select('member_id, member:members(id, name, level, remaining_credits)')
      .eq('lesson_id', id);

    // 기존 출석 기록 가져오기 (회원 정보 포함)
    const { data: attData } = await supabase
      .from('attendance')
      .select('id, member_id, status, deduct_credit, member:members(id, name, level, remaining_credits)')
      .eq('lesson_id', id);

    const attMap = new Map((attData ?? []).map(a => [a.member_id, a]));

    let merged: AttendanceRow[];

    if (lmData && lmData.length > 0) {
      // lesson_members 기준으로 합치기
      merged = lmData.map(lm => {
        const member = lm.member as any;
        const att = attMap.get(lm.member_id);
        return {
          id: att?.id ?? '',
          member_id: lm.member_id,
          status: (att?.status ?? null) as any,
          deduct_credit: att?.deduct_credit ?? false,
          member,
        };
      });
    } else {
      // 기존 레슨: attendance 기록에서 직접 가져오기
      merged = (attData ?? []).map(a => ({
        id: a.id,
        member_id: a.member_id,
        status: a.status as AttendanceStatus,
        deduct_credit: a.deduct_credit,
        member: (a as any).member,
      }));
    }

    setAttendance(merged);
    setLoading(false);
  }

  useEffect(() => {
    loadLesson();
    loadAttendance();
  }, []);

  async function updateStatus(row: AttendanceRow, newStatus: AttendanceStatus) {
    if (updating) return;
    setUpdating(row.id);

    const oldStatus = row.status;
    const wasDeducted = row.deduct_credit;
    const willDeduct = DEDUCT_STATUSES.includes(newStatus);

    // 크레딧 변화 계산
    // 이전에 차감됐고 이제 차감 안 되면 +1 복구
    // 이전에 차감 안 됐고 이제 차감되면 -1
    let creditDelta = 0;
    if (wasDeducted && !willDeduct) creditDelta = 1;
    if (!wasDeducted && willDeduct) creditDelta = -1;

    // 잔여 횟수 부족할 때 경고
    if (creditDelta < 0 && row.member.remaining_credits <= 0) {
      Alert.alert(
        '수강권 부족',
        `${row.member.name}님의 잔여 수강권이 없습니다. (0회)\n그래도 차감하시겠습니까?`,
        [
          { text: '취소', style: 'cancel', onPress: () => setUpdating(null) },
          { text: '차감', style: 'destructive', onPress: () => doUpdate(row, newStatus, willDeduct, creditDelta) },
        ]
      );
      return;
    }

    await doUpdate(row, newStatus, willDeduct, creditDelta);
  }

  async function doUpdate(row: AttendanceRow, newStatus: AttendanceStatus, willDeduct: boolean, creditDelta: number) {
    // 출석 기록 없으면 insert, 있으면 update
    if (!row.id) {
      await supabase.from('attendance').insert({
        lesson_id: id,
        member_id: row.member_id,
        status: newStatus,
        deduct_credit: willDeduct,
      });
    } else {
      await supabase.from('attendance').update({
        status: newStatus,
        deduct_credit: willDeduct,
      }).eq('id', row.id);
    }

    // 크레딧 변화 있으면 member 업데이트
    if (creditDelta !== 0) {
      await supabase.from('members').update({
        remaining_credits: Math.max(0, row.member.remaining_credits + creditDelta),
      }).eq('id', row.member_id);
    }

    // 로컬 상태 업데이트 후 리로드
    setUpdating(null);
    await loadAttendance();
  }

  async function deleteLesson() {
    Alert.alert('레슨 삭제', '이 레슨을 삭제하시겠습니까? 출석 기록도 함께 삭제됩니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive', onPress: async () => {
          // 차감됐던 크레딧 복구
          for (const a of attendance) {
            if (a.deduct_credit) {
              await supabase.from('members').update({
                remaining_credits: a.member.remaining_credits + 1,
              }).eq('id', a.member_id);
            }
          }
          await supabase.from('lessons').delete().eq('id', id!);
          router.back();
        }
      }
    ]);
  }

  function openEditModal() {
    if (!lesson) return;
    const [h, m] = lesson.start_time.slice(0, 5).split(':');
    const startMin = parseInt(h) * 60 + parseInt(m);
    const endMin = parseInt(lesson.end_time.slice(0, 2)) * 60 + parseInt(lesson.end_time.slice(3, 5));
    setEditHour(h);
    setEditMinute(m);
    setEditDuration(endMin - startMin);
    setHourPickerOpen(false);
    setMinutePickerOpen(false);
    setDurationPickerOpen(false);
    setEditModal(true);
  }

  async function handleSaveTime() {
    if (!editHour) { Alert.alert('오류', '시간을 선택해주세요.'); return; }
    setSavingEdit(true);
    const startMin = parseInt(editHour) * 60 + parseInt(editMinute);
    const endMin = startMin + editDuration;
    const startSt = editHour + ':' + editMinute + ':00';
    const endSt = minutesToTime(endMin) + ':00';
    // 오버랩 체크 (자신 제외)
    const { data: existing } = await supabase.from('lessons').select('id, start_time, end_time')
      .eq('coach_id', (lesson as any).coach_id).eq('date', lesson!.date).neq('id', lesson!.id);
    const overlap = (existing ?? []).find((l: any) => {
      const ls = parseInt(l.start_time.slice(0,2))*60+parseInt(l.start_time.slice(3,5));
      const le = parseInt(l.end_time.slice(0,2))*60+parseInt(l.end_time.slice(3,5));
      return startMin < le && endMin > ls;
    });
    if (overlap) {
      setSavingEdit(false);
      Alert.alert('시간 충돌', '해당 시간대에 다른 레슨이 있습니다. 다른 시간을 선택해주세요.');
      return;
    }
    const { error } = await supabase.from('lessons').update({ start_time: startSt, end_time: endSt }).eq('id', lesson!.id);
    setSavingEdit(false);
    if (error) { Alert.alert('오류', '수정 실패'); return; }
    setEditModal(false);
    loadLesson();
  }

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color="#1a7a4a" /></View>;
  if (!lesson) return <View style={styles.loader}><Text>레슨을 찾을 수 없습니다</Text></View>;

  const presentCount = attendance.filter(a => a.status === '출석').length;
  const totalCount = attendance.length;
  const deductedCount = attendance.filter(a => a.deduct_credit).length;
  const checkedCount = attendance.filter(a => a.status !== null).length;

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={styles.container}>
      {/* Lesson Info */}
      <View style={styles.infoCard}>
        <Text style={styles.lessonTitle}>{lesson.title}</Text>
        <View style={styles.infoRow}>
          <Ionicons name="calendar-outline" size={15} color="#888" />
          <Text style={styles.infoText}>{lesson.date}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="time-outline" size={15} color="#888" />
          <Text style={styles.infoText}>{lesson.start_time?.slice(0, 5)} ~ {lesson.end_time?.slice(0, 5)}</Text>
        </View>
        {lesson.location && (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={15} color="#888" />
            <Text style={styles.infoText}>{lesson.location}</Text>
          </View>
        )}
        {lesson.notes && (
          <View style={styles.infoRow}>
            <Ionicons name="document-text-outline" size={15} color="#888" />
            <Text style={styles.infoText}>{lesson.notes}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <TouchableOpacity style={styles.editBtn} onPress={openEditModal}>
            <Ionicons name="create-outline" size={14} color="#1a7a4a" />
            <Text style={styles.editBtnText}>시간 수정</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={deleteLesson}>
            <Ionicons name="trash-outline" size={14} color="#ef4444" />
            <Text style={styles.deleteBtnText}>레슨 삭제</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 수강권 차감 안내 */}
      <View style={styles.noticeCard}>
        <Ionicons name="information-circle-outline" size={16} color="#2563eb" />
        <Text style={styles.noticeText}>출석·지각·조퇴·결석 모두 수강권 1회 차감됩니다</Text>
      </View>

      {/* Attendance */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>출석 체크</Text>
          <View style={styles.sectionMeta}>
            <Text style={styles.sectionCount}>{checkedCount}/{totalCount}명 체크됨</Text>
            <Text style={styles.deductCount}>· {deductedCount}명 차감</Text>
          </View>
        </View>

        {attendance.length === 0 && (
          <Text style={styles.emptyText}>등록된 회원이 없습니다</Text>
        )}

        {attendance.map(a => (
          <View key={a.member_id} style={styles.attendanceCard}>
            {/* 회원 정보 */}
            <TouchableOpacity onPress={() => router.push(`/members/${a.member_id}`)}>
              <View style={[styles.avatar, { backgroundColor: a.status ? STATUS_COLOR[a.status] + '33' : '#f0f0f0' }]}>
                <Text style={[styles.avatarText, { color: a.status ? STATUS_COLOR[a.status] : '#888' }]}>
                  {a.member?.name?.slice(0, 1) ?? '?'}
                </Text>
              </View>
            </TouchableOpacity>
            <View style={styles.memberInfo}>
              <TouchableOpacity onPress={() => router.push(`/members/${a.member_id}`)}>
                <Text style={styles.memberName}>{a.member?.name ?? '알 수 없음'}</Text>
              </TouchableOpacity>
              <View style={styles.creditRow}>
                <Ionicons name="ticket-outline" size={12} color={a.member.remaining_credits <= 2 ? '#ef4444' : '#888'} />
                <Text style={[styles.creditText, a.member.remaining_credits <= 2 && { color: '#ef4444', fontWeight: '700' }]}>
                  잔여 {a.member.remaining_credits}회
                </Text>
                {a.deduct_credit && (
                  <View style={styles.deductBadge}>
                    <Text style={styles.deductBadgeText}>-1회</Text>
                  </View>
                )}
              </View>
            </View>

            {/* 상태 버튼 */}
            {updating === a.member_id ? (
              <ActivityIndicator size="small" color="#1a7a4a" />
            ) : (
              <View style={styles.statusButtons}>
                {STATUS_OPTIONS.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusBtn, a.status === s && { backgroundColor: STATUS_COLOR[s] }]}
                    onPress={() => updateStatus(a, s)}
                  >
                    <Text style={[styles.statusBtnText, a.status === s && { color: '#fff' }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ))}
      </View>

      {/* Summary */}
      {attendance.length > 0 && (
        <View style={styles.summaryCard}>
          {STATUS_OPTIONS.map(s => {
            const count = attendance.filter(a => a.status === s).length;
            return (
              <View key={s} style={styles.summaryItem}>
                <View style={[styles.summaryDot, { backgroundColor: STATUS_COLOR[s] }]} />
                <Text style={styles.summaryLabel}>{s}</Text>
                <Text style={styles.summaryCount}>{count}명</Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
      {/* 시간 수정 모달 */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>레슨 시간 수정</Text>
              <TouchableOpacity onPress={() => setEditModal(false)}><Ionicons name="close" size={22} color="#888" /></TouchableOpacity>
            </View>
            <View style={{ padding: 20 }}>
              <Text style={styles.modalLabel}>시작 시간</Text>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setHourPickerOpen(v => !v); setMinutePickerOpen(false); setDurationPickerOpen(false); }}>
                  <Text style={styles.spinnerLabel}>시</Text>
                  <Text style={styles.spinnerValue}>{editHour || '--'}</Text>
                </TouchableOpacity>
                <Text style={styles.colonText}>:</Text>
                <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setMinutePickerOpen(v => !v); setHourPickerOpen(false); setDurationPickerOpen(false); }}>
                  <Text style={styles.spinnerLabel}>분</Text>
                  <Text style={styles.spinnerValue}>{editMinute}</Text>
                </TouchableOpacity>
              </View>
              {hourPickerOpen && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, backgroundColor: '#f5f7fa', borderRadius: 10, padding: 6 }}>
                  {SPINNER_HOURS.map(item => (
                    <TouchableOpacity key={item} style={[styles.pickerItem, editHour === item && styles.pickerItemActive]}
                      onPress={() => { setEditHour(item); setHourPickerOpen(false); }}>
                      <Text style={[styles.pickerText, editHour === item && styles.pickerTextActive]}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {minutePickerOpen && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, backgroundColor: '#f5f7fa', borderRadius: 10, padding: 6 }}>
                  {SPINNER_MINUTES.map(item => (
                    <TouchableOpacity key={item} style={[styles.pickerItem, editMinute === item && styles.pickerItemActive]}
                      onPress={() => { setEditMinute(item); setMinutePickerOpen(false); }}>
                      <Text style={[styles.pickerText, editMinute === item && styles.pickerTextActive]}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <Text style={[styles.modalLabel, { marginTop: 16 }]}>레슨 시간</Text>
              <TouchableOpacity style={styles.spinnerBtn} onPress={() => { setDurationPickerOpen(v => !v); setHourPickerOpen(false); setMinutePickerOpen(false); }}>
                <Text style={styles.spinnerLabel}>분</Text>
                <Text style={styles.spinnerValue}>{editDuration}분</Text>
              </TouchableOpacity>
              {durationPickerOpen && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, backgroundColor: '#f5f7fa', borderRadius: 10, padding: 6 }}>
                  {DURATION_OPTIONS.map(item => (
                    <TouchableOpacity key={item} style={[styles.pickerItem, editDuration === item && styles.pickerItemActive]}
                      onPress={() => { setEditDuration(item); setDurationPickerOpen(false); }}>
                      <Text style={[styles.pickerText, editDuration === item && styles.pickerTextActive]}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {editHour && (
                <Text style={{ textAlign: 'center', color: '#888', fontSize: 13, marginTop: 12 }}>
                  {editHour}:{editMinute} ~ {minutesToTime(parseInt(editHour)*60+parseInt(editMinute)+editDuration)}
                </Text>
              )}
              <TouchableOpacity style={[styles.saveBtn, { marginTop: 16 }]} onPress={handleSaveTime} disabled={savingEdit}>
                {savingEdit ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  infoCard: { backgroundColor: '#fff', margin: 16, borderRadius: 12, padding: 16 },
  lessonTitle: { fontSize: 20, fontWeight: '800', color: '#1a1a1a', marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  infoText: { fontSize: 14, color: '#555' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'flex-start' },
  deleteBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  noticeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#eff6ff', marginHorizontal: 16, borderRadius: 10,
    padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#bfdbfe',
  },
  noticeText: { fontSize: 12, color: '#2563eb', flex: 1 },
  section: { backgroundColor: '#fff', marginHorizontal: 16, borderRadius: 12, padding: 16, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  sectionMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionCount: { fontSize: 13, color: '#888', fontWeight: '600' },
  deductCount: { fontSize: 13, color: '#ef4444', fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center', paddingVertical: 20 },
  attendanceCard: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 8,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 3 },
  creditRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  creditText: { fontSize: 12, color: '#888' },
  deductBadge: { backgroundColor: '#fee2e2', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  deductBadgeText: { fontSize: 10, color: '#ef4444', fontWeight: '700' },
  statusButtons: { flexDirection: 'row', gap: 4 },
  statusBtn: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: '#f0f0f0' },
  statusBtnText: { fontSize: 11, fontWeight: '700', color: '#888' },
  summaryCard: {
    backgroundColor: '#fff', marginHorizontal: 16, borderRadius: 12, padding: 16,
    flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12,
  },
  summaryItem: { alignItems: 'center', gap: 4 },
  summaryDot: { width: 10, height: 10, borderRadius: 5 },
  summaryLabel: { fontSize: 12, color: '#888' },
  summaryCount: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#f0fdf4', borderRadius: 8, borderWidth: 1, borderColor: '#d1fae5' },
  editBtnText: { fontSize: 13, color: '#1a7a4a', fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8 },
  spinnerBtn: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#eee' },
  spinnerLabel: { fontSize: 11, color: '#aaa', fontWeight: '600', marginBottom: 2 },
  spinnerValue: { fontSize: 22, fontWeight: '800', color: '#1a7a4a' },
  colonText: { fontSize: 24, fontWeight: '800', color: '#1a1a1a', paddingHorizontal: 4 },
  pickerItem: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, marginHorizontal: 2, alignItems: 'center' },
  pickerItemActive: { backgroundColor: '#1a7a4a' },
  pickerText: { fontSize: 16, fontWeight: '600', color: '#555' },
  pickerTextActive: { color: '#fff', fontWeight: '800' },
  saveBtn: { backgroundColor: '#1a7a4a', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});