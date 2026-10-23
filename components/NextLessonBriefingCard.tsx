import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import type { TodayCard } from '../lib/homeDataLoader';

interface LessonPlanBrief {
  id: string;
  improvement_points: string | string[] | null;
  session_goals: string | null;
  created_at: string;
  source: 'plan' | 'report';
}

interface Props {
  nextCard: TodayCard | null;
  hasToday: boolean;
  allDone: boolean;
  onPressCard: (memberId: string, memberName: string, memberLevel: string) => void;
  onPressViewRecord: (planId: string | undefined, reportId: string | undefined, memberId: string, memberName: string, memberLevel: string) => void;
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
      const [planResult, reportResult] = await Promise.all([
        supabase
          .from('lesson_plans')
          .select('id, improvement_points, session_goals, created_at')
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
        if (new Date(planData.created_at) >= new Date(reportData.created_at)) {
          best = { ...planData, session_goals: planData.session_goals ?? null, source: 'plan' };
        } else {
          best = { id: reportData.id, improvement_points: reportData.improvement_points, session_goals: null, created_at: reportData.created_at, source: 'report' };
        }
      } else if (planData) {
        best = { ...planData, source: 'plan' };
      } else if (reportData) {
        best = { id: reportData.id, improvement_points: reportData.improvement_points, session_goals: null, created_at: reportData.created_at, source: 'report' };
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

  // improvement_points: lesson_plans는 JSON 문자열, member_lesson_reports는 Postgres ARRAY
  const keyPoints: string[] = (() => {
    if (!plan?.improvement_points) return [];
    if (Array.isArray(plan.improvement_points)) {
      return (plan.improvement_points as string[]).slice(0, 2);
    }
    try {
      const parsed: string[] = JSON.parse(plan.improvement_points as string);
      if (Array.isArray(parsed)) return parsed.slice(0, 2);
    } catch {}
    return [(plan.improvement_points as string).trim()].filter(Boolean);
  })();

  if (!hasToday) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <Ionicons name="checkmark-circle-outline" size={13} color="#C0755A" />
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
            <Ionicons name="checkmark-circle" size={13} color="#C0755A" />
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
          <Ionicons name="checkmark-circle-outline" size={13} color="#C0755A" />
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
        <ActivityIndicator size="small" color="#C0755A" style={{ marginVertical: 10 }} />
      ) : isFirstLesson ? (
        <Text style={styles.emptyText}>첫 레슨입니다</Text>
      ) : !plan ? (
        <Text style={styles.emptyText}>이전 레슨 기록이 없습니다</Text>
      ) : (
        <View style={styles.contentWrap}>
          {keyPoints.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>지난 레슨 핵심</Text>
              {keyPoints.map((pt, i) => (
                <Text key={i} style={styles.bulletText} numberOfLines={1}>• {pt}</Text>
              ))}
            </View>
          )}

          {plan.session_goals ? (
            <View style={styles.goalSection}>
              <Text style={styles.sectionLabel}>오늘 레슨 포인트</Text>
              <Text style={styles.sectionText} numberOfLines={2}>{plan.session_goals}</Text>
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
              onPressViewRecord(
                plan.source === 'plan' ? plan.id : undefined,
                plan.source === 'report' ? plan.id : undefined,
                nextCard.memberId, nextCard.memberName, nextCard.memberLevel
              );
            }}
          >
            <Text style={styles.viewRecordText}>지난 레슨 기록 보기</Text>
            <Ionicons name="chevron-forward" size={13} color="#C0755A" />
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
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDE0D4',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3E2B22',
  },
  timeBadge: {
    backgroundColor: '#C0755A',
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#3E2B22',
  },
  lastLessonDate: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0EDEA',
  },
  contentWrap: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  section: {
    gap: 3,
  },
  goalSection: {
    gap: 3,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3E2B22',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  bulletText: {
    fontSize: 12,
    color: '#555555',
    lineHeight: 18,
  },
  sectionText: {
    fontSize: 12,
    color: '#555555',
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  viewRecordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 14,
    marginBottom: 10,
    paddingVertical: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    gap: 3,
  },
  viewRecordText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555555',
  },
});
