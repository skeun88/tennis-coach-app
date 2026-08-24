import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export interface HomeStats {
  totalMembers: number;
  todayLessons: number;
  unpaidMembers: number;
  expiringMembers: number;
}

export interface TodayCard {
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

export interface ChurnRiskMember {
  id: string;
  name: string;
  level: string;
  lastAttended: string | null;
}

export interface TrialMember {
  id: string;
  name: string;
  trial_started_at: string | null;
  trial_lesson_count: number;
}

export interface InterestMember {
  id: string;
  name: string | null;
  phone: string | null;
  package_title: string | null;
  created_at: string;
  packageId: string | null;
}

export interface AutoGenSuggestion {
  memberId: string;
  name: string;
  time: string;
}

export interface HomeData {
  stats: HomeStats;
  todayCards: TodayCard[];
  churnRiskList: ChurnRiskMember[];
  trialCount: number;
  trialMembers: TrialMember[];
  interestList: InterestMember[];
  knowledgeCount: number;
  autoGenSuggestion: AutoGenSuggestion[];
  coachEmail: string;
  userId: string;
  today: string;
  fetchedAt: number;
}

const CACHE_KEY_PREFIX = 'home_data_v2_';
const CACHE_TTL_MS = 60_000; // 60s fresh window

const memCache: Record<string, HomeData> = {};

export function getMemCache(coachId: string): HomeData | null {
  return memCache[coachId] ?? null;
}

export function isFresh(data: HomeData): boolean {
  return Date.now() - data.fetchedAt < CACHE_TTL_MS;
}

export async function loadCachedHomeData(coachId: string): Promise<HomeData | null> {
  if (memCache[coachId]) return memCache[coachId];
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY_PREFIX + coachId);
    if (!raw) return null;
    const data = JSON.parse(raw) as HomeData;
    memCache[coachId] = data;
    return data;
  } catch {
    return null;
  }
}

export async function persistHomeData(coachId: string, data: HomeData) {
  memCache[coachId] = data;
  try {
    await AsyncStorage.setItem(CACHE_KEY_PREFIX + coachId, JSON.stringify(data));
  } catch {}
}

export function clearHomeCache(coachId?: string) {
  if (coachId) {
    delete memCache[coachId];
    AsyncStorage.removeItem(CACHE_KEY_PREFIX + coachId).catch(() => {});
  } else {
    Object.keys(memCache).forEach(k => { delete memCache[k]; });
  }
}

export async function fetchTodayCards(uid: string, date: string): Promise<TodayCard[]> {
  const { data: lessons } = await supabase
    .from('lessons')
    .select('id, title, start_time')
    .eq('coach_id', uid)
    .eq('date', date)
    .order('start_time');

  if (!lessons || lessons.length === 0) return [];

  const lessonIds = lessons.map(l => l.id);
  const [{ data: lessonMembers }, { data: attendances }] = await Promise.all([
    supabase
      .from('lesson_members')
      .select('lesson_id, member_id, member:members(id, name, level, remaining_credits, lesson_package_id, lesson_packages(title))')
      .in('lesson_id', lessonIds),
    supabase
      .from('attendance')
      .select('id, lesson_id, member_id, status, deduct_credit, absence_reason, deduction_type')
      .in('lesson_id', lessonIds),
  ]);

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

  const cards: TodayCard[] = [];
  for (const lm of lessonMembers ?? []) {
    const lesson = lessons.find(l => l.id === lm.lesson_id);
    const member = lm.member as any;
    if (!lesson || !member) continue;
    const att = attendanceMap.get(`${lm.lesson_id}:${lm.member_id}`);
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
  cards.sort((a, b) =>
    a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.memberName.localeCompare(b.memberName)
  );
  return cards;
}

export async function fetchChurnRisk(
  activeMembers: { id: string; name: string; level: string; is_trial?: boolean }[]
): Promise<ChurnRiskMember[]> {
  const memberIds = activeMembers.filter(m => !m.is_trial).map(m => m.id);
  if (memberIds.length === 0) return [];

  const threeWeeksAgo = new Date();
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
  const cutoff = threeWeeksAgo.toISOString().split('T')[0];

  const { data: recentAttendance } = await supabase
    .from('attendance')
    .select('member_id, lessons!inner(date)')
    .in('member_id', memberIds)
    .gte('lessons.date' as any, cutoff);

  const attendedRecently = new Set((recentAttendance ?? []).map((a: any) => a.member_id));
  const atRisk = activeMembers
    .filter(m => !m.is_trial && !attendedRecently.has(m.id))
    .map(m => ({ id: m.id, name: m.name, level: m.level, lastAttended: null as string | null }));

  if (atRisk.length > 0) {
    const { data: lastAttData } = await supabase
      .from('attendance')
      .select('member_id, lessons!inner(date)')
      .in('member_id', atRisk.map(m => m.id));

    const lastAttMap: Record<string, string> = {};
    for (const row of lastAttData ?? []) {
      const mid = (row as any).member_id;
      const d = (row as any).lessons?.date ?? null;
      if (d && !lastAttMap[mid]) lastAttMap[mid] = d;
    }
    return atRisk.map(m => ({ ...m, lastAttended: lastAttMap[m.id] ?? null }));
  }
  return [];
}

export async function fetchAutoGenSuggestion(uid: string): Promise<AutoGenSuggestion[]> {
  const todayDayOfWeek = new Date().getDay();
  const { data: membersWithSchedule } = await supabase
    .from('members')
    .select('id, name, fixed_schedule_days, fixed_schedule_time, fixed_schedule_times')
    .eq('coach_id', uid)
    .eq('is_active', true)
    .not('fixed_schedule_days', 'is', null);
  if (!membersWithSchedule) return [];
  return membersWithSchedule
    .filter(m => m.fixed_schedule_days && m.fixed_schedule_days.includes(todayDayOfWeek))
    .map(m => {
      const fst = (m as any).fixed_schedule_times;
      const time = fst?.[String(todayDayOfWeek)] ?? (m.fixed_schedule_time as string | null)?.slice(0, 5) ?? null;
      if (!time) return null;
      return { memberId: m.id, name: m.name, time };
    })
    .filter(Boolean) as AutoGenSuggestion[];
}

export async function fetchHomeData(userId: string, email: string): Promise<HomeData> {
  const today = new Date().toISOString().split('T')[0];

  const [membersRes, lessonsRes] = await Promise.all([
    supabase.from('members').select('id, name, level, remaining_credits, is_active, is_trial').eq('coach_id', userId),
    supabase.from('lessons').select('id').eq('coach_id', userId).eq('date', today),
  ]);

  const members = membersRes.data ?? [];
  const activeMembers = members.filter((m: any) => m.is_active !== false);
  const stats: HomeStats = {
    totalMembers: activeMembers.length,
    todayLessons: lessonsRes.data?.length ?? 0,
    unpaidMembers: activeMembers.filter((m: any) => (m.remaining_credits ?? 0) === 0 && !m.is_trial).length,
    expiringMembers: activeMembers.filter((m: any) => {
      const rc = m.remaining_credits ?? 0;
      return rc > 0 && rc <= 2 && !m.is_trial;
    }).length,
  };

  const trials = activeMembers.filter((m: any) => m.is_trial);

  const [churnRiskList, interestRes, todayCards, autoGenSuggestion, knowledgeRes] = await Promise.all([
    fetchChurnRisk(activeMembers as any[]),
    supabase
      .from('member_interest')
      .select('id, name, phone, package_id, created_at, lesson_packages(title)')
      .eq('coach_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    fetchTodayCards(userId, today),
    fetchAutoGenSuggestion(userId),
    supabase.from('tennis_knowledge').select('id', { count: 'exact', head: true }).eq('coach_id', userId),
  ]);

  const interestList: InterestMember[] = (interestRes.data ?? []).map((i: any) => ({
    id: i.id, name: i.name, phone: i.phone,
    package_title: i.lesson_packages?.title ?? null,
    packageId: i.package_id ?? null,
    created_at: i.created_at,
  }));

  return {
    stats,
    todayCards,
    churnRiskList,
    trialCount: trials.length,
    trialMembers: trials.map((m: any) => ({
      id: m.id, name: m.name,
      trial_started_at: m.trial_started_at ?? null,
      trial_lesson_count: m.trial_lesson_count ?? 0,
    })),
    interestList,
    knowledgeCount: knowledgeRes.count ?? 0,
    autoGenSuggestion,
    coachEmail: email,
    userId,
    today,
    fetchedAt: Date.now(),
  };
}
