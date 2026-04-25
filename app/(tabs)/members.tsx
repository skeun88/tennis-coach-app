import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Member, MemberLevel } from '../../types';

const LEVEL_COLORS: Record<MemberLevel, string> = {
  '입문': '#94a3b8', '초급': '#22c55e', '중급': '#3b82f6', '고급': '#f59e0b', '선수': '#ef4444',
};

export default function MembersScreen() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [filtered, setFiltered] = useState<Member[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [packageCount, setPackageCount] = useState(0);

  async function loadMembers() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    let query = supabase.from('members').select('*').eq('coach_id', user.id).order('name');
    if (activeOnly) query = query.eq('is_active', true);
    const { data } = await query;
    setMembers(data ?? []);
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
  }, [activeOnly]));

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(q ? members.filter(m => m.name.toLowerCase().includes(q) || m.phone.includes(q)) : members);
  }, [search, members]);

  function renderMember({ item }: { item: Member }) {
    const initials = item.name.slice(0, 1);
    return (
      <TouchableOpacity style={styles.card} onPress={() => router.push(`/members/${item.id}`)}>
        <View style={[styles.avatar, { backgroundColor: LEVEL_COLORS[item.level as MemberLevel] ?? '#94a3b8' }]}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.cardInfo}>
          <View style={styles.cardTop}>
            <Text style={styles.name}>{item.name}</Text>
            <View style={[styles.levelBadge, { backgroundColor: (LEVEL_COLORS[item.level as MemberLevel] ?? '#94a3b8') + '22' }]}>
              <Text style={[styles.levelText, { color: LEVEL_COLORS[item.level as MemberLevel] ?? '#94a3b8' }]}>{item.level}</Text>
            </View>
          </View>
          <Text style={styles.phone}>{item.phone}</Text>
          {!item.is_active && <Text style={styles.inactive}>비활성</Text>}
        </View>
        <Ionicons name="chevron-forward" size={16} color="#ccc" />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
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
          <Ionicons name="chevron-forward" size={16} color="#1a7a4a" />
        </View>
      </TouchableOpacity>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color="#888" style={{ marginRight: 6 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="이름 또는 전화번호 검색"
            placeholderTextColor="#bbb"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color="#bbb" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, activeOnly && styles.filterActive]}
          onPress={() => setActiveOnly(v => !v)}
        >
          <Text style={[styles.filterText, activeOnly && styles.filterTextActive]}>활성</Text>
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
            tintColor="#1a7a4a"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color="#ccc" />
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
  container: { flex: 1, backgroundColor: '#f5f7fa' },

  // 레슨권 배너
  packageBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 14, marginBottom: 4,
    borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: '#d1fae5',
    shadowColor: '#1a7a4a', shadowOpacity: 0.08, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  packageBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  packageIconBox: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: '#1a7a4a',
    justifyContent: 'center', alignItems: 'center',
  },
  packageBannerTitle: { fontSize: 15, fontWeight: '800', color: '#1a1a1a', marginBottom: 2 },
  packageBannerSub: { fontSize: 12, color: '#888' },
  packageBannerRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  packageBannerAction: { fontSize: 13, fontWeight: '700', color: '#1a7a4a' },

  // Search
  searchRow: { flexDirection: 'row', padding: 16, paddingBottom: 8, gap: 8 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#eee',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#1a1a1a' },
  filterBtn: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14,
    justifyContent: 'center', borderWidth: 1, borderColor: '#eee',
  },
  filterActive: { backgroundColor: '#1a7a4a', borderColor: '#1a7a4a' },
  filterText: { fontSize: 13, color: '#888', fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  count: { fontSize: 12, color: '#888', paddingHorizontal: 16, marginBottom: 8 },

  // Member card
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  cardInfo: { flex: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  name: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  levelText: { fontSize: 11, fontWeight: '700' },
  phone: { fontSize: 13, color: '#888' },
  inactive: { fontSize: 11, color: '#dc2626', marginTop: 2 },

  // Empty
  empty: { alignItems: 'center', padding: 40 },
  emptyText: { fontSize: 16, color: '#aaa', fontWeight: '600', marginTop: 12 },
  emptySubText: { fontSize: 13, color: '#ccc', marginTop: 4 },

  // FAB
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1a7a4a', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
});
