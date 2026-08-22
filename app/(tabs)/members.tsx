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

const LEVEL_BADGE: Record<string, { bg: string; text: string }> = {
  '입문': { bg: '#FBF2EF', text: '#C0755A' },
  '초급': { bg: '#F0E0D6', text: '#A86045' },
  '중급': { bg: '#E4C8B8', text: '#8A4A34' },
  '상급': { bg: '#D4A898', text: '#6B3522' },
  '선수': { bg: '#3E2B22', text: '#F7F0E9' },
};

export default function MembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<MemberWithUnread[]>([]);
  const [filtered, setFiltered] = useState<MemberWithUnread[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('활성');
  const [packageCount, setPackageCount] = useState(0);

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

  async function loadPackageCount() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { count } = await supabase
      .from('lesson_packages')
      .select('id', { count: 'exact', head: true })
      .eq('coach_id', user.id)
      .eq('is_active', true);
    setPackageCount(count ?? 0);
  }

  useFocusEffect(useCallback(() => {
    loadMembers();
    loadPackageCount();
  }, [filter]));

  useEffect(() => {
    const q = search.toLowerCase();
    let base = members;
    if (filter === '체험') base = members.filter(m => (m as any).is_trial);
    else if (filter === '미납') base = members.filter(m => !(m as any).is_trial && (m.remaining_credits ?? 0) === 0);
    else if (filter === '만료예정') base = members.filter(m => !(m as any).is_trial && (m.remaining_credits ?? 0) > 0 && (m.remaining_credits ?? 0) <= 2);
    setFiltered(q ? base.filter(m => m.name.toLowerCase().includes(q) || m.phone.includes(q)) : base);
  }, [search, members, filter]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>회원</Text>
          <Text style={styles.headerSub}>총 {members.length}명</Text>
        </View>
      </View>

      {/* 레슨권 관리 카드 */}
      <TouchableOpacity
        style={styles.packageCard}
        onPress={() => router.push('/lesson-packages/')}
        activeOpacity={0.85}
      >
        <View style={styles.packageLeft}>
          <View style={styles.packageIconBox}>
            <Ionicons name="card-outline" size={20} color="#C0755A" />
          </View>
          <View>
            <Text style={styles.packageTitle}>레슨권 관리</Text>
            <Text style={styles.packageSub}>
              {packageCount > 0 ? `${packageCount}종 등록` : '등록된 레슨권 없음'}
            </Text>
          </View>
        </View>
        <View style={styles.packageRight}>
          <Text style={styles.packageAction}>관리하기</Text>
          <Ionicons name="chevron-forward" size={15} color="#C0755A" />
        </View>
      </TouchableOpacity>

      {/* 검색 */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color="#8B7355" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="이름 또는 전화번호 검색"
          placeholderTextColor="#C4B49E"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#C4B49E" />
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
            <Text numberOfLines={1} style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
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
            tintColor="#C0755A"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color="#C4B49E" />
            <Text style={styles.emptyText}>회원이 없습니다</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const initials = item.name.slice(0, 1);
          const badge = LEVEL_BADGE[item.level] ?? LEVEL_BADGE['입문'];
          const isFirst = index === 0;
          const isLast = index === filtered.length - 1;
          const hasUnread = (item.unread_count ?? 0) > 0;
          return (
            <TouchableOpacity
              style={[
                styles.memberRow,
                isFirst && styles.memberRowFirst,
                isLast && styles.memberRowLast,
                !isLast && styles.memberRowDivider,
                hasUnread && styles.memberRowUnread,
              ]}
              onPress={() => router.push(`/members/${item.id}`)}
              activeOpacity={0.7}
            >
              <View style={[styles.memberAvatar, { backgroundColor: badge.bg }]}>
                <Text style={[styles.memberAvatarText, { color: badge.text }]}>{initials}</Text>
              </View>
              <View style={styles.memberInfo}>
                <View style={styles.memberNameRow}>
                  <Text style={styles.memberName}>{item.name}</Text>
                  <View style={[styles.levelBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.levelText, { color: badge.text }]}>{item.level}</Text>
                  </View>
                  {hasUnread && (
                    <View style={styles.newMsgBadge}>
                      <Ionicons name="chatbubble" size={10} color="#fff" />
                      <Text style={styles.newMsgText}>새 메시지</Text>
                      <View style={styles.newMsgCount}>
                        <Text style={styles.newMsgCountText}>{item.unread_count}</Text>
                      </View>
                    </View>
                  )}
                </View>
                <Text style={styles.memberPhone}>{item.phone}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#C4B49E" />
            </TouchableOpacity>
          );
        }}
      />

      {/* FAB */}
      <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={() => router.push('/members/new')}>
        <Ionicons name="person-add" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F0E9' },

  header: {
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
  },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#3E2B22' },
  headerSub: { fontSize: 14, color: '#8B7355', marginTop: 2 },

  packageCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FBF2EF',
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  packageLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  packageIconBox: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#EDE0D4',
    justifyContent: 'center', alignItems: 'center',
  },
  packageTitle: { fontSize: 14, fontWeight: '700', color: '#3E2B22' },
  packageSub: { fontSize: 12, color: '#8B7355', marginTop: 1 },
  packageRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  packageAction: { fontSize: 13, fontWeight: '600', color: '#C0755A' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#EDE0D4',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#3E2B22' },

  filterScroll: { flexGrow: 0, marginBottom: 12 },
  filterChips: { paddingHorizontal: 16, gap: 8, flexDirection: 'row', alignItems: 'center' },
  chip: {
    paddingHorizontal: 15, paddingVertical: 0,
    minHeight: 40,
    borderRadius: 20, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#D5C9BC',
    justifyContent: 'center', alignItems: 'center',
  },
  chipActive: { backgroundColor: '#C0755A', borderColor: '#C0755A' },
  chipText: { fontSize: 14, fontWeight: '600', color: '#3E2B22', lineHeight: 20, includeFontPadding: false },
  chipTextActive: { color: '#fff' },

  listContent: { paddingHorizontal: 16, paddingBottom: 100 },

  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 14,
    minHeight: 76,
  },
  memberRowFirst: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  memberRowLast: { borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  memberRowDivider: { borderBottomWidth: 1, borderBottomColor: '#EDE0D4' },
  memberRowUnread: { borderLeftWidth: 3, borderLeftColor: '#C0755A' },
  memberAvatar: {
    width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  memberAvatarText: { fontSize: 17, fontWeight: '700' },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  memberName: { fontSize: 15, fontWeight: '700', color: '#3E2B22' },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  levelText: { fontSize: 11, fontWeight: '600' },
  memberPhone: { fontSize: 13, color: '#8B7355' },
  newMsgBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#C0755A', borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  newMsgText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  newMsgCount: {
    backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 1, marginLeft: 2,
  },
  newMsgCountText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  empty: { alignItems: 'center', padding: 60 },
  emptyText: { fontSize: 15, color: '#C4B49E', fontWeight: '500', marginTop: 12 },

  fab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#C0755A', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#C0755A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 5,
  },
});
