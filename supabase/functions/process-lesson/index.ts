import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── SSE 헬퍼 ──
function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

// ── 고정 System Prompt (Anthropic 프롬프트 캐싱 대상) ──
// 역할 설명 + JSON 스키마를 여기에 고정. 매 호출마다 캐싱되어 input 토큰 비용 절감.
const SYSTEM_PROMPT = `당신은 USTA/ITF 자격증을 보유한 전문 테니스 코치 어시스턴트입니다.
코치가 레슨 후 회원별 맞춤 리포트를 작성할 수 있도록 분석을 제공합니다.

## 분석 원칙
1. 레슨에서 구체적으로 언급된 기술/상황을 중심으로 분석
2. 회원 레벨과 목표에 맞는 피드백 제공
3. 코트 환경에 적합한 드릴 추천
4. 이전 레슨 히스토리가 있으면 연속성 있게 반영
5. 개선 포인트는 "원인 → 교정법" 형식으로
6. 드릴 추천은 구체적인 반복 횟수/목표 포함

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요 (한국어):
{
  "summary": "오늘 레슨 요약 (4-6문장)",
  "session_goals": "이번 레슨에서 달성하려 했던 핵심 목표 1-2가지",
  "improvement_points": [
    "개선 포인트 1 (원인 → 교정법)",
    "개선 포인트 2",
    "개선 포인트 3",
    "개선 포인트 4"
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
}`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const wantsStream = req.headers.get('accept') === 'text/event-stream'

  let streamController: ReadableStreamDefaultController<string> | null = null
  let stream: ReadableStream<string> | null = null

  if (wantsStream) {
    stream = new ReadableStream<string>({
      start(controller) { streamController = controller },
    })
  }

  function pushProgress(step: number, total: number, message: string) {
    if (streamController) {
      streamController.enqueue(sseEvent({ type: 'progress', step, total, message }))
    }
  }

  async function run(): Promise<Response> {
    try {
      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
      const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
      const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

      const formData = await req.formData()
      const audioFile = formData.get('audio') as File
      const memberId = formData.get('member_id') as string
      const lessonId = formData.get('lesson_id') as string | null
      const coachId = formData.get('coach_id') as string
      const courtType = (formData.get('court_type') as string) || null

      if (!audioFile || !memberId || !coachId) {
        return new Response(JSON.stringify({ error: '필수 파라미터 누락' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // ── Step 1: Whisper STT + 회원/코치 정보 병렬 ──
      pushProgress(1, 5, '🎙 음성 변환 중...')

      const whisperForm = new FormData()
      whisperForm.append('file', audioFile, 'audio.m4a')
      whisperForm.append('model', 'whisper-1')
      whisperForm.append('language', 'ko')
      whisperForm.append('prompt',
        '테니스 레슨 녹음입니다. 포핸드, 백핸드, 서브, 발리, 스매시, 로브, 드롭샷, 풋워크, 스플릿스텝, ' +
        '탑스핀, 슬라이스, 플랫, 이스턴, 웨스턴, 컨티넨탈, 트로피자세, 팔로스루, 테이크백, ' +
        '듀스코트, 어드밴티지, 서비스라인, 베이스라인, 크로스코트, 다운더라인, ' +
        '어프로치, 드롭발리, 앵글발리, 패싱샷, 오픈코트 등의 용어가 나올 수 있습니다.'
      )

      const [whisperRes, memberRes, coachRes] = await Promise.all([
        fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
          body: whisperForm,
        }),
        supabase
          .from('members')
          .select('name, level, dominant_hand, backhand_type, goal, injury_history, weak_points, lesson_count, notes, court_type')
          .eq('id', memberId)
          .single(),
        supabase
          .from('coach_profiles')
          .select('default_court_type, specialties, coaching_style')
          .eq('coach_id', coachId)
          .single(),
      ])

      const whisperData = await whisperRes.json()
      const transcript = whisperData.text
      if (!transcript) throw new Error(`음성 변환 실패: ${JSON.stringify(whisperData)}`)

      const member = memberRes.data
      const coachProfile = coachRes.data

      const effectiveCourtType = courtType
        || member?.court_type
        || coachProfile?.default_court_type
        || '풀코트야외'

      // ── Step 2: transcript 요약 (GPT-4o-mini) + transcript 저장 + 히스토리 병렬 ──
      // transcript가 길면 GPT-4o-mini로 저렴하게 요약하여 Claude 입력 토큰 절감
      pushProgress(2, 5, '📝 레슨 내용 요약 중...')

      const TRANSCRIPT_SUMMARY_PROMPT = `다음은 테니스 레슨 녹음의 전문입니다.
코치 AI 분석에 사용할 핵심 내용을 추출해주세요.

출력 형식 (JSON):
{
  "key_techniques": ["언급된 기술 1", "기술 2", ...],
  "main_issues": ["주요 문제점 1", "문제점 2", ...],
  "lesson_flow": "레슨 전체 흐름 요약 (3-5문장)",
  "coach_instructions": ["코치가 준 주요 지시사항 1", "지시사항 2", ...]
}

레슨 녹음:
${transcript}`

      const [summaryRes, transcriptInsert, historyRes] = await Promise.all([
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 800,
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: TRANSCRIPT_SUMMARY_PROMPT }],
          }),
        }),
        supabase
          .from('lesson_transcripts')
          .insert({
            coach_id: coachId,
            member_id: memberId,
            lesson_id: lessonId || null,
            transcript,
            duration_seconds: Math.round(audioFile.size / 16000),
            recorded_at: new Date().toISOString(),
          })
          .select()
          .single(),
        supabase
          .from('lesson_plans')
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

      // ── Step 3: RAG - 요약된 키워드로 knowledge 벡터 검색 ──
      // transcript 전체가 아닌 핵심 키워드로 임베딩 → 더 정확한 검색
      pushProgress(3, 5, '🔍 관련 교육 자료 검색 중...')

      const ragQuery = [
        ...(transcriptSummary.key_techniques || []),
        ...(transcriptSummary.main_issues || []),
        member?.level || '',
        effectiveCourtType,
      ].filter(Boolean).join(', ')

      const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: ragQuery.slice(0, 2000),
        }),
      })
      const embedData = await embedRes.json()

      let knowledgeContext = ''
      if (embedData.data?.[0]?.embedding) {
        const { data: knowledgeResults } = await supabase.rpc('search_tennis_knowledge', {
          query_embedding: embedData.data[0].embedding,
          match_threshold: 0.4,
          match_count: 5,           // 8 → 5로 축소 (정확도는 올라감)
          filter_level: member?.level || null,
          filter_court_type: effectiveCourtType,
        })
        knowledgeContext = (knowledgeResults || [])
          .map((k: any) => `[${k.category}][${k.level || '전체'}] ${k.title}\n${k.content}`)
          .join('\n\n---\n\n')
      }

      // ── Step 4: Claude 분석 (system prompt 캐싱 + 경량 user prompt) ──
      pushProgress(4, 5, '🧠 AI 레슨 분석 중...')

      const historyContext = (recentPlans || []).map((p, i) =>
        `[${i + 1}회 전 - ${new Date(p.created_at).toLocaleDateString('ko-KR')}]\n` +
        `요약: ${p.summary}\n` +
        `다음목표: ${p.next_goals}`
      ).join('\n\n')

      // user prompt는 이번 레슨 데이터만 (역할/스키마는 system에)
      const userPrompt = `## 회원 프로파일
- 이름: ${member?.name || '미상'} | 레벨: ${member?.level || '초급'} | 누적 레슨: ${member?.lesson_count || 0}회
- 손: ${member?.dominant_hand || '오른손'} | 백핸드: ${member?.backhand_type || '양손'} | 목표: ${member?.goal || '취미'}
- 부상: ${member?.injury_history || '없음'} | 약점: ${(member?.weak_points || []).join(', ') || '없음'}
- 코치 메모: ${member?.notes || '없음'}

## 코트 환경
${effectiveCourtType} (상가미니/하프코트/풀코트실내/풀코트야외/멀티코트)

## 오늘 레슨 요약
${transcriptSummary.lesson_flow || '(요약 없음)'}

주요 기술: ${(transcriptSummary.key_techniques || []).join(', ') || '없음'}
주요 문제: ${(transcriptSummary.main_issues || []).join(', ') || '없음'}
코치 지시: ${(transcriptSummary.coach_instructions || []).join(' / ') || '없음'}

## 이전 레슨 히스토리 (최근 3회)
${historyContext || '(이전 레슨 기록 없음)'}

## 관련 테니스 교육 자료
${knowledgeContext || '(관련 자료 없음)'}`

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',  // 프롬프트 캐싱 활성화
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 2048,
          stream: wantsStream,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },  // system prompt 캐싱
            },
          ],
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })

      let rawResponse = ''

      if (wantsStream && claudeRes.body) {
        const reader = claudeRes.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value)
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') continue
            try {
              const evt = JSON.parse(payload)
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                const text = evt.delta.text || ''
                rawResponse += text
                streamController?.enqueue(sseEvent({ type: 'chunk', text }))
              }
            } catch { /* skip malformed */ }
          }
        }
      } else {
        const claudeData = await claudeRes.json()
        if (!claudeData.content?.[0]?.text) {
          throw new Error(`Claude 응답 오류: ${JSON.stringify(claudeData)}`)
        }
        rawResponse = claudeData.content[0].text
      }

      // ── JSON 파싱 ──
      let parsed: any = {}
      try {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
      } catch {
        parsed = { summary: rawResponse, improvement_points: [], next_goals: [] }
      }

      function normalizeList(val: unknown): string[] {
        if (Array.isArray(val)) return val.map(String).filter(Boolean)
        if (typeof val === 'string') {
          return val
            .replace(/\\n/g, '\n')
            .split('\n')
            .map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim())
            .filter(Boolean)
        }
        return []
      }

      const improvementPoints = normalizeList(parsed.improvement_points)
      const nextGoals = normalizeList(parsed.next_goals)

      // ── Step 5: DB 저장 ──
      pushProgress(5, 5, '💾 분석 결과 저장 중...')

      const { data: plan } = await supabase
        .from('lesson_plans')
        .insert({
          coach_id: coachId,
          member_id: memberId,
          transcript_id: transcriptRow?.id,
          court_type: effectiveCourtType,
          summary: parsed.summary || '',
          improvement_points: improvementPoints,
          next_goals: nextGoals,
          session_goals: parsed.session_goals || '',
          drill_suggestions: parsed.drill_suggestions || [],
          duration_minutes: Math.round((audioFile.size / 16000) / 60),
          raw_response: rawResponse,
          transcript_summary: transcriptSummary,  // 요약본 영구 보관
        })
        .select()
        .single()

      await supabase
        .from('members')
        .update({ lesson_count: (member?.lesson_count || 0) + 1 })
        .eq('id', memberId)

      const result = { success: true, plan, transcript, court_type: effectiveCourtType }

      if (streamController) {
        streamController.enqueue(sseEvent({ type: 'done', ...result }))
        streamController.close()
      }

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } catch (error: any) {
      console.error(error)
      if (streamController) {
        streamController.enqueue(sseEvent({ type: 'error', error: error.message }))
        streamController.close()
      }
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  if (wantsStream && stream) {
    run()
    return new Response(stream as any, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  return run()
})
