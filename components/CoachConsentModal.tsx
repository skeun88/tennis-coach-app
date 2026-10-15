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

  function toggleAll() {
    const next = !(check1 && check2);
    setCheck1(next);
    setCheck2(next);
  }

  async function handleAgree() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const now = new Date().toISOString();
    await supabase.from('ai_consents').insert([
      {
        coach_id: user.id,
        consent_type: 'coach_voice_ai',
        consent_status: 'agreed',
        consent_version: AI_CONSENT_VERSION,
        consent_method: 'app',
        source: 'coach_app',
        agreed_at: now,
      },
      {
        coach_id: user.id,
        consent_type: 'international_transfer',
        consent_status: 'agreed',
        consent_version: AI_CONSENT_VERSION,
        consent_method: 'app',
        source: 'coach_app',
        agreed_at: now,
      },
    ]);
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
                {/* 전체 동의 */}
                <TouchableOpacity style={[styles.checkRow, styles.allCheckRow]} onPress={toggleAll} activeOpacity={0.7}>
                  <View style={[styles.checkbox, canAgree && styles.checkboxChecked]}>
                    {canAgree && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <Text style={styles.allCheckLabel}>전체 동의</Text>
                </TouchableOpacity>
                <View style={styles.divider} />
                <CheckRow
                  checked={check1}
                  onToggle={() => setCheck1(v => !v)}
                  label="[AI 레슨 기록 이용 시 필수] 본인의 음성 녹음 및 AI 처리"
                />
                <CheckRow
                  checked={check2}
                  onToggle={() => setCheck2(v => !v)}
                  label="[AI 레슨 기록 이용 시 필수] 개인정보 국외 이전 및 외부 AI 서비스 처리"
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

export const CONSENT_FULL_TEXT = `KERRI AI 음성 분석 및 레슨 기록 처리 동의서
시행일: 2026년 10월 15일 / 버전: v${AI_CONSENT_VERSION}
운영자: 케리(KERRI) / 대표 정현수 / 문의: hyunsoo@kerri.co.kr

KERRI는 스포츠 레슨 중 녹음된 음성을 인공지능으로 분석하여 코치와 회원이 레슨 내용을 다시 확인할 수 있는 AI 레슨 기록 기능을 제공합니다.
본 동의는 AI 레슨 기록 기능을 이용하기 위한 동의입니다. 동의하지 않아도 회원 관리, 일정, 출결, 레슨권 및 결제 등 KERRI의 일반 기능은 이용할 수 있습니다.

[1. 처리하는 정보]
KERRI는 AI 레슨 기록을 만들기 위해 다음 정보를 처리할 수 있습니다.
• 레슨 중 녹음된 코치와 회원의 음성
• 음성을 텍스트로 변환한 전사문
• 코치가 직접 입력한 레슨 메모
• 회원 식별정보와 레슨 일시
• 레슨 중 다룬 기술, 자세, 목표 및 코칭 내용
• AI가 생성한 레슨 요약, 잘한 점, 개선점 및 연습 방향
• 레슨 중 언급될 수 있는 통증·부상·신체 상태 등의 건강 관련 정보
KERRI는 AI 레슨 기록 생성에 필요한 범위에서만 정보를 처리합니다.

[2. 이용 목적]
처리된 정보는 다음 목적으로 이용합니다.
• 녹음된 음성을 텍스트로 변환
• 레슨과 관련된 핵심 내용 추출
• 코칭 내용과 회원의 연습 과제 정리
• 잘한 점, 개선점 및 다음 연습 방향 생성
• 코치와 회원의 레슨 기록 관리
• 코치가 확인한 레슨 기록을 회원에게 전달
별도의 동의 없이 음성, 전사문 또는 AI 레슨 기록을 광고 소재나 범용 AI 모델 학습에 사용하지 않습니다.

[3. AI 처리 및 회원 공유]
AI 레슨 기록은 다음 과정으로 생성됩니다.
1) 코치가 KERRI 코치앱에서 녹음을 시작합니다.
2) 녹음된 음성이 암호화된 네트워크를 통해 서버로 전송됩니다.
3) 음성인식 기술이 음성을 텍스트로 변환합니다.
4) AI가 레슨과 관련된 내용을 추출하고 정리합니다.
5) 레슨 요약, 잘한 점, 개선점 및 연습 방향을 생성합니다.
6) 코치가 생성된 내용을 확인하고 필요한 경우 수정합니다.
7) 코치가 직접 전송한 경우에만 회원에게 공유됩니다.
AI가 생성한 레슨 기록은 회원에게 자동으로 전송되지 않습니다.

[4. 사적인 대화와 건강 관련 정보]
레슨 과정에서 레슨과 관계없는 사적인 대화나 주변 사람의 음성이 우연히 포함될 수 있습니다.
KERRI는 레슨과 관계없는 사적인 대화를 최종 레슨 기록에서 제외하도록 처리합니다. 다만 레슨 내용과 사적인 대화를 구분하는 과정에서 해당 음성이 일시적으로 전송·변환·분석될 수 있습니다.
스포츠 레슨의 특성상 통증, 부상, 신체 상태 또는 운동 제한에 관한 정보가 포함될 수 있습니다. 해당 정보는 레슨 내용 정리와 다음 코칭 방향 제공을 위해서만 처리하며, 의료 진단이나 치료 목적으로 사용하지 않습니다.
코치는 녹음을 시작하기 전에 회원에게 다음 내용을 각각 안내하고 동의 여부를 확인해야 합니다.
• 레슨 음성의 녹음 및 AI 처리
• 통증·부상 등 건강 관련 정보가 포함될 가능성
• 외부 AI 서비스를 통한 국외 처리
• 원본 음성의 보관 및 삭제 기간
코치와 회원은 고의로 제3자의 대화나 서비스 목적과 관계없는 음성을 녹음하거나 업로드해서는 안 됩니다.

[5. 외부 서비스 및 국외 처리]
KERRI는 음성 저장, 음성인식 및 AI 레슨 기록 생성을 위해 다음 외부 서비스를 이용할 수 있습니다.

Supabase
• 처리업체: Supabase Pte. Ltd. 및 관련 운영업체
• 처리 목적: 음성 파일 및 서비스 데이터 저장·처리
• 처리 정보: 음성 파일, 전사문, 회원 식별정보 및 AI 결과
• 처리 지역: KERRI 프로젝트에 설정된 저장 지역과 서비스 운영·지원 지역
• 이전 방법: 기능 이용 시 암호화된 네트워크를 통해 전송
• 보관기간: KERRI가 정한 보관기간 또는 이용자가 삭제할 때까지

OpenAI
• 처리업체: OpenAI, L.L.C.
• 이전 국가: 미국
• 처리 목적: 음성의 텍스트 변환 및 레슨 내용 처리
• 처리 정보: 음성 파일, 전사문 및 레슨 메모
• 이전 방법: AI 레슨 기록 생성 시 암호화된 네트워크를 통해 전송
• 보관기간: 처리 완료 후 삭제되며, 서비스 제공과 오남용 방지를 위해 최대 30일간 보관될 수 있음

Anthropic
• 처리업체: Anthropic, PBC
• 이전 국가: 미국
• 처리 목적: 레슨 내용 정리 및 AI 레슨 기록 생성
• 처리 정보: 전사문, 레슨 메모 및 AI 처리 결과
• 이전 방법: AI 레슨 기록 생성 시 암호화된 네트워크를 통해 전송
• 보관기간: 처리 완료 후 삭제되며, 서비스 제공과 안전 관리를 위해 최대 30일간 보관될 수 있음

외부 서비스 제공업체가 KERRI의 요청 범위를 벗어나 정보를 광고 또는 범용 AI 모델 학습에 사용하지 않도록 계약 및 기술적 설정을 적용합니다.
국외 처리에 동의하지 않으면 AI 레슨 기록 기능은 이용할 수 없지만 KERRI의 일반 기능은 계속 이용할 수 있습니다.

[6. 보관 및 삭제 기간]
• 원본 음성: AI 처리 완료 후 최대 7일 이내 삭제
• 음성에서 변환된 전사문: 생성일로부터 최대 14일 이내 삭제
• 완성된 AI 레슨 기록: 이용자가 삭제하거나 관련 계정을 삭제할 때까지
• 동의 이력: 동의 사실 확인과 분쟁 대응에 필요한 기간
보관기간이 끝나거나 처리 목적이 달성된 정보는 복구하기 어려운 방법으로 삭제합니다.

[7. 회원의 현장 구두 동의]
회원앱을 설치하지 않은 회원도 현장에서 구두로 동의할 수 있습니다.
코치는 회원별 최초 녹음 전에 다음 내용을 안내하고 회원의 동의 의사를 확인해야 합니다.
"레슨 음성이 AI 레슨 기록 생성에 사용되고, 통증·부상 등의 레슨 정보가 포함될 수 있습니다. 정보는 외부 AI 서비스를 통해 처리될 수 있으며 원본 음성은 처리 후 최대 7일 이내 삭제됩니다. 기록을 진행해도 괜찮으세요?"
회원의 동의를 확인한 코치는 앱에서 '동의 확인했어요'를 선택합니다.

[8. 만 14세 미만 회원]
만 14세 미만 회원은 법정대리인의 동의와 법정대리인 여부가 확인된 경우에만 AI 레슨 기록 기능을 이용할 수 있습니다.
보호자 동의가 확인되지 않으면 해당 회원의 녹음, 음성 업로드 및 AI 처리를 시작할 수 없습니다.

[9. AI 결과의 한계]
AI 레슨 기록에는 음성 인식 오류, 내용 누락·과장, 코치/회원의 의도와 다른 표현, 문맥 오해가 발생할 수 있습니다.
코치는 회원에게 전달하기 전에 AI가 생성한 내용을 확인하고 필요한 경우 수정해야 합니다.
AI 레슨 기록은 의료인의 판단을 대신하지 않으며 특정 운동 성과, 실력 향상 또는 부상 방지를 보장하지 않습니다.

[10. 동의 거부 및 철회]
본 동의는 AI 레슨 기록 기능 이용 시 필요합니다.
동의하지 않으면 음성 기반 AI 레슨 기록 기능은 이용할 수 없지만, 일반 기능은 계속 이용할 수 있습니다.
동의 후에도 언제든지 철회할 수 있습니다.
• 코치: 설정 → 개인정보 및 약관 → AI 음성 분석 동의
• 회원앱 이용 회원: 회원앱의 동의 관리
• 회원앱 미설치 회원: 담당 코치 또는 KERRI 고객지원
동의를 철회하면 새로운 녹음, 음성 업로드 및 AI 레슨 기록 생성이 중단됩니다.

[11. 동의 내용 변경]
처리 목적, 처리업체, 보관기간 등 중요한 내용이 변경되면 변경 내용을 알리고 필요한 경우 다시 동의를 받습니다.`;

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
  allCheckRow: { alignItems: 'center' },
  allCheckLabel: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
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
