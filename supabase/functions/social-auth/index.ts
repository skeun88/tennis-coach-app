import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const KAKAO_CLIENT_ID = Deno.env.get('KAKAO_CLIENT_ID') ?? '';
const NAVER_CLIENT_ID = Deno.env.get('NAVER_CLIENT_ID') ?? '';
const NAVER_CLIENT_SECRET = Deno.env.get('NAVER_CLIENT_SECRET') ?? '';
const SOCIAL_AUTH_SALT = Deno.env.get('SOCIAL_AUTH_SALT') ?? 'kerri-social-2024';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // POST: 네이버 네이티브 SDK accessToken 처리
  // verify_jwt=false: 네이버 accessToken으로 자체 검증
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { provider, naver_access_token } = body;

      if (provider !== 'naver' || !naver_access_token) {
        return new Response(JSON.stringify({ error: 'naver_access_token 필수' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 1. 네이버 유저 정보 조회
      const userRes = await fetch('https://openapi.naver.com/v1/nid/me', {
        headers: { Authorization: `Bearer ${naver_access_token}` },
      });
      const userData = await userRes.json();
      if (userData.resultcode !== '00') throw new Error('네이버 사용자 정보 조회 실패');

      const naverEmail = userData.response?.email ?? '';
      const name = userData.response?.name ?? userData.response?.nickname ?? '코치';
      if (!naverEmail) throw new Error('네이버 이메일을 가져올 수 없어요.');

      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // 2. 유저 upsert — createSession 대신 password 방식 사용
      const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
      let user = existingUsers?.users?.find((u: any) => u.email === naverEmail);

      // 결정론적 비밀번호 (email + salt)
      const password = `naver::${naverEmail}::${SOCIAL_AUTH_SALT}`;

      if (!user) {
        const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
          email: naverEmail,
          password,
          email_confirm: true,
          user_metadata: { full_name: name, provider: 'naver' },
        });
        if (createErr) throw createErr;
        user = newUser.user;
      } else {
        // 기존 유저 비밀번호 동기화 + metadata 업데이트
        await admin.auth.admin.updateUserById(user.id, {
          password,
          user_metadata: { full_name: name, provider: 'naver' },
        });
      }
      if (!user) throw new Error('유저 생성 실패');

      // 3. signInWithPassword로 세션 발급 (createSession 대신)
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
        email: naverEmail,
        password,
      });
      if (signInErr || !signInData.session) throw signInErr ?? new Error('로그인 실패');

      return new Response(JSON.stringify({
        success: true,
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // GET: 카카오 웹 OAuth (기존 유지)
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider');
  const code = url.searchParams.get('code');
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';

  if (!code) {
    let authUrl = '';
    if (provider === 'kakao') {
      authUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=account_email,profile_nickname`;
    } else {
      return new Response(JSON.stringify({ error: 'Unknown provider' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    let email = '';
    let name = '';

    if (provider === 'kakao') {
      const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: KAKAO_CLIENT_ID, redirect_uri: redirectUri, code }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('카카오 토큰 발급 실패');
      const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const ud = await userRes.json();
      email = ud.kakao_account?.email ?? '';
      name = ud.kakao_account?.profile?.nickname ?? ud.properties?.nickname ?? '코치';
    }

    if (!email) throw new Error('이메일 정보를 가져올 수 없어요.');

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
    let userId = users?.find((u: any) => u.email === email)?.id;
    if (!userId) {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email, email_confirm: true,
        user_metadata: { full_name: name, provider },
      });
      if (createErr) throw createErr;
      userId = newUser.user?.id;
    }
    if (!userId) throw new Error('유저 생성 실패');

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink', email,
      options: { redirectTo: redirectUri },
    });
    if (linkErr) throw linkErr;

    return new Response(JSON.stringify({ success: true, email, userId, magicLink: linkData?.properties?.action_link }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
