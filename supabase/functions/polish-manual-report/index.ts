import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const REPORT_TOOL = {
  name: 'create_lesson_report',
  description: '코치 메모를 기반으로 회원에게 전달할 레슨 리포트를 생성합니다.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: '오늘 레슨 요약 (2-3문장, 회원에게 직접 전달하는 말투)',
      },
      achievements: {
        type: 'array',
        items: { type: 'string' },
        description: '오늘 잘한 점 목록 (1-3개)',
      },
      improvement_points: {
        type: 'array',
        items: { type: 'string' },
        description: '개선 포인트 목록 (1-3개)',
      },
      practice_plan: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '연습 이름' },
            description: { type: 'string', description: '구체적인 연습 방법' },
            duration: { type: 'string', description: '연습 시간 (예: 10분)' },
            frequency: { type: 'string', description: '연습 빈도 (예: 매일)' },
          },
          required: ['title', 'description'],
        },
        description: '집에서 혼자 연습할 수 있는 연습 플랜 (1-2개)',
      },
    },
    required: ['summary', 'achievements', 'improvement_points', 'practice_plan'],
  },
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
  ].join('\n')

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      tools: [REPORT_TOOL],
      tool_choice: { type: 'tool', name: 'create_lesson_report' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!resp.ok) {
    const errBody = await resp.text()
    console.error('Anthropic API HTTP 오류:', resp.status, errBody)
    return new Response(JSON.stringify({ error: 'AI API 오류', detail: errBody }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const data = await resp.json()
  const toolUse = data.content?.find((c: any) => c.type === 'tool_use')

  if (!toolUse?.input) {
    console.error('tool_use 응답 없음:', JSON.stringify(data))
    return new Response(JSON.stringify({ error: 'AI 응답 없음', detail: data.error?.message ?? '' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ success: true, report: toolUse.input }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
