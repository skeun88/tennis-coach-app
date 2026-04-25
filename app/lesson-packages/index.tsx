import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];

interface LessonPackage {
  id: string;
  title: string;
  days: number[];
  price: number;
  total_credits: number;
  duration_minutes: number;
  color: string;
  is_active: boolean;
  notes?: string;
}

export default function LessonPackagesScreen() {
  const router = useRouter();
  const [packages, setPackages] = useState<LessonPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadPackages() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('lesson_packages')
      .select('*')
      .eq('coach_id', user.id)
      .order('created_at', { ascending: false });
    setPackages(data ?? []);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { loadPackages(); }, []));

  async function handleDelete(pkg: LessonPackage) {
    Alert.alert(
      '레슨권 삭제',
      `"${pkg.title}"을 삭제할까요?\n이미 등록된 회원에게는 영향 없습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제', style: 'destructive',
          onPress: async () => {
            await supabase.from('lesson_packages').delete().eq('id', pkg.id);
            loadPackages();
          }
        }
      ]
    );
  }

  function renderItem({ item }: { item: LessonPackage }) {
    const daysLabel = item.days.length > 0
      ? item.days.map(d => DAYS_KR[d]).join(', ')
      : '요일 미지정';

    return (
      <View style={[styles.card, { borderLeftColor: item.color }]}>
        <View style={styles.cardTop}>
          <View style={[styles.colorDot, { backgroundColor: item.color }]} />
          <Text style={styles.cardTitle}>{item.title}</Text>
          {!item.is_active && (
            <View style={styles.inactiveBadge}>
              <Text style={styles.inactiveBadgeText}>비활성</Text>
            </View>
          )}
        </View>

        <View style={styles.cardMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={13} color="#888" />
            <Text style={styles.metaText}>{daysLabel}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={13} color="#888" />
            <Text style={styles.metaText}>{item.duration_minutes}분</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="layers-outline" size={13} color="#888" />
            <Text style={styles.metaText}>{item.total_credits}회</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="card-outline" size={13} color="#888" />
            <Text style={styles.metaText}>{item.price.toLocaleString()}원</Text>
          </View>
        </View>

        {item.notes ? (
          <Text style={styles.cardNotes} numberOfLines={1}>{item.notes}</Text>
        ) : null}

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => router.push({ pathname: '/lesson-packages/new', params: { editId: item.id } })}
          >
            <Ionicons name="pencil-outline" size={14} color="#1a7a4a" />
            <Text style={styles.editBtnText}>수정</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
            <Ionicons name="trash-outline" size={14} color="#dc2626" />
            <Text style={styles.deleteBtnText}>삭제</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={packages}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadPackages(); setRefreshing(false); }} tintColor="#1a7a4a" />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color="#1a7a4a" style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="receipt-outline" size={48} color="#ccc" />
              <Text style={styles.emptyTitle}>등록된 레슨권이 없어요</Text>
              <Text style={styles.emptyDesc}>아래 + 버튼으로 레슨권을 등록해보세요</Text>
            </View>
          )
        }
      />

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/lesson-packages/new')}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#1a1a1a', flex: 1 },
  inactiveBadge: { backgroundColor: '#f0f0f0', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  inactiveBadgeText: { fontSize: 11, color: '#888' },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: '#555' },
  cardNotes: { fontSize: 12, color: '#aaa', marginBottom: 8 },
  cardActions: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 10, marginTop: 4 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#f0fdf4' },
  editBtnText: { fontSize: 13, color: '#1a7a4a', fontWeight: '600' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#fef2f2' },
  deleteBtnText: { fontSize: 13, color: '#dc2626', fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#888' },
  emptyDesc: { fontSize: 13, color: '#aaa' },
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1a7a4a', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
});
