import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Lesson, AttendanceStatus } from '../../types';
import { Colors } from '../../lib/theme';
import { useSubscription } from '../../hooks/useSubscription';
import LessonBriefingModal from '../../components/LessonBriefingModal';
import PlanUpsellModal from '../../components/PlanUpsellModal';

const STATUS_OPTIONS: AttendanceStatus[] = ['출석', '결석'];
const ABSENCE_REASONS = ['개인사정', '부상', '일정충돌', '무단결석', '기타'] as const;
const DEDUCTION_TYPES = ['정상차감', '미차감', '보강예정'] as const;
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  '출석': Colors.success, '결석': Colors.destructive, '지각': Colors.warning, '조퇴': Colors.info,
};

// 차감되는 상태 (출석/지각/조퇴/결석 모두 차감)
const DEDUCT_STATUSES: AttendanceStatus[] = ['출석', '지각', '조퇴', '결석'];

interface AttendanceRow {
  id: string;
  member_id: string;
  status: AttendanceStatus;
  deduct_credit: boolean;
  absence_reason?: string | null;
  deduction_type?: string | null;
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

  // ② 레슨 브리핑 모달 상태
  const [briefingVisible, setBriefingVisible] = useState(false);
  const [showProModal, setShowProModal] = useState(false);
  const { canUse, subscription } = useSubscription();

  // 결석 처리 모달
  const [absenceModal, setAbsenceModal] = useState(false);
  const [absenceRow, setAbsenceRow] = useState<AttendanceRow | null>(null);
  const [selectedReason, setSelectedReason] = useState('');
  const [selectedDeduction, setSelectedDeduction] = useState('');
  const [savingAbsence, setSavingAbsence] = useState(false);

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
      .select('id, member_id, status, deduct_credit, absence_reason, deduction_type, member:members(id, name, level, remaining_credits)')
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
          absence_reason: (att as any)?.absence_reason ?? null,
          deduction_type: (att as any)?.deduction_type ?? null,
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
        absence_reason: (a as any).absence_reason ?? null,
        deduction_type: (a as any).deduction_type ?? null,
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

    if (newStatus === '결석') {
      if (row.status === '결석') {
        // 결석 되돌리기
        setUpdating(row.member_id);
        if (row.id) {
          await supabase.from('attendance').delete().eq('id', row.id);
          if (row.deduct_credit) {
            await supabase.rpc('adjust_remaining_credits', { p_member_id: row.member_id, p_delta: 1 });
          }
        }
        await loadAttendance();
        setUpdating(null);
        return;
      }
      // 결석 모달 오픈
      setAbsenceRow(row);
      setSelectedReason(row.absence_reason ?? '');
      setSelectedDeduction(row.deduction_type ?? '');
      setAbsenceModal(true);
      return;
    }

    // 출석 처리
    setUpdating(row.member_id);
    const wasDeducted = row.deduct_credit;
    const creditDelta = wasDeducted ? 0 : -1; // 이미 차감됐으면 추가 차감 없음

    if (creditDelta < 0 && row.member.remaining_credits <= 0) {
      Alert.alert(
        '수강권 부족',
        `${row.member.name}님의 잔여 수강권이 없습니다. (0회)\n그래도 차감하시겠습니까?`,
        [
          { text: '취소', style: 'cancel', onPress: () => setUpdating(null) },
          { text: '차감', style: 'destructive', onPress: () => doUpdate(row, newStatus, true, creditDelta) },
        ]
      );
      return;
    }
    await doUpdate(row, newStatus, true, creditDelta);
  }

  async function handleAbsenceSave() {
    if (!absenceRow || !selectedReason || !selectedDeduction) return;
    const row = absenceRow;
    setSavingAbsence(true);
    setUpdating(row.member_id);
    const willDeduct = selectedDeduction === '정상차감';
    const wasDeducted = row.deduct_credit;
    let creditDelta = 0;
    if (willDeduct && !wasDeducted) creditDelta = -1;
    else if (!willDeduct && wasDeducted) creditDelta = 1;

    if (creditDelta < 0 && row.member.remaining_credits <= 0) {
      setSavingAbsence(false);
      setUpdating(null);
      Alert.alert('수강권 부족', `${row.member.name}님의 잔여 수강권이 없습니다.`);
      return;
    }

    await doUpdate(row, '결석', willDeduct, creditDelta, selectedReason, selectedDeduction);
    setSavingAbsence(false);
    setAbsenceModal(false);
    setAbsenceRow(null);
  }

  async function doUpdate(
    row: AttendanceRow,
    newStatus: AttendanceStatus,
    willDeduct: boolean,
    creditDelta: number,
    absenceReason?: string,
    deductionType?: string,
  ) {
    const payload: any = {
      lesson_id: id,
      member_id: row.member_id,
      status: newStatus,
      deduct_credit: willDeduct,
      absence_reason: absenceReason ?? null,
      deduction_type: deductionType ?? null,
    };
    if (!row.id) {
      await supabase.from('attendance').insert(payload);
    } else {
      await supabase.from('attendance').update({
        status: newStatus,
        deduct_credit: willDeduct,
        absence_reason: absenceReason ?? null,
        deduction_type: deductionType ?? null,
      }).eq('id', row.id);
    }
    if (creditDelta !== 0) {
      await supabase.rpc('adjust_remaining_credits', { p_member_id: row.member_id, p_delta: creditDelta });
    }
    await loadAttendance();
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
              await supabase.rpc('adjust_remaining_credits', { p_member_id: a.member_id, p_delta: 1 });
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

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!lesson) return <View style={styles.loader}><Text>레슨을 찾을 수 없습니다</Text></View>;

  const presentCount = attendance.filter(a => a.status === '출석').length;
  const absentCount = attendance.filter(a => a.status === '결석').length;
  const makeupCount = attendance.filter(a => (a as any).deduction_type === '보강예정').length;
  const totalCount = attendance.length;
  const deductedCount = attendance.filter(a => a.deduct_credit).length;
  const checkedCount = attendance.filter(a => a.status !== null).length;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        title: '레슨 상세',
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/schedule')}
            style={{ paddingLeft: 4, paddingRight: 8 }}
          >
            <Ionicons name="chevron-back" size={26} color={Colors.navy} />
          </TouchableOpacity>
        ),
      }} />
    <ScrollView style={styles.container}>
      {/* Lesson Info */}
      <View style={styles.infoCard}>
        <Text style={styles.lessonTitle}>{lesson.title}</Text>
        <View style={styles.infoRow}>
          <Ionicons name="calendar-outline" size={15} color={Colors.mutedFg} />
          <Text style={styles.infoText}>{lesson.date}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="time-outline" size={15} color={Colors.mutedFg} />
          <Text style={styles.infoText}>{lesson.start_time?.slice(0, 5)} ~ {lesson.end_time?.slice(0, 5)}</Text>
        </View>
        {lesson.location && (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={15} color={Colors.mutedFg} />
            <Text style={styles.infoText}>{lesson.location}</Text>
          </View>
        )}
        {lesson.notes && (
          <View style={styles.infoRow}>
            <Ionicons name="document-text-outline" size={15} color={Colors.mutedFg} />
            <Text style={styles.infoText}>{lesson.notes}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {/* ② 레슨 브리핑 버튼 (프로 전용) */}
          <TouchableOpacity
            style={styles.briefingBtn}
            onPress={() => {
              if (canUse('ai_analysis')) {
                setBriefingVisible(true);
              } else {
                setShowProModal(true);
              }
            }}
          >
            <Ionicons name="clipboard-outline" size={14} color="#8B5CF6" />
            <Text style={styles.briefingBtnText}>레슨 브리핑</Text>
            {!canUse('ai_analysis') && (
              <View style={styles.proBadgeInline}>
                <Text style={styles.proBadgeInlineText}>PRO</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.editBtn} onPress={openEditModal}>
            <Ionicons name="create-outline" size={14} color={Colors.primary} />
            <Text style={styles.editBtnText}>시간 수정</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={deleteLesson}>
            <Ionicons name="trash-outline" size={14} color={Colors.destructive} />
            <Text style={styles.deleteBtnText}>레슨 삭제</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 출석 처리 안내 */}
      <View style={styles.noticeCard}>
        <Ionicons name="information-circle-outline" size={16} color={Colors.info} />
        <Text style={styles.noticeText}>출석 → 1회 차감 · 결석 → 처리방식 선택</Text>
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
              <View style={[styles.avatar, { backgroundColor: a.status ? STATUS_COLOR[a.status] + '33' : Colors.mutedBg }]}>
                <Text style={[styles.avatarText, { color: a.status ? STATUS_COLOR[a.status] : Colors.mutedFg }]}>
                  {a.member?.name?.slice(0, 1) ?? '?'}
                </Text>
              </View>
            </TouchableOpacity>
            <View style={styles.memberInfo}>
              <TouchableOpacity onPress={() => router.push(`/members/${a.member_id}`)}>
                <Text style={styles.memberName}>{a.member?.name ?? '알 수 없음'}</Text>
              </TouchableOpacity>
              <View style={styles.creditRow}>
                <Ionicons name="ticket-outline" size={12} color={a.member.remaining_credits <= 2 ? Colors.destructive : Colors.mutedFg} />
                <Text style={[styles.creditText, a.member.remaining_credits <= 2 && { color: Colors.destructive, fontWeight: '700' }]}>
                  잔여 {a.member.remaining_credits}회
                </Text>
                {a.deduct_credit && (
                  <View style={styles.deductBadge}>
                    <Text style={styles.deductBadgeText}>-1회</Text>
                  </View>
                )}
              </View>
            </View>

            {/* 출석 / 결석 버튼 */}
            {updating === a.member_id ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <View style={styles.statusButtons}>
                <TouchableOpacity
                  style={[styles.statusBtn, a.status === '출석' && { backgroundColor: Colors.success, borderColor: Colors.success }]}
                  onPress={() => updateStatus(a, '출석')}
                >
                  <Ionicons name={a.status === '출석' ? 'checkmark-circle' : 'checkmark-circle-outline'} size={14} color={a.status === '출석' ? '#fff' : Colors.success} />
                  <Text style={[styles.statusBtnText, a.status === '출석' && { color: '#fff' }]}>출석</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.statusBtn, a.status === '결석' && { backgroundColor: (a as any).deduction_type === '보강예정' ? Colors.info : Colors.destructive, borderColor: (a as any).deduction_type === '보강예정' ? Colors.info : Colors.destructive }]}
                  onPress={() => updateStatus(a, '결석')}
                >
                  <Ionicons name={a.status === '결석' ? 'close-circle' : 'close-circle-outline'} size={14} color={a.status === '결석' ? '#fff' : Colors.destructive} />
                  <Text style={[styles.statusBtnText, a.status === '결석' && { color: '#fff' }]}>
                    {a.status === '결석' && (a as any).deduction_type ? (a as any).deduction_type : '결석'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </View>



      <View style={{ height: 40 }} />
    </ScrollView>
      {/* 결석 처리 바텀시트 */}
      <Modal
        visible={absenceModal}
        transparent
        animationType="slide"
        onRequestClose={() => setAbsenceModal(false)}
      >
        <View style={styles.absModalOverlay}>
          <View style={styles.absModalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>결석 처리</Text>
              <TouchableOpacity onPress={() => setAbsenceModal(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            {absenceRow && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: Colors.background, marginHorizontal: 16, borderRadius: 10, marginTop: 12 }}>
                <Ionicons name="person-circle-outline" size={20} color={Colors.primary} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.foreground }}>{absenceRow.member?.name}</Text>
                <Text style={{ fontSize: 12, color: Colors.mutedFg }}>잔여 {absenceRow.member.remaining_credits}회</Text>
              </View>
            )}
            <Text style={styles.absLabel}>결석 사유</Text>
            <View style={styles.absOptionGrid}>
              {ABSENCE_REASONS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.absChip, selectedReason === r && styles.absChipActive]}
                  onPress={() => setSelectedReason(r)}
                >
                  <Text style={[styles.absChipText, selectedReason === r && styles.absChipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.absLabel}>처리 방식</Text>
            <View style={styles.absDeductRow}>
              {DEDUCTION_TYPES.map(d => {
                const color = d === '정상차감' ? Colors.destructive : d === '보강예정' ? Colors.info : Colors.success;
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.absDeductChip, selectedDeduction === d && { backgroundColor: color, borderColor: color }]}
                    onPress={() => setSelectedDeduction(d)}
                  >
                    <Text style={[styles.absDeductText, selectedDeduction === d && { color: '#fff' }]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedDeduction === '정상차감' && (
              <Text style={{ fontSize: 12, color: Colors.destructive, marginHorizontal: 20, marginTop: 6, fontWeight: '500' }}>잔여 횟수 1회 차감됩니다</Text>
            )}
            {(selectedDeduction === '미차감' || selectedDeduction === '보강예정') && (
              <Text style={{ fontSize: 12, color: Colors.info, marginHorizontal: 20, marginTop: 6, fontWeight: '500' }}>잔여 횟수 차감 없이 결석 처리됩니다</Text>
            )}
            <TouchableOpacity
              style={[styles.absSaveBtn, (!selectedReason || !selectedDeduction || savingAbsence) && { opacity: 0.5 }]}
              onPress={handleAbsenceSave}
              disabled={!selectedReason || !selectedDeduction || savingAbsence}
            >
              {savingAbsence
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.absSaveBtnText}>저장</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* 시간 수정 모달 */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>레슨 시간 수정</Text>
              <TouchableOpacity onPress={() => setEditModal(false)}><Ionicons name="close" size={22} color={Colors.mutedFg} /></TouchableOpacity>
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, backgroundColor: Colors.background, borderRadius: 10, padding: 6 }}>
                  {SPINNER_HOURS.map(item => (
                    <TouchableOpacity key={item} style={[styles.pickerItem, editHour === item && styles.pickerItemActive]}
                      onPress={() => { setEditHour(item); setHourPickerOpen(false); }}>
                      <Text style={[styles.pickerText, editHour === item && styles.pickerTextActive]}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {minutePickerOpen && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, backgroundColor: Colors.background, borderRadius: 10, padding: 6 }}>
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, backgroundColor: Colors.background, borderRadius: 10, padding: 6 }}>
                  {DURATION_OPTIONS.map(item => (
                    <TouchableOpacity key={item} style={[styles.pickerItem, editDuration === item && styles.pickerItemActive]}
                      onPress={() => { setEditDuration(item); setDurationPickerOpen(false); }}>
                      <Text style={[styles.pickerText, editDuration === item && styles.pickerTextActive]}>{item}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {editHour && (
                <Text style={{ textAlign: 'center', color: Colors.mutedFg, fontSize: 13, marginTop: 12 }}>
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

      {/* ② 레슨 브리핑 모달 (프로 전용) */}
      <LessonBriefingModal
        visible={briefingVisible}
        onClose={() => setBriefingVisible(false)}
        memberIds={attendance.map(a => a.member_id)}
      />

      {/* Plan Upsell 모달 */}
      <PlanUpsellModal
        visible={showProModal}
        onClose={() => setShowProModal(false)}
        context="tagging"
        currentPlanId={subscription?.plan_id ?? 'free'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: Colors.background },
  infoCard: { backgroundColor: '#fff', margin: 16, borderRadius: 12, padding: 16 },
  lessonTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  infoText: { fontSize: 14, color: Colors.mutedFg },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'flex-start' },
  deleteBtnText: { color: Colors.destructive, fontSize: 13, fontWeight: '600' },
  noticeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primaryLight, marginHorizontal: 16, borderRadius: 10,
    padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#bfdbfe',
  },
  noticeText: { fontSize: 12, color: Colors.info, flex: 1 },
  section: { backgroundColor: '#fff', marginHorizontal: 16, borderRadius: 12, padding: 16, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  sectionMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionCount: { fontSize: 13, color: Colors.mutedFg, fontWeight: '600' },
  deductCount: { fontSize: 13, color: Colors.destructive, fontWeight: '600' },
  emptyText: { fontSize: 14, color: Colors.placeholder, textAlign: 'center', paddingVertical: 20 },
  attendanceCard: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.mutedBg, gap: 8,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: 3 },
  creditRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  creditText: { fontSize: 12, color: Colors.mutedFg },
  deductBadge: { backgroundColor: '#fee2e2', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  deductBadgeText: { fontSize: 10, color: Colors.destructive, fontWeight: '700' },
  statusButtons: { flexDirection: 'row', gap: 4 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.mutedBg, borderWidth: 1, borderColor: Colors.border },
  statusBtnText: { fontSize: 11, fontWeight: '700', color: Colors.mutedFg },
  summaryCard: {
    backgroundColor: '#fff', marginHorizontal: 16, borderRadius: 12, padding: 16,
    flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12,
  },
  summaryItem: { alignItems: 'center', gap: 4 },
  summaryDot: { width: 10, height: 10, borderRadius: 5 },
  summaryLabel: { fontSize: 12, color: Colors.mutedFg },
  summaryCount: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.primaryLight, borderRadius: 8, borderWidth: 1, borderColor: Colors.successLight },
  editBtnText: { fontSize: 13, color: Colors.navy, fontWeight: '600' },
  briefingBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#F3E8FF', borderRadius: 8, borderWidth: 1, borderColor: '#DDD6FE' },
  briefingBtnText: { fontSize: 13, color: '#7C3AED', fontWeight: '600' },
  proBadgeInline: { backgroundColor: '#8B5CF6', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 2 },
  proBadgeInlineText: { fontSize: 9, color: '#fff', fontWeight: '800', letterSpacing: 0.5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  modalLabel: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, marginBottom: 8 },
  spinnerBtn: { flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  spinnerLabel: { fontSize: 11, color: Colors.placeholder, fontWeight: '600', marginBottom: 2 },
  spinnerValue: { fontSize: 22, fontWeight: '800', color: Colors.navy },
  colonText: { fontSize: 24, fontWeight: '800', color: Colors.foreground, paddingHorizontal: 4 },
  pickerItem: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, marginHorizontal: 2, alignItems: 'center' },
  pickerItemActive: { backgroundColor: Colors.primary },
  pickerText: { fontSize: 16, fontWeight: '600', color: Colors.mutedFg },
  pickerTextActive: { color: '#fff', fontWeight: '800' },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  absModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  absModalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  absLabel: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 16, marginBottom: 8, marginHorizontal: 20 },
  absOptionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 20 },
  absChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.mutedBg, borderWidth: 1.5, borderColor: Colors.border },
  absChipActive: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  absChipText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  absChipTextActive: { color: '#fff' },
  absDeductRow: { flexDirection: 'row', gap: 8, marginHorizontal: 20 },
  absDeductChip: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: Colors.mutedBg, borderWidth: 1.5, borderColor: Colors.border },
  absDeductText: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  absSaveBtn: { margin: 16, marginTop: 20, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  absSaveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

});