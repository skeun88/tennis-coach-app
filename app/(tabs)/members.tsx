import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { Member, MemberLevel } from '../../types';
import { Colors } from '../../lib/theme';

interface MemberWithUnread extends Member {
  unread_count?: number;
  last_message_at?: string;
}

type FilterType = '전체' | '활성' | '체험' | '미납' | '만료예정';

const FILTERS: FilterType[] = ['전체', '활성', '체험', '미납', '만료예정'];

const LEVEL_COLORS: Record<string, string> = {
  '입문': '#B0B7C3',
  '초급': Colors.accentWarm,
  '중급': Colors.primary,
  '상급': '#B85A42',
  '선수': Colors.navy,
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export default function MembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<MemberWithUnread[]>([]);
  const [filtered, setFiltered] = useState<MemberWithUnread[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('활성');

  async function loadMembers() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    let query = supabase.from('members').select('*').eq('coach_id', user.id).order('name');
    if (filter !== '전체') query = query.eq('is_active', true);
    const { data: rawMembers } = await query;
    if (!rawMembers) { setMembers([]); return; }

    const { data: unreadData } = await supabase
      .from('messages')
      .select('member_id, created_at')
      .eq('coach_id', user.id)
      .eq('sender_type', 'member')
      .is('read_at', null);

    const { data: lastMsgData } = await supabase
      .from('messages')
      .select('member_id, created_at')
      .eq('coach_id', user.id)
      .order('created_at', { ascending: false });

    const unreadMap: Record<string, number> = {};
    for (const row of (unreadData ?? [])) {
      unreadMap[row.member_id] = (unreadMap[row.member_id] ?? 0) + 1;
    }
    const lastMsgMap: Record<string, string> = {};
    for (const row of (lastMsgData ?? [])) {
      if (!lastMsgMap[row.member_id]) lastMsgMap[row.member_id] = row.created_at;
    }

    const enriched: MemberWithUnread[] = rawMembers.map(m => ({
      ...m,
      unread_count: unreadMap[m.id] ?? 0,
      last_message_at: lastMsgMap[m.id] ?? null,
    }));

    enriched.sort((a, b) => {
      const aUnread = (a.unread_count ?? 0) > 0;
      const bUnread = (b.unread_count ?? 0) > 0;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      if (a.last_message_at && b.last_message_at) return b.last_message_at.localeCompare(a.last_message_at);
      if (a.last_message_at) return -1;
      if (b.last_message_at) return 1;
      return a.name.localeCompare(b.name);
    });

    setMembers(enriched);
  }

  useFocusEffect(useCallback(() => {
    loadMembers();
  }, [filter]));

  useEffect(() => {
    const q = search.toLowerCase();
    let base = members;
    if (filter === '체험') base = members.filter(m => (m as any).is_trial);
    else if (filter === '미납') base = members.filter(m => !(m as any).is_trial && (m.remaining_credits ?? 0) === 0);
    else if (filter === '만료예정') base = members.filter(m => !(m as any).is_trial && (m.remaining_credits ?? 0) > 0 && (m.remaining_credits ?? 0) <= 2);
    setFiltered(q ? base.filter(m => m.name.toLowerCase().includes(q) || m.phone.includes(q)) : base);
  }, [search, members, filter]);

  const activeCount = members.filter(m => m.is_active).length;

  function getMemberSubtitle(item: MemberWithUnread): string {
    if ((item as any).is_trial) {
      const started = (item as any).trial_started_at;
      const days = started
        ? Math.floor((Date.now() - new Date(started + 'T00:00:00').getTime()) / 86400000)
        : null;
      const count = (item as any).trial_lesson_count ?? 0;
      return days !== null ? `체험 ${count}회 · D+${days}일` : `체험 ${count}회`;
    }
    const days: number[] = (item as any).fixed_schedule_days ?? [];
    const remaining = (item as any).remaining_credits ?? 0;
    const parts: string[] = [];
    if (days.length > 0) parts.push(`주${days.length}회`);
    if (parts.length > 0 || remaining >= 0) {
      parts.push(`잔여 ${remaining}회`);
    }
    return parts.join(' · ');
  }

  function getCreditsDisplay(item: MemberWithUnread): { label: string; urgent: boolean; trial: boolean } {
    if ((item as any).is_trial) return { label: '체험', urgent: false, trial: true };
    const remaining = (item as any).remaining_credits ?? 0;
    return { label: `${remaining}회`, urgent: remaining <= 2, trial: false };
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>MEMBERS</Text>
          <Text style={styles.headerTitle}>회원</Text>
          <Text style={styles.headerSub}>{activeCount}명 활성</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/members/new')}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* 검색 */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={15} color={Colors.mutedFg} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="이름 또는 전화번호"
          placeholderTextColor={Colors.placeholder}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color={Colors.placeholder} />
          </TouchableOpacity>
        )}
      </View>

      {/* 필터 칩 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterChips}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 회원 목록 */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadMembers(); setRefreshing(false); }}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={44} color={Colors.placeholder} />
            <Text style={styles.emptyText}>회원이 없습니다</Text>
          </View>
        }
        renderItem={({ item }) => {
          const initials = item.name.slice(0, 1);
          const levelColor = LEVEL_COLORS[item.level] ?? Colors.mutedFg;
          const credits = getCreditsDisplay(item);
          const subtitle = getMemberSubtitle(item);
          const hasUnread = (item.unread_count ?? 0) > 0;

          return (
            <TouchableOpacity
              style={styles.memberRow}
              onPress={() => router.push(`/members/${item.id}`)}
              activeOpacity={0.7}
            >
              {/* 아바타 */}
              <View style={[styles.avatar, { backgroundColor: levelColor + '22' }]}>
                <Text style={[styles.avatarText, { color: levelColor }]}>{initials}</Text>
              </View>

              {/* 정보 */}
              <View style={styles.memberInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.memberName}>{item.name}</Text>
                  <View style={[styles.levelBadge, { backgroundColor: levelColor + '18', borderColor: levelColor + '40' }]}>
                    <Text style={[styles.levelText, { color: levelColor }]}>{item.level}</Text>
                  </View>
                  {hasUnread && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.memberSub}>{subtitle}</Text>
              </View>

              {/* 크레딧 뱃지 */}
              <View style={[
                styles.creditsBadge,
                credits.urgent && styles.creditsBadgeUrgent,
                credits.trial && styles.creditsBadgeTrial,
              ]}>
                <Text style={[
                  styles.creditsText,
                  credits.urgent && styles.creditsTextUrgent,
                  credits.trial && styles.creditsTextTrial,
                ]}>{credits.label}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    backgroundColor: Colors.navy,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 2,
    marginBottom: 2,
  },
  headerTitle: { fontSize: 30, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 },

  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 14, marginBottom: 10,
    backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.foreground },

  filterScroll: { flexGrow: 0, marginBottom: 8 },
  filterChips: { paddingHorizontal: 16, gap: 8, flexDirection: 'row' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: '#fff',
    borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg },
  chipTextActive: { color: '#fff' },

  listContent: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 4 },

  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  separator: { height: 8 },

  avatar: {
    width: 44, height: 44, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 18, fontWeight: '800' },

  memberInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  memberName: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  levelBadge: {
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 6, borderWidth: 1,
  },
  levelText: { fontSize: 11, fontWeight: '700' },
  unreadDot: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: Colors.primary,
  },
  memberSub: { fontSize: 13, color: Colors.mutedFg },

  creditsBadge: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, backgroundColor: Colors.mutedBg,
    minWidth: 44, alignItems: 'center',
  },
  creditsBadgeUrgent: { backgroundColor: Colors.destructiveLight },
  creditsBadgeTrial: { backgroundColor: '#FEF3C7' },
  creditsText: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg },
  creditsTextUrgent: { color: Colors.destructive },
  creditsTextTrial: { color: '#D97706' },

  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontSize: 15, color: Colors.placeholder, fontWeight: '500', marginTop: 12 },
});
