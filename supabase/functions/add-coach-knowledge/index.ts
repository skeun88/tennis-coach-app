import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VOICE_MONTHLY_LIMIT_SECONDS = 1800 // 월 30분 = 1800초

// 현재 연월 'YYYY-MM' 반환
function getCurrentYearMonth(): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

// 500~800자 단위로 청킹 (20% overlap)
function chunkText(text: string, chunkSize = 650, overlap = 130): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end).trim())
    if (end === text.length) break
    start += chunkSize - overlap
  }
  return chunks.filter(c => c.length > 50)
}

// OpenAI 임베딩 생성
async function createEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
  })
  const data = await res.json()
  if (!data.data?.[0]?.embedding) throw new Error(`임베딩 생성 실패: ${JSON.stringify(data)}`)
  return data.data[0].embedding
}

// 월 음성 사용량 조회
async function getMonthlyVoiceUsage(supabase: ReturnType<typeof createClient>, coachId: string, yearMonth: string): Promise<number> {
  const { data } = await supabase
    .from('coach_voice_usage')
    .select('used_seconds')
    .eq('coach_id', coachId)
    .eq('year_month', yearMonth)
    .maybeSingle()
  return data?.used_seconds ?? 0
}

// 월 음성 사용량 추가 (upsert)
async function addMonthlyVoiceUsage(supabase: ReturnType<typeof createClient>, coachId: string, yearMonth: string, addSeconds: number): Promise<void> {
  const current = await getMonthlyVoiceUsage(supabase, coachId, yearMonth)
  await supabase
    .from('coach_voice_usage')
    .upsert(
      { coach_id: coachId, year_month: yearMonth, used_seconds: current + addSeconds },
      { onConflict: 'coach_id,year_month' }
    )
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const WHISPER_API_KEY = Deno.env.get('OPENAI_API_KEY')!

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const contentType = req.headers.get('content-type') || ''
    let coachId: string, category: string, level: string, title: string, source: string
    let textContent = ''
    let audioDurationSeconds = 0

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      coachId = formData.get('coach_id') as string
      category = (formData.get('category') as string) || '기타'
      level = (formData.get('level') as string) || '전체'
      title = formData.get('title') as string
      const durationRaw = formData.get('duration_seconds') as string | null
      audioDurationSeconds = durationRaw ? Math.round(parseFloat(durationRaw)) : 0

      const audioFile = formData.get('audio') as File | null
      const textFile = formData.get('file') as File | null

      if (!coachId) {
        return new Response(JSON.stringify({ error: 'coach_id 필수' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (audioFile) {
        // ── 음성 입력: 월 사용량 체크 ──
        source = '코치 직접 입력'
        if (audioFile.size < 5000) {
          return new Response(JSON.stringify({ error: '녹음이 너무 짧습니다. 최소 10초 이상 녹음해 주세요.' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        // duration_seconds가 없으면 파일 크기로 추정 (m4a ~16kbps 기준)
        if (audioDurationSeconds <= 0) {
          audioDurationSeconds = Math.max(10, Math.round(audioFile.size / 2000))
        }

        const yearMonth = getCurrentYearMonth()
        const usedSeconds = await getMonthlyVoiceUsage(supabase, coachId, yearMonth)
        const remainingSeconds = VOICE_MONTHLY_LIMIT_SECONDS - usedSeconds

        if (remainingSeconds <= 0) {
          return new Response(JSON.stringify({
            error: `이번 달 음성 녹음 한도(30분)를 모두 사용했습니다. 다음 달 1일에 초기화됩니다.`,
            used_seconds: usedSeconds,
            limit_seconds: VOICE_MONTHLY_LIMIT_SECONDS,
          }), {
            status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        if (audioDurationSeconds > remainingSeconds) {
          const remainMin = Math.floor(remainingSeconds / 60)
          const remainSec = remainingSeconds % 60
          return new Response(JSON.stringify({
            error: `이번 달 남은 음성 녹음 시간(${remainMin}분 ${remainSec}초)을 초과합니다. 더 짧게 녹음해 주세요.`,
            used_seconds: usedSeconds,
            remaining_seconds: remainingSeconds,
            limit_seconds: VOICE_MONTHLY_LIMIT_SECONDS,
          }), {
            status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        // Whisper STT
        const whisperForm = new FormData()
        whisperForm.append('file', audioFile, 'audio.m4a')
        whisperForm.append('model', 'whisper-1')
        whisperForm.append('language', 'ko')
        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${WHISPER_API_KEY}` },
          body: whisperForm,
        })
        const whisperData = await whisperRes.json()
        textContent = (whisperData.text || '').trim()
        if (!textContent || textContent.split(/\s+/).length < 10) {
          return new Response(JSON.stringify({ error: '음성 인식 내용이 너무 적습니다. 다시 녹음해 주세요.' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        // 사용량 기록 (STT 성공 후)
        await addMonthlyVoiceUsage(supabase, coachId, yearMonth, audioDurationSeconds)

      } else if (textFile) {
        // 파일 입력: txt 지원 (PDF는 추후)
        source = '코치 파일 업로드'
        if (textFile.size > 10 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: '파일 크기는 최대 10MB입니다.' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        textContent = await textFile.text()
      } else {
        // 텍스트 직접 입력
        source = '코치 직접 입력'
        textContent = (formData.get('text') as string) || ''
      }
    } else {
      // JSON 입력 (텍스트 직접)
      const body = await req.json()
      coachId = body.coach_id
      category = body.category || '기타'
      level = body.level || '전체'
      title = body.title || ''
      textContent = body.text || ''
      source = '코치 직접 입력'
    }

    if (!textContent || textContent.trim().length < 20) {
      return new Response(JSON.stringify({ error: '등록할 내용이 없습니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 제목 자동 생성
    if (!title) {
      const dateStr = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
      title = `${dateStr} ${category} 코칭 스타일`
    }

    // 청킹
    const chunks = chunkText(textContent)
    if (chunks.length === 0) {
      return new Response(JSON.stringify({ error: '내용이 너무 짧습니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 각 청크 임베딩 생성 후 저장
    const results = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const chunkTitle = chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title
      const textToEmbed = `[${category}][${level}] ${chunkTitle}\n${chunk}`

      const embedding = await createEmbedding(textToEmbed, OPENAI_API_KEY)

      const { data, error } = await supabase
        .from('tennis_knowledge')
        .insert({
          coach_id: coachId,
          source,
          category,
          level,
          title: chunkTitle,
          content: chunk,
          embedding,
        })
        .select('id')
        .single()

      if (error) throw error
      results.push(data.id)
    }

    return new Response(JSON.stringify({
      success: true,
      saved: results.length,
      ids: results,
      title,
      category,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('add-coach-knowledge error:', err)
    const msg = err instanceof Error ? err.message : (err && typeof err === 'object' ? JSON.stringify(err) : String(err))
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
