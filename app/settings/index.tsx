import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, SafeAreaView
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '../../hooks/useSubscription';

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
            icon="notifications-outline"
            label="알림 설정"
            onPress={() => router.push('/settings/notifications')}
          />
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
});
