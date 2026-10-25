import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 코치용 분석 도구 — lesson_plans 스키마와 동일한 구조
const PLAN_TOOL = {
  name: 'create_lesson_plan',
  description: '코치가 타이핑한 레슨 메모를 분석하여 AI 레슨 기록을 생성합니다.',
  input_schema: {
    type: 'object',
    properties: {
      ai_title: {
        type: 'string',
        description: '이번 레슨 핵심 주제 (5-8단어, 명사형으로 끝낼 것. 예: "포핸드 타점 교정 집중 레슨")',
      },
      summary: {
        type: 'string',
        description: '오늘 레슨 흐름 요약 (2문장 이내)',
      },
      session_goals: {
        type: 'string',
        description: '이번 레슨 핵심 목표 (1문장)',
      },
      improvement_points: {
        type: 'array',
        items: { type: 'string' },
        description: '주의 포인트 목록 (정확히 2항목, 각 1문장, 원인→교정법 형식)',
      },
      next_goals: {
        type: 'array',
        items: { type: 'string' },
        description: '다음 레슨 목표 목록 (정확히 2항목, 각 1문장)',
      },
      drill_suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '드릴 이름' },
            purpose: { type: 'string', description: '목적 (1문장)' },
            method: { type: 'string', description: '실행 방법 (1문장)' },
            reps: { type: 'string', description: '횟수/시간' },
          },
          required: ['name', 'purpose', 'method', 'reps'],
        },
        description: '연습 드릴 추천 (정확히 2개)',
      },
      lesson_comparison: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            point: { type: 'string', description: '이전 목표 내용' },
            status: { type: 'string', enum: ['improved', 'same', 'regressed'] },
            reason: { type: 'string', description: '근거 1-2문장' },
          },
          required: ['point', 'status', 'reason'],
        },
        description: '이전 레슨 대비 변화 (이전 기록 있을 때만 작성, 없으면 빈 배열)',
      },
    },
    required: ['ai_title', 'summary', 'session_goals', 'improvement_points', 'next_goals', 'drill_suggestions', 'lesson_comparison'],
  },
}

// 회원용 리포트 도구
const REPORT_TOOL = {
  name: 'create_member_report',
  description: '레슨 분석 결과를 회원에게 전달할 친근한 리포트로 변환합니다.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: '오늘 레슨 전체 흐름 요약 (2-3문장, 회원 시각에서, 친근한 말투)',
      },
      achievements: {
        type: 'array',
        items: { type: 'string' },
        description: '오늘 잘한 점 / 발전한 점 (1-3개, 구체적으로, 긍정적 톤)',
      },
      improvement_points: {
        type: 'array',
        items: { type: 'string' },
        description: '개선할 점 (1-2개, 왜 중요한지 + 쉽게 설명)',
      },
      practice_plan: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '연습 이름' },
            description: { type: 'string', description: '집에서 혼자 할 수 있는 구체적인 연습 방법' },
            duration: { type: 'string', description: '1회 소요 시간 (예: 10분)' },
            frequency: { type: 'string', description: '권장 빈도 (예: 주 3회)' },
          },
          required: ['title', 'description'],
        },
        description: '집에서 혼자 연습할 수 있는 연습 플랜 (2-3개)',
      },
    },
    required: ['summary', 'achievements', 'improvement_points', 'practice_plan'],
  },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
  const body = await req.json().catch(() => ({}))
  const { memberName, memberLevel, lessonDate, raw, previousLessons } = body

  if (!raw) {
    return new Response(JSON.stringify({ error: '레슨 메모 데이터가 필요합니다.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const memoText = typeof raw === 'string' ? raw : (raw.summary ?? JSON.stringify(raw))

  // 이전 레슨 히스토리 섹션
  const historySection = Array.isArray(previousLessons) && previousLessons.length > 0
    ? [
        '',
        '[이전 레슨 기록 (최근 순)]',
        ...previousLessons.map((p: any, i: number) => {
          const date = p.created_at ? new Date(p.created_at).toLocaleDateString('ko-KR') : `${i + 1}회 전`
          const prevNextGoals = Array.isArray(p.next_goals) && p.next_goals.length > 0
            ? p.next_goals.join(', ')
            : (p.next_goals || '')
          return `• ${date}: 요약=${p.summary || '없음'} | 다음목표=${prevNextGoals || '없음'}`
        }),
      ].join('\n')
    : ''

  const prevGoals: string[] = Array.isArray(previousLessons) && previousLessons.length > 0
    ? (() => {
        const latest = previousLessons[0]
        const goals = Array.isArray(latest?.coach_next_goals) && latest.coach_next_goals.length > 0
          ? latest.coach_next_goals
          : (Array.isArray(latest?.next_goals) ? latest.next_goals : [])
        return goals as string[]
      })()
    : []

  const prevGoalsSection = prevGoals.length > 0
    ? `\n[이전 레슨 목표 달성도 평가]\n이전 목표: ${prevGoals.join(', ')}\nlessen_comparison 배열에 각 목표의 이번 레슨 달성 여부를 평가해주세요.`
    : '\n이전 레슨 기록이 없으므로 lesson_comparison은 빈 배열([])로 작성하세요.'

  const planPrompt = [
    '당신은 USTA/ITF 자격증을 보유한 전문 테니스 코치 어시스턴트입니다.',
    '코치가 타이핑한 레슨 메모를 분석하여 체계적인 AI 레슨 기록을 생성합니다.',
    '',
    '[분석 원칙]',
    '1. 코치가 입력한 메모를 기반으로 분석할 것',
    '2. 메모에 없는 내용은 추가하거나 추론하지 말 것',
    '3. 정보가 부족한 항목은 메모에 있는 내용만으로 작성하고, 실제 없는 경우 최소한의 내용으로 작성',
    '4. improvement_points와 next_goals는 반드시 2개씩 작성 (정보 부족 시 메모 내용에서 추출)',
    '5. drill_suggestions는 반드시 2개 작성 (오늘 레슨 내용과 관련된 연습)',
    '',
    '[회원 정보]',
    `이름: ${memberName} / 레벨: ${memberLevel ?? '미설정'} / 날짜: ${lessonDate ?? '오늘'}`,
    historySection,
    '',
    '[코치 타이핑 메모]',
    memoText,
    prevGoalsSection,
  ].join('\n')

  // 1차: 코치 분석 생성 (lesson_plans 스키마)
  const planRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: 'create_lesson_plan' },
      messages: [{ role: 'user', content: planPrompt }],
    }),
  })

  if (!planRes.ok) {
    const errBody = await planRes.text()
    console.error('Anthropic API 오류 (plan):', planRes.status, errBody)
    return new Response(JSON.stringify({ error: 'AI API 오류', detail: errBody }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const planData = await planRes.json()
  const planToolUse = planData.content?.find((c: any) => c.type === 'tool_use')

  if (!planToolUse?.input) {
    console.error('plan tool_use 응답 없음:', JSON.stringify(planData))
    return new Response(JSON.stringify({ error: 'AI 응답 없음', detail: planData.error?.message ?? '' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const planResult = planToolUse.input

  // 2차: 회원용 리포트 생성
  const reportPrompt = [
    `당신은 테니스 회원에게 오늘 레슨 결과를 친절하게 전달하는 KERRI AI입니다.`,
    `전문 용어는 쉽게 풀어쓰고, 회원이 집에서 혼자 연습할 수 있도록 구체적이고 실용적인 안내를 제공합니다.`,
    '',
    '[회원 정보]',
    `이름: ${memberName} / 레벨: ${memberLevel ?? '미설정'}`,
    '',
    '[코치 분석 결과]',
    `요약: ${planResult.summary || ''}`,
    `세션 목표: ${planResult.session_goals || ''}`,
    `주의 포인트: ${(planResult.improvement_points || []).join(' / ')}`,
    `다음 목표: ${(planResult.next_goals || []).join(' / ')}`,
    `추천 드릴: ${JSON.stringify(planResult.drill_suggestions || [])}`,
    '',
    '위 코치 분석을 회원이 이해하기 쉽게 변환해주세요.',
    `칭찬과 격려를 섞어 ${memberName}님에게 직접 전달하는 따뜻한 말투로 작성하세요.`,
  ].join('\n')

  const reportRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      tools: [REPORT_TOOL],
      tool_choice: { type: 'tool', name: 'create_member_report' },
      messages: [{ role: 'user', content: reportPrompt }],
    }),
  })

  if (!reportRes.ok) {
    const errBody = await reportRes.text()
    console.error('Anthropic API 오류 (report):', reportRes.status, errBody)
    // 회원 리포트 생성 실패해도 코치 분석은 반환
    return new Response(JSON.stringify({
      success: true,
      plan: planResult,
      report: {
        summary: planResult.summary || '',
        achievements: [],
        improvement_points: planResult.improvement_points || [],
        practice_plan: [],
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const reportData = await reportRes.json()
  const reportToolUse = reportData.content?.find((c: any) => c.type === 'tool_use')
  const reportResult = reportToolUse?.input ?? {
    summary: planResult.summary || '',
    achievements: [],
    improvement_points: planResult.improvement_points || [],
    practice_plan: [],
  }

  return new Response(JSON.stringify({ success: true, plan: planResult, report: reportResult }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
