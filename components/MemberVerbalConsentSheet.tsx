import { View, Text, StyleSheet, Modal, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Colors } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { AI_CONSENT_VERSION } from './CoachConsentModal';

interface Props {
  visible: boolean;
  memberName: string;
  memberId: string;
  coachId: string;
  isMinor: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

async function insertVerbalConsents(memberId: string): Promise<void> {
  // coachId는 prop 대신 auth에서 직접 가져옴 (race condition/stale prop 방지)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('인증 정보를 확인할 수 없습니다.');

  const now = new Date().toISOString();
  const payload = {
    consent_status: 'agreed',
    consent_version: AI_CONSENT_VERSION,
    consent_method: 'verbal',
    source: 'coach_app',
    agreed_at: now,
    consent_type: 'member',
    member_id: memberId,
    coach_id: user.id,
  };

  // 이미 agreed 동의가 있으면 중복 삽입 생략
  const { data: existing } = await supabase
    .from('ai_consents')
    .select('id')
    .eq('coach_id', user.id)
    .eq('member_id', memberId)
    .eq('consent_type', 'member')
    .eq('consent_status', 'agreed')
    .limit(1)
    .maybeSingle();

  if (existing) return;

  const { error } = await supabase.from('ai_consents').insert(payload);
  if (error) {
    console.error('[MemberVerbalConsent] insert error:', JSON.stringify(error));
    throw error;
  }
}

export default function MemberVerbalConsentSheet({
  visible, memberName, memberId, coachId, isMinor, onConfirm, onCancel,
}: Props) {
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      await insertVerbalConsents(memberId);
    } catch (e: any) {
      // DB 실패해도 구두 동의는 확인된 것으로 처리 (UX 우선)
      // 에러는 로깅해서 추적 가능하게 유지
      console.error('[MemberVerbalConsent] handleConfirm error:', e?.message ?? e);
    } finally {
      setSaving(false);
    }
    onConfirm();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.content}>
            <View style={styles.iconWrap}>
              <Ionicons
                name={isMinor ? 'alert-circle-outline' : 'mic-outline'}
                size={36}
                color={Colors.primary}
              />
            </View>

            {isMinor ? (
              <>
                <Text style={styles.title}>보호자 동의가 필요해요</Text>
                <Text style={styles.desc}>
                  {memberName || '이 회원'}은 만 14세 미만입니다.{'\n\n'}
                  현재 앱에서 보호자 동의 기능을 준비 중입니다.{'\n'}
                  보호자 동의 기능이 준비되면 안내드릴게요.
                </Text>
                <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
                  <Text style={styles.cancelBtnText}>확인</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.title}>회원에게 확인했나요?</Text>
                <Text style={styles.desc}>
                  레슨 음성이 AI 기록 생성에 사용되고, 통증·부상 등 레슨 정보가 포함될 수 있으며 원본은 최대 7일 이내 삭제된다고 안내해주세요.
                </Text>

                <TouchableOpacity
                  style={[styles.confirmBtn, saving && styles.btnDisabled]}
                  onPress={saving ? undefined : handleConfirm}
                  activeOpacity={0.85}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.confirmBtnText}>동의 확인했어요</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
                  <Text style={styles.cancelBtnText}>취소</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  content: { padding: 24, paddingBottom: 36, alignItems: 'center' },
  iconWrap: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20, fontWeight: '800', color: Colors.foreground,
    marginBottom: 12, textAlign: 'center',
  },
  desc: {
    fontSize: 14, color: Colors.mutedFg, lineHeight: 22,
    textAlign: 'center', marginBottom: 24,
  },
  confirmBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    paddingVertical: 16, width: '100%', alignItems: 'center', marginBottom: 10,
  },
  btnDisabled: { opacity: 0.6 },
  confirmBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  cancelBtn: { paddingVertical: 10 },
  cancelBtnText: { fontSize: 15, color: Colors.mutedFg },
});
