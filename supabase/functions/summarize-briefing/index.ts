import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { improvement_points, next_goals, coach_next_goals, next_goals_saved } = await req.json()

    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

    // 주의 포인트 최대 2개
    const rawPoints: string[] = (() => {
      if (!improvement_points) return []
      if (Array.isArray(improvement_points)) return improvement_points.filter(Boolean).slice(0, 2)
      try {
        const parsed = JSON.parse(improvement_points)
        if (Array.isArray(parsed)) return parsed.filter(Boolean).slice(0, 2)
      } catch { /**/ }
      return [String(improvement_points).trim()].filter(Boolean)
    })()

    // 목표: 코치 확정 > AI 초안
    const goalsSource: string[] = (next_goals_saved && coach_next_goals?.length)
      ? coach_next_goals
      : (next_goals ?? [])
    const rawGoal: string | null = goalsSource[0] ?? null

    if (rawPoints.length === 0 && !rawGoal) {
      return new Response(JSON.stringify({ keyPoints: [], nextGoal: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const pointsSection = rawPoints.length > 0
      ? rawPoints.map((p, i) => `주의 포인트 ${i + 1}: ${p}`).join('\n')
      : '(없음)'
    const goalSection = rawGoal ? `다음 레슨 목표: ${rawGoal}` : '(없음)'

    const prompt = `테니스 코치앱 홈 화면 레슨 브리핑 카드용 요약입니다.

${pointsSection}
${goalSection}

지시사항:
- 각 주의 포인트를 15~25자 이내의 완결된 한국어 명사구로 요약하세요.
- 명사구 형식: "[부위/동작] [문제/상태]" 예) "포핸드 타점 일관성 부족", "백핸드 밀어치기 동작 불안정"
- 다음 레슨 목표는 25자 이내의 완결된 짧은 문장으로 요약하세요.
- 문장이 중간에 끊기지 않도록 하세요.
- 원문에 없는 내용을 임의로 추가하지 마세요.
- keyPoints 배열은 입력한 주의 포인트 개수와 동일하게 출력하세요.

JSON만 출력 (다른 텍스트 없이):
{"keyPoints":["요약1","요약2"],"nextGoal":"목표 요약 또는 null"}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const aiData = await res.json()
    const rawText = aiData.content?.[0]?.text?.trim() ?? ''

    // JSON 블록 추출 (```json ... ``` 감싸인 경우 대비)
    const jsonStr = rawText.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(jsonStr)

    // 결과 검증: 빈 문자열·중간 끊김 문구는 원문으로 대체
    const keyPoints: string[] = rawPoints.map((raw, i) => {
      const summary = (parsed.keyPoints?.[i] ?? '').trim()
      if (!summary || summary.length < 4) return raw
      return summary
    })
    const nextGoal: string | null = (() => {
      const s = (parsed.nextGoal ?? '').trim()
      if (!s || s === 'null' || s.length < 4) return rawGoal
      return s
    })()

    return new Response(JSON.stringify({ keyPoints, nextGoal }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[summarize-briefing]', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
