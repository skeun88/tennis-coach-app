import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

interface Stats {
  totalMembers: number;
  activeMembers: number;
  todayLessons: number;
  unpaidPayments: number;
  unpaidAmount: number;
}

interface TodayMemberCard {
  lessonId: string;
  lessonTitle: string;
  startTime: string;
  memberId: string;
  memberName: string;
  memberLevel: string;
  remainingCredits: number;
  attended: boolean;
  attendanceId?: string;
}

export default function HomeScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    totalMembers: 0, activeMembers: 0, todayLessons: 0, unpaidPayments: 0, unpaidAmount: 0,
  });
  const [todayCards, setTodayCards] = useState<TodayMemberCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAttendance, setLoadingAttendance] = useState<string | null>(null);
  const [coachEmail, setCoachEmail] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [autoGenSuggestion, setAutoGenSuggestion] = useState<{memberId: string; name: string; time: string}[]>([]);

  const today = new Date().toISOString().split('T')[0];

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCoachEmail(user.email ?? '');
    setUserId(user.id);

    const [membersRes, lessonsRes, paymentsRes] = await Promise.all([
      supabase.from('members').select('id, is_active').eq('coach_id', user.id),
      supabase.from('lessons').select('id').eq('coach_id', user.id).eq('date', today),
      supabase.from('payments').select('id, amount, paid_amount, status').eq('coach_id', user.id).neq('status', '납부완료'),
    ]);

    const members = membersRes.data ?? [];
    const unpaidList = paymentsRes.data ?? [];
    const totalUnpaid = unpaidList.reduce((sum, p) => sum + (p.amount - p.paid_amount), 0);

    setStats({
      totalMembers: members.length,
      activeMembers: members.filter(m => m.is_active).length,
      todayLessons: lessonsRes.data?.length ?? 0,
      unpaidPayments: unpaidList.length,
      unpaidAmount: totalUnpaid,
    });

    await loadTodayCards(user.id);
    await checkAutoGenSchedule(user.id);
  }

  async function loadTodayCards(uid: string) {
    // Fetch today's lessons
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

    // Fetch lesson_members with member info
    const { data: lessonMembers } = await supabase
      .from('lesson_members')
      .select('lesson_id, member_id, member:members(id, name, level, remaining_credits)')
      .in('lesson_id', lessonIds);

    // Fetch existing attendances for today's lessons
    const { data: attendances } = await supabase
      .from('attendance')
      .select('id, lesson_id, member_id, status')
      .in('lesson_id', lessonIds);

    const attendanceMap = new Map<string, { id: string; status: string }>();
    for (const a of attendances ?? []) {
      attendanceMap.set(`${a.lesson_id}:${a.member_id}`, { id: a.id, status: a.status });
    }

    const cards: TodayMemberCard[] = [];
    for (const lm of lessonMembers ?? []) {
      const lesson = lessons.find(l => l.id === lm.lesson_id);
      const member = lm.member as any;
      if (!lesson || !member) continue;
      const key = `${lm.lesson_id}:${lm.member_id}`;
      const att = attendanceMap.get(key);
      cards.push({
        lessonId: lm.lesson_id,
        lessonTitle: lesson.title,
        startTime: lesson.start_time,
        memberId: lm.member_id,
        memberName: member.name,
        memberLevel: member.level,
        remainingCredits: member.remaining_credits ?? 0,
        attended: att?.status === '출석',
        attendanceId: att?.id,
      });
    }

    // Sort by start_time then member name
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
      .select('id, name, fixed_schedule_days, fixed_schedule_time')
      .eq('coach_id', uid)
      .eq('is_active', true)
      .not('fixed_schedule_time', 'is', null);
    if (!membersWithSchedule) return;
    const suggestions = membersWithSchedule
      .filter(m => m.fixed_schedule_days && m.fixed_schedule_days.includes(todayDayOfWeek))
      .map(m => ({ memberId: m.id, name: m.name, time: (m.fixed_schedule_time as string).slice(0, 5) }));
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
      if (!member || !member.fixed_schedule_time) continue;
      const startTime = (member.fixed_schedule_time as string).slice(0, 5);
      const durationMins = (member.fixed_lesson_duration as number) ?? 60;
      const [h, m] = startTime.split(':').map(Number);
      const endDate = new Date(2000, 0, 1, h, m + durationMins);
      const endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;

      // 같은 시간대 기존 레슨 있으면 통합, 없으면 새로 생성
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

      // 이미 등록된 회원이면 skip
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

  async function handleAttendance(card: TodayMemberCard) {
    if (!userId) return;
    const key = `${card.lessonId}:${card.memberId}`;
    setLoadingAttendance(key);
    try {
      if (card.attended) {
        // Toggle off: delete attendance
        if (card.attendanceId) {
          await supabase.from('attendance').delete().eq('id', card.attendanceId);
        }
      } else {
        // Upsert attendance
        await supabase.from('attendance').upsert({
          lesson_id: card.lessonId,
          member_id: card.memberId,
          status: '출석',
          deduct_credit: true,
        }, { onConflict: 'lesson_id,member_id' });
      }
      await loadTodayCards(userId);
    } catch (e) {
      Alert.alert('오류', '출석 처리 중 오류가 발생했습니다.');
    } finally {
      setLoadingAttendance(null);
    }
  }

  const LEVEL_COLOR: Record<string, string> = {
    '입문': '#94a3b8', '초급': '#22c55e', '중급': '#2563eb', '고급': '#7c3aed', '선수': '#dc2626',
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await loadAll(); setRefreshing(false); }}
          tintColor="#1a7a4a"
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

      {/* Stats Grid (2x2) */}
      <View style={styles.statsGrid}>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderLeftColor: '#1a7a4a' }]}>
            <Text style={styles.statValue}>{stats.activeMembers}</Text>
            <Text style={styles.statLabel}>활성 회원</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: '#2563eb' }]}>
            <Text style={styles.statValue}>{stats.todayLessons}</Text>
            <Text style={styles.statLabel}>오늘 레슨</Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderLeftColor: '#dc2626' }]}>
            <Text style={[styles.statValue, { color: stats.unpaidPayments > 0 ? '#dc2626' : '#1a1a1a' }]}>
              {stats.unpaidPayments}
            </Text>
            <Text style={styles.statLabel}>미납 회원</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: '#7c3aed' }]}>
            <Text style={styles.statValue}>{stats.totalMembers}</Text>
            <Text style={styles.statLabel}>전체 회원</Text>
          </View>
        </View>
      </View>

      {/* Unpaid Alert */}
      {stats.unpaidAmount > 0 && (
        <TouchableOpacity style={styles.alertCard} onPress={() => router.push('/(tabs)/payments')}>
          <Ionicons name="alert-circle" size={20} color="#dc2626" />
          <Text style={styles.alertText}>
            미납 금액 <Text style={styles.alertAmount}>{stats.unpaidAmount.toLocaleString()}원</Text>이 있습니다
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#dc2626" />
        </TouchableOpacity>
      )}

      {/* Today's Lessons Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>오늘 레슨</Text>
        <TouchableOpacity onPress={() => router.push('/lessons/new')}>
          <Ionicons name="add-circle-outline" size={22} color="#1a7a4a" />
        </TouchableOpacity>
      </View>

      {todayCards.length === 0 && autoGenSuggestion.length > 0 && (
        <View style={styles.autoGenBanner}>
          <View style={styles.autoGenHeader}>
            <Ionicons name="flash" size={18} color="#1a7a4a" />
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
          <Ionicons name="calendar-outline" size={40} color="#ccc" />
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
            return (
              <TouchableOpacity
                key={cardKey}
                style={[styles.memberCard, card.attended && styles.memberCardAttended]}
                onPress={() => router.push(`/members/${card.memberId}`)}
                activeOpacity={0.85}
              >
                {/* Left: time badge */}
                <View style={styles.timeBadge}>
                  <Text style={styles.timeText}>{card.startTime.slice(0, 5)}</Text>
                </View>

                {/* Center: member info */}
                <View style={styles.memberInfo}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName}>{card.memberName}</Text>
                    <View style={[styles.levelBadge, { backgroundColor: (LEVEL_COLOR[card.memberLevel] ?? '#888') + '22' }]}>
                      <Text style={[styles.levelText, { color: LEVEL_COLOR[card.memberLevel] ?? '#888' }]}>
                        {card.memberLevel}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.lessonSubtitle}>{card.lessonTitle}</Text>
                  <View style={styles.creditsRow}>
                    <Ionicons name="layers-outline" size={12} color={card.remainingCredits <= 1 ? '#dc2626' : '#888'} />
                    <Text style={[styles.creditsText, { color: card.remainingCredits <= 1 ? '#dc2626' : '#888' }]}>
                      잔여 {card.remainingCredits}회
                      {card.remainingCredits <= 1 && ' ⚠️'}
                    </Text>
                  </View>
                </View>

                {/* Right: attendance button */}
                <TouchableOpacity
                  style={[styles.attendBtn, card.attended && styles.attendBtnActive]}
                  onPress={() => handleAttendance(card)}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={card.attended ? '#fff' : '#1a7a4a'} />
                  ) : (
                    <Ionicons
                      name={card.attended ? 'checkmark-circle' : 'checkmark-circle-outline'}
                      size={32}
                      color={card.attended ? '#fff' : '#1a7a4a'}
                    />
                  )}
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Quick Actions */}
      <Text style={[styles.sectionTitle, { marginHorizontal: 16, marginTop: 8 }]}>빠른 실행</Text>
      <View style={styles.quickGrid}>
        {[
          { label: '회원 등록', icon: 'person-add', color: '#1a7a4a', onPress: () => router.push('/members/new') },
          { label: '레슨 추가', icon: 'calendar-outline', color: '#2563eb', onPress: () => router.push('/lessons/new') },
          { label: '결제 현황', icon: 'card-outline', color: '#dc2626', onPress: () => router.push('/(tabs)/payments') },
          { label: '회원 목록', icon: 'people-outline', color: '#7c3aed', onPress: () => router.push('/(tabs)/members') },
        ].map((action, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.quickCard, { borderTopColor: action.color }]}
            onPress={action.onPress}
          >
            <Ionicons name={action.icon as any} size={28} color={action.color} />
            <Text style={styles.quickLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },

  // Header
  headerCard: {
    backgroundColor: '#1a7a4a', padding: 20, paddingTop: 60,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24, marginBottom: 16,
  },
  headerTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 12,
  },
  greeting: { fontSize: 22, fontWeight: '700', color: '#fff' },
  email: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerIconBtn: { padding: 4 },
  dateText: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },

  // Stats
  statsGrid: {
    paddingHorizontal: 16, gap: 8, marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row', gap: 8, marginBottom: 0,
  },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 12, borderLeftWidth: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: '#1a1a1a', marginBottom: 1 },
  statLabel: { fontSize: 11, color: '#888', fontWeight: '500' },

  // Alert
  alertCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff5f5', borderRadius: 12, marginHorizontal: 16,
    padding: 12, marginBottom: 16,
    borderWidth: 1, borderColor: '#fecaca',
  },
  alertText: { flex: 1, fontSize: 14, color: '#555', marginLeft: 8 },
  alertAmount: { fontWeight: '700', color: '#dc2626' },

  // Section Header
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },

  // Today Lessons
  lessonCardsList: { paddingHorizontal: 16, marginBottom: 16 },
  memberCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    borderWidth: 1, borderColor: 'transparent',
  },
  memberCardAttended: {
    backgroundColor: '#f0fdf4', borderColor: '#bbf7d0',
  },
  timeBadge: {
    backgroundColor: '#f0fdf4', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    alignItems: 'center', marginRight: 12, minWidth: 52,
  },
  timeText: { fontSize: 14, fontWeight: '700', color: '#1a7a4a' },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  memberName: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  levelText: { fontSize: 11, fontWeight: '700' },
  lessonSubtitle: { fontSize: 12, color: '#888', marginBottom: 4 },
  creditsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  creditsText: { fontSize: 12, fontWeight: '500' },
  attendBtn: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 2, borderColor: '#1a7a4a',
    justifyContent: 'center', alignItems: 'center',
    marginLeft: 8,
  },
  attendBtnActive: {
    backgroundColor: '#1a7a4a', borderColor: '#1a7a4a',
  },

  // Empty
  emptyCard: {
    alignItems: 'center', backgroundColor: '#fff', borderRadius: 14,
    marginHorizontal: 16, padding: 40, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  emptyText: { fontSize: 14, color: '#aaa', fontWeight: '500', marginTop: 12, marginBottom: 16 },
  addLessonBtn: {
    backgroundColor: '#1a7a4a', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
  },
  addLessonBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Quick Actions
  quickGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, gap: 10, paddingBottom: 32,
  },
  quickCard: {
    flex: 1, minWidth: '45%', backgroundColor: '#fff', borderRadius: 12,
    padding: 16, alignItems: 'center', borderTopWidth: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  quickLabel: { fontSize: 13, fontWeight: '600', color: '#333', marginTop: 8 },

  // Auto-gen banner
  autoGenBanner: { backgroundColor: '#f0fdf4', borderRadius: 12, marginHorizontal: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#bbf7d0' },
  autoGenHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  autoGenTitle: { fontSize: 15, fontWeight: '700', color: '#1a7a4a' },
  autoGenItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  autoGenTime: { fontSize: 14, fontWeight: '700', color: '#1a7a4a', minWidth: 44 },
  autoGenName: { fontSize: 14, color: '#333', fontWeight: '500' },
  autoGenBtn: { marginTop: 12, backgroundColor: '#1a7a4a', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  autoGenBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
