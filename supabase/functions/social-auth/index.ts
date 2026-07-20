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

  // POST: 네이버/카카오 네이티브 SDK accessToken 처리
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { provider, naver_access_token, kakao_access_token } = body;

      // --- 네이버 ---
      if (provider === 'naver') {
        if (!naver_access_token) {
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
        const naverName = userData.response?.name ?? userData.response?.nickname ?? '코치';
        if (!naverEmail) throw new Error('네이버 이메일을 가져올 수 없어요.');

        return await upsertAndSignIn(naverEmail, naverName, 'naver');
      }

      // --- 카카오 ---
      if (provider === 'kakao') {
        if (!kakao_access_token) {
          return new Response(JSON.stringify({ error: 'kakao_access_token 필수' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // 1. 카카오 유저 정보 조회
        const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
          headers: { Authorization: `Bearer ${kakao_access_token}` },
        });
        const ud = await userRes.json();
        if (ud.code && ud.code < 0) throw new Error(`카카오 토큰 검증 실패: ${ud.msg}`);

        const kakaoId = String(ud.id); // 카카오 고유 numeric ID
        const kakaoEmail = ud.kakao_account?.email ?? '';
        const kakaoName = ud.kakao_account?.profile?.nickname ?? ud.properties?.nickname ?? '코치';

        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        // 2. kakao_id로 기존 계정 검색 (이메일 변경해도 동일 계정 유지)
        const { data: allUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
        let user = allUsers?.users?.find((u: any) => u.user_metadata?.kakao_id === kakaoId);

        if (!user && kakaoEmail) {
          // 3. 이메일로 기존 계정 검색 → kakao_id 연결
          user = allUsers?.users?.find((u: any) => u.email === kakaoEmail);
          if (user) {
            await admin.auth.admin.updateUserById(user.id, {
              user_metadata: { ...user.user_metadata, kakao_id: kakaoId, provider: 'kakao' },
            });
          }
        }

        if (!user) {
          // 4. 신규 생성 (이메일 필수)
          if (!kakaoEmail) throw new Error('카카오 이메일 정보를 가져올 수 없어요. (카카오 앱 설정에서 이메일 동의 필수)');
          const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
            email: kakaoEmail,
            email_confirm: true,
            user_metadata: { full_name: kakaoName, provider: 'kakao', kakao_id: kakaoId },
          });
          if (createErr) throw createErr;
          user = newUser.user;
        }

        if (!user?.email) throw new Error('카카오 계정 처리 실패');

        // 5. kakao_id 기반 고정 비밀번호로 세션 발급
        const password = `kakao::${kakaoId}::${SOCIAL_AUTH_SALT}`;
        await admin.auth.admin.updateUserById(user.id, {
          password,
          user_metadata: { ...user.user_metadata, kakao_id: kakaoId, full_name: kakaoName, provider: 'kakao' },
        });

        const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
          email: user.email,
          password,
        });
        if (signInErr || !signInData.session) throw signInErr ?? new Error('카카오 로그인 실패');

        return new Response(JSON.stringify({
          success: true,
          access_token: signInData.session.access_token,
          refresh_token: signInData.session.refresh_token,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ error: '지원하지 않는 provider' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // 공통 유저 upsert + 세션 발급 헬퍼
  async function upsertAndSignIn(email: string, name: string, provider: string): Promise<Response> {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
    let user = existingUsers?.users?.find((u: any) => u.email === email);

    const password = `${provider}::${email}::${SOCIAL_AUTH_SALT}`;

    if (!user) {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name, provider },
      });
      if (createErr) throw createErr;
      user = newUser.user;
    } else {
      await admin.auth.admin.updateUserById(user.id, {
        password,
        user_metadata: { full_name: name, provider },
      });
    }
    if (!user) throw new Error('유저 생성 실패');

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({ email, password });
    if (signInErr || !signInData.session) throw signInErr ?? new Error('로그인 실패');

    return new Response(JSON.stringify({
      success: true,
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
