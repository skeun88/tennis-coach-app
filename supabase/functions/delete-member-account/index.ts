import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 요청자 본인 확인
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const uid = user.id;

    // 1. member row 조회 (auth_user_id 기준)
    const { data: memberRows } = await supabaseAdmin
      .from('members')
      .select('id')
      .eq('auth_user_id', uid);
    const memberIds: string[] = (memberRows ?? []).map((m: any) => m.id);

    // 2. member_id 기반 연결 데이터 삭제
    if (memberIds.length > 0) {
      await supabaseAdmin.from('member_push_tokens').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_notifications').delete().in('member_id', memberIds);
      await supabaseAdmin.from('notification_settings').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_report_credit_txns').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_report_credits').delete().in('member_id', memberIds);
      await supabaseAdmin.from('coach_reviews').delete().in('member_id', memberIds);
      await supabaseAdmin.from('attendance').delete().in('member_id', memberIds);
      await supabaseAdmin.from('lesson_members').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_lesson_reports').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_notes').delete().in('member_id', memberIds);
      await supabaseAdmin.from('lesson_requests').delete().in('member_id', memberIds);
      await supabaseAdmin.from('messages').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_interest').delete().in('member_id', memberIds);
    }

    // 3. user_id 기반 데이터 삭제
    await supabaseAdmin.from('consent_logs').delete().eq('user_id', uid);

    // 4. members row 삭제
    await supabaseAdmin.from('members').delete().eq('auth_user_id', uid);

    // 5. auth 계정 삭제
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (deleteError) {
      console.error('Delete user error:', deleteError);
      return new Response(JSON.stringify({ error: '계정 삭제에 실패했습니다.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: '서버 오류가 발생했습니다.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
