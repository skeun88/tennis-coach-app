import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// verify_jwt=false: 미로그인 상태의 회원이 초대코드로 가입하는 공개 엔드포인트
// 단, 초대코드 자체가 one-time 인증 수단이므로 별도 보안 확보

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { invite_code } = await req.json()

    if (!invite_code || typeof invite_code !== 'string') {
      return new Response(
        JSON.stringify({ error: 'invite_code is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const code = invite_code.trim().toUpperCase()

    // service_role 클라이언트로 auth.admin 사용
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1. invite_code로 member row 조회
    const { data: member, error: memberErr } = await supabaseAdmin
      .from('members')
      .select('id, name, phone, email, coach_id, invite_code, auth_user_id')
      .eq('invite_code', code)
      .maybeSingle()

    if (memberErr) {
      console.error('DB error:', memberErr)
      return new Response(
        JSON.stringify({ error: 'DB error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!member) {
      return new Response(
        JSON.stringify({ error: 'invalid_code', message: '유효하지 않은 초대 코드입니다.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. 이미 auth 계정 연결된 경우 → 기존 계정으로 새 세션 발급
    if (member.auth_user_id) {
      const { data: sessionData, error: sessionErr } =
        await (supabaseAdmin.auth.admin as any).createSession({ user_id: member.auth_user_id })

      if (sessionErr) {
        console.error('Session error:', sessionErr)
        return new Response(
          JSON.stringify({ error: 'session_error', message: '세션 생성 실패' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({
          session: sessionData.session,
          member_id: member.id,
          member_name: member.name,
          coach_id: member.coach_id,
          is_new: false,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. auth 계정 없음 → 새 계정 생성
    // 이메일: invite_{code}@kerri.app (고정 패턴, 중복 방지)
    // 패스워드: UUID 기반 랜덤 (회원은 초대코드로만 로그인하므로 패스워드 불필요)
    const syntheticEmail = `invite_${code.toLowerCase()}@kerri.app`
    const syntheticPassword = crypto.randomUUID()

    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password: syntheticPassword,
      email_confirm: true, // 이메일 인증 스킵
      user_metadata: {
        member_id: member.id,
        invite_code: code,
        name: member.name,
      },
    })

    if (createErr) {
      console.error('Create user error:', createErr)
      return new Response(
        JSON.stringify({ error: 'create_error', message: createErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = newUser.user!.id

    // 4. member row에 auth_user_id 연결
    const { error: updateErr } = await supabaseAdmin
      .from('members')
      .update({ auth_user_id: userId })
      .eq('id', member.id)

    if (updateErr) {
      console.error('Update member error:', updateErr)
      // auth user는 만들었으나 연결 실패 — 롤백 시도
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return new Response(
        JSON.stringify({ error: 'link_error', message: '계정 연결 실패' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 5. 해당 유저로 세션 생성
    const { data: sessionData, error: sessionErr } =
      await (supabaseAdmin.auth.admin as any).createSession({ user_id: userId })

    if (sessionErr) {
      console.error('Session error:', sessionErr)
      return new Response(
        JSON.stringify({ error: 'session_error', message: '세션 생성 실패' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        session: sessionData.session,
        member_id: member.id,
        member_name: member.name,
        coach_id: member.coach_id,
        is_new: true,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e) {
    console.error('Unexpected error:', e)
    return new Response(
      JSON.stringify({ error: 'internal_error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
