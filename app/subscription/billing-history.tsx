import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  SafeAreaView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useSubscription } from '../../hooks/useSubscription';

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';

interface BillingItem {
  id: string;
  type: 'subscription' | 'topup';
  description: string;
  amount: number;
  created_at: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function BillingHistoryScreen() {
  const router = useRouter();
  const { subscription } = useSubscription();
  const [items, setItems] = useState<BillingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    if (!subscription?.coach_id) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('subscription_billing_events')
        .select('id, type, description, amount, created_at')
        .eq('coach_id', subscription.coach_id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && data) setItems(data as BillingItem[]);
    } catch {
      // fallback: show empty state
    } finally {
      setLoading(false);
    }
  }, [subscription]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color={DARK_BROWN} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>결제·충전 내역</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={TERRACOTTA} style={{ marginTop: 60 }} />
      ) : items.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="receipt-outline" size={48} color={WARM_GRAY_BORDER} />
          <Text style={s.emptyText}>결제·충전 내역이 없습니다.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          renderItem={({ item }) => (
            <View style={s.row}>
              <View style={s.rowIcon}>
                <Ionicons
                  name={item.type === 'topup' ? 'add-circle-outline' : 'card-outline'}
                  size={20}
                  color={TERRACOTTA}
                />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowDesc}>{item.description}</Text>
                <Text style={s.rowDate}>{formatDate(item.created_at)}</Text>
              </View>
              <Text style={s.rowAmount}>{item.amount.toLocaleString()}원</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: DARK_BROWN },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: WARM_GRAY },
  list: { paddingHorizontal: 20, paddingVertical: 12 },
  separator: { height: 1, backgroundColor: WARM_GRAY_BORDER + '40', marginVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  rowIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: TERRACOTTA + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  rowContent: { flex: 1 },
  rowDesc: { fontSize: 14, fontWeight: '600', color: DARK_BROWN, marginBottom: 3 },
  rowDate: { fontSize: 12, color: WARM_GRAY },
  rowAmount: { fontSize: 14, fontWeight: '700', color: DARK_BROWN },
});
