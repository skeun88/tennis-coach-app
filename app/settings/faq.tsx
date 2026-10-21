import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';

const TERRA = '#C0755A';

type FAQItem = { q: string; a: string };
type FAQSection = { title: string; icon: string; items: FAQItem[] };

const FAQ_SECTIONS: FAQSection[] = [
  {
    title: 'AI 레슨 리포트',
    icon: 'mic-outline',
    items: [
      {
        q: 'AI 레슨 리포트가 뭔가요?',
        a: '레슨이 끝난 후 코치가 음성이나 텍스트로 오늘 레슨 내용을 기록하면, KERRI AI가 이를 분석해서 전문적인 리포트를 자동으로 만들어주는 기능이에요. 회원에게 오늘 배운 내용, 잘한 점, 보완할 점, 다음 숙제까지 깔끔하게 정리해서 보낼 수 있어요.',
      },
      {
        q: '핀마이크가 꼭 필요한가요?',
        a: '필수는 아니에요. 휴대폰 마이크나 이어폰으로도 충분히 녹음할 수 있어요. 다만 테니스 코트처럼 야외나 소음이 있는 환경에서는 핀마이크를 사용하면 음성 인식 정확도가 크게 올라가요. 예산이 된다면 DJI Mic Mini(약 12만원)가 가성비 최고예요.',
      },
      {
        q: '녹음은 얼마나 해야 하나요?',
        a: '최소 10초 이상이면 리포트 생성이 가능해요. 30초~1분 정도면 충분히 좋은 리포트가 나와요. 너무 길게 말할 필요 없고, 핵심 내용만 간결하게 말씀해주세요.',
      },
      {
        q: '레슨 후 음성 기록, 어떻게 말하면 되나요?',
        a: '레슨 끝나고 30초 정도 자연스럽게 말하면 돼요.\n\n① 오늘 연습한 기술\n② 잘된 점\n③ 보완할 점\n④ 다음 숙제\n⑤ 다음 레슨 계획\n\n예: "오늘은 포핸드 크로스 연습을 했는데요, 스윙 속도가 많이 올라왔어요. 다만 타점이 아직 앞에서 맞지 않아서 다음에도 집중해야 할 것 같아요. 숙제는 벽 치기 20분, 다음 레슨은 네트 플레이 시작할게요."',
      },
      {
        q: '음성이 잘 인식되지 않아요.',
        a: '아래를 확인해보세요:\n• 앱에서 마이크 권한 허용 (설정 → KERRI → 마이크)\n• 주변 소음 최소화\n• 마이크와 10~15cm 거리 유지\n• 인터넷 연결 확인 (음성 인식은 서버에서 처리돼요)\n\n문제가 계속되면 hyunsoo@kerri.co.kr 로 문의해주세요.',
      },
      {
        q: 'AI 리포트가 이상하게 생성됐어요.',
        a: '주변 소음이 너무 많거나, 기록 내용이 너무 짧거나, 전문 용어를 너무 많이 쓴 경우에 발생해요. 조용한 곳에서 좀 더 구체적으로 자연스럽게 다시 기록해보세요. 문제가 계속되면 hyunsoo@kerri.co.kr 로 문의해주세요.',
      },
      {
        q: '좋은 리포트를 만들려면 어떻게 해야 하나요?',
        a: '5가지 비결:\n① 구체적으로 말하기 — "포핸드 잘 됐어요"보다 "포핸드 크로스에서 드라이브 회전이 안정적으로 나왔어요"가 훨씬 좋아요.\n② 기술 이름 언급하기 — 포핸드, 백핸드, 서브, 발리 등 구체적 기술명 포함\n③ 수준에 맞게 설명하기\n④ 숙제를 명확히\n⑤ 다음 목표 포함',
      },
      {
        q: '레슨 리포트를 회원에게 어떻게 보내나요?',
        a: 'AI 리포트가 생성된 후 "회원에게 공유" 버튼을 탭하면 돼요. 회원의 KERRI 앱으로 바로 전송되거나, 링크를 복사해서 카카오톡이나 문자로 보낼 수 있어요.',
      },
      {
        q: '텍스트로 레슨 리포트를 만들 수 있나요?',
        a: '네, 가능해요! 음성 녹음 대신 텍스트 입력을 선택하면 돼요. "오늘 내용: 포핸드 스트로크 / 잘된 점: 라켓 헤드 속도 향상 / 보완할 점: 스플릿 스텝 타이밍 / 숙제: 스텝 연습 5분씩" 이런 식으로 키워드만 넣어도 충분해요.',
      },
    ],
  },
  {
    title: 'KERRI 도우미',
    icon: 'chatbubble-ellipses-outline',
    items: [
      {
        q: 'KERRI 도우미는 무엇인가요?',
        a: '하단 탭의 "KERRI 도우미"는 AI 챗봇이에요. 앱 사용법부터 레슨 플랜, 드릴 추천, 테니스 이론까지 무엇이든 대화형으로 물어볼 수 있어요. 참고 자료를 활용할 때는 출처도 함께 알려줍니다.',
      },
      {
        q: '어떤 것을 물어볼 수 있나요?',
        a: '• 앱 사용법 ("미납 알림은 어떻게 확인하나요?")\n• 레슨 플랜 ("입문자용 포핸드 레슨 플랜 알려줘")\n• 드릴 추천 ("서브 속도를 높이는 드릴 추천해줘")\n• 테니스 이론 ("랠리 전술 훈련 방법이 궁금해요")\n• 코칭 관련 모든 질문',
      },
    ],
  },
  {
    title: '홈 탭',
    icon: 'home-outline',
    items: [
      {
        q: '홈 화면에서 어떤 정보를 볼 수 있나요?',
        a: '전체 회원 수, 미납 회원 수, 만료 예정 회원 수를 한눈에 확인할 수 있어요. 오늘의 레슨 카드에서 바로 출결 체크도 가능합니다.',
      },
      {
        q: '미납/만료예정 배지는 어떻게 작동하나요?',
        a: '• 미납: 미납 금액이 있는 회원 수를 빨간 숫자로 표시합니다.\n• 만료예정: 레슨 크레딧이 곧 소진되는 회원 수를 주황 숫자로 표시합니다.\n각 배지를 탭하면 해당 회원 목록이 바로 나와요.',
      },
      {
        q: '이탈 위험 회원이란 무엇인가요?',
        a: '최근 레슨이 뜸해지거나, 크레딧이 부족한 회원을 AI가 감지해서 홈 화면에 표시해줍니다. 이탈 전에 미리 연락하거나 레슨을 제안할 수 있어요.',
      },
      {
        q: '자동 레슨 생성이란 무엇인가요?',
        a: '고정 스케줄이 설정된 회원에 대해 레슨을 자동으로 생성할 수 있도록 제안해드립니다. 홈 화면에서 제안을 확인하고 바로 적용할 수 있어요.',
      },
    ],
  },
  {
    title: '회원 탭',
    icon: 'people-outline',
    items: [
      {
        q: '회원을 어떻게 검색하나요?',
        a: '회원 탭 상단 검색창에서 이름 또는 전화번호로 검색할 수 있어요.',
      },
      {
        q: '활성/비활성 회원을 구분해서 볼 수 있나요?',
        a: '네, 회원 목록 상단 필터에서 활성/비활성을 전환할 수 있습니다.',
      },
      {
        q: '회원을 어떻게 등록하나요?',
        a: '회원 탭 우측 상단 + 버튼을 탭하세요. 등록 흐름:\n① 기본 정보 (이름·전화번호)\n② 레슨권 선택 또는 새 레슨권 바로 만들기\n③ 일정 설정 (매주 요일 / 날짜 직접 선택 / 나중에 설정)\n④ 등록 요약 확인 후 저장',
      },
      {
        q: '레슨권을 등록 화면에서 바로 만들 수 있나요?',
        a: '네! 회원 등록 중 "＋ 새 레슨권 만들기"를 탭하면 바텀시트로 레슨권을 바로 생성할 수 있어요. 생성 완료 시 자동으로 선택되고, 입력한 회원 정보는 그대로 유지돼요.',
      },
      {
        q: '회원 상세 페이지에서 어떤 정보를 관리할 수 있나요?',
        a: '회원 상세 페이지는 4개 탭으로 구성되어 있어요:\n• 정보: 이름, 전화번호, 이메일, 가입일, 레벨, 고정 스케줄, 레슨 크레딧\n• 출결: 최근 출결 이력 (최대 20건)\n• 결제: 해당 회원의 결제 이력\n• 노트: 코치가 작성한 개인 메모',
      },
      {
        q: '회원 레벨은 어떻게 구분되나요?',
        a: '입문 / 초급 / 중급 / 상급 / 선수 5단계로 구분됩니다. 등록 시 선택하지 않으면 저장되지 않아요.',
      },
      {
        q: '고정 스케줄은 어떻게 설정하나요?',
        a: '회원 등록 시 또는 회원 정보 탭에서 요일 + 시작 시간 + 레슨 시간을 설정하면 됩니다. 요일마다 다른 시간(예: 월요일 19:00, 목요일 20:00)도 설정 가능해요.',
      },
      {
        q: '레슨 크레딧은 어떻게 관리하나요?',
        a: '회원 정보 탭에서 전체 크레딧과 잔여 크레딧을 확인하고 수정할 수 있습니다. 출결 처리 시 자동으로 크레딧이 차감됩니다.',
      },
      {
        q: 'AI 레슨 분석은 무엇인가요?',
        a: '회원 상세 페이지에서 AI 레슨 분석 버튼을 누르면 해당 회원의 출결, 노트 등을 기반으로 AI가 분석 결과를 제공합니다. 플랜에 따라 월 사용 횟수 제한이 있어요.',
      },
      {
        q: '회원을 비활성화하면 어떻게 되나요?',
        a: '비활성 상태로 전환되어 기본 목록에서는 숨겨지지만 데이터는 유지됩니다. 필터를 통해 비활성 회원도 조회 가능합니다.',
      },
    ],
  },
  {
    title: '스케줄 탭',
    icon: 'calendar-outline',
    items: [
      {
        q: '스케줄을 어떻게 확인하나요?',
        a: '일별 보기(7일 날짜 바에서 날짜 선택) 또는 주별 보기(월~일 그리드)로 전환해서 확인할 수 있어요.',
      },
      {
        q: '회원이 레슨을 예약 요청하면 어떻게 되나요?',
        a: '회원 앱에서 보낸 레슨 예약 요청은 스케줄 탭 상단에 배너로 표시돼요. 요청 카드를 탭해서 수락 또는 거절할 수 있고, 거절 시 회원에게 메시지를 함께 보낼 수 있어요. 새 요청이 들어오면 홈 화면 상단에도 실시간 알림이 나타납니다.',
      },
      {
        q: '출결은 어떤 상태로 기록되나요?',
        a: '출석 / 지각 / 조퇴 / 결석 4가지로 기록됩니다. 모든 상태는 레슨 크레딧 1회를 차감합니다.',
      },
      {
        q: '크레딧 경고는 언제 표시되나요?',
        a: '잔여 크레딧이 2 이하일 경우 레슨 상세 화면에서 경고 표시가 나타납니다.',
      },
      {
        q: '레슨을 삭제하면 크레딧은 어떻게 되나요?',
        a: '레슨 삭제 시 차감되었던 크레딧이 자동으로 복구됩니다.',
      },
    ],
  },
  {
    title: '결제 탭',
    icon: 'card-outline',
    items: [
      {
        q: '결제 상태는 어떻게 구분되나요?',
        a: '미납 / 부분납부 / 납부완료 / 전체로 필터링할 수 있습니다.',
      },
      {
        q: '이번 달 납부 현황을 볼 수 있나요?',
        a: '결제 탭 상단 배너에서 전체 미납 금액과 이번 달 납부 금액을 확인할 수 있어요.',
      },
      {
        q: 'D-day 배지는 무엇인가요?',
        a: '각 결제 항목의 납부 기한까지 남은 일수를 표시합니다.',
      },
      {
        q: '납부 처리는 어떻게 하나요?',
        a: '결제 목록에서 해당 항목을 탭하면 원터치로 납부 처리할 수 있습니다.',
      },
    ],
  },
  {
    title: '구독 플랜',
    icon: 'diamond-outline',
    items: [
      {
        q: '플랜은 어떻게 구성되나요?',
        a: '• Free (무료): 회원 3명까지, AI 리포트·분석 월 3회\n• Basic (₩9,900/월): 회원 무제한, AI 리포트·분석 월 10회, 회원 알림\n• Pro (₩19,000/월): 회원 무제한, AI 리포트·분석 월 50회, AI 코칭 모델, 모든 기능 포함',
      },
      {
        q: 'Free 플랜에서 회원 3명이 넘으면 어떻게 되나요?',
        a: '3명을 초과하려면 Basic 이상으로 업그레이드해야 해요. 기존 회원 데이터는 유지되고, 업그레이드 후 바로 추가 등록이 가능해요.',
      },
      {
        q: 'AI 리포트 월 한도를 초과하면 어떻게 되나요?',
        a: '한도 초과 후에는 AI 크레딧을 추가로 구매해서 계속 사용할 수 있어요. 설정 → 구독 관리에서 자동 충전 설정도 가능합니다.',
      },
      {
        q: '구독은 어떻게 변경하나요?',
        a: '설정 탭 → 구독 관리에서 플랜 업그레이드 또는 다운그레이드를 할 수 있어요. 업그레이드는 즉시 적용되고, 남은 기간에 대한 차액이 계산됩니다.',
      },
    ],
  },
  {
    title: '설정',
    icon: 'settings-outline',
    items: [
      {
        q: '알림 설정은 어디서 하나요?',
        a: '설정 탭 → 알림 설정에서 변경할 수 있습니다.',
      },
      {
        q: '시간블럭 설정은 무엇인가요?',
        a: '코치가 레슨 가능한 요일과 시간대를 설정하는 기능이에요. 회원이 레슨을 예약 요청할 때 이 시간 범위 안에서만 선택할 수 있어요. 설정 → 시간블럭 설정에서 변경 가능합니다.',
      },
      {
        q: 'AI 음성 분석 동의는 어디서 관리하나요?',
        a: '설정 탭 → AI 음성 분석 동의 관리에서 확인하거나 철회할 수 있습니다.',
      },
    ],
  },
  {
    title: '계정 · 로그인',
    icon: 'person-outline',
    items: [
      {
        q: '어떻게 로그인하나요?',
        a: '이메일과 비밀번호로 로그인합니다. 코치별 데이터는 완전히 분리되어 있어 다른 코치의 데이터는 볼 수 없습니다.',
      },
      {
        q: '데이터가 다른 코치에게 보이나요?',
        a: '아니요. 각 코치의 데이터는 독립적으로 분리되어 있어 본인의 데이터만 확인 가능합니다.',
      },
    ],
  },
];

function AccordionItem({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.item}>
      <TouchableOpacity style={styles.itemHeader} onPress={() => setOpen(v => !v)} activeOpacity={0.7}>
        <Text style={styles.question}>{item.q}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.mutedFg} />
      </TouchableOpacity>
      {open && (
        <View style={styles.answerBox}>
          <Text style={styles.answer}>{item.a}</Text>
        </View>
      )}
    </View>
  );
}

export default function FAQScreen() {
  const [openSection, setOpenSection] = useState<number | null>(0);

  return (
    <View style={styles.container}>
      <SettingsHeader title="자주 묻는 질문" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {FAQ_SECTIONS.map((section, si) => {
          const isOpen = openSection === si;
          return (
            <View key={si} style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => setOpenSection(isOpen ? null : si)}
                activeOpacity={0.7}
              >
                <View style={styles.sectionLeft}>
                  <View style={styles.sectionIconWrap}>
                    <Ionicons name={section.icon as any} size={18} color={TERRA} />
                  </View>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                </View>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={17} color={Colors.mutedFg} />
              </TouchableOpacity>
              {isOpen && (
                <View style={styles.sectionBody}>
                  {section.items.map((item, ii) => (
                    <AccordionItem key={ii} item={item} />
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.contactBox}>
          <Ionicons name="mail-outline" size={18} color={TERRA} />
          <View style={{ flex: 1 }}>
            <Text style={styles.contactTitle}>추가 문의</Text>
            <Text style={styles.contactBody}>위 FAQ에서 답을 찾지 못하셨나요? 아래로 문의해 주세요.</Text>
            <Text style={styles.contactEmail}>hyunsoo@kerri.co.kr</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 10 },
  section: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: TERRA + '15', justifyContent: 'center', alignItems: 'center',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  sectionBody: { borderTopWidth: 1, borderTopColor: Colors.borderLight },
  item: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  itemHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 13, gap: 8,
  },
  question: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foreground, lineHeight: 20 },
  answerBox: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 2 },
  answer: { fontSize: 14, color: Colors.mutedFg, lineHeight: 22 },
  contactBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.border, marginTop: 4,
  },
  contactTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  contactBody: { fontSize: 13, color: Colors.mutedFg, lineHeight: 18, marginBottom: 4 },
  contactEmail: { fontSize: 13, fontWeight: '600', color: TERRA },
});
