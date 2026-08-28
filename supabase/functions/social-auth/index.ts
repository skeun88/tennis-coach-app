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

async function getAllUsers(admin: any): Promise<any[]> {
  const users: any[] = [];
  let page = 1;
  while (true) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (!data?.users?.length) break;
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  return users;
}

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

        const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
          headers: { Authorization: `Bearer ${kakao_access_token}` },
        });
        const ud = await userRes.json();
        if (ud.code && ud.code < 0) throw new Error(`카카오 토큰 검증 실패: ${ud.msg}`);

        const kakaoId = String(ud.id);
        const kakaoEmail = ud.kakao_account?.email ?? '';
        const kakaoName = ud.kakao_account?.profile?.nickname ?? ud.properties?.nickname ?? '코치';
        // 이메일 미동의 시 kakao_id 기반 synthetic email 사용
        const effectiveEmail = kakaoEmail || `kakao_${kakaoId}@kakao-auth.kerri.app`;

        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const allUsers = await getAllUsers(admin);
        let user = allUsers.find((u: any) => u.user_metadata?.kakao_id === kakaoId);

        if (!user && kakaoEmail) {
          user = allUsers.find((u: any) => u.email === kakaoEmail);
          if (user) {
            await admin.auth.admin.updateUserById(user.id, {
              user_metadata: { ...user.user_metadata, kakao_id: kakaoId, provider: 'kakao' },
            });
          }
        }

        if (!user) {
          const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
            email: effectiveEmail,
            email_confirm: true,
            user_metadata: { full_name: kakaoName, provider: 'kakao', kakao_id: kakaoId },
          });
          if (createErr) throw createErr;
          user = newUser.user;
        }

        if (!user?.email) throw new Error('카카오 계정 처리 실패');

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
      console.error('[social-auth] POST error:', e.message, e.stack);
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

    const allUsers = await getAllUsers(admin);
    let user = allUsers.find((u: any) => u.email === email);

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
        user_metadata: { ...user.user_metadata, full_name: name, provider },
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
    const allUsers = await getAllUsers(admin);
    let userId = allUsers.find((u: any) => u.email === email)?.id;
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
    console.error('[social-auth] GET error:', e.message, e.stack);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
