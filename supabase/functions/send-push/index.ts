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

// notif_id → member_notifications.type 매핑 (회원용 인앱 알림함)
const MEMBER_NOTIF_TYPE_MAP: Record<string, string> = {
  'PN-04': 'reregister',
  'PN-05': 'lesson_reminder',
  'PN-06': 'lesson_reminder',
  'PN-07': 'lesson_report',
  'PN-08': 'chat_message',
  'PN-09': 'lesson_update',
  'PN-10': 'lesson_update',
  'PN-11': 'lesson_update',
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
      notif_id,       // 'PN-01' ~ 'PN-13' (선택, 중복 방지용)
      lesson_id,      // 선택, 중복 방지용
    } = await req.json()

    console.log('[send-push] 진입:', { recipient_type, recipient_id, notif_id, lesson_id })

    if (!recipient_type || !recipient_id || !title || !body) {
      console.log('[send-push] 필수 파라미터 누락')
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
        console.log('[send-push] 중복 스킵:', { notif_id, recipient_id })
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
        console.log('[send-push] 사용자 비활성화 스킵:', { settingKey, recipient_id })
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

    console.log('[send-push] 토큰 조회:', { recipient_type, recipient_id, found: !!pushToken, token: pushToken })

    // ── 회원 인앱 알림함 저장 (push token 유무 무관) ──
    if (recipient_type === 'member') {
      const { data: memberRow } = await supabase
        .from('members').select('coach_id').eq('id', recipient_id).maybeSingle()
      const coachId = memberRow?.coach_id
      if (coachId) {
        const notifType = MEMBER_NOTIF_TYPE_MAP[notif_id ?? ''] ?? 'general'
        const { error: notifErr } = await supabase.from('member_notifications').insert({
          member_id: recipient_id,
          coach_id: coachId,
          title,
          body,
          type: notifType,
          is_read: false,
          reference_id: lesson_id ?? null,
          reference_type: lesson_id ? 'lesson' : null,
        })
        if (notifErr) console.error('[send-push] member_notifications 저장 오류:', notifErr.message)
        else console.log('[send-push] member_notifications 저장 완료:', { recipient_id, notifType })
      }
    }

    if (!pushToken) {
      console.log('[send-push] no_token: 알림함만 저장하고 푸시 스킵')
      return new Response(JSON.stringify({ success: true, notification_saved: true, push_skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 응답 먼저 반환 후 Expo API 호출 (EarlyDrop 방지) ──
    const response = new Response(JSON.stringify({ success: true, queued: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

    EdgeRuntime.waitUntil((async () => {
      try {
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
        console.log('[send-push] Expo API 응답:', JSON.stringify(expoData))

        // ── 발송 로그 기록 (중복 방지용) ──
        if (lesson_id && notif_id) {
          await supabase.from('notification_logs').insert({
            lesson_id,
            notif_id,
            recipient_id,
          }).onConflict('lesson_id,notif_id,recipient_id').ignore()
        }

        console.log('[send-push] 완료:', { recipient_id, notif_id })
      } catch (bgErr: any) {
        console.error('[send-push] 백그라운드 오류:', bgErr.message)
      }
    })())

    return response

  } catch (error: any) {
    console.error('[send-push] 오류:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
