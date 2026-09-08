import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── cleanup-audio ──
// 처리 완료 후 7일 이상 된 레슨 오디오 파일 삭제
// Supabase Cron: 매일 새벽 4시 실행
// Schedule: 0 4 * * *

serve(async (_req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    // 7일 이상 된 completed 레슨 중 audio_storage_path가 있는 것
    const { data: plans, error: queryErr } = await supabase
      .from('lesson_plans')
      .select('id, audio_storage_path')
      .eq('status', 'completed')
      .not('audio_storage_path', 'is', null)
      .lt('updated_at', sevenDaysAgo.toISOString())

    if (queryErr) throw queryErr

    if (!plans || plans.length === 0) {
      console.log('[cleanup-audio] 삭제 대상 없음')
      return new Response(JSON.stringify({ deleted: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }

    const paths = plans.map((p: any) => p.audio_storage_path as string)
    const { error: deleteErr } = await supabase.storage.from('lesson-audio').remove(paths)
    if (deleteErr) throw deleteErr

    // audio_storage_path null 처리 (삭제 완료 표시)
    const ids = plans.map((p: any) => p.id as string)
    await supabase.from('lesson_plans').update({ audio_storage_path: null }).in('id', ids)

    console.log(`[cleanup-audio] ${paths.length}개 오디오 파일 삭제 완료 (7일 초과)`)
    return new Response(JSON.stringify({ deleted: paths.length, paths }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    console.error('[cleanup-audio] error:', e.message)
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
