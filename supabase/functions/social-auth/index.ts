import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KAKAO_CLIENT_ID = Deno.env.get('KAKAO_CLIENT_ID') ?? '';
const NAVER_CLIENT_ID = Deno.env.get('NAVER_CLIENT_ID') ?? '';
const NAVER_CLIENT_SECRET = Deno.env.get('NAVER_CLIENT_SECRET') ?? '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const provider = url.searchParams.get('provider'); // 'kakao' | 'naver'
  const code = url.searchParams.get('code');
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';

  // ── 1. 인증 URL 발급 (앱 → 브라우저 열기용) ──────────────────────────────────
  if (!code) {
    let authUrl = '';
    if (provider === 'kakao') {
      authUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=account_email,profile_nickname`;
    } else if (provider === 'naver') {
      const state = crypto.randomUUID();
      authUrl = `https://nid.naver.com/oauth2.0/authorize?client_id=${NAVER_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
    } else {
      return new Response(JSON.stringify({ error: 'Unknown provider' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 2. 코드 → 토큰 → 유저 정보 → Supabase 세션 발급 ────────────────────────
  try {
    let email = '';
    let name = '';

    if (provider === 'kakao') {
      const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: KAKAO_CLIENT_ID,
          redirect_uri: redirectUri,
          code,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('카카오 토큰 발급 실패');

      const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json();
      email = userData.kakao_account?.email ?? '';
      name = userData.kakao_account?.profile?.nickname ?? userData.properties?.nickname ?? '코치';

    } else if (provider === 'naver') {
      const tokenRes = await fetch(
        `https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${NAVER_CLIENT_ID}&client_secret=${NAVER_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`,
      );
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('네이버 토큰 발급 실패');

      const userRes = await fetch('https://openapi.naver.com/v1/nid/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json();
      email = userData.response?.email ?? '';
      name = userData.response?.name ?? userData.response?.nickname ?? '코치';
    }

    if (!email) throw new Error('이메일 정보를 가져올 수 없어요. 카카오/네이버 계정에 이메일을 연동해주세요.');

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 기존 유저 확인 또는 생성
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
    let userId = users?.find((u: any) => u.email === email)?.id;

    if (!userId) {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: name, provider },
      });
      if (createErr) throw createErr;
      userId = newUser.user?.id;
    }

    if (!userId) throw new Error('유저 생성 실패');

    // magic link로 세션 토큰 발급
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: redirectUri },
    });
    if (linkErr) throw linkErr;

    return new Response(JSON.stringify({
      success: true,
      email,
      userId,
      magicLink: linkData?.properties?.action_link,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
