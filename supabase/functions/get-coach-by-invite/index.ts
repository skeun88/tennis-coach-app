// supabase/functions/get-coach-by-invite/index.ts  (verify_jwt = false)
// 공개: token 또는 connect_code로 "공개 코치 정보만" 반환. 회원정보/존재여부 미노출.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const NOSTORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
const MAX_BODY = 2048
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/

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

  // 서버 구성 검증 (누락/약한 salt → 503, 빈 salt로 실행 금지)
  if (!SUPABASE_URL || !SERVICE) { console.error('config: missing supabase url/service key'); return json({ error: 'unavailable' }, 503) }
  if (SALT.length < 16) { console.error('config: THROTTLE_SALT missing or too weak'); return json({ error: 'unavailable' }, 503) }
  if (!FEATURE) return json({ error: 'disabled' }, 503)

  // 신뢰 IP (없으면 모든 사용자가 같은 키 공유하지 않도록 503 + PII 없는 로그)
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  if (!ip) { console.error('no trusted client ip header'); return json({ error: 'unavailable' }, 503) }

  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY) return json({ error: 'payload_too_large' }, 413)
  let body: any
  try { body = JSON.parse(rawBody || '{}') } catch { return json({ error: 'bad_request' }, 400) }

  const token = body.token
  const code = typeof body.connect_code === 'string' ? body.connect_code.trim().toUpperCase() : undefined
  const hasToken = typeof token === 'string'
  const hasCode = typeof code === 'string' && code.length > 0
  if (hasToken && hasCode) return json({ error: 'bad_request' }, 400)      // 동시 전달 금지
  if (!hasToken && !hasCode) return json({ error: 'bad_request' }, 400)
  if (hasToken && !TOKEN_RE.test(token)) return json({ error: 'invalid' }, 404)
  if (hasCode && !CODE_RE.test(code)) return json({ error: 'invalid' }, 404)

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  // 'ok' | 'limited' | 'error' (RPC 오류를 429로 위장하지 않음)
  const bump = async (key: string, win: string, lim: number): Promise<'ok' | 'limited' | 'error'> => {
    const { data, error } = await admin.rpc('bump_invite_throttle', { p_key: key, p_window: win, p_limit: lim })
    if (error) return 'error'
    return data === true ? 'ok' : 'limited'
  }

  const inviteKey = 'invite:' + await sha256((hasToken ? 't' + token : 'c' + code) + SALT)
  const rIp = await bump('ip:' + await sha256(ip + SALT), bucket(60_000), 30)       // 30/분
  if (rIp === 'error') return json({ error: 'unavailable' }, 503)
  if (rIp === 'limited') return json({ error: 'rate_limited' }, 429)
  const rInv = await bump(inviteKey, bucket(3_600_000), 60)                          // 60/시
  if (rInv === 'error') return json({ error: 'unavailable' }, 503)
  if (rInv === 'limited') return json({ error: 'rate_limited' }, 429)

  const base = admin.from('coach_invite_links').select('coach_id').eq('is_active', true)
  const { data: link, error: linkErr } = hasToken
    ? await base.eq('token', token).maybeSingle()
    : await base.eq('connect_code', code).maybeSingle()
  if (linkErr) { console.error('db error: invite link lookup'); return json({ error: 'unavailable' }, 503) }
  if (!link) return json({ error: 'invalid' }, 404)                                  // 없음/비활성/잘못된 값 동일

  const { data: coach, error: coachErr } = await admin.from('coach_profiles')
    .select('display_name, avatar_url, center_name, region_city, bio, coaching_years')
    .eq('coach_id', link.coach_id).maybeSingle()
  if (coachErr) { console.error('db error: coach lookup'); return json({ error: 'unavailable' }, 503) }
  if (!coach) return json({ error: 'invalid' }, 404)
  return json({ coach }, 200)                                                        // 화이트리스트 필드만
})
