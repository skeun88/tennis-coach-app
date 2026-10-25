import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import type { TodayCard } from '../lib/homeDataLoader';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const CACHE_PREFIX = 'briefing_v3_';

interface LessonPlanBrief {
  id: string;
  improvement_points: string | string[] | null;
  next_goals: string[] | null;
  coach_next_goals: string[] | null;
  next_goals_saved: boolean | null;
  created_at: string;
  source: 'plan' | 'report';
}

interface BriefingSummary {
  keyPoints: string[];
  nextGoal: string | null;
}

interface Props {
  nextCard: TodayCard | null;
  hasToday: boolean;
  allDone: boolean;
  onPressCard: (memberId: string, memberName: string, memberLevel: string) => void;
  onPressViewRecord: (planId: string | undefined, reportId: string | undefined, memberId: string, memberName: string, memberLevel: string) => void;
}

/** improvement_points를 원문 그대로 최대 2개 배열로 변환 (자르기 금지) */
function parseImprovementPoints(val: string | string[] | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean).slice(0, 2);
  try {
    const parsed = JSON.parse(val as string);
    if (Array.isArray(parsed)) return (parsed as string[]).filter(Boolean).slice(0, 2);
  } catch {}
  return [(val as string).trim()].filter(Boolean);
}

export default function NextLessonBriefingCard({
  nextCard,
  hasToday,
  allDone,
  onPressCard,
  onPressViewRecord,
}: Props) {
  const [plan, setPlan] = useState<LessonPlanBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [isFirstLesson, setIsFirstLesson] = useState(false);
  const [summary, setSummary] = useState<BriefingSummary | null>(null);
  const summarizing = useRef(false);

  useEffect(() => {
    if (!nextCard) { setPlan(null); setIsFirstLesson(false); setSummary(null); return; }
    fetchLatestPlan(nextCard.memberId);
  }, [nextCard?.memberId]);

  useEffect(() => {
    if (!nextCard?.memberId) return;
    const memberId = nextCard.memberId;
    const channel = supabase
      .channel('briefing_rt_' + memberId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_plans', filter: `member_id=eq.${memberId}` }, () => fetchLatestPlan(memberId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_lesson_reports', filter: `member_id=eq.${memberId}` }, () => fetchLatestPlan(memberId))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [nextCard?.memberId]);

  async function fetchLatestPlan(memberId: string) {
    setLoading(true);
    try {
      const [planResult, reportResult] = await Promise.all([
        supabase
          .from('lesson_plans')
          .select('id, improvement_points, next_goals, coach_next_goals, next_goals_saved, created_at')
          .eq('member_id', memberId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('member_lesson_reports')
          .select('id, improvement_points, created_at')
          .eq('member_id', memberId)
          .is('lesson_plan_id', null)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      const planData = planResult.data?.[0] ?? null;
      const reportData = reportResult.data?.[0] ?? null;

      let best: LessonPlanBrief | null = null;
      if (planData && reportData) {
        best = new Date(planData.created_at) >= new Date(reportData.created_at)
          ? { ...planData, source: 'plan' }
          : { id: reportData.id, improvement_points: reportData.improvement_points, next_goals: null, coach_next_goals: null, next_goals_saved: null, created_at: reportData.created_at, source: 'report' };
      } else if (planData) {
        best = { ...planData, source: 'plan' };
      } else if (reportData) {
        best = { id: reportData.id, improvement_points: reportData.improvement_points, next_goals: null, coach_next_goals: null, next_goals_saved: null, created_at: reportData.created_at, source: 'report' };
      }

      if (!best) {
        const { count } = await supabase
          .from('lesson_members')
          .select('id', { count: 'exact', head: true })
          .eq('member_id', memberId);
        setIsFirstLesson((count ?? 0) <= 1);
        setPlan(null);
        setSummary(null);
      } else {
        setPlan(best);
        setIsFirstLesson(false);
        await loadOrRequestSummary(best);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadOrRequestSummary(p: LessonPlanBrief) {
    // 캐시 확인
    try {
      const cached = await AsyncStorage.getItem(CACHE_PREFIX + p.id);
      if (cached) {
        setSummary(JSON.parse(cached));
        return;
      }
    } catch {}

    // 캐시 없음 → 원문 표시 상태로 두고 백그라운드 AI 호출
    setSummary(null);
    if (summarizing.current) return;
    summarizing.current = true;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/summarize-briefing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          improvement_points: p.improvement_points,
          next_goals: p.next_goals,
          coach_next_goals: p.coach_next_goals,
          next_goals_saved: p.next_goals_saved,
        }),
      });
      if (!res.ok) return;
      const data: BriefingSummary = await res.json();
      if (data.keyPoints?.length || data.nextGoal) {
        await AsyncStorage.setItem(CACHE_PREFIX + p.id, JSON.stringify(data));
        setSummary(data);
      }
    } catch {
      // 실패 시 원문 그대로 표시 (setSummary(null) 유지)
    } finally {
      summarizing.current = false;
    }
  }

  function formatDate(isoString: string): string {
    const d = new Date(isoString);
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  }

  // 표시할 핵심 포인트: AI 요약 캐시 우선 → 원문 (자르기 없음)
  const keyPoints: string[] = summary?.keyPoints?.length
    ? summary.keyPoints
    : parseImprovementPoints(plan?.improvement_points ?? null);

  // 표시할 목표: AI 요약 캐시 우선 → next_goals 원문 → null
  const nextGoalText: string | null = (() => {
    if (summary?.nextGoal) return summary.nextGoal;
    if (!plan || plan.source !== 'plan') return null;
    const goals = (plan.next_goals_saved && plan.coach_next_goals?.length)
      ? plan.coach_next_goals
      : (plan.next_goals ?? []);
    return goals[0] ?? null;
  })();

  // 빈 상태 카드
  if (!hasToday || allDone || !nextCard) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="sparkles-outline" size={14} color="#C0755A" />
            <Text style={styles.cardTitle}>레슨 브리핑</Text>
          </View>
        </View>
        <Text style={styles.emptyText}>
          {allDone ? '오늘 레슨을 모두 완료했어요 🎉' : '오늘 예정된 레슨이 없어요'}
        </Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.88}
      onPress={() => onPressCard(nextCard.memberId, nextCard.memberName, nextCard.memberLevel)}
    >
      {/* 헤더 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="sparkles-outline" size={14} color="#C0755A" />
          <Text style={styles.cardTitle}>레슨 브리핑</Text>
        </View>
        <View style={styles.timeBadge}>
          <Text style={styles.timeText}>{nextCard.startTime.slice(0, 5)}</Text>
        </View>
      </View>

      {/* 회원 정보 */}
      <View style={styles.memberRow}>
        <View style={styles.memberInfo}>
          <Text style={styles.memberName}>{nextCard.memberName}</Text>
          {plan && (
            <Text style={styles.lastDate}>지난 레슨 {formatDate(plan.created_at)}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color="#C0755A" />
      </View>

      {/* 본문 */}
      {loading ? (
        <ActivityIndicator size="small" color="#C0755A" style={{ marginVertical: 14 }} />
      ) : isFirstLesson ? (
        <Text style={styles.emptyText}>첫 레슨입니다</Text>
      ) : !plan ? (
        <Text style={styles.emptyText}>이전 레슨 기록이 없습니다</Text>
      ) : (
        <View style={styles.body}>
          {/* 지난 레슨 핵심 — 뉴트럴 배경 */}
          {keyPoints.length > 0 && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="clipboard-outline" size={15} color="#6B7280" />
                <Text style={styles.sectionTitle}>지난 레슨 핵심</Text>
              </View>
              {keyPoints.map((pt, i) => (
                <Text key={i} style={styles.sectionBody} numberOfLines={2}>• {pt}</Text>
              ))}
            </View>
          )}

          {/* 오늘의 레슨 포인트 — 테라코타 배경 */}
          {nextGoalText ? (
            <View style={[styles.sectionCard, styles.goalCard]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="locate-outline" size={15} color="#C0755A" />
                <Text style={[styles.sectionTitle, styles.goalTitle]}>오늘의 레슨 포인트</Text>
              </View>
              <Text style={[styles.sectionBody, styles.goalBody]} numberOfLines={2}>{nextGoalText}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* 하단 버튼 */}
      {plan && !loading && (
        <TouchableOpacity
          style={styles.viewRecordBtn}
          activeOpacity={0.7}
          onPress={(e) => {
            e.stopPropagation?.();
            onPressViewRecord(
              plan.source === 'plan' ? plan.id : undefined,
              plan.source === 'report' ? plan.id : undefined,
              nextCard.memberId, nextCard.memberName, nextCard.memberLevel
            );
          }}
        >
          <Text style={styles.viewRecordText}>지난 레슨 기록 보기</Text>
          <Ionicons name="chevron-forward" size={14} color="#C0755A" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 16,
    shadowColor: '#8B6A5A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3E2B22',
    letterSpacing: 0.2,
  },
  timeBadge: {
    backgroundColor: '#C0755A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  memberInfo: {
    gap: 2,
  },
  memberName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#3E2B22',
    letterSpacing: -0.3,
  },
  lastDate: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  sectionCard: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 5,
  },
  goalCard: {
    backgroundColor: '#FBF2EF',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.3,
  },
  goalTitle: {
    color: '#C0755A',
  },
  sectionBody: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 20,
  },
  goalBody: {
    color: '#3E2B22',
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '500',
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  viewRecordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginBottom: 14,
    paddingVertical: 9,
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    gap: 4,
  },
  viewRecordText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555555',
  },
});
