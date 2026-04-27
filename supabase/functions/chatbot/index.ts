import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const FAQ_CONTENT = `
# 테니스 코치 앱 FAQ

## 홈 탭
Q. 홈 화면에서 어떤 정보를 볼 수 있나요?
A. 오늘의 활성 회원 수, 오늘 예정된 레슨, 미납 회원 수, 전체 회원 수를 한눈에 확인할 수 있어요. 오늘의 레슨 카드에서 바로 출결 체크도 가능합니다.

Q. 미납 알림 배지는 어떻게 작동하나요?
A. 미납 금액이 있는 경우 홈 화면 상단에 자동으로 배지가 표시됩니다. 배지를 탭하면 결제로 이동합니다.

Q. 자동 레슨 생성이란 무엇인가요?
A. 고정 스케줄이 설정된 회원에 대해 레슨을 자동으로 생성할 수 있도록 제안해드립니다.

## 회원 탭
Q. 회원을 어떻게 검색하나요?
A. 회원 탭 상단 검색창에서 이름 또는 전화번호로 검색할 수 있어요.

Q. 활성/비활성 회원을 구분해서 볼 수 있나요?
A. 네, 회원 목록 상단 필터에서 활성/비활성을 전환할 수 있습니다.

Q. 회원 상세 페이지에서 어떤 정보를 관리할 수 있나요?
A. 회원 상세 페이지는 4개 탭으로 구성: 정보(이름/전화번호/이메일/레벨/고정스케줄/크레딧), 출결(최근 20개), 결제(결제 이력), 노트(코치 메모).

Q. 회원 레벨은 어떻게 구분되나요?
A. 입문/초급/중급/고급/선수 5단계입니다.

Q. 고정 스케줄은 어떻게 설정하나요?
A. 회원 정보 탭에서 요일 + 시작 시간 + 레슨 시간을 설정하면 됩니다.

Q. 레슨 크레딧은 어떻게 관리하나요?
A. 회원 정보 탭에서 확인/수정 가능하며, 출결 처리 시 자동 차감됩니다.

Q. AI 레슨 분석은 무엇인가요?
A. 회원 상세 페이지에서 AI 레슨 분석 버튼을 눌러 출결/노트를 기반으로 AI 분석 결과를 제공합니다.

Q. 회원을 비활성화하면 어떻게 되나요?
A. 비활성 상태로 전환되어 기본 목록에서 숨겨지지만 데이터는 유지됩니다.

## 스케줄 탭
Q. 스케줄을 어떻게 확인하나요?
A. 일별 보기(7일 네비 바) 또는 주별 보기(월~일 그리드)로 전환 가능합니다.

Q. 출결은 어떤 상태로 기록되나요?
A. 출석/지각/조퇴/결석 4가지로 기록되며 모두 크레딧 1회 차감됩니다.

Q. 크레딧 경고는 언제 표시되나요?
A. 잔여 크레딧이 2 이하일 경우 경고 표시가 나타납니다.

Q. 레슨을 삭제하면 크레딧은 어떻게 되나요?
A. 차감됐던 크레딧이 자동으로 복구됩니다.

## 결제 탭
Q. 결제 상태는 어떻게 구분되나요?
A. 미납/부분납부/납부완료/전체로 필터링 가능합니다.

Q. 이번 달 납부 현황을 볼 수 있나요?
A. 결제 탭 상단 배너에서 전체 미납 금액과 이번 달 납부 금액을 확인할 수 있어요.

Q. D-day 배지는 무엇인가요?
A. 납부 기한까지 남은 일수를 표시합니다.

Q. 납부 처리는 어떻게 하나요?
A. 결제 목록에서 해당 항목을 탭하면 완료로 납부 처리할 수 있습니다.

## 알림
Q. 알림 설정은 어디서 하나요?
A. 홈 화면 우측 상단의 벨 아이콘을 눌러 알림 설정을 변경할 수 있습니다.

## 계정/로그인
Q. 어떻게 로그인하나요?
A. 이메일과 비밀번호로 로그인합니다.

Q. 데이터가 다른 코치에게 보이나요?
A. 아니요. 각 코치의 데이터는 독립적으로 분리되어 있어 본인의 데이터만 확인 가능합니다.
`

const SYSTEM_PROMPT = `당신은 테니스 코치 앱의 고객지원 챗봇입니다.
아래 FAQ를 참고하여 사용자의 질문에 친절하고 간결하게 답변해주세요.

규칙:
1. FAQ에 있는 내용은 FAQ를 기반으로 정확하게 답변하세요.
2. FAQ에 없는 내용이거나 확실하지 않은 경우: "해당 문의는 이메일로 연락 주시면 빠르게 도와드리겠습니다. 📧 hyunsoo@kerri.co.kr" 라고 답변하세요.
3. 답변은 2-3문장 이내로 간결하게 작성하세요.
4. 친근하고 따뜻한 톤으로 답변하세요.
5. 앱 기능 외의 질문(개인정보, 환불 등 민감한 사항)은 이메일로 안내하세요.

FAQ 내용:
${FAQ_CONTENT}`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const { message, history = [] } = await req.json()

    if (!message) {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set')

    // 대화 히스토리 구성 (최대 10개)
    const messages = [
      ...history.slice(-10),
      { role: 'user', content: message }
    ]

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-3-5',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages,
      }),
    })

    const data = await response.json()
    const reply = data.content?.[0]?.text ?? '죄송합니다, 잠시 후 다시 시도해주세요.'

    return new Response(JSON.stringify({ reply }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    console.error('Chatbot error:', err)
    return new Response(JSON.stringify({ 
      reply: '일시적인 오류가 발생했습니다. 문의사항은 hyunsoo@kerri.co.kr로 연락 주세요.' 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
})
