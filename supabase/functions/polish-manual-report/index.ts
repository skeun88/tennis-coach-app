import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function safeParseJson(text: string): object | null {
  // Strip code fences if present
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  const target = stripped || text
  const match = target.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch (_e) { return null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
  const { memberName, memberLevel, lessonDate, raw } = await req.json().catch(() => ({}))

  if (!raw) {
    return new Response(JSON.stringify({ error: '레슨 메모 데이터가 필요합니다.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // 자유형 입력 감지: summary만 있고 나머지가 비어있으면 freeform 모드
  const isFreeform = raw.summary && !raw.achievements && !raw.improvementPoints && !raw.practicePlan

  const prompt = isFreeform ? [
    '당신은 테니스 코치 보조 AI입니다. 코치가 레슨 후 간단히 적은 메모를 분석하여 회원에게 전달할 완전한 레슨 리포트를 작성해주세요.',
    '',
    '[회원 정보]',
    `이름: ${memberName} / 레벨: ${memberLevel ?? '미설정'} / 날짜: ${lessonDate ?? '오늘'}`,
    '',
    '[코치 메모]',
    raw.summary,
    '',
    '[작성 규칙]',
    '1. 코치 메모에 적힌 내용을 기반으로 모든 항목을 채울 것',
    '2. 메모에서 유추 가능한 성과와 개선점을 자연스럽게 추출하여 정리할 것',
    `3. ${memberName}님에게 직접 전달하는 따뜻하고 격려하는 말투로 작성할 것`,
    '4. practice_plan은 집에서 혼자 연습할 수 있는 구체적인 내용으로 1-2개 작성',
    '5. achievements와 improvement_points는 각 1-3개 작성',
    '6. JSON만 응답 (코드블록, 마크다운, 설명 텍스트 없이 순수 JSON만)',
    '',
    '응답 형식 (이 구조 그대로):',
    '{"summary":"2-3문장 레슨 요약","achievements":["성과1","성과2"],"improvement_points":["개선포인트1"],"practice_plan":[{"title":"연습명","description":"구체적인 방법","duration":"시간","frequency":"빈도","tip":"팁"}]}',
  ].join('\n') : [
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
    '[절대 규칙]',
    '1. 위 코치 메모에 실제로 적힌 내용만 사용하여 작성할 것 — 없는 내용 추가 금지',
    '2. (미입력)으로 표시된 항목은 반드시 빈 배열([]) 또는 빈 문자열("")로만 응답할 것',
    `3. ${memberName}님에게 직접 전달하는 따뜻하고 자연스러운 말투로 다듬을 것`,
    '4. JSON만 응답 (코드블록, 마크다운 없이)',
    '',
    '응답 형식:',
    '{"summary":"2-3문장 요약","achievements":["성과1","성과2"],"improvement_points":["포인트1"],"practice_plan":[{"title":"연습명","description":"방법","duration":"시간","frequency":"빈도","tip":"팁"}]}',
  ].join('\n')

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const data = await resp.json()
  const text = data.content?.[0]?.text ?? ''

  if (!text) {
    console.error('Anthropic API 오류:', JSON.stringify(data))
    return new Response(JSON.stringify({ error: 'AI 응답 없음', detail: data.error?.message ?? '' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const parsed = safeParseJson(text)

  if (!parsed) {
    console.error('파싱 실패. 원본 응답:', text)
    return new Response(JSON.stringify({ error: 'AI 응답 파싱 실패', raw: text }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ success: true, report: parsed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
