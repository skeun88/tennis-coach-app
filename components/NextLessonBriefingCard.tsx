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

interface BriefingDisplayState {
  plan: LessonPlanBrief | null;
  summary: BriefingSummary | null;
  isFirstLesson: boolean;
  fetchError: boolean;
}

interface Props {
  nextCard: TodayCard | null;
  hasToday: boolean;
  allDone: boolean;
  /** All today's unprocessed member IDs — used to prefetch in background */
  upcomingMemberIds?: string[];
  onPressCard: (memberId: string, memberName: string, memberLevel: string) => void;
  onPressViewRecord: (planId: string | undefined, reportId: string | undefined, memberId: string, memberName: string, memberLevel: string) => void;
}

// Module-level cache — survives re-renders, cleared on app restart
const _stateCache = new Map<string, BriefingDisplayState>();
const _inflight = new Set<string>();
const _summarizing = new Set<string>();

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
  upcomingMemberIds = [],
  onPressCard,
  onPressViewRecord,
}: Props) {
  // What's currently rendered (may lag behind nextCard during fetch)
  const [displayedMemberId, setDisplayedMemberId] = useState<string | null>(null);
  const [displayState, setDisplayState] = useState<BriefingDisplayState | null>(null);
  const [spinnerVisible, setSpinnerVisible] = useState(false); // only for very first load with no prior data
  const currentMemberIdRef = useRef<string | null>(null);

  // Effect: switch to new member
  useEffect(() => {
    if (!nextCard) {
      currentMemberIdRef.current = null;
      setDisplayedMemberId(null);
      setDisplayState(null);
      setSpinnerVisible(false);
      return;
    }
    currentMemberIdRef.current = nextCard.memberId;

    const cached = _stateCache.get(nextCard.memberId);
    if (cached) {
      // Cache hit → instant display, no spinner
      setDisplayedMemberId(nextCard.memberId);
      setDisplayState(cached);
      setSpinnerVisible(false);
      return;
    }

    // Cache miss: if we have NO previous data at all, show spinner
    // If we do have previous data, keep displaying it (no flash) while fetching
    if (!displayState) {
      setSpinnerVisible(true);
    }
    doFetch(nextCard.memberId);
  }, [nextCard?.memberId]);

  // Effect: prefetch upcoming members in background whenever the list changes
  useEffect(() => {
    for (const id of upcomingMemberIds) {
      if (!_stateCache.has(id) && !_inflight.has(id)) {
        doFetch(id);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingMemberIds.join(',')]);

  // Realtime: invalidate cache and re-fetch on record changes
  useEffect(() => {
    if (!nextCard?.memberId) return;
    const memberId = nextCard.memberId;
    const channel = supabase
      .channel('briefing_rt_' + memberId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_plans', filter: `member_id=eq.${memberId}` }, () => {
        _stateCache.delete(memberId);
        if (currentMemberIdRef.current === memberId) doFetch(memberId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_lesson_reports', filter: `member_id=eq.${memberId}` }, () => {
        _stateCache.delete(memberId);
        if (currentMemberIdRef.current === memberId) doFetch(memberId);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCard?.memberId]);

  async function doFetch(memberId: string) {
    if (_inflight.has(memberId)) return;
    _inflight.add(memberId);
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

      if (planResult.error) throw planResult.error;
      if (reportResult.error) throw reportResult.error;

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

      let isFirstLesson = false;
      if (!best) {
        const { count } = await supabase
          .from('lesson_members')
          .select('id', { count: 'exact', head: true })
          .eq('member_id', memberId);
        isFirstLesson = (count ?? 0) <= 1;
      }

      // Check AsyncStorage for existing AI summary
      let cachedSummary: BriefingSummary | null = null;
      if (best) {
        try {
          const raw = await AsyncStorage.getItem(CACHE_PREFIX + best.id);
          if (raw) cachedSummary = JSON.parse(raw);
        } catch {}
      }

      const newState: BriefingDisplayState = {
        plan: best,
        summary: cachedSummary,
        isFirstLesson,
        fetchError: false,
      };

      _stateCache.set(memberId, newState);

      // Update display only if this is still the active member
      if (currentMemberIdRef.current === memberId) {
        setDisplayedMemberId(memberId);
        setDisplayState(newState);
        setSpinnerVisible(false);
      }

      // Background AI summary (if no cached summary)
      if (best && !cachedSummary) {
        doSummary(memberId, best);
      }
    } catch {
      // Don't overwrite existing display with error; just hide spinner
      if (currentMemberIdRef.current === memberId) {
        setSpinnerVisible(false);
        // Only update display if we have nothing yet
        if (!displayedMemberId || displayedMemberId === memberId) {
          setDisplayedMemberId(memberId);
          setDisplayState({ plan: null, summary: null, isFirstLesson: false, fetchError: true });
        }
      }
    } finally {
      _inflight.delete(memberId);
    }
  }

  async function doSummary(memberId: string, plan: LessonPlanBrief) {
    if (_summarizing.has(memberId)) return;
    _summarizing.add(memberId);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/summarize-briefing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          improvement_points: plan.improvement_points,
          next_goals: plan.next_goals,
          coach_next_goals: plan.coach_next_goals,
          next_goals_saved: plan.next_goals_saved,
        }),
      });
      if (!res.ok) return;
      const data: BriefingSummary = await res.json();
      if (data.keyPoints?.length || data.nextGoal) {
        await AsyncStorage.setItem(CACHE_PREFIX + plan.id, JSON.stringify(data));
        const existing = _stateCache.get(memberId);
        if (existing) {
          const updated = { ...existing, summary: data };
          _stateCache.set(memberId, updated);
          if (currentMemberIdRef.current === memberId) {
            setDisplayState(updated);
          }
        }
      }
    } catch {} finally {
      _summarizing.delete(memberId);
    }
  }

  function formatDate(isoString: string): string {
    const d = new Date(isoString);
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  }

  // Whether data is still being fetched for the active member
  const isTransitioning = nextCard != null && displayedMemberId !== nextCard.memberId;

  // Derive display values from current display state
  const ds = displayState;
  const keyPoints: string[] = ds?.summary?.keyPoints?.length
    ? ds.summary.keyPoints
    : parseImprovementPoints(ds?.plan?.improvement_points ?? null);

  const nextGoalText: string | null = (() => {
    if (ds?.summary?.nextGoal) return ds.summary.nextGoal;
    if (!ds?.plan || ds.plan.source !== 'plan') return null;
    const goals = (ds.plan.next_goals_saved && ds.plan.coach_next_goals?.length)
      ? ds.plan.coach_next_goals
      : (ds.plan.next_goals ?? []);
    return goals[0] ?? null;
  })();

  // Empty / all-done card
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
          {!isTransitioning && ds?.plan && (
            <Text style={styles.lastDate}>지난 레슨 {formatDate(ds.plan.created_at)}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color="#C0755A" />
      </View>

      {/* 본문 */}
      {spinnerVisible ? (
        // 최초 로드 (이전 데이터 없음): 스피너
        <ActivityIndicator size="small" color="#C0755A" style={{ marginVertical: 14 }} />
      ) : isTransitioning ? (
        // 회원 전환 중: 높이를 유지하는 빈 공간 (깜빡임 방지)
        <View style={styles.transitionPlaceholder} />
      ) : ds?.fetchError ? (
        <Text style={styles.emptyText}>브리핑 데이터를 불러오지 못했어요</Text>
      ) : ds?.isFirstLesson ? (
        <Text style={styles.emptyText}>첫 레슨입니다</Text>
      ) : !ds?.plan ? (
        <Text style={styles.emptyText}>아직 이전 레슨 기록이 없어요</Text>
      ) : (
        <View style={styles.body}>
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
      {!isTransitioning && !spinnerVisible && ds?.plan && (
        <TouchableOpacity
          style={styles.viewRecordBtn}
          activeOpacity={0.7}
          onPress={(e) => {
            e.stopPropagation?.();
            onPressViewRecord(
              ds.plan!.source === 'plan' ? ds.plan!.id : undefined,
              ds.plan!.source === 'report' ? ds.plan!.id : undefined,
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
  // Fixed-height placeholder during member transition — prevents layout jump
  transitionPlaceholder: {
    height: 120,
    marginHorizontal: 16,
    marginBottom: 12,
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
