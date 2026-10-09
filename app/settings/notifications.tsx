import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Switch, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';

interface NotificationSettings {
  lesson_day_before: boolean;
  lesson_hour_before: boolean;
  member_message: boolean;
  reregister_alert: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  lesson_day_before: true,
  lesson_hour_before: true,
  member_message: true,
  reregister_alert: true,
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
    key: 'lesson_day_before',
    title: '레슨 D-1 알림',
    subtitle: '레슨 전날 오전 10:00에 알림을 받습니다',
    icon: 'calendar-outline',
    iconColor: Colors.info,
  },
  {
    key: 'lesson_hour_before',
    title: '레슨 1시간 전 알림',
    subtitle: '레슨 시작 1시간 전에 알림을 받습니다',
    icon: 'time-outline',
    iconColor: Colors.primary,
  },
  {
    key: 'member_message',
    title: '회원 메시지',
    subtitle: '회원이 메시지를 보내면 알림을 받습니다',
    icon: 'chatbubble-outline',
    iconColor: Colors.accentWarm,
  },
  {
    key: 'reregister_alert',
    title: '재등록 알림',
    subtitle: '회원 잔여 횟수가 1회일 때 알림을 받습니다',
    icon: 'layers-outline',
    iconColor: Colors.destructive,
  },
];

export default function NotificationsScreen() {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('notification_settings')
      .select('lesson_day_before,lesson_hour_before,member_message,reregister_alert')
      .eq('coach_id', user.id)
      .maybeSingle();

    if (data) {
      setSettings({
        lesson_day_before: data.lesson_day_before ?? true,
        lesson_hour_before: data.lesson_hour_before ?? true,
        member_message: data.member_message ?? true,
        reregister_alert: data.reregister_alert ?? true,
      });
    }
    setLoading(false);
  }

  async function updateSetting(key: keyof NotificationSettings, value: boolean) {
    const updated = { ...settings, [key]: value };
    setSettings(updated);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('notification_settings').upsert({
      coach_id: user.id,
      user_type: 'coach',
      ...updated,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'coach_id' });

    if (error) {
      Alert.alert('오류', '설정 저장 중 오류가 발생했습니다.');
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SettingsHeader
        title="알림 설정"
        right={saved ? (
          <View style={styles.savedBadge}>
            <Ionicons name="checkmark" size={14} color={Colors.primary} />
            <Text style={styles.savedText}>저장됨</Text>
          </View>
        ) : null}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
          <Text style={styles.infoText}>
            알림 설정은 서버에 저장되며 모든 기기에 동일하게 적용됩니다.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>알림 종류</Text>
        <View style={styles.card}>
          {NOTIFICATION_ITEMS.map((item, index) => (
            <View key={item.key}>
              <View style={styles.settingRow}>
                <View style={[styles.iconBox, { backgroundColor: item.iconColor + '18' }]}>
                  <Ionicons name={item.icon as any} size={20} color={item.iconColor} />
                </View>
                <View style={styles.settingTexts}>
                  <Text style={styles.settingTitle}>{item.title}</Text>
                  <Text style={styles.settingSubtitle}>{item.subtitle}</Text>
                </View>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  savedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  savedText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 48 },
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.primaryLight, borderRadius: 12, padding: 12, marginBottom: 20,
    borderWidth: 1, borderColor: Colors.primary + '33',
  },
  infoText: { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 18 },
  sectionLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.mutedFg,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8, marginTop: 4,
  },
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
});
