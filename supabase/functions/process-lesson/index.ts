import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── STT 교정 사전 ──
// Whisper가 실제 transcript에서 오인식한 것으로 확인된 사례만 추가할 것 (자동 추가 금지)
const STT_CORRECTION_DICT: Array<{ wrong: string; correct: string }> = [
  { wrong: '고핸드', correct: '포핸드' },
  { wrong: '코에인드', correct: '포핸드' },
  { wrong: '맥핸드', correct: '백핸드' },
  { wrong: '크루스', correct: '크로스' },
  { wrong: '4핸드', correct: '포핸드' },
  { wrong: '스포핸드', correct: '포핸드' },
]

// 코러스는 실재 한국어 단어이므로 조사 결합형까지 명시 처리 (부분 문자열 오치환 방지)
const KOREOSEU_JOSA = new Set(['', '로', '는', '를', '가', '이', '에서', '에', '도', '만', '부터', '까지', '와', '과', '랑', '이랑', '에게', '한테', '처럼', '으로', '보다', '이고', '이면', '면'])

// 무음·무의미 transcript 감지 — 분석 진행 차단용
// 비율 기반 차단(정상 레슨 오탐 위험) 제거 후, prompt echo 탐지로 집중
function detectInvalidTranscript(transcript: string, whisperPrompt: string): string | null {
  // 1. 구 whisper prompt echo 패턴 ("등의 용어가 나올 수 있습니다" 문구가 포함된 경우)
  if (transcript.includes('등의 용어가 나올 수 있습니다')) {
    return '음성이 인식되지 않았습니다. 녹음 상태를 확인해 주세요. (구 whisper prompt 반복 출력 감지)'
  }

  // 2. 현재 prompt 정확 일치 (공백·문장부호 제거 후 비교)
  const norm = (s: string) => s.replace(/[.,!?\s]/g, '')
  const promptNorm = norm(whisperPrompt)
  const transcriptNorm = norm(transcript)
  if (promptNorm.length > 5 && transcriptNorm === promptNorm) {
    return '음성이 인식되지 않았습니다. 녹음 상태를 확인해 주세요. (whisper prompt와 동일한 출력 감지)'
  }

  // 3. transcript가 prompt 토큰의 반복으로만 구성된 경우 탐지
  // 예: "테니스 코치 레슨 녹음" × N — 현재/구 prompt 어절과 85% 이상 겹치고 고유 어절이 prompt 크기 이하
  const promptTokens = whisperPrompt.replace(/[.,!?]/g, ' ').split(/\s+/).filter(w => w.length > 0)
  const tTokens = transcript.replace(/[.,!?]/g, ' ').split(/\s+/).filter(w => w.length > 0)
  if (tTokens.length >= 4 && promptTokens.length >= 2) {
    // prefix-match: prompt 토큰이 transcript 토큰의 prefix이거나 그 반대 (예: "녹음입니다" ↔ "녹음")
    const matchCount = tTokens.filter(tw =>
      promptTokens.some(pw => pw.startsWith(tw) || tw.startsWith(pw))
    ).length
    const coverageRatio = matchCount / tTokens.length
    const uniqueInTranscript = new Set(tTokens).size
    if (coverageRatio >= 0.85 && uniqueInTranscript <= promptTokens.length) {
      return `음성이 인식되지 않았습니다. 녹음 상태를 확인해 주세요. (whisper prompt 반복 출력 감지: prompt 토큰 일치율 ${Math.round(coverageRatio * 100)}%)`
    }
  }

  return null
}

function applySTTCorrections(text: string): string {
  if (STT_CORRECTION_DICT.length === 0) return text
  let result = text
  const corrected: string[] = []
  for (const { wrong, correct } of STT_CORRECTION_DICT) {
    // 한국어는 \b word boundary가 없으므로 lookahead/lookbehind로 처리:
    // 앞뒤 문자가 한글 자모·영문자가 아닌 경우에만 치환 (조사 제외)
    // 조사 포함 패턴은 별도 항목으로 추가할 것 (예: { wrong: '코에인드부터', correct: '포핸드부터' })
    const regex = new RegExp(`(?<![가-힣a-zA-Z])${wrong}(?![가-힣a-zA-Z])`, 'g')
    const count = (result.match(regex) ?? []).length
    if (count > 0) {
      result = result.replace(regex, correct)
      corrected.push(`${wrong}→${correct} (${count}건)`)
    }
  }
  // 코러스 → 크로스: 실재 단어이므로 단독/조사 결합형만 치환 (다른 단어 일부면 skip)
  let koreoseuCount = 0
  result = result.replace(/코러스([가-힣]*)/g, (match, suffix) => {
    if (KOREOSEU_JOSA.has(suffix)) {
      koreoseuCount++
      return '크로스' + suffix
    }
    return match
  })
  if (koreoseuCount > 0) corrected.push(`코러스→크로스 (${koreoseuCount}건)`)

  if (corrected.length > 0) {
    console.log('[STT][교정]', corrected.join(', '))
  }
  return result
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── System Prompt (캐싱 대상) ──
const SYSTEM_PROMPT = `당신은 USTA/ITF 자격증을 보유한 전문 테니스 코치 어시스턴트입니다.
코치가 레슨 후 회원별 맞춤 리포트를 작성할 수 있도록 분석을 제공합니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  최우선 원칙 — 다른 모든 지침보다 반드시 우선 적용
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ "summary" · "session_goals" · "improvement_points" · "next_goals" 파트:
  코치가 레슨 중 실제로 말한 단어와 표현만 사용할 것.
  코치가 언급하지 않은 기술·개념·드릴은 절대 추가하지 말 것.
■ "summary" 파트: 코치가 말하지 않은 드릴/기술은 절대 포함 금지
■ 코치의 원래 용어와 표현을 그대로 살릴 것 — 임의 재해석·일반화 금지
■ 불확실한 내용은 추론하지 말고 해당 항목을 비워 둘 것
■ "drill_suggestions" 파트 (예외 허용):
  오늘 레슨 요약의 기술·문제점을 기반으로 "관련 교육 자료(RAG)"에서
  적합한 드릴을 선택·추천하세요. 코치가 레슨 중 명시적으로 언급하지
  않은 드릴도 RAG 자료에 근거가 있다면 추천 가능합니다.
  단, 반드시 오늘 레슨 요약 내용과 연관된 드릴만 선택할 것.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 분석 원칙
1. 레슨에서 구체적으로 언급된 기술/상황을 중심으로 분석
2. 회원 레벨과 목표에 맞는 피드백 제공
3. 코트 환경에 적합한 드릴 추천
4. 이전 레슨 히스토리가 있으면 연속성 있게 반영
5. 개선 포인트는 "원인 → 교정법" 형식으로
6. 드릴 추천은 구체적인 반복 횟수/목표 포함
7. 레슨 전체(시작~끝)를 균등하게 반영할 것. 초반 내용에만 치우치지 말 것

## 절대 금지 사항 (예외 없음)
- 날씨, 식사, 스포츠 뉴스, 일상 잡담, 안부 인사, 개인적 횟고담 등 비레슨 대화는 분석에 절대 포함하지 마세요
- 입력으로 주어진 "오늘 레슨 요약"에 없는 내용은 상상/추가하지 마세요
- 레슨 요약에 명시된 레슨 기술/피드백/지시사항만을 분석 대상으로 하세요

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요 (한국어). JSON 외 텍스트 절대 포함 금지.

━━ 분량 상한 (엄수) ━━
• ai_title: 5-8단어 이내, 명사형으로 끝낼 것 (예: "포핸드 타점 교정 집중 레슨")
• summary: 2문장 이내
• session_goals: 1문장 이내
• improvement_points: 정확히 2항목, 각 1문장 (원인→교정법 핵심만)
• next_goals: 정확히 2항목, 각 1문장
• drill method/court_adaptation: 각 1문장 이내
• 전체 출력 950토큰 이내

{
  "ai_title": "이번 레슨 핵심 주제 (5-8단어, 명사형)",
  "summary": "오늘 레슨 흐름 요약 (2문장 이내)",
  "session_goals": "이번 레슨 핵심 목표 (1문장)",
  "improvement_points": [
    "개선 포인트 1: 원인 → 교정법 (1문장)",
    "개선 포인트 2: 원인 → 교정법 (1문장)"
  ],
  "next_goals": [
    "다음 레슨 목표 1 (1문장)",
    "다음 레슨 목표 2 (1문장)"
  ],
  "drill_suggestions": [
    {
      "name": "드릴 이름",
      "purpose": "목적 (1문장)",
      "method": "실행 방법 (1문장)",
      "reps": "횟수/시간",
      "court_adaptation": "코트 변형 (1문장)"
    }
  ]
}
drill_suggestions는 정확히 2개만 포함할 것.`

// 전사 전체를 그대로 사용 (샘플링 제거)
// 한국어 1시간 레슨 전사 = ~8,000 토큰 수준, 비용 차이 미미하고 샘플링이 오히려 품질 저하

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // catch 블록에서 접근하기 위해 try 밖에 선언
  let lessonPlanId: string | null = null
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

    // ── body 파싱: FormData(기존) 또는 JSON(신규 비동기 방식) 지원 ──
    let audioFile: File | null = null
    let memberId: string = ''
    let coachId: string = ''
    let lessonId: string | null = null
    let courtType: string | null = null
    let durationSeconds: number | null = null
    let audioStoragePath: string | null = null
    let enhancedMode: boolean = false

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      // 비동기 방식: Storage에서 오디오 다운로드
      const body = await req.json()
      lessonPlanId = body.lesson_plan_id ?? null
      audioStoragePath = body.audio_storage_path ?? null
      memberId = body.member_id ?? ''
      coachId = body.coach_id ?? ''
      durationSeconds = body.duration_seconds ? parseInt(String(body.duration_seconds), 10) : null
      lessonId = body.lesson_id ?? null
      courtType = body.court_type ?? null
      enhancedMode = body.enhanced_mode === true

      if (!audioStoragePath) {
        return new Response(JSON.stringify({ error: 'audio_storage_path가 없습니다.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Storage에서 오디오 다운로드
      const { data: audioData, error: downloadError } = await supabase.storage
        .from('lesson-audio')
        .download(audioStoragePath)

      if (downloadError || !audioData) {
        const errMsg = `오디오 다운로드 실패: ${downloadError?.message ?? 'unknown'}`
        if (lessonPlanId) {
          await supabase.from('lesson_plans').update({ status: 'failed', error_message: errMsg }).eq('id', lessonPlanId)
        }
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      audioFile = new File([audioData], 'audio.m4a', { type: 'audio/m4a' })
    } else {
      // 기존 FormData 방식 (하위 호환)
      const formData = await req.formData()
      audioFile = formData.get('audio') as File | null
      memberId = formData.get('member_id') as string
      lessonId = formData.get('lesson_id') as string | null
      coachId = formData.get('coach_id') as string
      courtType = (formData.get('court_type') as string) || null
      const durationSecondsRaw = formData.get('duration_seconds') as string | null
      durationSeconds = durationSecondsRaw ? parseInt(durationSecondsRaw, 10) : null
    }

    // ── 필수 파라미터 체크 ──
    if (!memberId || !coachId) {
      if (lessonPlanId) await supabase.from('lesson_plans').update({ status: 'failed', error_message: '필수 파라미터 누락' }).eq('id', lessonPlanId)
      return new Response(JSON.stringify({ error: '필수 파라미터 누락 (member_id, coach_id)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── 서버사이드 quota 체크 (원자적 처리) ──
    if (Deno.env.get('BETA_MODE') !== 'true') {
      const now = new Date()
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

      // 구독 + 이번 달 사용량 병렬 조회
      const [subRes, usageRes] = await Promise.all([
        supabase.from('subscriptions')
          .select('plan_id, status, extra_report_credits')
          .eq('coach_id', coachId)
          .single(),
        supabase.from('ai_analysis_usage')
          .select('count')
          .eq('coach_id', coachId)
          .eq('year_month', yearMonth)
          .maybeSingle(),
      ])

      const sub = subRes.data
      const monthlyUsed: number = usageRes.data?.count ?? 0

      const PLAN_LIMITS: Record<string, number> = { free: 3, basic: 10, pro: 50 }
      const limit = sub ? (PLAN_LIMITS[sub.plan_id] ?? 0) : 0

      if (sub && (sub.status === 'blocked' || sub.status === 'cancelled')) {
        if (lessonPlanId) await supabase.from('lesson_plans').update({ status: 'failed', error_message: '구독이 차단되었습니다.' }).eq('id', lessonPlanId)
        return new Response(JSON.stringify({ error: '구독이 차단되었습니다.', code: 'SUBSCRIPTION_BLOCKED' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (monthlyUsed >= limit) {
        // 월 한도 초과 → 추가 크레딧 시도
        const { data: deducted } = await supabase.rpc('deduct_extra_report_credit', { p_coach_id: coachId })
        if (!deducted) {
          if (lessonPlanId) await supabase.from('lesson_plans').update({ status: 'failed', error_message: 'REPORT_QUOTA_EXCEEDED' }).eq('id', lessonPlanId)
          return new Response(JSON.stringify({
            error: '이번 달 AI 리포트 할당량을 모두 사용했습니다.',
            code: 'REPORT_QUOTA_EXCEEDED',
            used: monthlyUsed,
            limit,
            extra_credits: sub?.extra_report_credits ?? 0,
          }), {
            status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        // 추가 크레딧 차감 성공 → 계속 진행 (monthly count는 증가하지 않음)
      }
    }

    // ── 녹음 데이터 없으면 분석 거부 ──
    if (!audioFile || audioFile.size < 5000) {
      if (lessonPlanId) await supabase.from('lesson_plans').update({ status: 'failed', error_message: '녹음 파일이 너무 짧거나 없습니다.' }).eq('id', lessonPlanId)
      return new Response(JSON.stringify({ error: '녹음 파일이 너무 짧거나 없습니다. 최소 10초 이상 레슨을 녹음한 후 분석을 시작하세요.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    // duration_seconds가 있으면 10초 미만 차단
    if (durationSeconds !== null && durationSeconds < 10) {
      if (lessonPlanId) await supabase.from('lesson_plans').update({ status: 'failed', error_message: `녹음 시간이 너무 짧습니다 (${durationSeconds}초).` }).eq('id', lessonPlanId)
      return new Response(JSON.stringify({ error: `녹음 시간이 너무 짧습니다 (${durationSeconds}초). 최소 10초 이상 녹음해 주세요.` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── 타이밍 계측 시작 ──
    const T = { start: Date.now(), stt: 0, summary: 0, rag: 0, claude: 0, save: 0, member_report: 0 }

    // ── 비동기 시작: 분석 상태를 processing으로 업데이트 ──
    if (lessonPlanId) {
      await supabase.from('lesson_plans').update({ status: 'processing' }).eq('id', lessonPlanId)
    }

    // ── Step 1: Whisper STT + 회원/코치 정보 병렬 ──
    console.log(`[AUDIO] size=${audioFile?.size ?? '?'}bytes, duration=${durationSeconds ?? '?'}s`)
    const tennisTechPrompt = '한국어 테니스 코치 레슨 녹음입니다.'

    const whisperForm = new FormData()
    whisperForm.append('file', audioFile, 'audio.m4a')
    whisperForm.append('language', 'ko')
    whisperForm.append('prompt', tennisTechPrompt)

    // enhanced_mode: Groq whisper-large-v3-turbo (더 강한 노이즈 환경 인식)
    // 기본: OpenAI whisper-1
    let sttEndpoint: string
    let sttAuthHeader: string
    if (enhancedMode) {
      const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? ''
      whisperForm.append('model', 'whisper-large-v3-turbo')
      sttEndpoint = 'https://api.groq.com/openai/v1/audio/transcriptions'
      sttAuthHeader = `Bearer ${GROQ_API_KEY}`
      console.log('[STT] enhanced mode: groq/whisper-large-v3-turbo')
    } else {
      whisperForm.append('model', 'whisper-1')
      sttEndpoint = 'https://api.openai.com/v1/audio/transcriptions'
      sttAuthHeader = `Bearer ${OPENAI_API_KEY}`
      console.log('[STT] standard mode: openai/whisper-1')
    }

    const [whisperRes, memberRes, coachRes] = await Promise.all([
      fetch(sttEndpoint, {
        method: 'POST',
        headers: { 'Authorization': sttAuthHeader },
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
    T.stt = Date.now()
    const rawTranscript = (whisperData.text || '').trim()
    if (!rawTranscript) throw new Error(`음성 변환 실패: ${JSON.stringify(whisperData)}`)
    const transcript = applySTTCorrections(rawTranscript)

    // 무음/무의미 transcript 차단
    const invalidReason = detectInvalidTranscript(transcript, tennisTechPrompt)
    if (invalidReason) {
      console.log(`[STT][INVALID] ${invalidReason} | transcript(first 200): ${transcript.slice(0, 200)}`)
      const failMsg = '음성이 인식되지 않았습니다. 녹음 상태를 확인해 주세요.'
      if (lessonPlanId) {
        await supabase.from('lesson_plans')
          .update({ status: 'failed', error_message: failMsg })
          .eq('id', lessonPlanId)
      }
      return new Response(JSON.stringify({ error: failMsg }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 어절 수 최소 기준 검사
    const wordCount = transcript.split(/\s+/).filter((w: string) => w.length > 0).length
    if (wordCount < 10) {
      const failMsg = `인식된 레슨 내용이 너무 적습니다 (${wordCount}단어). 실제 레슨 음성이 녹음됐는지 확인해 주세요.`
      if (lessonPlanId) {
        await supabase.from('lesson_plans')
          .update({ status: 'failed', error_message: failMsg })
          .eq('id', lessonPlanId)
      }
      return new Response(JSON.stringify({ error: failMsg, transcript }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const member = memberRes.data
    const coachProfile = coachRes.data
    const effectiveCourtType = courtType || member?.court_type || coachProfile?.default_court_type || '풀코트야외'

    // ── Step 2: transcript 균등 샘플링 + 요약 ──
    const TRANSCRIPT_SUMMARY_PROMPT = `다음은 테니스 레슨 녹음 전체 전사입니다. 내용을 빠짐없이 분석해주세요.

⚠️ 최우선 원칙: 코치가 실제로 말한 단어·표현만 추출할 것. 전사에 없는 기술·드릴·개념을 절대 추가하거나 추론하지 마세요. 코치의 원래 용어를 그대로 사용할 것.

지침:
1. 레슨 기술 지도/피드백/지시사항을 빠짐없이 모두 추출하세요. 단, 전사에 실제로 나온 것만.
2. 사적 대화(날씨, 일상, 식사, 잡담, 안부 인사 등)는 lesson_flow에 포함하지 마세요.
   단, 레슨 내용이 짧거나 적어도 있는 레슨 내용은 전부 살려서 상세히 작성하세요.
3. lesson_flow는 레슨의 시작부터 끝까지 전체 흐름을 담아야 하며, 특정 구간에만 치우치지 말 것.
4. lesson_content_ratio: 전체 녹음 중 레슨 관련 대화 비율(0~1).

출력 형식 (JSON):
{
  "key_techniques": ["언급된 기술 1", "기술 2"],
  "main_issues": ["주요 문제점 1", "문제점 2"],
  "lesson_flow": "레슨의 시작~끝 전체 흐름 (있는 내용 전부, 생략 없이)",
  "coach_instructions": ["코치가 준 주요 지시사항 1", "지시사항 2"],
  "lesson_content_ratio": 0.8
}

레슨 전사:
${transcript}`

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
    T.summary = Date.now()
    let transcriptSummary: any = {}
    try {
      transcriptSummary = JSON.parse(summaryData.choices?.[0]?.message?.content || '{}')
    } catch {
      transcriptSummary = { lesson_flow: transcript }
    }

    const transcriptRow = transcriptInsert.data
    const recentPlans = historyRes.data
    const lessonRatio = transcriptSummary.lesson_content_ratio ?? 1.0

    // lessonRatio는 참고용으로만 사용 — 비율이 낮아도 분석 진행 (있는 레슨 내용은 그대로 반영)

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
      // 코치 개인 자료 우선(3개) + 공용 자료 보충(2개) 병렬 검색
      const [personalRes, publicRes] = await Promise.all([
        supabase.rpc('search_tennis_knowledge', {
          query_embedding: embedData.data[0].embedding,
          match_threshold: 0.35,
          match_count: 3,
          filter_level: member?.level || null,
          filter_court_type: effectiveCourtType,
          filter_coach_id: coachId,
        }),
        supabase.rpc('search_tennis_knowledge', {
          query_embedding: embedData.data[0].embedding,
          match_threshold: 0.4,
          match_count: 2,
          filter_level: member?.level || null,
          filter_court_type: effectiveCourtType,
          filter_coach_id: null,
        }),
      ])
      const personalResults = (personalRes.data || [])
      const publicResults = (publicRes.data || [])
      const allResults = [...personalResults, ...publicResults]
      knowledgeContext = allResults
        .map((k: any) => {
          const sourceTag = k.coach_id ? '[코치 개인 자료]' : '[공용 자료]'
          return `${sourceTag}[${k.category}][${k.level || '전체'}] ${k.title}\n${k.content}`
        })
        .join('\n\n---\n\n')
    }
    T.rag = Date.now()

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

## 오늘 레슨 요약 (사적 대화 필터링 완료)
${transcriptSummary.lesson_flow || '(요약 없음)'}

주요 기술: ${(transcriptSummary.key_techniques || []).join(', ') || '없음'}
주요 문제: ${(transcriptSummary.main_issues || []).join(', ') || '없음'}
코치 지시: ${(transcriptSummary.coach_instructions || []).join(' / ') || '없음'}
레슨 실질 비율: ${Math.round(lessonRatio * 100)}%

## 이전 레슨 히스토리 (최근 3회)
${historyContext || '(이전 레슨 기록 없음)'}

## 관련 교육 자료
${knowledgeContext || '(없음)'}

## 지켜야 할 규칙
- drill_suggestions는 정확히 2개만 작성하세요.
- summary, session_goals, improvement_points, next_goals: "오늘 레슨 요약"에 포함된 기술/피드백만 분석하세요. 코치가 언급하지 않은 내용 추가 금지.
- drill_suggestions (예외): 오늘 레슨 요약의 기술·문제점을 기반으로 위의 "관련 교육 자료"에서 적합한 드릴을 선택해 추천하세요. 코치가 레슨 중 명시하지 않은 드릴도 RAG 자료에 있다면 추천 가능합니다.
- 레슨 요약에 없는 내용(사적 대화, 일상 잡담, 날씨, 식사 등)은 분석에 절대 반영하지 마세요.
- 불확실하면 추정하지 말고 레슨 요약에 기반해 작성하세요.
- 레슨 내용이 짧거나 적어도 있는 내용을 최대한 상세하고 구체적으로 분석하세요. 내용을 줄이거나 심플하게 만들지 마세요.
- JSON만 출력하고 다른 텍스트는 포함하지 마세요.`

    const claudeRes = await fetchClaude({
      model: 'claude-sonnet-4-5',
      max_tokens: 3500,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const claudeData = await claudeRes.json()
    T.claude = Date.now()
    console.log('[TOKENS] coach', JSON.stringify(claudeData.usage))
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

    // ── Step 5: DB 저장 (비동기: update / 동기: insert) ──
    const planPayload = {
      transcript_id: transcriptRow?.id,
      court_type: effectiveCourtType,
      ai_title: parsed.ai_title || '',
      summary: parsed.summary || '',
      improvement_points: normalizeList(parsed.improvement_points),
      next_goals: normalizeList(parsed.next_goals),
      session_goals: parsed.session_goals || '',
      drill_suggestions: drillSuggestions,
      duration_minutes: durationSeconds ? Math.round(durationSeconds / 60) : Math.round((audioFile.size / 16000) / 60),
      raw_response: rawResponse,
      transcript_summary: transcriptSummary,
      status: 'completed',
    }

    let plan: any = null
    if (lessonPlanId) {
      // 비동기 방식: 기존 pending 레코드를 업데이트
      const { data } = await supabase.from('lesson_plans')
        .update(planPayload)
        .eq('id', lessonPlanId)
        .select().single()
      plan = data
    } else {
      // 동기 방식 (FormData 하위호환): 신규 insert
      const { data } = await supabase.from('lesson_plans').insert({
        coach_id: coachId,
        member_id: memberId,
        ...planPayload,
      }).select().single()
      plan = data
    }

    T.save = Date.now()

    await supabase.from('members')
      .update({ lesson_count: (member?.lesson_count || 0) + 1 })
      .eq('id', memberId)

    // ── 코치 응답용 타이밍 (save까지만) ──
    const timingPartial = {
      stt_ms:     T.stt     - T.start,
      summary_ms: T.summary - T.stt,
      rag_ms:     T.rag     - T.summary,
      claude_ms:  T.claude  - T.rag,
      save_ms:    T.save    - T.claude,
    }

    // ── Step 6: 회원 리포트 + 오디오 삭제를 백그라운드로 분리 ──
    // pending은 응답 반환 전 동기 구간에서 설정 (태스크 시작 전 죽어도 상태가 남음)
    if (plan?.id) {
      const { error: pendingErr } = await supabase.from('lesson_plans')
        .update({ member_report_status: 'pending' })
        .eq('id', plan.id)
      if (pendingErr) console.error('member_report_status_pending_error:', pendingErr)
    } else {
      console.error('member_report_status_skip: no plan id')
    }

    // save 완료 후 즉시 코치 응답 반환, 나머지는 EdgeRuntime.waitUntil()로 처리
    const bgTask = (async () => {
      try {
        await generateMemberReport({
          supabase, fetchClaude,
          coachId, memberId,
          plan, parsed, member, effectiveCourtType,
          durationSeconds: durationSeconds ?? null,
        })

        // 성공: completed 표시
        if (plan?.id) {
          const { error: completedErr } = await supabase.from('lesson_plans')
            .update({ member_report_status: 'completed' })
            .eq('id', plan.id)
          if (completedErr) console.error('member_report_status_completed_error:', completedErr)
        } else {
          console.error('member_report_status_skip: no plan id')
        }

        // PN-07: 회원에게 AI 리포트 도착 알림
        const { data: coachProfile } = await supabase
          .from('coach_profiles').select('name').eq('coach_id', coachId).maybeSingle()
        const coachName = coachProfile?.name ?? '코치'
        await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
          body: JSON.stringify({
            recipient_type: 'member', recipient_id: memberId,
            title: 'AI 레슨 리포트 도착',
            body: `${coachName} 코치의 레슨 리포트가 도착했습니다.`,
            data: { screen: 'report', plan_id: plan?.id },
            notif_id: 'PN-07',
          }),
        }).catch((e: any) => console.error('pn07_error:', e))
      } catch (e: any) {
        console.error('member_report_error:', e)
        // 실패: failed + 에러 메시지 기록
        if (plan?.id) {
          const { error: failedErr } = await supabase.from('lesson_plans')
            .update({ member_report_status: 'failed', member_report_error: e?.message ?? 'unknown' })
            .eq('id', plan.id)
          if (failedErr) console.error('member_report_status_failed_error:', failedErr)
        } else {
          console.error('member_report_status_skip: no plan id')
        }
      }

      T.member_report = Date.now()
      console.log('[TIMING]', JSON.stringify({
        ...timingPartial,
        member_report_ms: T.member_report - T.save,
        total_ms:         T.member_report - T.start,
      }))

      // ── Step 7: 오디오 파일 보존 (처리 완료 후 7일 보관, cleanup-audio 함수가 주기적으로 정리) ──
      if (audioStoragePath) {
        console.log('audio_preserved_for_retention:', audioStoragePath)
      }
    })()

    // @ts-ignore EdgeRuntime is available in Supabase/Deno runtime
    EdgeRuntime.waitUntil(bgTask)

    return new Response(JSON.stringify({ success: true, plan, transcript, court_type: effectiveCourtType, timing: timingPartial }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('process-lesson error:', error?.message ?? error)
    if (lessonPlanId) {
      const { error: updateErr } = await supabase.from('lesson_plans').update({
        status: 'failed',
        error_message: error?.message ?? 'unknown error',
      }).eq('id', lessonPlanId)
      if (updateErr) console.error('failed status update error:', updateErr.message)
    }
    return new Response(JSON.stringify({ error: error?.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// ── 회원용 레슨 리포트 생성 ──
async function generateMemberReport({
  supabase, fetchClaude,
  coachId, memberId,
  plan, parsed, member, effectiveCourtType,
  durationSeconds,
}: {
  supabase: any; fetchClaude: (body: object, retries?: number) => Promise<Response>;
  coachId: string; memberId: string;
  plan: any; parsed: any; member: any; effectiveCourtType: string;
  durationSeconds: number | null;
}) {
  const MEMBER_SYSTEM_PROMPT = `당신은 테니스 회원에게 오늘 레슨 결과를 친절하게 전달하는 KERRI AI입니다.
전문 용어는 쉽게 풀어쓰고, 회원이 집에서 혼자 연습할 수 있도록 구체적이고 실용적인 안내를 제공합니다.
칭찬과 격려를 적절히 섞어 동기부여가 되도록 작성하세요.

반드시 아래 JSON 형식으로만 응답하세요 (한국어):
{
  "summary": "오늘 레슨 전체 흐름을 회원 시각에서 2-3문장으로 요약 (코치 전문용어 최소화)",
  "achievements": [
    "오늘 잘한 것 / 발전한 것 1 (구체적으로, 긍정적 톤)",
    "성과 2",
    "성과 3"
  ],
  "improvement_points": [
    "개선할 점 1 (왜 중요한지 + 어떻게 고치면 되는지 쉽게 설명)",
    "보완 포인트 2"
  ],
  "practice_plan": [
    {
      "title": "연습 이름",
      "description": "집/코트에서 혼자 할 수 있는 구체적인 연습 방법",
      "duration": "1회 소요 시간 (예: 10분)",
      "frequency": "권장 빈도 (예: 주 3회)",
      "tip": "이 연습을 효과적으로 하는 핵심 팁 1가지"
    }
  ]
}
practice_plan은 2-3개 작성. JSON 외 텍스트 절대 포함 금지.`

  const userPrompt = `## 회원 정보
이름: ${member?.name || '회원'} | 레벨: ${member?.level || '초급'} | 목표: ${member?.goal || '취미'}
코트: ${effectiveCourtType}

## 코치 분석 결과 (이를 바탕으로 회원용 리포트 작성)
오늘 레슨 요약: ${parsed.summary || ''}
개선 포인트: ${(parsed.improvement_points || []).join(' / ')}
다음 목표: ${(parsed.next_goals || []).join(' / ')}
추천 드릴: ${JSON.stringify(parsed.drill_suggestions || [])}

위 코치 분석을 회원이 이해하기 쉽게 변환해주세요. JSON만 출력하세요.`

  const res = await fetchClaude({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    system: [{ type: 'text', text: MEMBER_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: userPrompt }],
  })

  const data = await res.json()
  console.log('[TOKENS] member', JSON.stringify(data.usage))

  if (data.error || !data.content) {
    console.error('member_report_claude_error:', JSON.stringify(data))
  }

  const rawText = data.content?.[0]?.text || ''

  let memberParsed: any = {}
  const cleaned = rawText.replace(/\`\`\`json\s*/g, '').replace(/\`\`\`\s*/g, '').trim()
  try {
    memberParsed = JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) { try { memberParsed = JSON.parse(m[0]) } catch { /* 무시 */ } }
  }

  if (!memberParsed.summary) {
    console.error('member_report_parse_failed: no summary', { rawText: rawText.slice(0, 200) })
    // fallback: 코치 분석 데이터로 기본 리포트 생성
    memberParsed = {
      summary: parsed.summary || '오늘 레슨을 완료했습니다.',
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
      improvement_points: Array.isArray(parsed.improvement_points) ? parsed.improvement_points : [],
      practice_plan: [],
    }
  }

  await supabase.from('member_lesson_reports').insert({
    coach_id: coachId,
    member_id: memberId,
    lesson_plan_id: plan?.id || null,
    lesson_date: new Date().toISOString().split('T')[0],
    summary: memberParsed.summary || '',
    achievements: Array.isArray(memberParsed.achievements) ? memberParsed.achievements : [],
    improvement_points: Array.isArray(memberParsed.improvement_points) ? memberParsed.improvement_points : [],
    practice_plan: Array.isArray(memberParsed.practice_plan) ? memberParsed.practice_plan : [],
  })
}
