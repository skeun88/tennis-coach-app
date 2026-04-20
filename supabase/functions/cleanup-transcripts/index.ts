import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── cleanup-transcripts ──
// 2주 이상 된 lesson_transcripts 원본 삭제 (transcript 컬럼만 null 처리)
// Supabase Cron: 매일 새벽 3시 실행
// Schedule: 0 3 * * *

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

    // transcript 원본만 지우고 행은 유지 (transcript_id 참조 보존)
    const { data, error } = await supabase
      .from('lesson_transcripts')
      .update({ transcript: null })
      .lt('recorded_at', twoWeeksAgo.toISOString())
      .not('transcript', 'is', null)  // 이미 지운 것 제외
      .select('id')

    if (error) throw error

    const count = data?.length || 0
    console.log(`[cleanup-transcripts] ${count}개 transcript 원본 삭제 완료 (2주 초과)`)

    return new Response(JSON.stringify({ success: true, deleted: count }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[cleanup-transcripts] 오류:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
