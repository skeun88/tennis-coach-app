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

async function insertVerbalConsents(coachId: string, memberId: string): Promise<void> {
  const now = new Date().toISOString();
  const base = {
    consent_status: 'agreed',
    consent_version: AI_CONSENT_VERSION,
    consent_method: 'verbal',
    source: 'coach_app',
    agreed_at: now,
  };

  const { error } = await supabase.from('ai_consents').insert([
    { ...base, consent_type: 'coach_voice_ai', coach_id: coachId },
    { ...base, consent_type: 'member_voice_ai', member_id: memberId, coach_id: coachId },
    { ...base, consent_type: 'member_health_info', member_id: memberId, coach_id: coachId },
    { ...base, consent_type: 'international_transfer', coach_id: coachId, member_id: memberId },
  ]);
  if (error) throw error;
}

export default function MemberVerbalConsentSheet({
  visible, memberName, memberId, coachId, isMinor, onConfirm, onCancel,
}: Props) {
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      await insertVerbalConsents(coachId, memberId);
      onConfirm();
    } catch {
      // 저장 실패 시 취소 처리
      onCancel();
    } finally {
      setSaving(false);
    }
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
