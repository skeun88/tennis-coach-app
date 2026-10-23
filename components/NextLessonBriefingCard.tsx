import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import type { TodayCard } from '../lib/homeDataLoader';

interface LessonPlanBrief {
  id: string;
  summary: string | null;
  improvement_points: string | string[] | null;
  session_goals: string | null;
  created_at: string;
}

interface Props {
  nextCard: TodayCard | null;
  hasToday: boolean;
  allDone: boolean;
  onPressCard: (memberId: string, memberName: string, memberLevel: string) => void;
  onPressViewRecord: (planId: string, memberId: string, memberName: string, memberLevel: string) => void;
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

  useEffect(() => {
    if (!nextCard) {
      setPlan(null);
      setIsFirstLesson(false);
      return;
    }
    fetchLatestPlan(nextCard.memberId);
  }, [nextCard?.memberId]);

  // lesson_plans 또는 member_lesson_reports 변경 시 실시간 갱신
  useEffect(() => {
    if (!nextCard?.memberId) return;
    const memberId = nextCard.memberId;
    const channel = supabase
      .channel('briefing_realtime_' + memberId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_plans', filter: `member_id=eq.${memberId}` }, () => {
        fetchLatestPlan(memberId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_lesson_reports', filter: `member_id=eq.${memberId}` }, () => {
        fetchLatestPlan(memberId);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [nextCard?.memberId]);

  async function fetchLatestPlan(memberId: string) {
    setLoading(true);
    try {
      // lesson_plans(AI 분석)과 member_lesson_reports(수동 기록) 병렬 조회
      const [planResult, reportResult] = await Promise.all([
        supabase
          .from('lesson_plans')
          .select('id, summary, improvement_points, session_goals, created_at')
          .eq('member_id', memberId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('member_lesson_reports')
          .select('id, summary, improvement_points, created_at')
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
          ? (planData as LessonPlanBrief)
          : { ...reportData, session_goals: null };
      } else if (planData) {
        best = planData as LessonPlanBrief;
      } else if (reportData) {
        best = { ...reportData, session_goals: null };
      }

      if (!best) {
        const { count } = await supabase
          .from('lesson_members')
          .select('id', { count: 'exact', head: true })
          .eq('member_id', memberId);
        setIsFirstLesson((count ?? 0) <= 1);
        setPlan(null);
      } else {
        setPlan(best);
        setIsFirstLesson(false);
      }
    } finally {
      setLoading(false);
    }
  }

  function formatDate(isoString: string): string {
    const d = new Date(isoString);
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  }

  const goalLines: string[] = (() => {
    if (!plan) return [];
    if (plan.improvement_points) {
      // member_lesson_reports.improvement_points는 Postgres ARRAY → JS array
      if (Array.isArray(plan.improvement_points)) {
        const arr = plan.improvement_points as string[];
        if (arr.length > 0) return arr.slice(0, 2);
      }
      // lesson_plans.improvement_points는 JSON 문자열
      if (typeof plan.improvement_points === 'string') {
        try {
          const parsed: string[] = JSON.parse(plan.improvement_points);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 2);
        } catch {}
        // JSON 파싱 실패 시 plain text이면 그대로 사용
        if (plan.improvement_points.trim()) return [plan.improvement_points.trim()];
      }
    }
    if (plan.session_goals) return [plan.session_goals];
    return [];
  })();

  if (!hasToday) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <Ionicons name="checkmark-circle-outline" size={14} color="#C0755A" />
            <Text style={styles.cardTitle}>다음 레슨 브리핑</Text>
          </View>
        </View>
        <Text style={styles.emptyText}>오늘 예정된 레슨이 없어요</Text>
      </View>
    );
  }

  if (allDone) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <Ionicons name="checkmark-circle" size={14} color="#C0755A" />
            <Text style={styles.cardTitle}>다음 레슨 브리핑</Text>
          </View>
        </View>
        <Text style={styles.emptyText}>오늘 레슨을 모두 완료했어요 🎉</Text>
      </View>
    );
  }

  if (!nextCard) return null;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => onPressCard(nextCard.memberId, nextCard.memberName, nextCard.memberLevel)}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons name="checkmark-circle-outline" size={14} color="#C0755A" />
          <Text style={styles.cardTitle}>다음 레슨 브리핑</Text>
        </View>
        <View style={styles.timeBadge}>
          <Text style={styles.timeText}>{nextCard.startTime.slice(0, 5)}</Text>
        </View>
      </View>

      <View style={styles.memberRow}>
        <Text style={styles.memberName}>{nextCard.memberName}</Text>
        {plan && (
          <Text style={styles.lastLessonDate}>지난 레슨 {formatDate(plan.created_at)}</Text>
        )}
      </View>

      <View style={styles.divider} />

      {loading ? (
        <ActivityIndicator size="small" color="#C0755A" style={{ marginVertical: 12 }} />
      ) : isFirstLesson ? (
        <Text style={styles.emptyText}>첫 레슨입니다</Text>
      ) : !plan ? (
        <Text style={styles.emptyText}>이전 레슨 기록이 없습니다</Text>
      ) : (
        <View style={styles.contentWrap}>
          {plan.summary ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>지난 레슨</Text>
              <Text style={styles.sectionText} numberOfLines={2}>{plan.summary}</Text>
            </View>
          ) : null}

          {goalLines.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>오늘의 레슨 포인트</Text>
              <Text style={styles.sectionText} numberOfLines={2}>
                {goalLines.join('\n')}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {plan && !loading && (
        <>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.viewRecordBtn}
            activeOpacity={0.7}
            onPress={(e) => {
              e.stopPropagation?.();
              onPressViewRecord(plan.id, nextCard.memberId, nextCard.memberName, nextCard.memberLevel);
            }}
          >
            <Text style={styles.viewRecordText}>지난 레슨 기록 보기</Text>
            <Ionicons name="chevron-forward" size={14} color="#C0755A" />
          </TouchableOpacity>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: '#EDE0D4',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3E2B22',
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
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3E2B22',
  },
  lastLessonDate: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0EDEA',
    marginHorizontal: 0,
  },
  contentWrap: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  section: {
    gap: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3E2B22',
    letterSpacing: 0.3,
  },
  sectionText: {
    fontSize: 13,
    color: '#555555',
    lineHeight: 20,
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '500',
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  viewRecordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 14,
    marginBottom: 12,
    paddingVertical: 9,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    gap: 4,
  },
  viewRecordText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555555',
  },
});
