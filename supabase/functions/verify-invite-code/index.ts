import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// verify_jwt=false: 미로그인 회원이 초대코드로 로그인하는 공개 엔드포인트

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

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

    // synthetic 계정 정보 (결정론적 생성 — 서버에서 재현 가능)
    const syntheticEmail = `invite_${code.toLowerCase()}@kerri.app`
    const salt = Deno.env.get('INVITE_CODE_SALT') ?? 'kerri-tennis-2024'
    const syntheticPassword = `${code}::${salt}`

    // 2. auth 계정 없으면 생성
    if (!member.auth_user_id) {
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: syntheticEmail,
        password: syntheticPassword,
        email_confirm: true,
        user_metadata: { member_id: member.id, invite_code: code, name: member.name },
      })

      if (createErr && !createErr.message?.toLowerCase().includes('already')) {
        console.error('Create user error:', createErr)
        return new Response(
          JSON.stringify({ error: 'create_error', message: createErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (newUser?.user) {
        const userId = newUser.user.id
        const { error: updateErr } = await supabaseAdmin
          .from('members')
          .update({ auth_user_id: userId })
          .eq('id', member.id)

        if (updateErr) {
          console.error('Update member error:', updateErr)
          await supabaseAdmin.auth.admin.deleteUser(userId)
          return new Response(
            JSON.stringify({ error: 'link_error', message: '계정 연결 실패' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }
    } else {
      // 이미 계정 있는 경우 패스워드 업데이트 (salt 변경 대비)
      await supabaseAdmin.auth.admin.updateUserById(member.auth_user_id, {
        password: syntheticPassword,
        email_confirm: true,
      })
    }

    // 3. Supabase Auth REST API로 signInWithPassword
    //    (Edge Function 내에서는 fetch로 직접 호출이 가장 확실)
    const signInRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
      },
      body: JSON.stringify({ email: syntheticEmail, password: syntheticPassword }),
    })

    const signInData = await signInRes.json()

    if (!signInRes.ok || !signInData.access_token) {
      console.error('SignIn REST error:', JSON.stringify(signInData))
      return new Response(
        JSON.stringify({ error: 'signin_error', message: signInData.error_description ?? signInData.msg ?? '로그인 실패' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // createUser "already exists" 케이스: auth_user_id가 아직 members에 없으면 sign in 응답의 user.id로 업데이트
    if (!member.auth_user_id && signInData.user?.id) {
      await supabaseAdmin
        .from('members')
        .update({ auth_user_id: signInData.user.id })
        .eq('id', member.id)
    }

    return new Response(
      JSON.stringify({
        session: {
          access_token: signInData.access_token,
          refresh_token: signInData.refresh_token,
          token_type: signInData.token_type ?? 'bearer',
          expires_in: signInData.expires_in ?? 3600,
        },
        member_id: member.id,
        member_name: member.name,
        coach_id: member.coach_id,
        is_new: !member.auth_user_id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e) {
    console.error('Unexpected error:', e)
    return new Response(
      JSON.stringify({ error: 'internal_error', message: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
