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

const CONSENT_FULL_TEXT = `KERRI 음성 녹음 및 AI 레슨 기록 처리 동의서
시행일: 2026년 10월 15일 / 버전: v${AI_CONSENT_VERSION}

[1. 녹음 및 처리 대상]
KERRI 코치앱을 사용하는 코치가 AI 레슨 기록을 만들기 위해 녹음을 시작합니다.
녹음에는 코치의 지도 내용·피드백, 회원의 질문과 답변, 레슨 중 다룬 기술·자세·목표·연습 내용, 코치가 직접 입력한 레슨 메모, 레슨 중 언급된 통증·부상·신체 상태, 주변 사람의 음성이 우연히 포함된 내용이 포함될 수 있습니다.
코치는 녹음 시작 전에 해당 회원 또는 법정대리인에게 녹음과 AI 처리 사실을 안내하고 동의 여부를 확인해야 합니다.

[2. 처리하는 정보]
코치와 회원의 음성, 음성을 텍스트로 변환한 전사문, 코치가 직접 입력한 레슨 메모, 회원 이름 또는 회원 식별번호, 레슨 일시 및 레슨 정보, AI가 생성한 레슨 요약, 잘한 점·개선점·다음 연습 방향, 레슨 중 언급될 수 있는 통증·부상·신체 상태 등의 건강 관련 정보.

[3. 처리 목적]
음성 텍스트 변환, 핵심 내용 추출, 코칭 내용과 연습 과제 정리, 레슨 기록 관리, 코치 확인 후 회원에게 전달, 기능 오류 확인 및 품질 유지. 별도 동의 없이 광고 소재나 범용 AI 모델 학습에 사용하지 않습니다.

[4. AI 레슨 기록 생성 과정]
1) 코치가 코치앱에서 녹음 시작
2) 암호화된 네트워크로 서버 전송
3) 음성인식 기술로 텍스트 변환
4) AI가 레슨 관련 내용 추출·정리
5) 레슨 요약·잘한 점·개선점·다음 연습 방향 생성
6) 코치가 확인하고 필요 시 수정
7) 코치가 직접 전송한 경우에만 회원에게 공유
AI가 만든 레슨 기록은 회원에게 자동으로 전송되지 않습니다.

[5. 사적인 대화와 주변 음성]
레슨과 관계없는 사적인 대화나 주변 음성이 우연히 녹음될 수 있습니다. KERRI는 이를 최종 기록에 포함하지 않도록 처리하지만, 구분 과정에서 해당 음성이 일시적으로 전송·변환·분석될 수 있습니다. 주변 사람의 신원 확인이나 사적인 대화 분석 목적으로 음성을 사용하지 않습니다.

[6. 건강·부상 관련 정보]
통증·부상·신체 상태 관련 정보는 레슨 내용 정리, 운동 강도·연습 방향 기록, 다음 레슨 참고 목적으로만 처리합니다. 의료 진단이나 치료 목적으로 사용하지 않으며, AI 결과는 의료인의 전문 판단을 대신하지 않습니다.

[7. 외부 서비스 및 국외 처리]
• Supabase Pte. Ltd.: 음성 파일 및 서비스 데이터 저장·처리 / 이전 국가: 미국(및 운영 리전) / 보관: KERRI 정책 또는 이용자 삭제 시까지
• OpenAI, L.L.C.: 음성 텍스트 변환 및 레슨 내용 처리 / 이전 국가: 미국 / 보관: API 처리 완료 후 삭제, 오남용 방지 목적 최대 30일
• Anthropic, PBC: 레슨 내용 정리 및 AI 레슨 기록 생성 / 이전 국가: 미국 / 보관: API 처리 정책 및 KERRI에 적용된 계약·설정에 따른 기간
국외 이전에 동의하지 않으면 AI 레슨 기록 기능을 이용할 수 없지만 일반 기능은 계속 이용할 수 있습니다.

[8. 보관 및 삭제 기간]
• 원본 음성: 처리 완료 후 최대 7일 이내 삭제
• 전사문: 생성일로부터 최대 14일 이내 삭제
• 완성된 AI 레슨 기록: 이용자 또는 계정 삭제 시까지
• 동의 이력: 분쟁 대응에 필요한 기간 동안 보관

[9. AI 결과의 한계]
음성 오인식, 누락·과장, 의도와 다른 표현, 문맥 오해가 발생할 수 있습니다. 코치는 전달 전 반드시 확인하고 수정해야 합니다.

[10. 현장 구두 동의]
회원앱 미설치 회원도 현장에서 구두로 동의할 수 있습니다. 코치는 녹음 전 "레슨 내용 AI 정리를 위해 음성이 녹음되며 최대 7일 이내 삭제됩니다. 동의하시나요?"를 안내하고 직접 확인한 경우에만 앱에서 확인을 완료할 수 있습니다.

[11. 만 14세 미만 회원]
법정대리인 동의가 확인된 경우에만 기능 이용 가능. 보호자 동의 미확인 시 녹음·업로드·AI 처리 불가.

[12. 동의 거부 및 철회]
동의하지 않아도 일반 기능 이용 가능. 동의 후 언제든지 철회 가능 (코치: 설정 → 개인정보 및 약관 / 회원: 회원앱 동의 관리 또는 고객지원).

[13. 동의 내용 변경]
처리 목적·업체·보관기간 등 중요 내용 변경 시 사전 안내 및 재동의 요청.

운영자: 케리(KERRI) / 대표 정현수 / 문의: hyunsoo@kerri.co.kr`;

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
