import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import type { TodayCard } from '../lib/homeDataLoader';

interface LessonPlanBrief {
  id: string;
  improvement_points: string | string[] | null;
  next_goals: string[] | null;
  coach_next_goals: string[] | null;
  next_goals_saved: boolean | null;
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

/**
 * 한국어 문법 패턴으로 핵심절 추출 — AI 원문 미변경, 단순 글자수 자르기 금지.
 *
 * 실제 AI 출력 패턴 기반 (DB에서 확인):
 *  1. "문제 → 해결책" 형식    → ' → ' 앞부분만 추출
 *  2. "현상 경향이 있으므로, 처방" 형식  → '경향이 있' 앞부분만 추출
 *  3. "원인이므로/하므로, 처방" 형식     → '으므로/므로' 앞부분 추출 (길이가 전체의 65% 미만일 때)
 *  4. 쉼표가 전체의 50% 이내 위치 → 앞부분 추출
 *  5. 위 패턴 미해당 → 그대로 반환 (numberOfLines={2}로 자연스럽게 래핑)
 */
function extractCorePhrase(text: string): string {
  const t = text.trim().replace(/[.。]$/, '').trim();
  if (t.length <= 22) return t;

  // 패턴 1: "문제 설명 → 해결책" — 화살표 앞부분이 핵심 문제
  const arrowIdx = t.indexOf(' → ');
  if (arrowIdx > 5) return t.slice(0, arrowIdx).trim();

  // 패턴 2: "...경향이 있으므로/있어서/있음" — 헤징 동사구 앞이 핵심
  const hedgeMatch = t.match(/^(.+?)\s+경향이\s+있/);
  if (hedgeMatch && hedgeMatch[1].length >= 5) return hedgeMatch[1].trim();

  // 패턴 3: "...으므로/므로" 원인절 — 원인부가 핵심 (전체의 65% 미만일 때만)
  const causalMatch = t.match(/^(.+?)으?므로\b/);
  if (causalMatch && causalMatch[1].length >= 5 && causalMatch[1].length < t.length * 0.65) {
    return causalMatch[1].trim();
  }

  // 패턴 4: 쉼표가 전체의 50% 이전 → 앞부분이 문제, 뒤가 처방
  // 쉼표 앞에 남은 "므로"는 접속 어미이므로 함께 제거
  const commaIdx = t.indexOf(', ');
  if (commaIdx > 5 && commaIdx < t.length * 0.5) {
    const part = t.slice(0, commaIdx).replace(/\s*으?므로$/, '').trim();
    if (part.length >= 5) return part;
  }

  // 패턴 5: "핵심 목표 - 세부 훈련 방법" 형식 (next_goals 스타일)
  const dashIdx = t.indexOf(' - ');
  if (dashIdx > 5 && dashIdx < t.length * 0.6) {
    return t.slice(0, dashIdx).trim();
  }

  // 패턴 미해당: 원문 그대로 (numberOfLines={2}로 래핑)
  return t;
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
    if (!nextCard) { setPlan(null); setIsFirstLesson(false); return; }
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
        if (new Date(planData.created_at) >= new Date(reportData.created_at)) {
          best = { ...planData, source: 'plan' };
        } else {
          best = { id: reportData.id, improvement_points: reportData.improvement_points, next_goals: null, coach_next_goals: null, next_goals_saved: null, created_at: reportData.created_at, source: 'report' };
        }
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

  // improvement_points → 최대 2개, 한국어 문법 패턴으로 핵심절 추출
  const keyPoints: string[] = (() => {
    if (!plan?.improvement_points) return [];
    let items: string[];
    if (Array.isArray(plan.improvement_points)) {
      items = (plan.improvement_points as string[]).filter(Boolean);
    } else {
      try {
        const parsed = JSON.parse(plan.improvement_points as string);
        if (Array.isArray(parsed)) items = (parsed as string[]).filter(Boolean);
        else items = [(plan.improvement_points as string).trim()].filter(Boolean);
      } catch {
        items = [(plan.improvement_points as string).trim()].filter(Boolean);
      }
    }
    return items
      .filter(item => !item.startsWith('레슨 내용 없음'))
      .slice(0, 2)
      .map(extractCorePhrase);
  })();

  // next_goals / coach_next_goals → 브리핑용 핵심 목표 1개 (핵심절 추출)
  const nextGoalText: string | null = (() => {
    if (!plan || plan.source !== 'plan') return null;
    const rawGoals: string[] = (plan.next_goals_saved && plan.coach_next_goals?.length)
      ? plan.coach_next_goals
      : (plan.next_goals ?? []);
    if (!rawGoals.length) return null;

    // 중첩 JSON 처리: goals[0]이 '["...", "..."]' 형식인 경우 파싱
    let goals = rawGoals;
    if (rawGoals.length === 1 && rawGoals[0].trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(rawGoals[0]);
        if (Array.isArray(parsed) && parsed.length > 0) goals = parsed as string[];
      } catch {}
    }

    return extractCorePhrase(goals[0]);
  })();

  // 빈 상태 카드 (레슨 없음 / 모두 완료)
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
          {/* 지난 레슨 핵심 — 연한 뉴트럴 배경 */}
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

          {/* 오늘의 레슨 포인트 — 연한 테라코타 배경 */}
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
  // 지난 레슨 핵심: 연한 뉴트럴 배경
  sectionCard: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 5,
  },
  // 오늘의 레슨 포인트: 연한 테라코타 배경
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
