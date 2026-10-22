import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import type { TodayCard } from '../lib/homeDataLoader';

interface LessonPlanBrief {
  id: string;
  summary: string | null;
  next_goals: string[] | null;
  coach_next_goals: string[] | null;
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

  async function fetchLatestPlan(memberId: string) {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('lesson_plans')
        .select('id, summary, next_goals, coach_next_goals, created_at')
        .eq('member_id', memberId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!data || data.length === 0) {
        const { count } = await supabase
          .from('lesson_members')
          .select('id', { count: 'exact', head: true })
          .eq('member_id', memberId);
        setIsFirstLesson((count ?? 0) <= 1);
        setPlan(null);
      } else {
        setPlan(data[0] as LessonPlanBrief);
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

  const goalLines = plan
    ? (
        plan.coach_next_goals && plan.coach_next_goals.length > 0
          ? plan.coach_next_goals
          : plan.next_goals ?? []
      ).slice(0, 2)
    : [];

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
