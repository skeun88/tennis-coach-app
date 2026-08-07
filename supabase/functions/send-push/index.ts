import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// notif_id → notification_settings 컬럼 매핑
const SETTING_KEY_MAP: Record<string, string> = {
  'PN-01': 'lesson_day_before',
  'PN-02': 'lesson_hour_before',
  'PN-03': 'member_message',
  'PN-04': 'reregister_alert',
  'PN-05': 'lesson_day_before',
  'PN-06': 'lesson_hour_before',
  'PN-07': 'ai_report',
  'PN-08': 'coach_message',
  'PN-09': 'schedule_change',
  'PN-10': 'lesson_cancel',
  'PN-11': 'lesson_count_update',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const {
      recipient_type, // 'coach' | 'member'
      recipient_id,   // coach_id (auth uid) or member_id (members.id)
      title,
      body,
      data = {},
      notif_id,       // 'PN-01' ~ 'PN-11' (선택, 중복 방지용)
      lesson_id,      // 선택, 중복 방지용
    } = await req.json()

    if (!recipient_type || !recipient_id || !title || !body) {
      return new Response(JSON.stringify({ error: '필수 파라미터 누락' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 중복 발송 방지 (lesson_id + notif_id 조합이 있을 때만 체크) ──
    if (lesson_id && notif_id) {
      const { data: existing } = await supabase
        .from('notification_logs')
        .select('id')
        .eq('lesson_id', lesson_id)
        .eq('notif_id', notif_id)
        .eq('recipient_id', recipient_id)
        .maybeSingle()

      if (existing) {
        return new Response(JSON.stringify({ skipped: true, reason: 'duplicate' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // ── 알림 설정 확인 ──
    if (notif_id && SETTING_KEY_MAP[notif_id]) {
      const settingKey = SETTING_KEY_MAP[notif_id]
      const query = recipient_type === 'coach'
        ? supabase.from('notification_settings').select(settingKey).eq('coach_id', recipient_id).maybeSingle()
        : supabase.from('notification_settings').select(settingKey).eq('member_id', recipient_id).maybeSingle()

      const { data: settings } = await query
      if (settings && settings[settingKey] === false) {
        return new Response(JSON.stringify({ skipped: true, reason: 'disabled_by_user' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // ── 푸시 토큰 조회 ──
    let pushToken: string | null = null

    if (recipient_type === 'coach') {
      const { data: tokenRow } = await supabase
        .from('coach_push_tokens')
        .select('push_token')
        .eq('coach_id', recipient_id)
        .maybeSingle()
      pushToken = tokenRow?.push_token ?? null
    } else {
      const { data: tokenRow } = await supabase
        .from('member_push_tokens')
        .select('push_token')
        .eq('member_id', recipient_id)
        .maybeSingle()
      pushToken = tokenRow?.push_token ?? null
    }

    if (!pushToken) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no_token' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Expo Push API 호출 ──
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        data,
        sound: 'default',
        priority: 'high',
      }),
    })

    const expoData = await expoRes.json()

    // ── 발송 로그 기록 (중복 방지용) ──
    if (lesson_id && notif_id) {
      await supabase.from('notification_logs').insert({
        lesson_id,
        notif_id,
        recipient_id,
      }).onConflict('lesson_id,notif_id,recipient_id').ignore()
    }

    return new Response(JSON.stringify({ success: true, expo: expoData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('send-push error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
