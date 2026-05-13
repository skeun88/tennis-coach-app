import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors, Radius, Shadow } from '../../lib/theme';

const ABSENCE_REASONS = ['개인사정', '부상', '일정충돌', '무단결석', '기타'] as const;
const DEDUCTION_TYPES = ['정상차감', '미차감', '보강예정'] as const;

interface Stats {
  totalMembers: number;
  todayLessons: number;
  unpaidMembers: number;   // 잔여횟수 0회
  expiringMembers: number; // 잔여횟수 2회 이하(1~2회)
}

interface TodayMemberCard {
  lessonId: string;
  lessonPackageName: string;
  startTime: string;
  memberId: string;
  memberName: string;
  memberLevel: string;
  remainingCredits: number;
  attended: boolean;
  isAbsent: boolean;
  deductCredit: boolean;
  absenceReason?: string | null;
  deductionType?: string | null;
  attendanceId?: string;
}

export default function HomeScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    totalMembers: 0, todayLessons: 0, unpaidMembers: 0, expiringMembers: 0,
  });
  const [todayCards, setTodayCards] = useState<TodayMemberCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAttendance, setLoadingAttendance] = useState<string | null>(null);
  const [coachEmail, setCoachEmail] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [autoGenSuggestion, setAutoGenSuggestion] = useState<{memberId: string; name: string; time: string}[]>([]);

  // 결석 모달
  const [absenceModal, setAbsenceModal] = useState(false);
  const [absenceCard, setAbsenceCard] = useState<TodayMemberCard | null>(null);
  const [selectedReason, setSelectedReason] = useState('');
  const [selectedDeduction, setSelectedDeduction] = useState('');
  const [savingAbsence, setSavingAbsence] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCoachEmail(user.email ?? '');
    setUserId(user.id);

    const [membersRes, lessonsRes] = await Promise.all([
      supabase.from('members').select('id, remaining_credits').eq('coach_id', user.id),
      supabase.from('lessons').select('id').eq('coach_id', user.id).eq('date', today),
    ]);

    const members = membersRes.data ?? [];
    setStats({
      totalMembers: members.length,
      todayLessons: lessonsRes.data?.length ?? 0,
      unpaidMembers: members.filter(m => (m.remaining_credits ?? 0) === 0).length,
      expiringMembers: members.filter(m => {
        const rc = m.remaining_credits ?? 0;
        return rc > 0 && rc <= 2;
      }).length,
    });

    await loadTodayCards(user.id);
    await checkAutoGenSchedule(user.id);
  }

  async function loadTodayCards(uid: string) {
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, title, start_time')
      .eq('coach_id', uid)
      .eq('date', today)
      .order('start_time');

    if (!lessons || lessons.length === 0) {
      setTodayCards([]);
      return;
    }

    const lessonIds = lessons.map(l => l.id);

    const { data: lessonMembers } = await supabase
      .from('lesson_members')
      .select('lesson_id, member_id, member:members(id, name, level, remaining_credits, lesson_package_id, lesson_packages(title))')
      .in('lesson_id', lessonIds);

    const { data: attendances } = await supabase
      .from('attendance')
      .select('id, lesson_id, member_id, status, deduct_credit, absence_reason, deduction_type')
      .in('lesson_id', lessonIds);

    const attendanceMap = new Map<string, {
      id: string; status: string; deduct_credit: boolean;
      absence_reason: string | null; deduction_type: string | null;
    }>();
    for (const a of attendances ?? []) {
      attendanceMap.set(`${a.lesson_id}:${a.member_id}`, {
        id: a.id, status: a.status, deduct_credit: a.deduct_credit,
        absence_reason: a.absence_reason, deduction_type: a.deduction_type,
      });
    }

    const cards: TodayMemberCard[] = [];
    for (const lm of lessonMembers ?? []) {
      const lesson = lessons.find(l => l.id === lm.lesson_id);
      const member = lm.member as any;
      if (!lesson || !member) continue;
      const key = `${lm.lesson_id}:${lm.member_id}`;
      const att = attendanceMap.get(key);
      const pkgName = member.lesson_packages?.title ?? null;
      cards.push({
        lessonId: lm.lesson_id,
        lessonPackageName: pkgName ?? lesson.title,
        startTime: lesson.start_time,
        memberId: lm.member_id,
        memberName: member.name,
        memberLevel: member.level,
        remainingCredits: member.remaining_credits ?? 0,
        attended: att?.status === '출석',
        isAbsent: att?.status === '결석',
        deductCredit: att?.deduct_credit ?? false,
        absenceReason: att?.absence_reason ?? null,
        deductionType: att?.deduction_type ?? null,
        attendanceId: att?.id,
      });
    }

    cards.sort((a, b) => {
      if (a.startTime < b.startTime) return -1;
      if (a.startTime > b.startTime) return 1;
      return a.memberName.localeCompare(b.memberName);
    });

    setTodayCards(cards);
  }

  async function checkAutoGenSchedule(uid: string) {
    const todayDayOfWeek = new Date().getDay();
    const { data: membersWithSchedule } = await supabase
      .from('members')
      .select('id, name, fixed_schedule_days, fixed_schedule_time, fixed_schedule_times')
      .eq('coach_id', uid)
      .eq('is_active', true)
      .not('fixed_schedule_days', 'is', null);
    if (!membersWithSchedule) return;
    const suggestions = membersWithSchedule
      .filter(m => m.fixed_schedule_days && m.fixed_schedule_days.includes(todayDayOfWeek))
      .map(m => {
        const fst = (m as any).fixed_schedule_times;
        const time = fst?.[String(todayDayOfWeek)] ?? (m.fixed_schedule_time as string | null)?.slice(0, 5) ?? null;
        if (!time) return null;
        return { memberId: m.id, name: m.name, time };
      })
      .filter(Boolean) as { memberId: string; name: string; time: string }[];
    setAutoGenSuggestion(suggestions);
  }

  async function handleAutoGenLessons() {
    if (!userId || autoGenSuggestion.length === 0) return;
    for (const s of autoGenSuggestion) {
      const { data: member } = await supabase
        .from('members')
        .select('fixed_schedule_time, fixed_lesson_duration')
        .eq('id', s.memberId)
        .single();
      if (!member) continue;
      const todayDow2 = new Date().getDay();
      const fst2 = (member as any).fixed_schedule_times;
      const startTime = fst2?.[String(todayDow2)] ?? (member.fixed_schedule_time as string | null)?.slice(0, 5);
      if (!startTime) continue;
      const durationMins = (member.fixed_lesson_duration as number) ?? 60;
      const [h, m] = startTime.split(':').map(Number);
      const endDate = new Date(2000, 0, 1, h, m + durationMins);
      const endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;

      const { data: existingLesson } = await supabase
        .from('lessons')
        .select('id')
        .eq('coach_id', userId)
        .eq('date', today)
        .eq('start_time', startTime + ':00')
        .maybeSingle();

      let lessonId: string;
      if (existingLesson) {
        lessonId = existingLesson.id;
      } else {
        const { data: lesson } = await supabase.from('lessons').insert({
          coach_id: userId,
          title: `${today} 레슨`,
          date: today,
          start_time: startTime,
          end_time: endTime,
        }).select().single();
        if (!lesson) continue;
        lessonId = lesson.id;
      }

      const { data: already } = await supabase
        .from('lesson_members')
        .select('id')
        .eq('lesson_id', lessonId)
        .eq('member_id', s.memberId)
        .maybeSingle();
      if (!already) {
        await supabase.from('lesson_members').insert({ lesson_id: lessonId, member_id: s.memberId });
      }
    }
    await loadAll();
  }

  useFocusEffect(useCallback(() => { loadAll(); }, []));

  async function handleSignOut() {
    Alert.alert('로그아웃', '로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  // 출석 처리 (출석 버튼)
  async function handleAttend(card: TodayMemberCard) {
    if (!userId) return;
    const key = `${card.lessonId}:${card.memberId}`;
    setLoadingAttendance(key);
    try {
      if (card.attended) {
        // 출석 되돌리기
        if (card.attendanceId) {
          await supabase.from('attendance').delete().eq('id', card.attendanceId);
          // 크레딧 복구 (출석은 항상 차감했으므로)
          await supabase.from('members')
            .update({ remaining_credits: card.remainingCredits + 1 })
            .eq('id', card.memberId);
        }
      } else {
        // 출석 처리 (결석→출석 or 미처리→출석)
        const wasDeducted = card.deductCredit;
        await supabase.from('attendance').upsert({
          lesson_id: card.lessonId,
          member_id: card.memberId,
          status: '출석',
          deduct_credit: true,
          absence_reason: null,
          deduction_type: null,
        }, { onConflict: 'lesson_id,member_id' });
        // 이전에 차감 안 됐을 때만 차감
        if (!wasDeducted) {
          await supabase.from('members')
            .update({ remaining_credits: Math.max(0, card.remainingCredits - 1) })
            .eq('id', card.memberId);
        }
      }
      await loadTodayCards(userId);
    } catch {
      Alert.alert('오류', '출석 처리 중 오류가 발생했습니다.');
    } finally {
      setLoadingAttendance(null);
    }
  }

  // 결석 버튼 클릭
  async function handleAbsenceBtn(card: TodayMemberCard) {
    if (card.isAbsent) {
      // 결석 되돌리기
      if (!userId || !card.attendanceId) return;
      const key = `${card.lessonId}:${card.memberId}`;
      setLoadingAttendance(key);
      try {
        await supabase.from('attendance').delete().eq('id', card.attendanceId);
        if (card.deductCredit) {
          await supabase.from('members')
            .update({ remaining_credits: card.remainingCredits + 1 })
            .eq('id', card.memberId);
        }
        await loadTodayCards(userId);
      } finally {
        setLoadingAttendance(null);
      }
    } else {
      // 결석 모달 오픈
      setAbsenceCard(card);
      setSelectedReason('');
      setSelectedDeduction('');
      setAbsenceModal(true);
    }
  }

  async function handleAbsenceSave() {
    if (!userId || !absenceCard || !selectedReason || !selectedDeduction) return;
    const card = absenceCard;
    setSavingAbsence(true);
    const key = `${card.lessonId}:${card.memberId}`;
    setLoadingAttendance(key);
    try {
      const willDeduct = selectedDeduction === '정상차감';
      const wasDeducted = card.deductCredit;

      await supabase.from('attendance').upsert({
        lesson_id: card.lessonId,
        member_id: card.memberId,
        status: '결석',
        deduct_credit: willDeduct,
        absence_reason: selectedReason,
        deduction_type: selectedDeduction,
      }, { onConflict: 'lesson_id,member_id' });

      // 크레딧 조정
      if (willDeduct && !wasDeducted) {
        await supabase.from('members')
          .update({ remaining_credits: Math.max(0, card.remainingCredits - 1) })
          .eq('id', card.memberId);
      } else if (!willDeduct && wasDeducted) {
        await supabase.from('members')
          .update({ remaining_credits: card.remainingCredits + 1 })
          .eq('id', card.memberId);
      }

      setAbsenceModal(false);
      setAbsenceCard(null);
      setSelectedReason('');
      setSelectedDeduction('');
      await loadTodayCards(userId);
    } catch {
      Alert.alert('오류', '처리 중 오류가 발생했습니다.');
    } finally {
      setSavingAbsence(false);
      setLoadingAttendance(null);
    }
  }

  const LEVEL_COLOR: Record<string, string> = Colors.level;

  return (
    <View style={styles.screenWrapper}>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadAll(); setRefreshing(false); }}
            tintColor={Colors.navy}
          />
        }
      >
        {/* Header */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.greeting}>안녕하세요 👋</Text>
              <Text style={styles.email}>{coachEmail}</Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => router.push('/settings/notifications')}
                style={styles.headerIconBtn}
              >
                <Ionicons name="notifications-outline" size={22} color="rgba(255,255,255,0.8)" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSignOut} style={styles.headerIconBtn}>
                <Ionicons name="log-out-outline" size={22} color="rgba(255,255,255,0.8)" />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.dateText}>
            {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </Text>
        </View>

        {/* Stats Grid (2x2) — 전체회원 / 오늘레슨 / 미납회원 / 만료예정 */}
        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/members')} activeOpacity={0.85}>
              <Text style={styles.statValue}>{stats.totalMembers}</Text>
              <Text style={styles.statLabel}>전체 회원</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/schedule')} activeOpacity={0.85}>
              <Text style={styles.statValue}>{stats.todayLessons}</Text>
              <Text style={styles.statLabel}>오늘 레슨</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: stats.unpaidMembers > 0 ? Colors.destructive : Colors.foreground }]}>
                {stats.unpaidMembers}
              </Text>
              <Text style={styles.statLabel}>미납 회원</Text>
              <Text style={styles.statHint}>잔여 0회</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: stats.expiringMembers > 0 ? Colors.warning : Colors.foreground }]}>
                {stats.expiringMembers}
              </Text>
              <Text style={styles.statLabel}>만료 예정</Text>
              <Text style={styles.statHint}>잔여 1~2회</Text>
            </View>
          </View>
        </View>

        {/* Today's Lessons Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>오늘 레슨</Text>
          <TouchableOpacity onPress={() => router.push('/lessons/new')}>
            <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        {todayCards.length === 0 && autoGenSuggestion.length > 0 && (
          <View style={styles.autoGenBanner}>
            <View style={styles.autoGenHeader}>
              <Ionicons name="flash" size={18} color={Colors.primary} />
              <Text style={styles.autoGenTitle}>오늘 고정 스케줄 회원이 있어요</Text>
            </View>
            {autoGenSuggestion.map(s => (
              <View key={s.memberId} style={styles.autoGenItem}>
                <Text style={styles.autoGenTime}>{s.time}</Text>
                <Text style={styles.autoGenName}>{s.name}</Text>
              </View>
            ))}
            <TouchableOpacity style={styles.autoGenBtn} onPress={handleAutoGenLessons}>
              <Text style={styles.autoGenBtnText}>레슨 자동 생성</Text>
            </TouchableOpacity>
          </View>
        )}

        {todayCards.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={40} color={Colors.iconMuted} />
            <Text style={styles.emptyText}>오늘 예정된 레슨이 없습니다</Text>
            <TouchableOpacity style={styles.addLessonBtn} onPress={() => router.push('/lessons/new')}>
              <Text style={styles.addLessonBtnText}>레슨 추가하기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.lessonCardsList}>
            {todayCards.map(card => {
              const cardKey = `${card.lessonId}:${card.memberId}`;
              const isLoading = loadingAttendance === cardKey;
              const cardBg = card.attended
                ? styles.memberCardAttended
                : card.isAbsent
                  ? styles.memberCardAbsent
                  : undefined;

              return (
                <TouchableOpacity
                  key={cardKey}
                  style={[styles.memberCard, cardBg]}
                  onPress={() => router.push(`/members/${card.memberId}`)}
                  activeOpacity={0.85}
                >
                  <View style={styles.timeBadge}>
                    <Text style={styles.timeText}>{card.startTime.slice(0, 5)}</Text>
                  </View>

                  <View style={styles.memberInfo}>
                    <View style={styles.memberNameRow}>
                      <Text style={styles.memberName}>{card.memberName}</Text>
                      <View style={[styles.levelBadge, { backgroundColor: (LEVEL_COLOR[card.memberLevel] ?? Colors.mutedFg) + '22' }]}>
                        <Text style={[styles.levelText, { color: LEVEL_COLOR[card.memberLevel] ?? Colors.mutedFg }]}>
                          {card.memberLevel}
                        </Text>
                      </View>
                    </View>
                    {/* 레슨권 이름 */}
                    <Text style={styles.packageName} numberOfLines={1}>{card.lessonPackageName}</Text>
                    <View style={styles.creditsRow}>
                      <Ionicons name="layers-outline" size={12} color={card.remainingCredits <= 1 ? Colors.destructive : Colors.mutedFg} />
                      <Text style={[styles.creditsText, { color: card.remainingCredits <= 1 ? Colors.destructive : Colors.mutedFg }]}>
                        잔여 {card.remainingCredits}회
                        {card.remainingCredits <= 1 && ' ⚠️'}
                      </Text>
                      {card.isAbsent && card.deductionType && (
                        <View style={styles.deductionBadge}>
                          <Text style={styles.deductionBadgeText}>{card.deductionType}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* 출석 / 결석 버튼 */}
                  {isLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 8 }} />
                  ) : (
                    <View style={styles.attendBtns}>
                      <TouchableOpacity
                        style={[styles.attendBtn, card.attended && styles.attendBtnActive]}
                        onPress={() => handleAttend(card)}
                      >
                        <Ionicons
                          name={card.attended ? 'checkmark-circle' : 'checkmark-circle-outline'}
                          size={28}
                          color={card.attended ? Colors.white : Colors.primary}
                        />
                        <Text style={[styles.attendBtnLabel, card.attended && { color: '#fff' }]}>출석</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.absentBtn, card.isAbsent && styles.absentBtnActive]}
                        onPress={() => handleAbsenceBtn(card)}
                      >
                        <Ionicons
                          name={card.isAbsent ? 'close-circle' : 'close-circle-outline'}
                          size={28}
                          color={card.isAbsent ? Colors.white : Colors.destructive}
                        />
                        <Text style={[styles.absentBtnLabel, card.isAbsent && { color: '#fff' }]}>결석</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Chatbot FAB */}
      <TouchableOpacity style={styles.chatFab} onPress={() => router.push('/(tabs)/chat')}>
        <Ionicons name="chatbubble-ellipses" size={24} color={Colors.white} />
      </TouchableOpacity>

      {/* 결석 처리 바텀시트 */}
      <Modal
        visible={absenceModal}
        transparent
        animationType="slide"
        onRequestClose={() => setAbsenceModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>결석 처리</Text>
              <TouchableOpacity onPress={() => setAbsenceModal(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            {absenceCard && (
              <View style={styles.modalMemberInfo}>
                <Ionicons name="person-circle-outline" size={20} color={Colors.primary} />
                <Text style={styles.modalMemberName}>{absenceCard.memberName}</Text>
                <Text style={styles.modalMemberSub}>{absenceCard.startTime.slice(0, 5)} · {absenceCard.lessonPackageName}</Text>
              </View>
            )}

            {/* a) 결석 사유 */}
            <Text style={styles.modalSectionLabel}>결석 사유</Text>
            <View style={styles.optionGrid}>
              {ABSENCE_REASONS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.optionChip, selectedReason === r && styles.optionChipActive]}
                  onPress={() => setSelectedReason(r)}
                >
                  <Text style={[styles.optionChipText, selectedReason === r && styles.optionChipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* b) 처리 방식 */}
            <Text style={styles.modalSectionLabel}>처리 방식</Text>
            <View style={styles.deductionRow}>
              {DEDUCTION_TYPES.map(d => {
                const color = d === '정상차감' ? Colors.destructive : d === '보강예정' ? Colors.info : Colors.success;
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.deductionChip, selectedDeduction === d && { backgroundColor: color, borderColor: color }]}
                    onPress={() => setSelectedDeduction(d)}
                  >
                    <Text style={[styles.deductionChipText, selectedDeduction === d && { color: '#fff' }]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 처리방식 안내 */}
            {selectedDeduction === '정상차감' && (
              <Text style={styles.deductionHint}>잔여 횟수 1회 차감됩니다</Text>
            )}
            {(selectedDeduction === '미차감' || selectedDeduction === '보강예정') && (
              <Text style={[styles.deductionHint, { color: Colors.info }]}>잔여 횟수 차감 없이 결석 처리됩니다</Text>
            )}

            {/* c) 저장 */}
            <TouchableOpacity
              style={[styles.saveBtn, (!selectedReason || !selectedDeduction || savingAbsence) && styles.saveBtnDis]}
              onPress={handleAbsenceSave}
              disabled={!selectedReason || !selectedDeduction || savingAbsence}
            >
              {savingAbsence
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveBtnText}>저장</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.background },

  headerCard: {
    backgroundColor: Colors.primary, padding: 16, paddingTop: 28,
    borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl, marginBottom: 16,
  },
  headerTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 12,
  },
  greeting: { fontSize: 22, fontWeight: '700', color: Colors.white },
  email: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerIconBtn: { padding: 4 },
  dateText: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },

  statsGrid: { paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1, backgroundColor: Colors.card, borderRadius: Radius.md,
    paddingVertical: 10, paddingHorizontal: 12,
    ...Shadow.sm,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: Colors.foreground, marginBottom: 1 },
  statLabel: { fontSize: 11, color: Colors.mutedFg, fontWeight: '500' },
  statHint: { fontSize: 10, color: Colors.placeholder, marginTop: 2 },

  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },

  lessonCardsList: { paddingHorizontal: 16, marginBottom: 16 },
  memberCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card,
    borderRadius: Radius.lg, padding: 14, marginBottom: 8,
    ...Shadow.sm,
    borderWidth: 1, borderColor: Colors.transparent,
  },
  memberCardAttended: {
    backgroundColor: Colors.successLight, borderColor: Colors.successBorder,
  },
  memberCardAbsent: {
    backgroundColor: '#fff1f2', borderColor: '#fecdd3',
  },
  timeBadge: {
    backgroundColor: Colors.primaryLight, borderRadius: Radius.sm,
    paddingHorizontal: 10, paddingVertical: 8,
    alignItems: 'center', marginRight: 12, minWidth: 52,
  },
  timeText: { fontSize: 14, fontWeight: '700', color: Colors.navy },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  memberName: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  levelText: { fontSize: 11, fontWeight: '700' },
  packageName: { fontSize: 12, color: Colors.mutedFg, marginBottom: 4 },
  creditsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  creditsText: { fontSize: 12, fontWeight: '500' },
  deductionBadge: { backgroundColor: '#fee2e2', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  deductionBadgeText: { fontSize: 10, color: Colors.destructive, fontWeight: '700' },

  attendBtns: { flexDirection: 'row', gap: 6, marginLeft: 10 },
  attendBtn: {
    width: 58, paddingVertical: 7, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', gap: 2,
    backgroundColor: 'transparent',
  },
  attendBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  attendBtnLabel: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  absentBtn: {
    width: 58, paddingVertical: 7, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.destructive,
    justifyContent: 'center', alignItems: 'center', gap: 2,
    backgroundColor: 'transparent',
  },
  absentBtnActive: { backgroundColor: Colors.destructive, borderColor: Colors.destructive },
  absentBtnLabel: { fontSize: 10, fontWeight: '700', color: Colors.destructive },

  emptyCard: {
    alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.lg,
    marginHorizontal: 16, padding: 40, marginBottom: 16,
    ...Shadow.sm,
  },
  emptyText: { fontSize: 14, color: Colors.placeholder, fontWeight: '500', marginTop: 12, marginBottom: 16 },
  addLessonBtn: {
    backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: Radius.md,
  },
  addLessonBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  autoGenBanner: {
    backgroundColor: Colors.primaryLight, borderRadius: Radius.lg,
    marginHorizontal: 16, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.successBorder,
  },
  autoGenHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  autoGenTitle: { fontSize: 15, fontWeight: '700', color: Colors.navy },
  autoGenItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  autoGenTime: { fontSize: 14, fontWeight: '700', color: Colors.navy, minWidth: 44 },
  autoGenName: { fontSize: 14, color: Colors.foreground, fontWeight: '500' },
  autoGenBtn: { marginTop: 12, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 10, alignItems: 'center' },
  autoGenBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  chatFab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.navy, justifyContent: 'center', alignItems: 'center',
    ...Shadow.md,
  },

  // 결석 모달
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  modalMemberInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: Colors.background, marginHorizontal: 16, borderRadius: Radius.md, marginTop: 12,
  },
  modalMemberName: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  modalMemberSub: { fontSize: 12, color: Colors.mutedFg, marginLeft: 2 },
  modalSectionLabel: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginTop: 16, marginBottom: 8, marginHorizontal: 20 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 20 },
  optionChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full,
    backgroundColor: Colors.mutedBg, borderWidth: 1.5, borderColor: Colors.border,
  },
  optionChipActive: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  optionChipText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  optionChipTextActive: { color: '#fff' },
  deductionRow: { flexDirection: 'row', gap: 8, marginHorizontal: 20 },
  deductionChip: {
    flex: 1, paddingVertical: 12, borderRadius: Radius.md, alignItems: 'center',
    backgroundColor: Colors.mutedBg, borderWidth: 1.5, borderColor: Colors.border,
  },
  deductionChipText: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  deductionHint: { fontSize: 12, color: Colors.destructive, marginHorizontal: 20, marginTop: 8, fontWeight: '500' },
  saveBtn: {
    margin: 16, marginTop: 20, backgroundColor: Colors.primary,
    borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center',
  },
  saveBtnDis: { backgroundColor: Colors.iconMuted },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
