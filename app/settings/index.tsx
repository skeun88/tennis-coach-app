import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, SafeAreaView, Alert, ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '../../hooks/useSubscription';
import { supabase } from '../../lib/supabase';

interface MenuItemProps {
  icon: string;
  label: string;
  onPress: () => void;
  badge?: string;
  badgeColor?: string;
  chevron?: boolean;
}

function MenuItem({ icon, label, onPress, badge, badgeColor = '#4A90D9', chevron = true }: MenuItemProps) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.menuLeft}>
        <Ionicons name={icon as any} size={22} color="#555" style={styles.menuIcon} />
        <Text style={styles.menuLabel}>{label}</Text>
      </View>
      <View style={styles.menuRight}>
        {badge && (
          <View style={[styles.badge, { backgroundColor: badgeColor }]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
        {chevron && <Ionicons name="chevron-forward" size={16} color="#ccc" />}
      </View>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { subscription, isTrial, trialDaysLeft } = useSubscription();
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = () => {
    Alert.alert(
      '계정 삭제',
      '정말로 계정을 삭제하시겠습니까?\n\n삭제 시 모든 회원 데이터, 레슨 기록, 결제 정보가 영구적으로 삭제되며 복구할 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              '최종 확인',
              '계정을 삭제하면 모든 데이터가 영구 삭제됩니다. 계속하시겠습니까?',
              [
                { text: '취소', style: 'cancel' },
                {
                  text: '영구 삭제',
                  style: 'destructive',
                  onPress: confirmDeleteAccount,
                },
              ]
            );
          },
        },
      ]
    );
  };

  const confirmDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('세션이 없습니다.');

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '삭제 실패');

      await supabase.auth.signOut();
      router.replace('/(auth)/login');
    } catch (err: any) {
      Alert.alert('오류', err.message || '계정 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  const planLabel = subscription
    ? subscription.plan_id === 'pro' ? 'Pro' : 'Basic'
    : '미구독';

  const subscriptionBadge = isTrial
    ? `체험 ${trialDaysLeft}일`
    : planLabel;

  const subscriptionBadgeColor = isTrial
    ? '#f39c12'
    : subscription?.status === 'active' ? '#2ecc71' : '#e74c3c';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>설정</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>계정</Text>
        <View style={styles.menuGroup}>
          <MenuItem
            icon="card-outline"
            label="구독 관리"
            badge={subscriptionBadge}
            badgeColor={subscriptionBadgeColor}
            onPress={() => router.push('/subscription/manage')}
          />
          <MenuItem
            icon="time-outline"
            label="레슨 가능 시간"
            onPress={() => router.push('/settings/availability')}
          />
          <MenuItem
            icon="notifications-outline"
            label="알림 설정"
            onPress={() => router.push('/settings/notifications')}
          />
        </View>

        <Text style={styles.sectionTitle}>위험 구역</Text>
        <View style={styles.menuGroup}>
          <TouchableOpacity
            style={styles.deleteItem}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
            disabled={deleting}
          >
            <View style={styles.menuLeft}>
              <Ionicons name="trash-outline" size={22} color="#e74c3c" style={styles.menuIcon} />
              <Text style={styles.deleteLabel}>계정 삭제</Text>
            </View>
            {deleting
              ? <ActivityIndicator size="small" color="#e74c3c" />
              : <Ionicons name="chevron-forward" size={16} color="#e74c3c" />
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { padding: 16, paddingTop: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1a1a2e' },
  scroll: { padding: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#999', marginBottom: 8, marginLeft: 4 },
  menuGroup: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  menuLeft: { flexDirection: 'row', alignItems: 'center' },
  menuIcon: { marginRight: 12 },
  menuLabel: { fontSize: 15, color: '#333' },
  menuRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  deleteItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16,
  },
  deleteLabel: { fontSize: 15, color: '#e74c3c', fontWeight: '500' },
});
