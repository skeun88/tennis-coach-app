import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { Colors } from '../../lib/theme';

const TERRA = '#C0755A';
const DARK = '#3E2B22';
const EFFECTIVE_DATE = '2026년 9월 22일';

const sections: { title: string; body: string }[] = [
  {
    title: '1. 수집하는 개인정보',
    body: `KERRI는 서비스 제공을 위해 다음과 같은 개인정보를 수집합니다.

【코치】
• 계정 정보: 이메일, 소셜 로그인 식별자(네이버/카카오)
• 프로필 정보: 이름, 종목, 활동 지역, 경력 등
• 구독 및 결제 정보: 구독 플랜, 결제 수단 정보(카드 번호는 결제대행사에서 관리)

【코치가 등록한 회원】
• 이름, 연락처(전화번호), 생년월일
• 레슨 관련 정보: 일정, 출결, 레슨권, 납부내역

【멤버앱 이용자】
• 계정 정보: 이메일, 소셜 로그인 식별자
• 스포츠 프로필: 이름, 레벨 등

【공통 — 서비스 이용 중 자동 생성】
• 레슨 일정, 출결, AI 레슨 기록
• 음성 녹음 파일(AI 처리 후 7일 이내 삭제)
• 푸시 알림 토큰
• 서비스 이용 로그`,
  },
  {
    title: '2. 개인정보 이용 목적',
    body: `수집한 개인정보는 아래 목적으로만 사용합니다.

• 회원가입 및 계정 관리: 본인 확인, 중복 가입 방지
• 코치 프로필 및 회원 관리: 레슨 서비스 제공
• 스케줄·출결·레슨권 관리: 수업 일정 및 이력 관리
• 레슨비 납부내역 관리: 결제 및 정산 처리
• AI 레슨 기록 생성: 레슨 음성을 분석하여 레슨 기록 자동 생성
• 코치·회원 간 알림: 일정 알림, 레슨 기록 전송
• 구독 및 유료 기능 제공: 플랜 관리, 결제 처리
• 서비스 보안 및 운영: 이상 접근 탐지, 오류 대응`,
  },
  {
    title: '3. 개인정보 보유기간',
    body: `데이터 종류에 따라 보유기간을 구분합니다.

• 계정 및 프로필 정보: 탈퇴 시까지
• 레슨 기록(최종 리포트): 서비스 이용 중 보관
• 음성 원본: AI 처리 완료 후 7일 이내 자동 삭제
• STT 전사 원문: 레슨 완료 후 14일 이내 자동 삭제
• 결제 관련 기록: 전자상거래법에 따라 5년

탈퇴 후 법적으로 보관이 필요한 정보(결제 기록 등)는 해당 법령에서 정한 기간 동안 별도 보관 후 삭제됩니다.`,
  },
  {
    title: '4. AI 레슨 기록 및 음성 데이터 처리',
    body: `레슨 기록 기능을 이용하면 녹음된 음성이 인공지능 서비스를 통해 처리되어 레슨 기록이 생성됩니다.

처리에 사용된 음성 데이터는 레슨 기록 생성 완료 후 자동으로 삭제되며, 최종 레슨 기록만 보관됩니다.

처리를 위탁받은 업체는 서비스 제공 목적 외의 사용 및 자체 모델 학습에 해당 데이터를 사용하지 않습니다.`,
  },
  {
    title: '5. 개인정보 처리위탁',
    body: `KERRI는 서비스 운영을 위해 아래 업체에 개인정보 처리를 위탁합니다.

• Supabase Inc. — 서비스 인프라 운영
• OpenAI, L.L.C. — AI 기반 서비스 운영
• Anthropic PBC — AI 기반 서비스 운영
• RevenueCat Inc. — 구독 및 결제 관리
• Apple Inc. / Google LLC — 앱 배포 및 결제 처리

각 위탁업체는 위탁 목적 외 개인정보 처리가 금지되며, 개인정보보호법에 따른 보호 조치 의무를 집니다.`,
  },
  {
    title: '6. 개인정보 국외이전',
    body: `위 위탁업체는 모두 미국 소재 기업으로, 개인정보가 대한민국 외부(미국)로 이전됩니다.

• Supabase Inc. (미국): 서비스 운영에 필요한 데이터
• OpenAI, L.L.C. (미국): AI 서비스 운영에 필요한 데이터
• Anthropic PBC (미국): AI 서비스 운영에 필요한 데이터
• RevenueCat Inc. (미국): 구독 및 결제 관련 정보

이전 시기: 서비스 이용 중 실시간 이전
보유기간: 각 서비스 계약 기간 및 위탁 목적 달성 시까지`,
  },
  {
    title: '7. 만 14세 미만 아동 개인정보',
    body: `KERRI는 만 14세 미만 아동의 개인정보 보호를 위해 별도의 절차를 운영합니다.

코치가 만 14세 미만 회원을 등록하는 경우, 보호자의 동의를 확인하는 절차를 거쳐야 합니다. 보호자 동의 확인 전에는 해당 회원의 AI 레슨 기록 생성 등 일부 기능 이용이 제한됩니다.

만 14세 미만으로 확인된 경우, 보호자(법정대리인)가 아동의 개인정보 열람·수정·삭제를 요청할 수 있습니다.`,
  },
  {
    title: '8. 계정 삭제 및 개인정보 파기',
    body: `계정을 삭제하면 아래 데이터가 즉시 영구 삭제됩니다.

• 계정 및 프로필 정보
• 등록한 회원 정보 및 개인정보
• 레슨 기록, AI 분석 리포트
• STT 및 음성 데이터
• 저장된 모든 파일
• 푸시 알림 토큰

단, 전자상거래법 등 관계 법령에 따라 보관 의무가 있는 결제 기록은 법정 보관기간(5년) 동안 별도 보관 후 삭제됩니다.`,
  },
  {
    title: '9. 이용자의 개인정보 관련 권리',
    body: `이용자는 언제든지 아래 권리를 행사할 수 있습니다.

• 개인정보 열람: 수집·이용 중인 개인정보 확인 요청
• 개인정보 수정: 부정확한 정보 정정 요청
• 개인정보 삭제: 특정 개인정보 삭제 요청
• 계정 탈퇴: 앱 설정 > 계정 삭제에서 직접 처리
• 동의 철회: 수집·이용 동의 철회 가능 (단, 서비스 이용 제한 가능)
• 처리정지 요청: 특정 개인정보 처리의 정지 요청

요청 방법: 앱 설정 > 문의하기 또는 아래 개인정보 보호책임자 이메일로 연락`,
  },
  {
    title: '10. 개인정보 보호 및 책임자',
    body: `KERRI는 개인정보보호를 위해 아래 기술적·관리적 조치를 취합니다.

• 개인정보 접근 권한을 최소화하고, 권한 변경 이력 관리
• SSL/TLS 암호화 전송
• 접근 권한 기반의 데이터 보호 체계 운영
• 개인정보 처리 시스템 접근 로그 기록 및 감시

개인정보 보호책임자:
• 이름: 정현수 (CEO)
• 이메일: hyunsoo@kerri.co.kr

개인정보 관련 문의, 불만, 피해 구제 신청은 hyunsoo@kerri.co.kr 로 접수하며, 영업일 기준 3일 이내 답변드립니다.

개인정보침해 관련 신고·상담은 개인정보보호위원회(www.pipc.go.kr, 국번없이 182)에 문의하실 수 있습니다.`,
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <>
      <Stack.Screen options={{ title: '개인정보 처리방침', headerShown: true, headerBackTitle: '뒤로' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.effectiveDate}>시행일: {EFFECTIVE_DATE}</Text>
        {sections.map((s) => (
          <View key={s.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <Text style={styles.sectionBody}>{s.body}</Text>
          </View>
        ))}
        <Text style={styles.footer}>KERRI 개인정보 처리방침 v1.0</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 60 },
  effectiveDate: {
    fontSize: 13,
    color: Colors.mutedFg,
    marginBottom: 20,
    textAlign: 'right',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TERRA,
    marginBottom: 10,
  },
  sectionBody: {
    fontSize: 14,
    color: DARK,
    lineHeight: 22,
  },
  footer: {
    fontSize: 12,
    color: Colors.mutedFg,
    textAlign: 'center',
    marginTop: 8,
  },
});
