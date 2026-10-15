import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, Modal, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';
import { AI_CONSENT_VERSION, CONSENT_FULL_TEXT } from '../../components/CoachConsentModal';

const TERRA = '#C0755A';
const DARK = '#3E2B22';

interface ConsentRecord {
  consent_type: string;
  consent_status: string;
  agreed_at: string | null;
  consent_version: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function AiConsentScreen() {
  const router = useRouter();
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('ai_consents')
      .select('consent_type, consent_status, agreed_at, consent_version')
      .eq('coach_id', user.id)
      .eq('consent_version', AI_CONSENT_VERSION)
      .in('consent_type', ['coach_voice_ai', 'international_transfer'])
      .order('agreed_at', { ascending: false });
    setRecords(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const agreedRecord = records.find(r => r.consent_status === 'agreed');
  const isAgreed = !!agreedRecord;
  const agreedAt = agreedRecord?.agreed_at ?? null;

  async function handleWithdraw() {
    Alert.alert(
      '동의 철회',
      '동의를 철회하면 AI 레슨 기록 기능을 사용할 수 없습니다. 기존 레슨 기록은 삭제되지 않습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '철회',
          style: 'destructive',
          onPress: confirmWithdraw,
        },
      ]
    );
  }

  async function confirmWithdraw() {
    setWithdrawing(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setWithdrawing(false); return; }
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('ai_consents')
      .update({ consent_status: 'withdrawn', withdrawn_at: now })
      .eq('coach_id', user.id)
      .eq('consent_version', AI_CONSENT_VERSION)
      .eq('consent_status', 'agreed');
    setWithdrawing(false);
    if (error) {
      Alert.alert('오류', '동의 철회 중 오류가 발생했습니다.');
    } else {
      await load();
      Alert.alert('철회 완료', 'AI 레슨 기록 동의가 철회되었습니다.');
    }
  }

  return (
    <View style={styles.container}>
      <SettingsHeader title="AI 음성 분석 동의 관리" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={TERRA} />
        ) : (
          <>
            {/* 상태 카드 */}
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <Ionicons
                  name={isAgreed ? 'checkmark-circle' : 'close-circle-outline'}
                  size={22}
                  color={isAgreed ? TERRA : Colors.mutedFg}
                />
                <Text style={[styles.statusText, !isAgreed && styles.statusTextMuted]}>
                  {isAgreed ? '동의 완료' : '동의 없음'}
                </Text>
              </View>
              {isAgreed && (
                <Text style={styles.dateText}>
                  동의일: {formatDate(agreedAt)} · 버전 v{AI_CONSENT_VERSION}
                </Text>
              )}
              {!isAgreed && (
                <Text style={styles.dateText}>
                  AI 레슨 기록 기능을 사용하려면 AI 레슨 기록 화면에서 동의해주세요.
                </Text>
              )}
            </View>

            {/* 동의서 전문 보기 */}
            <TouchableOpacity style={styles.fullTextBtn} onPress={() => setDetailVisible(true)} activeOpacity={0.7}>
              <Ionicons name="document-text-outline" size={18} color={TERRA} />
              <Text style={styles.fullTextBtnLabel}>동의서 전문 보기</Text>
              <Ionicons name="chevron-forward" size={15} color={Colors.placeholder} />
            </TouchableOpacity>

            {/* 철회 버튼 */}
            {isAgreed && (
              <TouchableOpacity
                style={styles.withdrawBtn}
                onPress={handleWithdraw}
                disabled={withdrawing}
                activeOpacity={0.7}
              >
                {withdrawing
                  ? <ActivityIndicator size="small" color={Colors.destructive} />
                  : <Text style={styles.withdrawBtnText}>동의 철회</Text>
                }
              </TouchableOpacity>
            )}

            <Text style={styles.note}>
              동의를 철회해도 기존에 생성된 레슨 기록은 삭제되지 않습니다.
              기록 삭제를 원하시면 고객지원으로 문의해주세요.
            </Text>
          </>
        )}
      </ScrollView>

      {/* 전문 모달 */}
      <Modal visible={detailVisible} animationType="slide" transparent onRequestClose={() => setDetailVisible(false)}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.sheet}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>AI 음성 분석 동의서 전문</Text>
              <TouchableOpacity onPress={() => setDetailVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.detailBody}>{CONSENT_FULL_TEXT}</Text>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F0E9' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },

  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 20, padding: 20,
    marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusText: { fontSize: 16, fontWeight: '700', color: DARK },
  statusTextMuted: { color: Colors.mutedFg },
  dateText: { fontSize: 13, color: Colors.mutedFg, lineHeight: 20 },

  fullTextBtn: {
    backgroundColor: '#fff',
    borderRadius: 20, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  fullTextBtnLabel: { flex: 1, fontSize: 15, color: DARK, fontWeight: '500' },

  withdrawBtn: {
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.destructive,
    marginBottom: 16,
  },
  withdrawBtnText: { fontSize: 15, fontWeight: '700', color: Colors.destructive },

  note: {
    fontSize: 12, color: Colors.mutedFg, lineHeight: 18, textAlign: 'center',
  },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  detailTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  detailContent: { padding: 20 },
  detailBody: { fontSize: 13, color: Colors.foreground, lineHeight: 22 },
});
