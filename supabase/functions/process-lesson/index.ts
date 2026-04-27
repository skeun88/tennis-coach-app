import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── System Prompt (캐싱 대상) ──
const SYSTEM_PROMPT = `당신은 USTA/ITF 자격증을 보유한 전문 테니스 코치 어시스턴트입니다.
코치가 레슨 후 회원별 맞춤 리포트를 작성할 수 있도록 분석을 제공합니다.

## 분석 원칙
1. 레슨에서 구체적으로 언급된 기술/상황을 중심으로 분석
2. 회원 레벨과 목표에 맞는 피드백 제공
3. 코트 환경에 적합한 드릴 추천
4. 이전 레슨 히스토리가 있으면 연속성 있게 반영
5. 개선 포인트는 "원인 → 교정법" 형식으로
6. 드릴 추천은 구체적인 반복 횟수/목표 포함
7. 레슨 전체(시작~끝)를 균등하게 반영할 것. 초반 내용에만 치우치지 말 것

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요 (한국어). JSON 외 텍스트 절대 포함 금지:
{
  "summary": "오늘 레슨 전체 흐름 요약 (4-6문장, 시작~끝 균등 반영)",
  "session_goals": "이번 레슨에서 달성하려 했던 핵심 목표 1-2가지",
  "improvement_points": [
    "개선 포인트 1 (원인 → 교정법)",
    "개선 포인트 2",
    "개선 포인트 3"
  ],
  "next_goals": [
    "다음 레슨 목표 1 (구체적 드릴 포함)",
    "다음 레슨 목표 2",
    "다음 레슨 목표 3"
  ],
  "drill_suggestions": [
    {
      "name": "드릴 이름",
      "purpose": "목적",
      "method": "실행 방법 (구체적)",
      "reps": "횟수/시간",
      "court_adaptation": "코트 유형에 맞는 변형 방법"
    }
  ]
}
drill_suggestions는 정확히 2개만 포함할 것.`

// transcript가 길면 앞/중간/뒤를 균등하게 샘플링
function sampleTranscript(text: string, maxChars = 6000): string {
  if (text.length <= maxChars) return text
  const third = Math.floor(maxChars / 3)
  const start = text.slice(0, third)
  const mid = text.slice(Math.floor(text.length / 2) - Math.floor(third / 2), Math.floor(text.length / 2) + Math.floor(third / 2))
  const end = text.slice(text.length - third)
  return `[앞부분]\n${start}\n\n[중간부분]\n${mid}\n\n[뒷부분]\n${end}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const formData = await req.formData()
    const audioFile = formData.get('audio') as File | null
    const memberId = formData.get('member_id') as string
    const lessonId = formData.get('lesson_id') as string | null
    const coachId = formData.get('coach_id') as string
    const courtType = (formData.get('court_type') as string) || null
    const durationSecondsRaw = formData.get('duration_seconds') as string | null
    const durationSeconds = durationSecondsRaw ? parseInt(durationSecondsRaw, 10) : null

    // ── 필수 파라미터 체크 ──
    if (!memberId || !coachId) {
      return new Response(JSON.stringify({ error: '필수 파라미터 누락 (member_id, coach_id)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── 녹음 데이터 없으면 분석 거부 ──
    if (!audioFile || audioFile.size < 1000) {
      return new Response(JSON.stringify({ error: '유효한 녹음 파일이 없습니다. 레슨을 녹음한 후 분석을 시작하세요.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── Step 1: Whisper STT + 회원/코치 정보 병렬 ──
    const whisperForm = new FormData()
    whisperForm.append('file', audioFile, 'audio.m4a')
    whisperForm.append('model', 'whisper-1')
    whisperForm.append('language', 'ko')
    whisperForm.append('prompt',
      '테니스 레슨 녹음입니다. 포핸드, 백핸드, 서브, 발리, 스매시, 로브, 드롭샷, 풋워크, 스플릿스텝, ' +
      '탑스핀, 슬라이스, 플랫, 이스턴, 웨스턴, 컨티넨탈, 트로피자세, 팔로스루, 테이크백 등의 용어가 나올 수 있습니다.'
    )

    const [whisperRes, memberRes, coachRes] = await Promise.all([
      fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: whisperForm,
      }),
      supabase.from('members')
        .select('name, level, dominant_hand, backhand_type, goal, injury_history, weak_points, lesson_count, notes, court_type')
        .eq('id', memberId).single(),
      supabase.from('coach_profiles')
        .select('default_court_type, specialties, coaching_style')
        .eq('coach_id', coachId).single(),
    ])

    const whisperData = await whisperRes.json()
    const transcript = whisperData.text
    if (!transcript) throw new Error(`음성 변환 실패: ${JSON.stringify(whisperData)}`)

    const member = memberRes.data
    const coachProfile = coachRes.data
    const effectiveCourtType = courtType || member?.court_type || coachProfile?.default_court_type || '풀코트야외'

    // ── Step 2: transcript 균등 샘플링 + 요약 ──
    const sampledTranscript = sampleTranscript(transcript, 8000)

    const TRANSCRIPT_SUMMARY_PROMPT = `다음은 테니스 레슨 녹음의 전문입니다. 앞/중간/뒷부분이 모두 포함되어 있습니다.
레슨 전체를 균등하게 반영하여 핵심 내용을 추출해주세요. 특정 시간대에 치우치지 말 것.

출력 형식 (JSON):
{
  "key_techniques": ["언급된 기술 1", "기술 2"],
  "main_issues": ["주요 문제점 1", "문제점 2"],
  "lesson_flow": "레슨 전체 흐름 요약 - 시작/중반/후반 모두 포함 (4-5문장)",
  "coach_instructions": ["코치가 준 주요 지시사항 1", "지시사항 2"]
}

레슨 녹음:
${sampledTranscript}`

    const [summaryRes, transcriptInsert, historyRes] = await Promise.all([
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 1000,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: TRANSCRIPT_SUMMARY_PROMPT }],
        }),
      }),
      supabase.from('lesson_transcripts').insert({
        coach_id: coachId,
        member_id: memberId,
        lesson_id: lessonId || null,
        transcript,
        duration_seconds: durationSeconds ?? Math.round(audioFile.size / 16000),
        recorded_at: new Date().toISOString(),
      }).select().single(),
      supabase.from('lesson_plans')
        .select('summary, improvement_points, next_goals, created_at')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .limit(3),
    ])

    const summaryData = await summaryRes.json()
    let transcriptSummary: any = {}
    try {
      transcriptSummary = JSON.parse(summaryData.choices?.[0]?.message?.content || '{}')
    } catch {
      transcriptSummary = { lesson_flow: transcript.slice(0, 500) }
    }

    const transcriptRow = transcriptInsert.data
    const recentPlans = historyRes.data

    // ── Step 3: RAG 검색 ──
    const ragQuery = [
      ...(transcriptSummary.key_techniques || []),
      ...(transcriptSummary.main_issues || []),
      member?.level || '',
      effectiveCourtType,
    ].filter(Boolean).join(', ')

    const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: ragQuery.slice(0, 2000) }),
    })
    const embedData = await embedRes.json()

    let knowledgeContext = ''
    if (embedData.data?.[0]?.embedding) {
      const { data: knowledgeResults } = await supabase.rpc('search_tennis_knowledge', {
        query_embedding: embedData.data[0].embedding,
        match_threshold: 0.4,
        match_count: 4,
        filter_level: member?.level || null,
        filter_court_type: effectiveCourtType,
      })
      knowledgeContext = (knowledgeResults || [])
        .map((k: any) => `[${k.category}][${k.level || '전체'}] ${k.title}\n${k.content}`)
        .join('\n\n---\n\n')
    }

    // ── Step 4: Claude 분석 ──
    async function fetchClaude(body: object, retries = 3): Promise<Response> {
      for (let i = 0; i < retries; i++) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        if (res.status !== 529 && res.status !== 503) return res
        await new Promise(r => setTimeout(r, (i + 1) * 3000))
      }
      throw new Error('Claude 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.')
    }

    const historyContext = (recentPlans || []).map((p, i) =>
      `[${i + 1}회 전 - ${new Date(p.created_at).toLocaleDateString('ko-KR')}]\n요약: ${p.summary}\n다음목표: ${p.next_goals}`
    ).join('\n\n')

    const userPrompt = `## 회원 프로파일
- 이름: ${member?.name || '미상'} | 레벨: ${member?.level || '초급'} | 누적 레슨: ${member?.lesson_count || 0}회
- 손: ${member?.dominant_hand || '오른손'} | 백핸드: ${member?.backhand_type || '양손'} | 목표: ${member?.goal || '취미'}
- 부상: ${member?.injury_history || '없음'} | 약점: ${(member?.weak_points || []).join(', ') || '없음'}

## 코트 환경
${effectiveCourtType}

## 오늘 레슨 요약 (전체 균등 반영)
${transcriptSummary.lesson_flow || '(요약 없음)'}

주요 기술: ${(transcriptSummary.key_techniques || []).join(', ') || '없음'}
주요 문제: ${(transcriptSummary.main_issues || []).join(', ') || '없음'}
코치 지시: ${(transcriptSummary.coach_instructions || []).join(' / ') || '없음'}

## 이전 레슨 히스토리 (최근 3회)
${historyContext || '(이전 레슨 기록 없음)'}

## 관련 교육 자료
${knowledgeContext || '(없음)'}

중요: drill_suggestions는 정확히 2개만 작성하세요. JSON만 출력하고 다른 텍스트는 포함하지 마세요.`

    const claudeRes = await fetchClaude({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const claudeData = await claudeRes.json()
    if (!claudeData.content?.[0]?.text) {
      throw new Error(`Claude 응답 오류: ${JSON.stringify(claudeData)}`)
    }
    const rawResponse = claudeData.content[0].text

    // ── JSON 파싱 (강화) ──
    let parsed: any = {}
    const cleanedResponse = rawResponse
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim()

    // 1차: 전체가 JSON인 경우
    try {
      parsed = JSON.parse(cleanedResponse)
    } catch {
      // 2차: 텍스트 안에서 JSON 블록 추출
      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]) } catch { /* 파싱 실패 */ }
      }
    }

    // 파싱 완전 실패 시 rawResponse를 summary로
    if (!parsed.summary) {
      parsed = {
        summary: cleanedResponse.slice(0, 300),
        improvement_points: [],
        next_goals: [],
        drill_suggestions: [],
      }
    }

    function normalizeList(val: unknown): string[] {
      if (Array.isArray(val)) return val.map(String).filter(Boolean)
      if (typeof val === 'string') {
        return val.replace(/\\n/g, '\n').split('\n')
          .map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim())
          .filter(Boolean)
      }
      return []
    }

    // drill_suggestions 최대 2개로 제한
    const drillSuggestions = Array.isArray(parsed.drill_suggestions)
      ? parsed.drill_suggestions.slice(0, 2)
      : []

    // ── Step 5: DB 저장 ──
    const { data: plan } = await supabase.from('lesson_plans').insert({
      coach_id: coachId,
      member_id: memberId,
      transcript_id: transcriptRow?.id,
      court_type: effectiveCourtType,
      summary: parsed.summary || '',
      improvement_points: normalizeList(parsed.improvement_points),
      next_goals: normalizeList(parsed.next_goals),
      session_goals: parsed.session_goals || '',
      drill_suggestions: drillSuggestions,
      duration_minutes: durationSeconds ? Math.round(durationSeconds / 60) : Math.round((audioFile.size / 16000) / 60),
      raw_response: rawResponse,
      transcript_summary: transcriptSummary,
    }).select().single()

    await supabase.from('members')
      .update({ lesson_count: (member?.lesson_count || 0) + 1 })
      .eq('id', memberId)

    return new Response(JSON.stringify({ success: true, plan, transcript, court_type: effectiveCourtType }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('process-lesson error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
