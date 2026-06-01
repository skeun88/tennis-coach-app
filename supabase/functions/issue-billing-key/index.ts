import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TOSS_SECRET_KEY = Deno.env.get('TOSS_SECRET_KEY') ?? 'test_sk_nRQoOaPz8LlvM2EMxaam8y47BMw6';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  try {
    const { authKey, customerKey, planId } = await req.json();
    if (!authKey || !customerKey) {
      return new Response(JSON.stringify({ error: 'authKey, customerKey required' }), { status: 400 });
    }

    // 토스페이먼츠 빌링키 발급
    const tossRes = await fetch('https://api.tosspayments.com/v1/billing/authorizations/issue', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(TOSS_SECRET_KEY + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ authKey, customerKey }),
    });

    if (!tossRes.ok) {
      const err = await tossRes.json();
      return new Response(JSON.stringify({ error: err.message || '빌링키 발급 실패' }), { status: 400 });
    }

    const tossData = await tossRes.json();
    const billingKey = tossData.billingKey;

    return new Response(JSON.stringify({ billingKey, customerKey }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
