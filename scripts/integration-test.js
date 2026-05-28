/**
 * KERRI Integration Test — Coach App
 * TC-001~005: 두 앱 데이터 정합성 자동 검증
 * 
 * 실행: node scripts/integration-test.js
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key = RLS 우회, 테스트 전용
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

// ─── 테스트 데이터 세팅 ───────────────────────────────────
let testCoachId = null;
let testMemberId = null;
let testLessonId = null;

async function setupTestData() {
  console.log('\n📋 테스트 데이터 준비 중...');

  // 테스트 코치 찾기 (실제 코치 중 첫번째)
  const { data: coaches } = await supabase.from('coaches').select('id').limit(1);
  if (!coaches || coaches.length === 0) throw new Error('코치 데이터 없음');
  testCoachId = coaches[0].id;
  console.log(`  코치 ID: ${testCoachId}`);
}

async function cleanupTestData() {
  if (testMemberId) {
    await supabase.from('lesson_members').delete().eq('member_id', testMemberId);
    await supabase.from('attendances').delete().eq('member_id', testMemberId);
    await supabase.from('payments').delete().eq('member_id', testMemberId);
    await supabase.from('members').delete().eq('id', testMemberId);
    console.log(`\n🧹 테스트 데이터 정리 완료 (member: ${testMemberId})`);
  }
}

// ─── TC-001: 신규 회원 등록 → 전체 반영 확인 ────────────────
async function tc001_memberRegistration() {
  console.log('\n🧪 TC-001: 신규 회원 등록 → 전체 반영 확인');

  const today = new Date();
  const todayKST = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = todayKST.toISOString().split('T')[0];
  const todayDow = todayKST.getDay(); // 0=일, 1=월...

  // 1. 회원 등록 (오늘 요일을 고정 스케줄로)
  const { data: newMember, error } = await supabase
    .from('members')
    .insert({
      name: '[TEST] 자동테스트회원',
      coach_id: testCoachId,
      fixed_schedule_days: [todayDow],
      fixed_schedule_time: '10:00',
      fixed_lesson_duration: 60,
      total_credits: 10,
      remaining_credits: 10,
      level: '초급',
    })
    .select()
    .single();

  assert(!error && newMember, 'TC-001-A', '회원 등록 성공');
  if (!newMember) return;
  testMemberId = newMember.id;

  await sleep(500); // DB 반영 대기

  // 2. 해당 회원이 오늘 레슨에 반영되는지 확인
  // (lessons 테이블에 오늘 날짜로 레슨이 있어야 함 — 자동 생성 로직)
  const { data: todayLessons } = await supabase
    .from('lessons')
    .select('id, lesson_members(member_id)')
    .eq('coach_id', testCoachId)
    .eq('date', todayStr);

  const memberInLesson = todayLessons?.some(lesson =>
    lesson.lesson_members?.some(lm => lm.member_id === testMemberId)
  );
  assert(memberInLesson, 'TC-001-B', `오늘(${todayStr}) 레슨에 신규 회원 반영됨`);

  // 3. 회원 목록에서 조회 가능한지
  const { data: memberList } = await supabase
    .from('members')
    .select('id, name')
    .eq('coach_id', testCoachId)
    .eq('id', testMemberId);

  assert(memberList && memberList.length > 0, 'TC-001-C', '회원 목록 조회 가능');

  // 4. 이번 달 해당 요일 레슨들에 회원이 등록되어 있는지 (캘린더 반영)
  const monthStart = todayStr.substring(0, 7) + '-01';
  const monthEnd = todayStr.substring(0, 7) + '-31';

  const { data: monthLessons } = await supabase
    .from('lessons')
    .select('id, date, lesson_members(member_id)')
    .eq('coach_id', testCoachId)
    .gte('date', monthStart)
    .lte('date', monthEnd);

  const memberInCalendar = monthLessons?.some(lesson =>
    lesson.lesson_members?.some(lm => lm.member_id === testMemberId)
  );
  assert(memberInCalendar, 'TC-001-D', '이번 달 캘린더에 회원 스케줄 반영됨');
}

// ─── TC-003: 출석 체크 → 크레딧 차감 ─────────────────────────
async function tc003_attendance() {
  console.log('\n🧪 TC-003: 출석 체크 → 크레딧 차감');
  if (!testMemberId) { console.log('  ⚠️ 선행 테스트 실패로 스킵'); return; }

  // 출석 전 크레딧 확인
  const { data: before } = await supabase
    .from('members')
    .select('remaining_credits')
    .eq('id', testMemberId)
    .single();

  const creditsBefore = before?.remaining_credits ?? 0;

  // 오늘 레슨 찾기
  const todayKST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const todayStr = todayKST.toISOString().split('T')[0];

  const { data: lessons } = await supabase
    .from('lessons')
    .select('id')
    .eq('coach_id', testCoachId)
    .eq('date', todayStr)
    .limit(1);

  if (!lessons || lessons.length === 0) {
    console.log('  ⚠️ 오늘 레슨 없어서 TC-003 스킵');
    return;
  }
  testLessonId = lessons[0].id;

  // 출석 체크
  const { error: attError } = await supabase
    .from('attendances')
    .insert({
      lesson_id: testLessonId,
      member_id: testMemberId,
      status: 'present',
    });

  assert(!attError, 'TC-003-A', '출석 체크 성공');
  await sleep(500);

  // 크레딧 차감 확인
  const { data: after } = await supabase
    .from('members')
    .select('remaining_credits')
    .eq('id', testMemberId)
    .single();

  assert(
    after?.remaining_credits === creditsBefore - 1,
    'TC-003-B',
    `크레딧 자동 차감 확인 (${creditsBefore} → ${after?.remaining_credits})`
  );

  // 출석 취소 → 크레딧 복원
  await supabase
    .from('attendances')
    .delete()
    .eq('lesson_id', testLessonId)
    .eq('member_id', testMemberId);

  await sleep(500);

  const { data: restored } = await supabase
    .from('members')
    .select('remaining_credits')
    .eq('id', testMemberId)
    .single();

  assert(
    restored?.remaining_credits === creditsBefore,
    'TC-003-C',
    `출석 취소 시 크레딧 복원 확인 (${after?.remaining_credits} → ${restored?.remaining_credits})`
  );
}

// ─── TC-004: 결제 등록 확인 ──────────────────────────────────
async function tc004_payment() {
  console.log('\n🧪 TC-004: 결제 등록 → DB 저장 확인');
  if (!testMemberId) { console.log('  ⚠️ 선행 테스트 실패로 스킵'); return; }

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      member_id: testMemberId,
      coach_id: testCoachId,
      amount: 300000,
      paid_amount: 0,
      status: 'unpaid',
      description: '[TEST] 자동테스트 결제',
      due_date: new Date().toISOString().split('T')[0],
    })
    .select()
    .single();

  assert(!error && payment, 'TC-004-A', '결제 등록 성공');

  // 조회 확인
  const { data: paymentList } = await supabase
    .from('payments')
    .select('id, status')
    .eq('member_id', testMemberId);

  assert(paymentList && paymentList.length > 0, 'TC-004-B', '결제 내역 조회 가능');
}

// ─── 메인 실행 ────────────────────────────────────────────────
async function main() {
  console.log('🚀 KERRI Integration Test 시작');
  console.log('═'.repeat(50));

  try {
    await setupTestData();
    await tc001_memberRegistration();
    await tc003_attendance();
    await tc004_payment();
  } catch (err) {
    console.error('\n💥 테스트 실행 오류:', err.message);
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
