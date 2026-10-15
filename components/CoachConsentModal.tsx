import { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  ScrollView, SafeAreaView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/theme';
import { supabase } from '../lib/supabase';

export const AI_CONSENT_VERSION = '1.0';

interface Props {
  visible: boolean;
  onAgree: () => void;
  onDecline: () => void;
}

const INFO_ITEMS = [
  {
    icon: 'mic-outline' as const,
    text: '레슨 음성을 텍스트로 변환해요',
  },
  {
    icon: 'sparkles-outline' as const,
    text: '레슨과 관계없는 사적인 대화는 기록에서 제외해요',
  },
  {
    icon: 'trash-outline' as const,
    text: '원본 음성은 처리 후 최대 7일 이내 삭제해요',
  },
];

export default function CoachConsentModal({ visible, onAgree, onDecline }: Props) {
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);

  const canAgree = check1 && check2;

  async function handleAgree() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('ai_consents').insert({
      coach_id: user.id,
      consent_type: 'coach',
      consent_status: 'agreed',
      consent_version: AI_CONSENT_VERSION,
      source: 'coach_app',
      agreed_at: new Date().toISOString(),
    });
    onAgree();
  }

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onDecline}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.sheet}>
            <View style={styles.handle} />

            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {/* 헤더 */}
              <Text style={styles.title}>AI 레슨 기록을{'\n'}시작해볼까요?</Text>
              <Text style={styles.desc}>
                레슨 중 코칭 내용을 녹음하면 KERRI가 핵심 내용과 다음 연습 방향을 정리해드려요.
              </Text>

              {/* 핵심 안내 3개 */}
              <View style={styles.infoBox}>
                {INFO_ITEMS.map((item, i) => (
                  <View key={i} style={[styles.infoRow, i < INFO_ITEMS.length - 1 && styles.infoRowBorder]}>
                    <View style={styles.infoIconWrap}>
                      <Ionicons name={item.icon} size={18} color={Colors.primary} />
                    </View>
                    <Text style={styles.infoText}>{item.text}</Text>
                  </View>
                ))}
              </View>

              {/* 추가 안내 */}
              <View style={styles.noteBox}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.mutedFg} />
                <Text style={styles.noteText}>
                  AI가 만든 기록은 자동으로 전송되지 않아요. 코치님이 내용을 확인하고 수정한 후 회원에게 보낼 수 있어요.
                </Text>
              </View>

              {/* 체크박스 */}
              <View style={styles.checkboxSection}>
                <CheckRow
                  checked={check1}
                  onToggle={() => setCheck1(v => !v)}
                  label="[필수] 음성 녹음 및 AI 처리에 동의합니다."
                />
                <CheckRow
                  checked={check2}
                  onToggle={() => setCheck2(v => !v)}
                  label="[필수] 개인정보 국외 이전 및 외부 AI 서비스 처리에 동의합니다."
                />
              </View>

              {/* 자세히 보기 */}
              <TouchableOpacity onPress={() => setDetailVisible(true)} style={styles.detailLink}>
                <Text style={styles.detailLinkText}>자세히 보기</Text>
                <Ionicons name="chevron-forward" size={13} color={Colors.primary} />
              </TouchableOpacity>
            </ScrollView>

            {/* 버튼 */}
            <View style={styles.btnArea}>
              <TouchableOpacity
                style={[styles.agreeBtn, !canAgree && styles.agreeBtnDisabled]}
                onPress={canAgree ? handleAgree : undefined}
                activeOpacity={canAgree ? 0.85 : 1}
              >
                <Text style={[styles.agreeBtnText, !canAgree && styles.agreeBtnTextDisabled]}>
                  동의하고 시작하기
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.declineBtn} onPress={onDecline} activeOpacity={0.7}>
                <Text style={styles.declineBtnText}>지금은 안 할게요</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* 동의서 전문 모달 */}
      <Modal visible={detailVisible} animationType="slide" transparent onRequestClose={() => setDetailVisible(false)}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>AI 레슨 기록 동의서</Text>
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
    </>
  );
}

function CheckRow({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onToggle} activeOpacity={0.7}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const CONSENT_FULL_TEXT = `AI 레슨 기록 서비스 동의서 (버전 ${AI_CONSENT_VERSION})

1. 수집 및 이용 목적
KERRI는 레슨 중 녹음된 음성을 텍스트로 변환(STT)하고, AI를 통해 레슨 내용을 분석하여 코치와 회원에게 레슨 기록을 제공합니다.

2. 수집 항목
• 레슨 중 녹음된 음성 파일
• 음성에서 변환된 텍스트(전사본)
• AI 분석 결과(요약, 개선 포인트, 다음 목표 등)

3. 보유 및 이용 기간
• 원본 음성 파일: 처리 완료 후 최대 7일 이내 삭제
• 텍스트 전사본 및 분석 결과: 서비스 이용 기간 동안 보관

4. 개인정보 국외 이전
음성 처리 과정에서 일부 데이터가 국외(미국 등) 서버로 이전될 수 있습니다.
• OpenAI (STT 처리)
• Anthropic (AI 분석)

5. 동의 거부 권리
동의를 거부하실 수 있으나, 이 경우 AI 레슨 기록 기능을 이용하실 수 없습니다.

6. 동의 철회
언제든지 설정에서 동의를 철회할 수 있습니다. 철회 시 이후 녹음은 처리되지 않으나, 기존 분석 결과는 보관됩니다.`;

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  content: { padding: 24, paddingBottom: 8 },
  title: {
    fontSize: 22, fontWeight: '800', color: Colors.foreground,
    lineHeight: 30, marginBottom: 12,
  },
  desc: {
    fontSize: 14, color: Colors.mutedFg, lineHeight: 22, marginBottom: 20,
  },
  infoBox: {
    backgroundColor: Colors.background,
    borderRadius: 16, overflow: 'hidden',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  infoRowBorder: {
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  infoIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
  },
  infoText: { flex: 1, fontSize: 14, color: Colors.foreground, lineHeight: 20 },
  noteBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: Colors.mutedBg,
    borderRadius: 12, padding: 14, marginBottom: 20,
  },
  noteText: { flex: 1, fontSize: 13, color: Colors.mutedFg, lineHeight: 19 },
  checkboxSection: { gap: 12, marginBottom: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
    marginTop: 1, flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkLabel: { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 20 },
  detailLink: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    alignSelf: 'flex-end', marginBottom: 4,
  },
  detailLinkText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  btnArea: { padding: 20, paddingTop: 12, gap: 8 },
  agreeBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  agreeBtnDisabled: { backgroundColor: Colors.border },
  agreeBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  agreeBtnTextDisabled: { color: Colors.mutedFg },
  declineBtn: { alignItems: 'center', paddingVertical: 10 },
  declineBtnText: { fontSize: 15, color: Colors.mutedFg },
  // 전문 모달
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  detailTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  detailContent: { padding: 20 },
  detailBody: { fontSize: 13, color: Colors.foreground, lineHeight: 22 },
});
