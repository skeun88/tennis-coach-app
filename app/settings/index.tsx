import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '../../hooks/useSubscription';
import { PLANS } from '../../lib/subscription';
import { supabase } from '../../lib/supabase';
import { Colors, Radius } from '../../lib/theme';

const TERRA = '#C0755A';
const DARK = '#3E2B22';
const TERRA_LIGHT = '#FBF2EF';

interface SettingRowProps {
  icon: string;
  label: string;
  onPress: () => void;
  value?: string;
  destructive?: boolean;
}

function SettingRow({ icon, label, onPress, value, destructive }: SettingRowProps) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon as any} size={20} color={destructive ? Colors.destructive : TERRA} style={styles.rowIcon} />
        <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>{label}</Text>
      </View>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        <Ionicons name="chevron-forward" size={15} color={Colors.placeholder} />
      </View>
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function Group({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { subscription } = useSubscription();
  const [email, setEmail] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setEmail(user.email ?? '');
    });
  }, []);

  const planLabel = subscription
    ? PLANS[subscription.plan_id]?.name ?? subscription.plan_id
    : null;

  function handleSignOut() {
    Alert.alert('로그아웃', '로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      '계정 삭제',
      '계정을 삭제하면 모든 데이터(회원, 레슨, 리포트)가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제 확인',
          style: 'destructive',
          onPress: () => {
            Alert.alert('최종 확인', '정말로 계정을 영구 삭제하시겠습니까? 복구할 수 없습니다.', [
              { text: '취소', style: 'cancel' },
              { text: '영구 삭제', style: 'destructive', onPress: confirmDeleteAccount },
            ]);
          },
        },
      ]
    );
  }

  async function confirmDeleteAccount() {
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
    } catch (err: any) {
      Alert.alert('오류', err.message || '계정 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleting(false);
    }
  }

  function notReady() {
    Alert.alert('준비 중', '곧 제공될 예정입니다.');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>

      {/* ── 계정 및 프로필 ── */}
      <SectionHeader title="계정 및 프로필" />
      <Group>
        <SettingRow icon="person-circle-outline" label="계정 정보" onPress={notReady} value={email || undefined} />
        <SettingRow icon="create-outline" label="코치 프로필 수정" onPress={() => { router.back(); }} />
        <SettingRow icon="eye-outline" label="공개 프로필 미리보기" onPress={notReady} />
        <SettingRow icon="time-outline" label="시간블럭 설정" onPress={() => router.push('/settings/availability')} />
      </Group>

      {/* ── 구독 ── */}
      <SectionHeader title="구독" />
      <Group>
        <SettingRow
          icon="card-outline"
          label="구독 관리"
          value={planLabel ? `${planLabel} 플랜` : undefined}
          onPress={() => router.push('/subscription/manage')}
        />
      </Group>

      {/* ── 개인정보 및 보안 ── */}
      <SectionHeader title="개인정보 및 보안" />
      <Group>
        <SettingRow icon="document-text-outline" label="개인정보 처리방침" onPress={notReady} />
        <SettingRow icon="reader-outline" label="이용약관" onPress={notReady} />
        <SettingRow icon="mic-outline" label="AI 및 음성 분석 동의 관리" onPress={notReady} />
        <SettingRow icon="shield-outline" label="데이터 및 계정 관리" onPress={notReady} />
      </Group>

      {/* ── 고객 지원 ── */}
      <SectionHeader title="고객 지원" />
      <Group>
        <SettingRow icon="help-circle-outline" label="자주 묻는 질문" onPress={notReady} />
        <SettingRow icon="mail-outline" label="문의하기" onPress={notReady} />
        <SettingRow icon="bug-outline" label="오류 신고" onPress={notReady} />
        <SettingRow icon="information-circle-outline" label="앱 버전 정보" onPress={() => Alert.alert('앱 버전', '1.1.8 (Build 10)')} value="1.1.8" />
      </Group>

      {/* ── 로그아웃 ── */}
      <View style={styles.logoutCard}>
        <TouchableOpacity style={styles.logoutRow} onPress={handleSignOut} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={20} color={Colors.destructive} />
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
        {!!email && <Text style={styles.emailHint}>{email}</Text>}
      </View>

      {/* ── 계정 삭제 ── */}
      <TouchableOpacity
        style={styles.deleteRow}
        onPress={handleDeleteAccount}
        disabled={deleting}
        activeOpacity={0.7}
      >
        {deleting
          ? <ActivityIndicator size="small" color={Colors.mutedFg} />
          : <Ionicons name="trash-outline" size={14} color={Colors.mutedFg} />
        }
        <Text style={styles.deleteText}>계정 삭제</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F0E9' },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 },

  sectionHeader: {
    fontSize: 12, fontWeight: '700', color: Colors.mutedFg,
    marginTop: 20, marginBottom: 8, marginLeft: 4,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  group: {
    backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowIcon: { marginRight: 12 },
  rowLabel: { fontSize: 15, color: DARK, fontWeight: '500' },
  rowLabelDestructive: { color: Colors.destructive },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: { fontSize: 13, color: Colors.mutedFg, maxWidth: 140, textAlign: 'right' },

  // Logout
  logoutCard: {
    backgroundColor: '#fff', borderRadius: 20, marginTop: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
    overflow: 'hidden',
  },
  logoutRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: Colors.destructive },
  emailHint: {
    fontSize: 12, color: Colors.placeholder,
    textAlign: 'center', paddingBottom: 12,
  },

  // Delete account
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, marginTop: 16, paddingVertical: 8,
  },
  deleteText: { fontSize: 12, color: Colors.mutedFg, textDecorationLine: 'underline' },
});
