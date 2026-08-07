import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// KST = UTC+9
const KST_OFFSET = 9 * 60 * 60 * 1000

function kstNow(): Date {
  return new Date(Date.now() + KST_OFFSET)
}

function kstDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function sendPush(supabase: any, {
  recipient_type, recipient_id, title, body, data, notif_id, lesson_id,
}: {
  recipient_type: 'coach' | 'member'
  recipient_id: string
  title: string
  body: string
  data?: object
  notif_id: string
  lesson_id: string
}) {
  // 중복 방지
  const { data: existing } = await supabase
    .from('notification_logs')
    .select('id')
    .eq('lesson_id', lesson_id)
    .eq('notif_id', notif_id)
    .eq('recipient_id', recipient_id)
    .maybeSingle()
  if (existing) return

  // 알림 설정 확인
  const SETTING_MAP: Record<string, string> = {
    'PN-01': 'lesson_day_before', 'PN-02': 'lesson_hour_before',
    'PN-05': 'lesson_day_before', 'PN-06': 'lesson_hour_before',
  }
  const settingKey = SETTING_MAP[notif_id]
  if (settingKey) {
    const q = recipient_type === 'coach'
      ? supabase.from('notification_settings').select(settingKey).eq('coach_id', recipient_id).maybeSingle()
      : supabase.from('notification_settings').select(settingKey).eq('member_id', recipient_id).maybeSingle()
    const { data: s } = await q
    if (s && s[settingKey] === false) return
  }

  // 푸시 토큰 조회
  let pushToken: string | null = null
  if (recipient_type === 'coach') {
    const { data: t } = await supabase.from('coach_push_tokens').select('push_token').eq('coach_id', recipient_id).maybeSingle()
    pushToken = t?.push_token ?? null
  } else {
    const { data: t } = await supabase.from('member_push_tokens').select('push_token').eq('member_id', recipient_id).maybeSingle()
    pushToken = t?.push_token ?? null
  }
  if (!pushToken) return

  // Expo Push API
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: pushToken, title, body, data, sound: 'default', priority: 'high' }),
  })

  // 로그 기록
  await supabase.from('notification_logs').insert({ lesson_id, notif_id, recipient_id })
    .onConflict('lesson_id,notif_id,recipient_id').ignore()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    // mode: 'day_before' | 'hour_before' (query param or body)
    const url = new URL(req.url)
    let mode = url.searchParams.get('mode')
    if (!mode && req.method === 'POST') {
      try {
        const body = await req.json()
        mode = body.mode ?? null
      } catch { /* ok */ }
    }

    const now = kstNow()
    const nowHour = now.getUTCHours()
    const nowMin = now.getUTCMinutes()

    let results = { sent: 0, skipped: 0 }

    // ── D-1 알림 (PN-01/05): 오전 10:00 KST에 실행 ──
    if (mode === 'day_before' || (!mode && nowHour === 10 && nowMin < 15)) {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const tomorrowStr = kstDateStr(tomorrow)

      const { data: lessons } = await supabase
        .from('lessons')
        .select(`
          id, coach_id, title, date, start_time,
          lesson_members(member_id)
        `)
        .eq('date', tomorrowStr)

      for (const lesson of (lessons ?? [])) {
        const timeStr = lesson.start_time.slice(0, 5)

        // PN-01: 코치 D-1 알림
        await sendPush(supabase, {
          recipient_type: 'coach',
          recipient_id: lesson.coach_id,
          title: '레슨 D-1 알림',
          body: `내일 ${timeStr} ${lesson.title} 레슨이 있습니다.`,
          data: { screen: 'lesson', lesson_id: lesson.id },
          notif_id: 'PN-01',
          lesson_id: lesson.id,
        })

        // PN-05: 회원 D-1 알림
        for (const lm of (lesson.lesson_members ?? [])) {
          await sendPush(supabase, {
            recipient_type: 'member',
            recipient_id: lm.member_id,
            title: '레슨 D-1 알림',
            body: `내일 ${timeStr} 레슨이 예정되어 있습니다.`,
            data: { screen: 'lesson', lesson_id: lesson.id },
            notif_id: 'PN-05',
            lesson_id: lesson.id,
          })
        }

        results.sent++
      }
    }

    // ── 1시간 전 알림 (PN-02/06): 매 15분마다 실행 ──
    if (mode === 'hour_before' || (!mode && mode !== 'day_before')) {
      const todayStr = kstDateStr(now)

      // 지금으로부터 45~75분 후 시작하는 레슨
      const targetMinFrom = nowHour * 60 + nowMin + 45
      const targetMinTo = nowHour * 60 + nowMin + 75

      const targetFromH = Math.floor(targetMinFrom / 60).toString().padStart(2, '0')
      const targetFromM = (targetMinFrom % 60).toString().padStart(2, '0')
      const targetToH = Math.floor(targetMinTo / 60).toString().padStart(2, '0')
      const targetToM = (targetMinTo % 60).toString().padStart(2, '0')

      const { data: lessons } = await supabase
        .from('lessons')
        .select(`
          id, coach_id, title, date, start_time, created_at,
          lesson_members(member_id)
        `)
        .eq('date', todayStr)
        .gte('start_time', `${targetFromH}:${targetFromM}:00`)
        .lte('start_time', `${targetToH}:${targetToM}:00`)

      for (const lesson of (lessons ?? [])) {
        const timeStr = lesson.start_time.slice(0, 5)

        // 급조 레슨 예외: 등록 시점이 60분 이내면 스킵
        const createdAt = new Date(lesson.created_at).getTime()
        const lessonStart = new Date(`${lesson.date}T${lesson.start_time}+09:00`).getTime()
        if (lessonStart - createdAt < 60 * 60 * 1000) continue

        // PN-02: 코치 1시간 전 알림
        await sendPush(supabase, {
          recipient_type: 'coach',
          recipient_id: lesson.coach_id,
          title: '레슨 1시간 전',
          body: `1시간 후 ${lesson.title} 레슨이 시작됩니다.`,
          data: { screen: 'lesson', lesson_id: lesson.id },
          notif_id: 'PN-02',
          lesson_id: lesson.id,
        })

        // PN-06: 회원 1시간 전 알림
        for (const lm of (lesson.lesson_members ?? [])) {
          await sendPush(supabase, {
            recipient_type: 'member',
            recipient_id: lm.member_id,
            title: '레슨 1시간 전',
            body: `1시간 후 ${timeStr} 레슨이 시작됩니다.`,
            data: { screen: 'lesson', lesson_id: lesson.id },
            notif_id: 'PN-06',
            lesson_id: lesson.id,
          })
        }

        results.sent++
      }
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('schedule-lesson-reminders error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
