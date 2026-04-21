import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
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

export default function LessonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  async function loadLesson() {
    const { data } = await supabase.from('lessons').select('*').eq('id', id).single();
    setLesson(data);
  }

  async function loadAttendance() {
    const { data } = await supabase
      .from('attendance')
      .select('id, member_id, status, deduct_credit, member:members(id, name, level, remaining_credits)')
      .eq('lesson_id', id);
    setAttendance((data ?? []) as any);
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
    // attendance 업데이트
    await supabase.from('attendance').update({
      status: newStatus,
      deduct_credit: willDeduct,
    }).eq('id', row.id);

    // 크레딧 변화 있으면 member 업데이트
    if (creditDelta !== 0) {
      await supabase.from('members').update({
        remaining_credits: Math.max(0, row.member.remaining_credits + creditDelta),
      }).eq('id', row.member_id);
    }

    // 로컬 상태 업데이트
    setAttendance(prev => prev.map(a => a.id === row.id ? {
      ...a,
      status: newStatus,
      deduct_credit: willDeduct,
      member: { ...a.member, remaining_credits: Math.max(0, a.member.remaining_credits + creditDelta) },
    } : a));

    setUpdating(null);
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

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color="#1a7a4a" /></View>;
  if (!lesson) return <View style={styles.loader}><Text>레슨을 찾을 수 없습니다</Text></View>;

  const presentCount = attendance.filter(a => a.status === '출석').length;
  const totalCount = attendance.length;
  const deductedCount = attendance.filter(a => a.deduct_credit).length;

  return (
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
        <TouchableOpacity style={styles.deleteBtn} onPress={deleteLesson}>
          <Ionicons name="trash-outline" size={14} color="#ef4444" />
          <Text style={styles.deleteBtnText}>레슨 삭제</Text>
        </TouchableOpacity>
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
            <Text style={styles.sectionCount}>{presentCount}/{totalCount}명 출석</Text>
            <Text style={styles.deductCount}>· {deductedCount}명 차감</Text>
          </View>
        </View>

        {attendance.length === 0 && (
          <Text style={styles.emptyText}>등록된 회원이 없습니다</Text>
        )}

        {attendance.map(a => (
          <View key={a.id} style={styles.attendanceCard}>
            {/* 회원 정보 */}
            <View style={[styles.avatar, { backgroundColor: STATUS_COLOR[a.status] + '33' }]}>
              <Text style={[styles.avatarText, { color: STATUS_COLOR[a.status] }]}>
                {a.member?.name?.slice(0, 1) ?? '?'}
              </Text>
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{a.member?.name ?? '알 수 없음'}</Text>
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
            {updating === a.id ? (
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
});
