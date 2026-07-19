import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function safeParseJson(text: string): object | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch (_e) { return null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
  const { memberName, memberLevel, lessonDate, raw } = await req.json().catch(() => ({}))

  // summary가 없으면 빈 문자열로 처리 (수동 리포트에서는 optional)
  if (!raw) {
    return new Response(JSON.stringify({ error: '레슨 메모 데이터가 필요합니다.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const prompt = [
    '당신은 테니스 코치입니다. 코치가 작성한 메모를 회원에게 전달할 친근하고 전문적인 레슨 리포트로 다듬어주세요.',
    '',
    '[회원 정보]',
    `이름: ${memberName} / 레벨: ${memberLevel ?? '미설정'} / 날짜: ${lessonDate ?? '오늘'}`,
    '',
    '[코치 메모]',
    `a. 오늘 레슨 요약: ${raw.summary || '(미입력)'}`,
    `b. 중요 성과: ${raw.achievements || '(미입력)'}`,
    `c. 개선 포인트: ${raw.improvementPoints || '(미입력)'}`,
    `d. 연습 플랜: ${raw.practicePlan || '(미입력)'}`,
    '',
    '[절대 규칙 — 반드시 준수할 것]',
    '1. 위 코치 메모에 실제로 적힌 내용만 사용하여 작성할 것 — 메모에 없는 기술명, 드릴, 조언, 예시를 절대 임의로 추가하거나 추측하지 말 것',
    '2. (미입력)으로 표시된 항목은 반드시 빈 배열([]) 또는 빈 문자열("")로만 응답할 것 — 해당 항목에 대한 내용 생성 절대 금지',
    `3. ${memberName}님에게 직접 전달하는 따뜻하고 자연스러운 말투로 다듬을 것 (내용 추가 없이 표현만 자연스럽게)`,
    '4. 성과는 메모에 명시된 것만 칭찬하고, 개선점은 메모에 적힌 것만 긍정적으로 표현할 것',
    '5. JSON만 응답 (코드블록, 마크다운 없이)',
    '',
    '응답 형식:',
    '{"summary":"2-3문장 요약","achievements":["성과1","성과2"],"improvement_points":["포인트1"],"practice_plan":[{"title":"연습명","description":"방법","duration":"시간","frequency":"빈도"}]}',
  ].join('\n')

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-3-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const data = await resp.json()
  const text = data.content?.[0]?.text ?? ''
  const parsed = safeParseJson(text)

  if (!parsed) {
    return new Response(JSON.stringify({ error: 'AI 응답 파싱 실패', raw: text }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ success: true, report: parsed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
