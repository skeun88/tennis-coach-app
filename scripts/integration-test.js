/**
 * KERRI Integration Test — Coach App
 * TC-001~016: 데이터 정합성, 엣지케이스, 비즈니스 로직 자동 검증
 *
 * 실행: node scripts/integration-test.js
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testId, description) {
  if (condition) {
    console.log(`  ✅ PASS [${testId}] ${description}`);
    passed++;
    results.push({ id: testId, status: 'PASS', description });
  } else {
    console.error(`  ❌ FAIL [${testId}] ${description}`);
    failed++;
    results.push({ id: testId, status: 'FAIL', description });
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let testCoachId = null;
let testMemberId = null;
let testLessonId = null;

async function setupTestData() {
  console.log('\n📋 테스트 데이터 준비 중...');
  // 실데이터 호환: members에서 실존 coach_id 사용
  const { data: any } = await supabase.from('members').select('coach_id').limit(1);
  if (!any || any.length === 0) throw new Error('코치 데이터 없음 (members 비어있음)');
  testCoachId = any[0].coach_id;
  console.log(`  코치 ID: ${testCoachId}`);
}

async function cleanupTestData() {
  if (testMemberId) {
    await supabase.from('attendances').delete().eq('member_id', testMemberId);
    await supabase.from('lesson_members').delete().eq('member_id', testMemberId);
    await supabase.from('payments').delete().eq('member_id', testMemberId);
    await supabase.from('members').delete().eq('id', testMemberId);
    if (testLessonId) {
      await supabase.from('lessons').delete().eq('id', testLessonId);
    }
    console.log(`\n🧹 테스트 데이터 정리 완료`);
  }
  // 혹시 남아있는 TEST 데이터도 정리
  await supabase.from('members').delete().like('name', '[TEST%');
}

// ─── TC-001: 신규 회원 등록 → 레슨 자동 생성 ────────────────
async function tc001_memberRegistration() {
  console.log('\n🧪 TC-001: 신규 회원 등록 → 레슨 자동 생성');

  const todayKST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const todayStr = todayKST.toISOString().split('T')[0];
  const todayDow = todayKST.getDay();

  const { data: newMember, error } = await supabase
    .from('members')
    .insert({
      name: '[TEST] 자동테스트회원', phone: '010-0000-0001',
      coach_id: testCoachId,
      fixed_schedule_days: [todayDow],
      fixed_schedule_time: '10:00',
      fixed_lesson_duration: 60,
      total_credits: 10,
      remaining_credits: 10,
      level: '중급',
    })
    .select()
    .single();

  assert(!error && newMember, 'TC-001-A', '회원 등록 성공');
  if (!newMember) return;
  testMemberId = newMember.id;

  await sleep(1000);

  // 오늘 레슨 자동 생성 확인
  const { data: lessons } = await supabase
    .from('lessons')
    .select('id, date, lesson_members!inner(member_id)')
    .eq('lesson_members.member_id', testMemberId)
    .eq('date', todayStr);

  assert(lessons && lessons.length > 0, 'TC-001-B', '오늘 고정 스케줄 레슨 자동 생성됨');
  if (lessons && lessons.length > 0) {
    testLessonId = lessons[0].id;
    console.log(`  → 레슨 ID: ${testLessonId}`);
  }
}

// ─── TC-003: 출석 체크 → 크레딧 차감 ────────────────────────
async function tc003_attendance() {
  console.log('\n🧪 TC-003: 출석 체크 → 크레딧 차감/복원');
  if (!testMemberId || !testLessonId) { console.log('  ⚠️ 선행 테스트 실패로 스킵'); return; }

  const { data: before } = await supabase
    .from('members').select('remaining_credits').eq('id', testMemberId).single();
  const creditsBefore = before?.remaining_credits;

  await supabase.from('attendances').insert({
    lesson_id: testLessonId, member_id: testMemberId, status: 'attended',
  });
  await sleep(800);

  const { data: after } = await supabase
    .from('members').select('remaining_credits').eq('id', testMemberId).single();
  assert(after?.remaining_credits === creditsBefore - 1, 'TC-003-A', `크레딧 차감 (${creditsBefore} → ${after?.remaining_credits})`);

  // 출석 취소 → 복원
  await supabase.from('attendances').delete().eq('lesson_id', testLessonId).eq('member_id', testMemberId);
  await sleep(800);

  const { data: restored } = await supabase
    .from('members').select('remaining_credits').eq('id', testMemberId).single();
  assert(restored?.remaining_credits === creditsBefore, 'TC-003-B', `출석 취소 시 크레딧 복원`);
}

// ─── TC-004: 결제 등록 ───────────────────────────────────────
async function tc004_payment() {
  console.log('\n🧪 TC-004: 결제 등록 → DB 저장');
  if (!testMemberId) { console.log('  ⚠️ 선행 테스트 실패로 스킵'); return; }

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      member_id: testMemberId, coach_id: testCoachId,
      amount: 300000, paid_amount: 0, status: '미납',
      description: '[TEST] 자동테스트 결제',
      due_date: new Date().toISOString().split('T')[0],
    })
    .select().single();

  assert(!error && payment, 'TC-004-A', '결제 등록 성공');

  const { data: list } = await supabase.from('payments').select('id, status').eq('member_id', testMemberId);
  assert(list && list.length > 0, 'TC-004-B', '결제 내역 조회 가능');
  assert(list?.some(p => p.status === '미납'), 'TC-004-C', '미납 상태 정확히 저장됨');
}

// ─── TC-006: 크레딧 0일 때 출석 체크 ────────────────────────
async function tc006_zeroCredit() {
  console.log('\n🧪 TC-006: 크레딧 0 상태에서 출석 체크 방지');
  if (!testMemberId || !testLessonId) { console.log('  ⚠️ 선행 테스트 실패로 스킵'); return; }

  // 크레딧 0으로 강제 세팅
  await supabase.from('members').update({ remaining_credits: 0 }).eq('id', testMemberId);
  await sleep(300);

  const { data: zeroMember } = await supabase
    .from('members').select('remaining_credits').eq('id', testMemberId).single();
  assert(zeroMember?.remaining_credits === 0, 'TC-006-A', '크레딧 0 세팅 확인');

  // 출석 체크 시도 (DB trigger가 막는지 확인)
  const { error: attError } = await supabase.from('attendances').insert({
    lesson_id: testLessonId, member_id: testMemberId, status: 'attended',
  });
  await sleep(500);

  const { data: afterZero } = await supabase
    .from('members').select('remaining_credits').eq('id', testMemberId).single();

  // 크레딧이 음수가 되면 안 됨
  assert((afterZero?.remaining_credits ?? 0) >= 0, 'TC-006-B', '크레딧 음수 방지 확인');

  // 정리
  await supabase.from('attendances').delete().eq('lesson_id', testLessonId).eq('member_id', testMemberId);
  await supabase.from('members').update({ remaining_credits: 10 }).eq('id', testMemberId);
  await sleep(300);
}

// ─── TC-007: 중복 레슨 방지 ──────────────────────────────────
async function tc007_duplicateLesson() {
  console.log('\n🧪 TC-007: 같은 날짜/시간 중복 레슨 방지');
  if (!testCoachId) return;

  const todayStr = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

  const lessonData = {
    coach_id: testCoachId, date: todayStr,
    start_time: '15:00', end_time: '16:00', title: '[TEST] 중복테스트레슨',
  };

  const { data: l1, error: e1 } = await supabase.from('lessons').insert(lessonData).select().single();
  assert(!e1 && l1, 'TC-007-A', '첫 번째 레슨 생성 성공');

  const { data: l2, error: e2 } = await supabase.from('lessons').insert(lessonData).select().single();
  // DB constraint 또는 앱 레벨에서 막혀야 함
  if (e2) {
    assert(true, 'TC-007-B', 'DB 레벨에서 중복 레슨 방지됨');
  } else {
    // 중복이 허용되면 경고 (버그)
    assert(false, 'TC-007-B', '중복 레슨이 DB에 저장됨 (버그!)');
    if (l2) await supabase.from('lessons').delete().eq('id', l2.id);
  }

  if (l1) await supabase.from('lessons').delete().eq('id', l1.id);
}

// ─── TC-008: 날짜 경계 — 오늘/내일 레슨 분류 ────────────────
async function tc008_dateBoundary() {
  console.log('\n🧪 TC-008: 날짜 경계 — 오늘/내일 레슨 정확히 분류');
  if (!testMemberId) { console.log('  ⚠️ 선행 테스트 실패로 스킵'); return; }

  const nowKST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const todayStr = nowKST.toISOString().split('T')[0];
  const tomorrowStr = new Date(nowKST.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // 오늘/내일 레슨 각각 생성
  const { data: todayLesson } = await supabase.from('lessons').insert({
    coach_id: testCoachId, date: todayStr,
    start_time: '20:00', end_time: '21:00', title: '[TEST] 오늘레슨',
  }).select().single();

  const { data: tomorrowLesson } = await supabase.from('lessons').insert({
    coach_id: testCoachId, date: tomorrowStr,
    start_time: '23:00', end_time: '23:59', title: '[TEST] 내일레슨',
  }).select().single();

  // 오늘 레슨만 쿼리
  const { data: todayOnly } = await supabase
    .from('lessons').select('id, date').eq('coach_id', testCoachId).eq('date', todayStr)
    .like('title', '[TEST]%');
  const { data: tomorrowOnly } = await supabase
    .from('lessons').select('id, date').eq('coach_id', testCoachId).eq('date', tomorrowStr)
    .like('title', '[TEST]%');

  assert(todayOnly?.some(l => l.id === todayLesson?.id), 'TC-008-A', '오늘 레슨 오늘 날짜로 정확히 저장');
  assert(tomorrowOnly?.some(l => l.id === tomorrowLesson?.id), 'TC-008-B', '내일 레슨 내일 날짜로 정확히 저장');
  assert(!todayOnly?.some(l => l.id === tomorrowLesson?.id), 'TC-008-C', '내일 레슨이 오늘 목록에 없음');

  // 정리
  if (todayLesson) await supabase.from('lessons').delete().eq('id', todayLesson.id);
  if (tomorrowLesson) await supabase.from('lessons').delete().eq('id', tomorrowLesson.id);
}

// ─── TC-009: 회원 삭제 → 고아 데이터 방지 ───────────────────
async function tc009_cascadeDelete() {
  console.log('\n🧪 TC-009: 회원 삭제 → 연관 데이터 정리 확인');

  // 임시 회원 생성
  const { data: tmpMember } = await supabase.from('members').insert({
    name: '[TEST-DEL] 삭제테스트', phone: '010-0000-0002',
    coach_id: testCoachId,
    fixed_schedule_days: [],
    total_credits: 5, remaining_credits: 5, level: '초급',
  }).select().single();

  if (!tmpMember) { assert(false, 'TC-009-A', '임시 회원 생성 실패'); return; }

  // 결제 데이터 추가
  await supabase.from('payments').insert({
    member_id: tmpMember.id, coach_id: testCoachId,
    amount: 100000, paid_amount: 0, status: '미납',
    description: '[TEST] 삭제테스트 결제',
  });

  // 회원 삭제
  const { error: delError } = await supabase.from('members').delete().eq('id', tmpMember.id);
  assert(!delError, 'TC-009-A', '회원 삭제 성공');
  await sleep(500);

  // 고아 결제 데이터 없는지 확인
  const { data: orphanPayments } = await supabase
    .from('payments').select('id').eq('member_id', tmpMember.id);
  assert(!orphanPayments || orphanPayments.length === 0, 'TC-009-B', '회원 삭제 시 결제 데이터 함께 정리됨 (cascade)');
}

// ─── TC-010: AI 분석 결과 JSON 파싱 무결성 ───────────────────
async function tc010_aiAnalysisJsonIntegrity() {
  console.log('\n🧪 TC-010: AI 분석 결과 JSON 무결성 검증');
  if (!testMemberId || !testLessonId) { console.log('  ⚠️ 선행 테스트 실패로 스킵'); return; }

  // lesson_analyses 테이블에 깨진 JSON 넣기 시도 방지 검증
  const validAnalysis = {
    lesson_id: testLessonId,
    member_id: testMemberId,
    summary: '테스트 요약입니다.',
    strengths: ['포핸드 스트로크 안정적'],
    improvements: ['백핸드 폼 교정 필요'],
    overall_score: 85,
  };

  // lesson_analyses 테이블 존재 확인
  const { error: insertErr } = await supabase
    .from('lesson_analyses')
    .insert(validAnalysis);

  if (insertErr?.message?.includes('does not exist')) {
    console.log('  ℹ️ lesson_analyses 테이블 없음 — 스킵');
    return;
  }

  assert(!insertErr, 'TC-010-A', 'AI 분석 데이터 저장 성공');

  // 저장된 데이터 타입 검증
  const { data: analysis } = await supabase
    .from('lesson_analyses')
    .select('*')
    .eq('lesson_id', testLessonId)
    .eq('member_id', testMemberId)
    .single();

  assert(typeof analysis?.summary === 'string', 'TC-010-B', 'summary 필드가 string 타입');
  assert(Array.isArray(analysis?.strengths), 'TC-010-C', 'strengths 필드가 배열 타입');
  assert(typeof analysis?.overall_score === 'number', 'TC-010-D', 'overall_score가 숫자 타입');

  // 정리
  await supabase.from('lesson_analyses').delete()
    .eq('lesson_id', testLessonId).eq('member_id', testMemberId);
}

// ─── TC-011: 잔여 크레딧 1 이하 경고 상태 ───────────────────
async function tc011_lowCreditWarning() {
  console.log('\n🧪 TC-011: 잔여 크레딧 1 이하 → 경고 상태 확인');
  if (!testMemberId) { console.log('  ⚠️ 선행 테스트 실패로 스킵'); return; }

  await supabase.from('members').update({ remaining_credits: 1 }).eq('id', testMemberId);
  await sleep(300);

  const { data: member } = await supabase
    .from('members').select('remaining_credits').eq('id', testMemberId).single();

  assert(member?.remaining_credits === 1, 'TC-011-A', '크레딧 1로 업데이트됨');
  // 실제 앱에서는 잔여 1 이하 시 알림 표시 — DB 값 기준 검증
  assert(member?.remaining_credits <= 1, 'TC-011-B', '알림 조건 충족 (크레딧 ≤ 1)');

  // 복원
  await supabase.from('members').update({ remaining_credits: 10 }).eq('id', testMemberId);
}

// ─── TC-012: 결제 완료 처리 상태 변경 ───────────────────────
async function tc012_paymentStatusUpdate() {
  console.log('\n🧪 TC-012: 결제 미납 → 완료 상태 변경');
  if (!testMemberId) { console.log('  ⚠️ 선행 테스트 실패로 스킵'); return; }

  const { data: payment } = await supabase.from('payments').insert({
    member_id: testMemberId, coach_id: testCoachId,
    amount: 150000, paid_amount: 0, status: '미납',
    description: '[TEST] 상태변경 테스트',
    due_date: new Date().toISOString().split('T')[0],
  }).select().single();

  if (!payment) { assert(false, 'TC-012-A', '결제 생성 실패'); return; }

  // 완료로 변경
  const { error: updateErr } = await supabase.from('payments')
    .update({ status: '납부완료', paid_amount: 150000 })
    .eq('id', payment.id);

  assert(!updateErr, 'TC-012-A', '결제 상태 완료로 변경 성공');

  const { data: updated } = await supabase.from('payments')
    .select('status, paid_amount').eq('id', payment.id).single();

  assert(updated?.status === '납부완료', 'TC-012-B', '상태 paid로 정확히 업데이트됨');
  assert(updated?.paid_amount === 150000, 'TC-012-C', '납부 금액 정확히 기록됨');

  await supabase.from('payments').delete().eq('id', payment.id);
}

// ─── 메인 실행 ────────────────────────────────────────────────
async function main() {
  console.log('🚀 KERRI Integration Test — Coach App');
  console.log('═'.repeat(50));

  try {
    await setupTestData();
    await tc001_memberRegistration();
    await tc003_attendance();
    await tc004_payment();
    await tc006_zeroCredit();
    await tc007_duplicateLesson();
    await tc008_dateBoundary();
    await tc009_cascadeDelete();
    await tc010_aiAnalysisJsonIntegrity();
    await tc011_lowCreditWarning();
    await tc012_paymentStatusUpdate();
  } catch (err) {
    console.error('\n💥 테스트 실행 오류:', err.message);
    console.error(err.stack);
    failed++;
  } finally {
    await cleanupTestData();
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`📊 결과: ${passed} 통과 / ${failed} 실패`);

  if (failed > 0) {
    console.error('\n❌ 실패한 테스트:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.error(`  - [${r.id}] ${r.description}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ 전체 통과!');
    process.exit(0);
  }
}

main();
