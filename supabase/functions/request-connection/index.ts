// supabase/functions/request-connection/index.ts  (verify_jwt = false)
// 공개: 회원이 코치에게 "연결 요청" 접수. coach_id는 클라 불신 → 서버가 활성 링크로 결정.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const NOSTORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
const MAX_BODY = 4096
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SOURCES = ['qr', 'connect_code', 'web_invite', 'shared_link']

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SALT = Deno.env.get('THROTTLE_SALT') ?? ''
const FEATURE = (Deno.env.get('FEATURE_SHARED_QR_ENABLED') ?? 'false') === 'true'

const json = (o: unknown, s: number) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, ...NOSTORE } })
async function sha256(s: string) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('') }
const bucket = (ms: number) => new Date(Math.floor(Date.now() / ms) * ms).toISOString()

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  if (!SUPABASE_URL || !SERVICE) { console.error('config: missing supabase url/service key'); return json({ error: 'unavailable' }, 503) }
  if (SALT.length < 16) { console.error('config: THROTTLE_SALT missing or too weak'); return json({ error: 'unavailable' }, 503) }
  if (!FEATURE) return json({ error: 'disabled' }, 503)

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  if (!ip) { console.error('no trusted client ip header'); return json({ error: 'unavailable' }, 503) }

  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY) return json({ error: 'payload_too_large' }, 413)
  let body: any
  try { body = JSON.parse(rawBody || '{}') } catch { return json({ error: 'bad_request' }, 400) }

  // 엄격한 타입/길이 검사
  const name = body.name
  const phone = body.phone
  const request_id = body.request_id
  const source = body.source
  const token = body.token
  const code = typeof body.connect_code === 'string' ? body.connect_code.trim().toUpperCase() : undefined
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) return json({ error: 'invalid_name' }, 400)
  if (typeof phone !== 'string' || phone.length < 1 || phone.length > 32) return json({ error: 'invalid_phone' }, 400)
  if (typeof request_id !== 'string' || !UUID_RE.test(request_id)) return json({ error: 'invalid_request_id' }, 400)
  if (typeof source !== 'string' || !SOURCES.includes(source)) return json({ error: 'invalid_source' }, 400)  // 자동 qr 치환 안 함
  const hasToken = typeof token === 'string'
  const hasCode = typeof code === 'string' && code.length > 0
  if (hasToken && hasCode) return json({ error: 'bad_request' }, 400)
  if (!hasToken && !hasCode) return json({ error: 'bad_request' }, 400)
  if (hasToken && !TOKEN_RE.test(token)) return json({ error: 'invalid' }, 404)
  if (hasCode && !CODE_RE.test(code)) return json({ error: 'invalid' }, 404)

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  const bump = async (key: string, win: string, lim: number): Promise<'ok' | 'limited' | 'error'> => {
    const { data, error } = await admin.rpc('bump_invite_throttle', { p_key: key, p_window: win, p_limit: lim })
    if (error) return 'error'
    return data === true ? 'ok' : 'limited'
  }
  const inviteKey = 'invite:' + await sha256((hasToken ? 't' + token : 'c' + code) + SALT)

  // 1) IP 레이트리밋
  const rIp = await bump('ip:' + await sha256(ip + SALT), bucket(60_000), 20)        // 20/분
  if (rIp === 'error') return json({ error: 'unavailable' }, 503)
  if (rIp === 'limited') return json({ error: 'rate_limited' }, 429)
  // 2) 초대 token/code 레이트리밋
  const rInv = await bump(inviteKey, bucket(3_600_000), 60)
  if (rInv === 'error') return json({ error: 'unavailable' }, 503)
  if (rInv === 'limited') return json({ error: 'rate_limited' }, 429)
  // 3) 활성 초대 링크 조회
  const base = admin.from('coach_invite_links').select('coach_id').eq('is_active', true)
  const { data: link, error: linkErr } = hasToken
    ? await base.eq('token', token).maybeSingle()
    : await base.eq('connect_code', code).maybeSingle()
  if (linkErr) { console.error('db error: invite link lookup'); return json({ error: 'unavailable' }, 503) }
  if (!link) return json({ error: 'invalid' }, 404)
  const coach_id = link.coach_id
  // 4) 전화번호 서버 정규화
  const { data: pnorm, error: normErr } = await admin.rpc('normalize_kr_phone', { p: phone })
  if (normErr) { console.error('db error: phone normalize'); return json({ error: 'unavailable' }, 503) }
  if (!pnorm) return json({ error: 'invalid_phone' }, 400)
  // 5) 유효한 초대에 대해서만 전화번호 레이트리밋 (피해자 전화 소진 방지)
  const rPhone = await bump('phone:' + await sha256(pnorm + SALT), bucket(3_600_000), 5)  // 5/시
  if (rPhone === 'error') return json({ error: 'unavailable' }, 503)
  if (rPhone === 'limited') return json({ error: 'rate_limited' }, 429)
  // 6) 멱등(coach_id, request_id) / 중복(coach_id, phone pending)
  const nm = name.trim()
  const { data: ex, error: exErr } = await admin.from('member_connection_requests')
    .select('status, member_name, phone_norm').eq('coach_id', coach_id).eq('request_id', request_id).maybeSingle()
  if (exErr) { console.error('db error: idempotency lookup'); return json({ error: 'unavailable' }, 503) }
  if (ex) {
    if (ex.member_name !== nm || ex.phone_norm !== pnorm) return json({ error: 'conflict' }, 409)  // 같은 id 다른 데이터
    return json({ status: ex.status === 'pending' ? 'received' : ex.status }, 200)                  // 동일 데이터 멱등
  }
  const { data: pend, error: pendErr } = await admin.from('member_connection_requests')
    .select('id').eq('coach_id', coach_id).eq('phone_norm', pnorm).eq('status', 'pending').maybeSingle()
  if (pendErr) { console.error('db error: pending dedup lookup'); return json({ error: 'unavailable' }, 503) }
  if (pend) return json({ status: 'already_pending' }, 200)
  // 7) 생성
  const { error: insErr } = await admin.from('member_connection_requests').insert({
    coach_id, request_id, member_name: nm, phone_raw: phone, phone_norm: pnorm, source, status: 'pending',
  })
  if (insErr) {
    if ((insErr as any).code === '23505') {   // unique_violation 경합 → 재조회
      const { data: ex2 } = await admin.from('member_connection_requests')
        .select('status, member_name, phone_norm').eq('coach_id', coach_id).eq('request_id', request_id).maybeSingle()
      if (ex2) {
        if (ex2.member_name !== nm || ex2.phone_norm !== pnorm) return json({ error: 'conflict' }, 409)
        return json({ status: ex2.status === 'pending' ? 'received' : ex2.status }, 200)
      }
      const { data: pend2 } = await admin.from('member_connection_requests')
        .select('id').eq('coach_id', coach_id).eq('phone_norm', pnorm).eq('status', 'pending').maybeSingle()
      if (pend2) return json({ status: 'already_pending' }, 200)
      return json({ error: 'conflict' }, 409)
    }
    console.error('db error: insert', (insErr as any).code ?? '')  // PII 없음
    return json({ error: 'unavailable' }, 503)
  }
  return json({ status: 'received' }, 201)
})
