import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { Member, MemberLevel } from '../../types';
import { Colors, Radius, Shadow } from '../../lib/theme';

interface MemberWithUnread extends Member {
  unread_count?: number;
  last_message_at?: string;
}

const LEVEL_COLORS: Record<MemberLevel, string> = {
  '입문': Colors.level.입문,
  '초급': Colors.level.초급,
  '중급': Colors.level.중급,
  '상급': Colors.level.상급,
  '고급': Colors.level.고급,
  '선수': Colors.level.선수,
};

export default function MembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<MemberWithUnread[]>([]);
  const [filtered, setFiltered] = useState<MemberWithUnread[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [trialOnly, setTrialOnly] = useState(false);
  const [packageCount, setPackageCount] = useState(0);

  async function loadMembers() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    let query = supabase.from('members').select('*').eq('coach_id', user.id).order('name');
    if (trialOnly) query = query.eq('is_trial', true);
    else if (activeOnly) query = query.eq('is_active', true);
    const { data: rawMembers } = await query;
    if (!rawMembers) { setMembers([]); return; }

    // 안 읽은 메시지 수 + 마지막 메시지 시각 조회
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

    // 정렬: 안읽은 메시지 있는 회원 먼저 → 마지막 메시지 시각 → 이름
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
  }, [activeOnly, trialOnly]));

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(q ? members.filter(m => m.name.toLowerCase().includes(q) || m.phone.includes(q)) : members);
  }, [search, members]);

  function renderMember({ item }: { item: MemberWithUnread }) {
    const initials = item.name.slice(0, 1);
    const hasUnread = (item.unread_count ?? 0) > 0;
    return (
      <TouchableOpacity style={[styles.card, hasUnread && styles.cardUnread]} onPress={() => router.push(`/members/${item.id}`)}>
        <View style={{ position: 'relative' }}>
          <View style={[styles.avatar, { backgroundColor: LEVEL_COLORS[item.level as MemberLevel] ?? Colors.level.입문 }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>

        </View>
        <View style={styles.cardInfo}>
          <View style={styles.cardTop}>
            <Text style={styles.name}>{item.name}</Text>
            <View style={styles.levelBadge}>
              <Text style={styles.levelText}>{item.level}</Text>
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
          <Text style={styles.phone}>{item.phone}</Text>
          {!item.is_active && <Text style={styles.inactive}>비활성</Text>}
          {(item as any).is_trial && <Text style={styles.trialBadge}>체험 중</Text>}
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.iconMuted} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 레슨권 배너 */}
      <TouchableOpacity
        style={styles.packageBanner}
        onPress={() => router.push('/lesson-packages/')}
        activeOpacity={0.85}
      >
        <View style={styles.packageBannerLeft}>
          <View style={styles.packageIconBox}>
            <Ionicons name="receipt" size={22} color="#fff" />
          </View>
          <View>
            <Text style={styles.packageBannerTitle}>레슨권 관리</Text>
            <Text style={styles.packageBannerSub}>
              {packageCount > 0 ? `등록된 레슨권 ${packageCount}종` : '레슨권을 먼저 등록해보세요'}
            </Text>
          </View>
        </View>
        <View style={styles.packageBannerRight}>
          <Text style={styles.packageBannerAction}>관리하기</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
        </View>
      </TouchableOpacity>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={Colors.mutedFg} style={{ marginRight: 6 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="이름 또는 전화번호 검색"
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
        <TouchableOpacity
          style={[styles.filterBtn, !trialOnly && activeOnly && styles.filterActive]}
          onPress={() => { setTrialOnly(false); setActiveOnly(true); }}
        >
          <Text style={[styles.filterText, !trialOnly && activeOnly && styles.filterTextActive]}>활성</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, !trialOnly && !activeOnly && styles.filterActive]}
          onPress={() => { setTrialOnly(false); setActiveOnly(false); }}
        >
          <Text style={[styles.filterText, !trialOnly && !activeOnly && styles.filterTextActive]}>전체</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, trialOnly && styles.filterTrialActive]}
          onPress={() => { setTrialOnly(true); }}
        >
          <Text style={[styles.filterText, trialOnly && styles.filterTextActive]}>체험</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.count}>총 {filtered.length}명</Text>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderMember}
        contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadMembers(); setRefreshing(false); }}
            tintColor={Colors.navy}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color={Colors.iconMuted} />
            <Text style={styles.emptyText}>회원이 없습니다</Text>
            <Text style={styles.emptySubText}>아래 + 버튼을 눌러 회원을 등록하세요</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/members/new')}>
        <Ionicons name="person-add" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // 레슨권 배너
  packageBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.card,
    marginHorizontal: 16, marginTop: 14, marginBottom: 12,
    borderRadius: Radius.md, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  packageBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  packageIconBox: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#FBF2EF',
    justifyContent: 'center', alignItems: 'center',
  },
  packageBannerTitle: { fontSize: 15, fontWeight: '600', color: Colors.foreground, marginBottom: 2 },
  packageBannerSub: { fontSize: 13, color: Colors.mutedFg },
  packageBannerRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  packageBannerAction: { fontSize: 14, fontWeight: '500', color: Colors.mutedFg },

  // Search
  searchRow: { flexDirection: 'row', padding: 16, paddingBottom: 8, gap: 8 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.foreground },
  filterBtn: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12,
    justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, paddingVertical: 6,
  },
  filterTrialActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  trialBadge: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, backgroundColor: Colors.mutedBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2, alignSelf: 'flex-start' },
  filterActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontSize: 13, color: Colors.mutedFg, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  count: { fontSize: 14, color: Colors.mutedFg, paddingHorizontal: 16, marginBottom: 8 },

  // Member card
  cardUnread: { borderLeftWidth: 3, borderLeftColor: Colors.primary, borderWidth: 1, borderColor: Colors.border },
  unreadBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: Colors.destructive, borderRadius: 10,
    minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 4,
  },
  unreadBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  newMsgBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  newMsgText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  newMsgCount: { backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 2 },
  newMsgCountText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card,
    borderRadius: Radius.md, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
    ...Shadow.sm,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12, backgroundColor: Colors.mutedBg },
  avatarText: { fontSize: 16, fontWeight: '600', color: Colors.foreground },
  cardInfo: { flex: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(45,51,64,0.08)' },
  levelText: { fontSize: 11, fontWeight: '500', color: Colors.foreground },
  phone: { fontSize: 13, color: Colors.mutedFg },
  inactive: { fontSize: 13, color: Colors.destructive, marginTop: 2 },

  // Empty
  empty: { alignItems: 'center', padding: 40 },
  emptyText: { fontSize: 16, color: Colors.placeholder, fontWeight: '600', marginTop: 12 },
  emptySubText: { fontSize: 13, color: Colors.iconMuted, marginTop: 4 },

  // FAB
  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 5,
  },
});
