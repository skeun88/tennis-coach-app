import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

const CREAM = '#F7F0E9';
const TERRA = '#C0755A';
const BROWN = '#3E2B22';
const WARM_GRAY = '#8B7355';

type ConsultationItem = {
  id: string;
  guest_name: string | null;
  guest_phone: string | null;
  message: string | null;
  consultation_status: string;
  viewed_at: string | null;
  created_at: string;
  source: string;
};

const STATUS_LABEL: Record<string, string> = {
  new_inquiry: '신규 문의',
  consulting: '상담 중',
  trial_scheduled: '체험 예정',
  registered: '등록 완료',
  closed: '종료',
};

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  new_inquiry: { bg: '#FCE8E0', text: '#C0755A' },
  consulting: { bg: '#E8F0FE', text: '#4A6FA5' },
  trial_scheduled: { bg: '#E8F5E8', text: '#3A7D44' },
  registered: { bg: '#EDE0D4', text: '#6B4C3B' },
  closed: { bg: '#F0EEEC', text: '#9E9289' },
};

const FILTER_TABS = [
  { key: 'active', label: '진행 중' },
  { key: 'all', label: '전체' },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function ConsultationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ConsultationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<'active' | 'all'>('active');

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const query = supabase
      .from('lesson_requests')
      .select('id, guest_name, guest_phone, message, consultation_status, viewed_at, created_at, source')
      .eq('coach_id', user.id)
      .eq('source', 'web')
      .order('created_at', { ascending: false });

    if (activeFilter === 'active') {
      query.in('consultation_status', ['new_inquiry', 'consulting', 'trial_scheduled']);
    }

    const { data } = await query;
    setItems(data ?? []);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { load(); }, [activeFilter]));

  async function markViewedOnOpen(id: string) {
    await supabase.from('lesson_requests')
      .update({ viewed_at: new Date().toISOString() })
      .eq('id', id)
      .is('viewed_at', null);
    router.push({ pathname: '/consultations/[id]', params: { id } } as any);
  }

  const renderItem = ({ item }: { item: ConsultationItem }) => {
    const statusStyle = STATUS_COLOR[item.consultation_status] ?? STATUS_COLOR.closed;
    const isUnread = item.consultation_status === 'new_inquiry' && !item.viewed_at;

    return (
      <TouchableOpacity style={styles.card} onPress={() => markViewedOnOpen(item.id)} activeOpacity={0.8}>
        <View style={styles.cardTop}>
          <Text style={[styles.name, isUnread && styles.nameUnread]}>
            {item.guest_name ?? '이름 없음'}
            {isUnread && <Text style={styles.newBadge}> N</Text>}
          </Text>
          <Text style={[styles.chip, { backgroundColor: statusStyle.bg, color: statusStyle.text }]}>
            {STATUS_LABEL[item.consultation_status] ?? item.consultation_status}
          </Text>
        </View>
        {item.guest_phone && (
          <Text style={styles.phone}>{item.guest_phone}</Text>
        )}
        {item.message && (
          <Text style={styles.message} numberOfLines={2}>{item.message}</Text>
        )}
        <Text style={styles.date}>{formatDate(item.created_at)}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={BROWN} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>신규 상담 및 체험</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.filterRow}>
        {FILTER_TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.filterTab, activeFilter === tab.key && styles.filterTabActive]}
            onPress={() => setActiveFilter(tab.key as any)}
          >
            <Text style={[styles.filterTabText, activeFilter === tab.key && styles.filterTabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={TERRA} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubble-outline" size={48} color="#C4B49E" />
          <Text style={styles.emptyText}>
            {activeFilter === 'active' ? '진행 중인 상담이 없습니다' : '상담 이력이 없습니다'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: CREAM },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDE0D4',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: BROWN },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterTab: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: '#EDE0D4', backgroundColor: '#fff',
  },
  filterTabActive: { backgroundColor: TERRA, borderColor: TERRA },
  filterTabText: { fontSize: 13, fontWeight: '600', color: WARM_GRAY },
  filterTabTextActive: { color: '#fff' },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: '#EDE0D4',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  name: { fontSize: 15, fontWeight: '700', color: BROWN },
  nameUnread: { color: TERRA },
  newBadge: { fontSize: 11, fontWeight: '700', color: TERRA },
  chip: {
    fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  phone: { fontSize: 13, color: WARM_GRAY, marginBottom: 4 },
  message: { fontSize: 13, color: '#6B5A4E', lineHeight: 18, marginBottom: 4 },
  date: { fontSize: 12, color: '#9E9289', marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: WARM_GRAY },
});
