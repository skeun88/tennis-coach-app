import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Switch, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../lib/theme';

const STORAGE_KEY = '@kerri_notification_settings';

interface NotificationSettings {
  dayBeforeLesson: boolean;   // 레슨 전날 오후 6시
  lessonDayReminder: boolean; // 레슨 당일 1시간 전
  lowCreditsAlert: boolean;   // 잔여 횟수 1회 시
}

const DEFAULT_SETTINGS: NotificationSettings = {
  dayBeforeLesson: true,
  lessonDayReminder: true,
  lowCreditsAlert: true,
};

interface NotificationItem {
  key: keyof NotificationSettings;
  title: string;
  subtitle: string;
  icon: string;
  iconColor: string;
}

const NOTIFICATION_ITEMS: NotificationItem[] = [
  {
    key: 'dayBeforeLesson',
    title: 'D-1 알림',
    subtitle: '레슨 전날 오후 6시에 알림을 받습니다',
    icon: 'calendar-outline',
    iconColor: Colors.info,
  },
  {
    key: 'lessonDayReminder',
    title: '당일 알림',
    subtitle: '레슨 시작 1시간 전에 알림을 받습니다',
    icon: 'time-outline',
    iconColor: Colors.primary,
  },
  {
    key: 'lowCreditsAlert',
    title: '재등록 알림',
    subtitle: '회원 잔여 횟수가 1회일 때 알림을 받습니다',
    icon: 'layers-outline',
    iconColor: Colors.destructive,
  },
];

export default function NotificationsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
      }
    } catch {
      // Use defaults
    }
  }

  async function updateSetting(key: keyof NotificationSettings, value: boolean) {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      Alert.alert('오류', '설정 저장 중 오류가 발생했습니다.');
    }
  }

  async function resetAll() {
    Alert.alert('초기화', '모든 알림 설정을 초기화 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '초기화', style: 'destructive', onPress: async () => {
          setSettings(DEFAULT_SETTINGS);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>알림 설정</Text>
        {saved ? (
          <View style={styles.savedBadge}>
            <Ionicons name="checkmark" size={14} color={Colors.primary} />
            <Text style={styles.savedText}>저장됨</Text>
          </View>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Info banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.info} />
          <Text style={styles.infoText}>
            알림은 앱이 실행 중일 때 로컬 알림으로 전송됩니다. 설정은 기기에 저장됩니다.
          </Text>
        </View>

        {/* Notification toggles */}
        <Text style={styles.sectionLabel}>알림 종류</Text>
        <View style={styles.card}>
          {NOTIFICATION_ITEMS.map((item, index) => (
            <View key={item.key}>
              <View style={styles.settingRow}>
                {/* Icon */}
                <View style={[styles.iconBox, { backgroundColor: item.iconColor + '18' }]}>
                  <Ionicons name={item.icon as any} size={20} color={item.iconColor} />
                </View>

                {/* Labels */}
                <View style={styles.settingTexts}>
                  <Text style={styles.settingTitle}>{item.title}</Text>
                  <Text style={styles.settingSubtitle}>{item.subtitle}</Text>
                </View>

                {/* Toggle */}
                <Switch
                  value={settings[item.key]}
                  onValueChange={(val) => updateSetting(item.key, val)}
                  trackColor={{ false: Colors.border, true: Colors.successBorder }}
                  thumbColor={settings[item.key] ? Colors.primary : '#f4f3f4'}
                  ios_backgroundColor={Colors.border}
                />
              </View>
              {index < NOTIFICATION_ITEMS.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        {/* Summary */}
        <Text style={styles.sectionLabel}>현재 설정 요약</Text>
        <View style={styles.summaryCard}>
          {NOTIFICATION_ITEMS.map(item => (
            <View key={item.key} style={styles.summaryRow}>
              <Ionicons
                name={settings[item.key] ? 'checkmark-circle' : 'close-circle'}
                size={16}
                color={settings[item.key] ? Colors.primary : Colors.iconMuted}
              />
              <Text style={[styles.summaryText, !settings[item.key] && styles.summaryTextOff]}>
                {item.title}
              </Text>
            </View>
          ))}
        </View>

        {/* Reset button */}
        <TouchableOpacity style={styles.resetBtn} onPress={resetAll}>
          <Ionicons name="refresh-outline" size={16} color={Colors.mutedFg} />
          <Text style={styles.resetBtnText}>기본값으로 초기화</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingTop: 56, paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  savedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  savedText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },

  content: { padding: 16, paddingBottom: 48 },

  // Info banner
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.primaryLight, borderRadius: 10, padding: 12, marginBottom: 20,
    borderWidth: 1, borderColor: '#bfdbfe',
  },
  infoText: { flex: 1, fontSize: 13, color: Colors.info, lineHeight: 18 },

  sectionLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.mutedFg,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8, marginTop: 4,
  },

  // Card
  card: {
    backgroundColor: '#fff', borderRadius: 14, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  iconBox: {
    width: 38, height: 38, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  settingTexts: { flex: 1 },
  settingTitle: { fontSize: 15, fontWeight: '600', color: Colors.foreground, marginBottom: 2 },
  settingSubtitle: { fontSize: 12, color: Colors.mutedFg, lineHeight: 16 },
  divider: { height: 1, backgroundColor: Colors.mutedBg, marginLeft: 66 },

  // Summary
  summaryCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 20, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryText: { fontSize: 14, color: Colors.foreground, fontWeight: '500' },
  summaryTextOff: { color: Colors.placeholder },

  // Reset
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: Colors.border,
  },
  resetBtnText: { fontSize: 14, color: Colors.mutedFg, fontWeight: '600' },
});
