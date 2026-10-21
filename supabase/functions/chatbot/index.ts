import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FAQ_CONTENT = `
# 테니스 코치 앱 FAQ

## AI 레슨 리포트

Q. AI 레슨 리포트가 뭔가요?
A. 레슨이 끝난 후 코치가 음성이나 텍스트로 오늘 레슨 내용을 기록하면, KERRI AI가 이를 분석해서 전문적인 리포트를 자동으로 만들어주는 기능이에요. 회원에게 오늘 배운 내용, 잘한 점, 보완할 점, 다음 숙제까지 깔끔하게 정리해서 보낼 수 있어요.

Q. 핀마이크가 꼭 필요한가요?
A. 필수는 아니에요. 휴대폰 마이크나 이어폰으로도 충분히 녹음할 수 있어요. 다만 테니스 코트처럼 야외나 소음이 있는 환경에서는 핀마이크를 사용하면 음성 인식 정확도가 크게 올라가요. 예산이 된다면 DJI Mic Mini(약 12만원)가 가성비 최고예요.

Q. 녹음은 얼마나 해야 하나요?
A. 최소 10초 이상이면 리포트 생성이 가능해요. 30초~1분 정도면 충분히 좋은 리포트가 나와요.

Q. 레슨 후 음성 기록, 어떻게 말하면 되나요?
A. 레슨 끝나고 30초 정도 자연스럽게 말하면 돼요. (1) 오늘 연습한 기술, (2) 잘된 점, (3) 보완할 점, (4) 다음 숙제, (5) 다음 레슨 계획 순서로 이야기해보세요.

Q. 음성이 잘 인식되지 않아요.
A. 아래를 확인해보세요: (1) 앱에서 마이크 권한이 허용되어 있는지 확인 (설정 → KERRI → 마이크), (2) 주변 소음 최소화, (3) 마이크와 10~15cm 거리 유지, (4) 인터넷 연결 확인. 문제가 계속되면 hyunsoo@kerri.co.kr 로 문의해주세요.

Q. AI 리포트가 이상하게 생성됐어요.
A. 주변 소음이 너무 많거나, 기록 내용이 너무 짧거나, 전문 용어를 너무 많이 쓴 경우에 발생해요. 조용한 곳에서 좀 더 구체적으로 자연스럽게 다시 기록해보세요. 문제가 계속되면 hyunsoo@kerri.co.kr 로 문의해주세요.

Q. 좋은 리포트를 만들려면 어떻게 해야 하나요?
A. 5가지 비결: (1) 구체적으로 말하기, (2) 기술 이름 언급하기, (3) 수준에 맞게 설명하기, (4) 숙제를 명확히, (5) 다음 목표 포함.

Q. 레슨 리포트를 회원에게 어떻게 보내나요?
A. AI 리포트가 생성된 후 '회원에게 공유' 버튼을 탭하면 돼요. 회원의 KERRI 앱으로 바로 전송되거나, 링크를 복사해서 카카오톡이나 문자로 보낼 수 있어요.

Q. 텍스트로 레슨 리포트를 만들 수 있나요?
A. 네, 가능해요! 음성 녹음 대신 텍스트 입력을 선택하면 돼요.

## KERRI 도우미 탭
Q. KERRI 도우미는 무엇인가요?
A. 하단 탭의 "KERRI 도우미"는 AI 챗봇이에요. 앱 사용법부터 레슨 플랜, 드릴 추천, 테니스 이론까지 무엇이든 대화형으로 물어볼 수 있어요.

Q. 어떤 것을 물어볼 수 있나요?
A. 앱 사용법, 레슨 플랜 작성, 드릴 추천, 기술 이론, 코칭 전략 등 코치에게 필요한 거의 모든 질문을 할 수 있어요.

## 홈 탭
Q. 홈 화면에서 어떤 정보를 볼 수 있나요?
A. 전체 회원 수, 미납 회원 수, 만료 예정 회원 수를 한눈에 확인할 수 있어요. 오늘의 레슨 카드에서 바로 출결 체크도 가능합니다.

Q. 미납/만료예정 배지는 어떻게 작동하나요?
A. 미납: 미납 금액이 있는 회원 수를 빨간 숫자로 표시합니다. 만료예정: 레슨 크레딧이 곧 소진되는 회원 수를 주황 숫자로 표시합니다. 각 배지를 탭하면 해당 회원 목록이 바로 나와요.

Q. 이탈 위험 회원이란 무엇인가요?
A. 최근 레슨이 뜸해지거나, 크레딧이 부족한 회원을 AI가 감지해서 홈 화면에 표시해줍니다.

Q. 자동 레슨 생성이란 무엇인가요?
A. 고정 스케줄이 설정된 회원에 대해 레슨을 자동으로 생성할 수 있도록 제안해드립니다.

## 회원 탭
Q. 회원을 어떻게 검색하나요?
A. 회원 탭 상단 검색창에서 이름 또는 전화번호로 검색할 수 있어요.

Q. 회원을 어떻게 등록하나요?
A. + 버튼 탭 후 등록 흐름: ① 기본 정보 → ② 레슨권 선택(바로 만들기 가능) → ③ 일정 설정 → ④ 요약 확인 후 저장.

Q. 레슨권을 등록 화면에서 바로 만들 수 있나요?
A. 네! 회원 등록 중 "＋ 새 레슨권 만들기"를 탭하면 바텀시트로 레슨권을 바로 생성할 수 있어요.

Q. 회원 상세 페이지에서 어떤 정보를 관리할 수 있나요?
A. 4개 탭으로 구성: 정보(이름/전화번호/이메일/레벨/고정스케줄/크레딧), 출결(최근 20개), 결제(결제 이력), 노트(코치 메모).

Q. 고정 스케줄은 어떻게 설정하나요?
A. 회원 등록 시 또는 회원 정보 탭에서 요일 + 시작 시간 + 레슨 시간을 설정하면 됩니다.

Q. 레슨 크레딧은 어떻게 관리하나요?
A. 회원 정보 탭에서 확인/수정 가능하며, 출결 처리 시 자동 차감됩니다.

Q. AI 레슨 분석은 무엇인가요?
A. 회원 상세 페이지에서 AI 레슨 분석 버튼을 눌러 출결/노트를 기반으로 AI 분석 결과를 제공합니다. 플랜에 따라 월 사용 횟수 제한이 있어요.

## 스케줄 탭
Q. 회원이 레슨을 예약 요청하면 어떻게 되나요?
A. 스케줄 탭 상단에 배너로 표시돼요. 수락 또는 거절할 수 있고, 거절 시 회원에게 메시지도 보낼 수 있어요.

Q. 출결은 어떤 상태로 기록되나요?
A. 출석/지각/조퇴/결석 4가지로 기록되며 모두 크레딧 1회 차감됩니다.

Q. 레슨을 삭제하면 크레딧은 어떻게 되나요?
A. 차감됐던 크레딧이 자동으로 복구됩니다.

## 결제 탭
Q. 결제 상태는 어떻게 구분되나요?
A. 미납/부분납부/납부완료/전체로 필터링 가능합니다.

Q. 납부 처리는 어떻게 하나요?
A. 결제 목록에서 해당 항목을 탭하면 완료로 납부 처리할 수 있습니다.

## 구독 플랜
Q. 플랜은 어떻게 구성되나요?
A. Free(무료): 회원 3명, AI 월 3회 / Basic(월 9,900원): 회원 무제한, AI 월 10회 / Pro(월 19,000원): 회원 무제한, AI 월 50회, 모든 기능 포함.

Q. Free 플랜에서 회원 3명이 넘으면 어떻게 되나요?
A. 3명을 초과하려면 Basic 이상으로 업그레이드해야 해요.

Q. AI 리포트 월 한도를 초과하면 어떻게 되나요?
A. AI 크레딧을 추가로 구매해서 계속 사용할 수 있어요.

## 설정
Q. 시간블럭 설정은 무엇인가요?
A. 코치가 레슨 가능한 요일과 시간대를 설정하는 기능이에요. 회원이 예약 요청할 때 이 시간 범위 안에서만 선택할 수 있어요.

Q. AI 음성 분석 동의는 어디서 관리하나요?
A. 설정 탭 → AI 음성 분석 동의 관리에서 확인하거나 철회할 수 있습니다.

## 계정/로그인
Q. 데이터가 다른 코치에게 보이나요?
A. 아니요. 각 코치의 데이터는 독립적으로 분리되어 있어 본인의 데이터만 확인 가능합니다.
`

// RAG 검색: search_tennis_knowledge RPC 직접 호출
async function searchKnowledge(
  query: string,
  openaiKey: string,
  supabase: ReturnType<typeof createClient>,
  count = 4,
): Promise<Array<{ content: string; source: string; title: string; similarity: number }>> {
  try {
    // 쿼리 임베딩 생성
    const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: query.slice(0, 2000) }),
    })
    const embedData = await embedRes.json()
    const embedding = embedData.data?.[0]?.embedding
    if (!embedding) return []

    const { data } = await supabase.rpc('search_tennis_knowledge', {
      query_embedding: embedding,
      match_threshold: 0.45,
      match_count: count,
      filter_level: null,
    })
    return data ?? []
  } catch {
    return []
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
    const OPENAI_KEY    = Deno.env.get('OPENAI_API_KEY')!
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    const { message, history = [] } = await req.json()
    if (!message) return new Response(JSON.stringify({ error: 'message required' }), { status: 400, headers: corsHeaders })

    // RAG 검색 (항상 수행, 유사도 낮으면 자동 무시)
    const ragResults = await searchKnowledge(message, OPENAI_KEY, supabase)

    // RAG 컨텍스트 구성 (출처 포함)
    let ragContext = ''
    if (ragResults.length > 0) {
      ragContext = '\n\n# 관련 테니스 코칭 자료 (RAG)\n'
      ragResults.forEach((r, i) => {
        ragContext += `\n[출처 ${i + 1}: ${r.source} — ${r.title}]\n${r.content}\n`
      })
    }

    const systemPrompt = `당신은 테니스 코치들을 위한 AI 어시스턴트입니다.
앱 사용법 질문과 테니스 코칭(드릴, 훈련법, 전술, 이론 등) 질문 모두 답변할 수 있습니다.

## 답변 스타일
- 말투: 친근하고 간결하게. 문장 2~4개면 충분. 길게 늘어놓지 않기
- 마크다운 금지: ** 같은 볼드, ## 같은 헤더 사용하지 말 것
- 강조할 때는 [대괄호] 사용 (예: [포핸드 크로스])
- 이모지는 꼭 필요할 때만, 줄당 1개 이하
- 번호 목록은 꼭 필요할 때만 사용

## 답변 규칙
1. [앱 사용법] 질문 → 아래 FAQ를 기반으로 간결하게 답변
2. [테니스 코칭] 질문 → RAG 자료 참고해서 핵심만 답변. 출처는 "출처: 자료명" 형식으로 짧게
3. 모르는 내용 → "그건 제가 확인이 안 되는 부분이에요. hyunsoo@kerri.co.kr 로 문의해보세요"
4. 코치가 바로 쓸 수 있는 실용적인 답변 위주로

${FAQ_CONTENT}
${ragContext}`

    const messages = [
      ...history.slice(-10),
      { role: 'user', content: message },
    ]

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 768,
        system: systemPrompt,
        messages,
      }),
    })

    const data = await response.json()
    const reply = data.content?.[0]?.text ?? '죄송합니다, 잠시 후 다시 시도해주세요.'

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Chatbot error:', err)
    return new Response(JSON.stringify({
      reply: '일시적인 오류가 발생했습니다. 문의사항은 hyunsoo@kerri.co.kr로 연락 주세요.',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
