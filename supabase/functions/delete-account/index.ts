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

    // 1. Storage: 음성 파일 삭제
    const { data: audioPaths } = await supabaseAdmin
      .from('lesson_plans')
      .select('audio_storage_path')
      .eq('coach_id', uid)
      .not('audio_storage_path', 'is', null);
    if (audioPaths && audioPaths.length > 0) {
      const paths = audioPaths.map((p: any) => p.audio_storage_path).filter(Boolean);
      if (paths.length > 0) {
        await supabaseAdmin.storage.from('lesson-audio').remove(paths);
      }
    }

    // 2. lesson_plans.transcript_id 순환 FK 해제
    await supabaseAdmin.from('lesson_plans').update({ transcript_id: null }).eq('coach_id', uid);

    // 3. members.lesson_package_id FK 해제
    await supabaseAdmin.from('members').update({ lesson_package_id: null }).eq('coach_id', uid);

    // 4. member_id 목록 수집
    const { data: memberRows } = await supabaseAdmin
      .from('members').select('id').eq('coach_id', uid);
    const memberIds: string[] = (memberRows ?? []).map((m: any) => m.id);

    // 5. 회원 연결 데이터 삭제
    if (memberIds.length > 0) {
      await supabaseAdmin.from('member_lesson_reports').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_notes').delete().in('member_id', memberIds);
      await supabaseAdmin.from('attendance').delete().in('member_id', memberIds);
      await supabaseAdmin.from('lesson_members').delete().in('member_id', memberIds);
      await supabaseAdmin.from('notification_settings').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_report_credit_txns').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_report_credits').delete().in('member_id', memberIds);
      await supabaseAdmin.from('coach_reviews').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_push_tokens').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_notifications').delete().in('member_id', memberIds);
      await supabaseAdmin.from('lesson_requests').delete().in('member_id', memberIds);
      await supabaseAdmin.from('messages').delete().in('member_id', memberIds);
      await supabaseAdmin.from('member_interest').delete().in('member_id', memberIds);
    }

    // 6. lesson_id 기반 데이터 삭제 (coach 소유 레슨)
    const { data: lessonRows } = await supabaseAdmin
      .from('lessons').select('id').eq('coach_id', uid);
    const lessonIds: string[] = (lessonRows ?? []).map((l: any) => l.id);
    if (lessonIds.length > 0) {
      await supabaseAdmin.from('attendance').delete().in('lesson_id', lessonIds);
      await supabaseAdmin.from('lesson_members').delete().in('lesson_id', lessonIds);
    }

    // 7. 구독 관련 삭제
    const { data: subRows } = await supabaseAdmin
      .from('subscriptions').select('id').eq('coach_id', uid);
    if (subRows && subRows.length > 0) {
      await supabaseAdmin.from('subscription_logs').delete().in('subscription_id', subRows.map((s: any) => s.id));
    }
    await supabaseAdmin.from('subscriptions').delete().eq('coach_id', uid);

    // 8. 코치 소유 데이터 삭제 (coach_id 기준)
    await supabaseAdmin.from('lesson_plans').delete().eq('coach_id', uid);
    await supabaseAdmin.from('lesson_transcripts').delete().eq('coach_id', uid);
    await supabaseAdmin.from('payments').delete().eq('coach_id', uid);
    await supabaseAdmin.from('members').delete().eq('coach_id', uid);
    await supabaseAdmin.from('lessons').delete().eq('coach_id', uid);
    await supabaseAdmin.from('lesson_packages').delete().eq('coach_id', uid);
    await supabaseAdmin.from('member_notes').delete().eq('coach_id', uid);
    await supabaseAdmin.from('tennis_knowledge').delete().eq('coach_id', uid);
    await supabaseAdmin.from('courts').delete().eq('coach_id', uid);
    await supabaseAdmin.from('coach_voice_usage').delete().eq('coach_id', uid);
    await supabaseAdmin.from('member_notifications').delete().eq('coach_id', uid);
    await supabaseAdmin.from('member_interest').delete().eq('coach_id', uid);
    await supabaseAdmin.from('ai_analysis_usage').delete().eq('coach_id', uid);
    await supabaseAdmin.from('report_topup_transactions').delete().eq('coach_id', uid);
    await supabaseAdmin.from('coaching_stats').delete().eq('coach_id', uid);
    await supabaseAdmin.from('coach_metrics').delete().eq('coach_id', uid);
    await supabaseAdmin.from('coach_availability').delete().eq('coach_id', uid);
    await supabaseAdmin.from('coach_push_tokens').delete().eq('coach_id', uid);
    await supabaseAdmin.from('consent_logs').delete().eq('user_id', uid);
    await supabaseAdmin.from('coach_profiles').delete().eq('coach_id', uid);

    // 9. auth 계정 삭제
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
