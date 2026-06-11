import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

Q. 회원 상세 페이지에서 어떤 정보를 관리할 수 있나요?
A. 회원 상세 페이지는 4개 탭으로 구성: 정보(이름/전화번호/이메일/레벨/고정스케줄/크레딧), 출결(최근 20개), 결제(결제 이력), 노트(코치 메모).

Q. 고정 스케줄은 어떻게 설정하나요?
A. 회원 정보 탭에서 요일 + 시작 시간 + 레슨 시간을 설정하면 됩니다.

Q. 레슨 크레딧은 어떻게 관리하나요?
A. 회원 정보 탭에서 확인/수정 가능하며, 출결 처리 시 자동 차감됩니다.

Q. AI 레슨 분석은 무엇인가요?
A. 회원 상세 페이지에서 AI 레슨 분석 버튼을 눌러 출결/노트를 기반으로 AI 분석 결과를 제공합니다.

## 스케줄 탭
Q. 출결은 어떤 상태로 기록되나요?
A. 출석/지각/조퇴/결석 4가지로 기록되며 모두 크레딧 1회 차감됩니다.

Q. 레슨을 삭제하면 크레딧은 어떻게 되나요?
A. 차감됐던 크레딧이 자동으로 복구됩니다.

## 결제 탭
Q. 결제 상태는 어떻게 구분되나요?
A. 미납/부분납부/납부완료/전체로 필터링 가능합니다.

Q. 납부 처리는 어떻게 하나요?
A. 결제 목록에서 해당 항목을 탭하면 완료로 납부 처리할 수 있습니다.

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

## 답변 규칙
1. **앱 사용법** 질문 → 아래 FAQ를 기반으로 정확히 답변
2. **테니스 코칭** 질문 → RAG 자료를 참고하여 답변하고, 반드시 출처를 명시
   - 출처 형식: "📚 출처: [자료명]"
3. RAG 자료에도 FAQ에도 없는 내용 → "해당 내용은 확인이 필요합니다. 📧 hyunsoo@kerri.co.kr"
4. 답변은 명확하고 실용적으로, 코치가 바로 활용할 수 있게 작성
5. 친근하고 전문적인 톤 유지

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
        model: 'claude-haiku-3-5',
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
