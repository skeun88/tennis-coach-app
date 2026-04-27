#!/usr/bin/env node
const SUPABASE_URL = 'https://luhuiwyhewofjxnbzbdt.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const REQUIRED_TABLES = [
  'members','lessons','lesson_members','attendance',
  'payments','member_notes','lesson_packages',
];

async function main() {
  if (!SERVICE_KEY) { console.error('SUPABASE_SERVICE_KEY 필요'); process.exit(1); }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SERVICE_KEY}`, {
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const data = await res.json();
  const existing = Object.keys(data.definitions || {});

  let ok = true;
  console.log('DB 테이블 검증:\n');
  for (const t of REQUIRED_TABLES) {
    const has = existing.includes(t);
    console.log(`  ${has ? '✅' : '❌'} ${t}${has ? '' : ' ← 없음!'}`);
    if (!has) ok = false;
  }
  console.log('');
  if (!ok) { console.log('⚠️  누락 테이블 있음. SQL 적용 후 재확인'); process.exit(1); }
  else console.log('✅ 모두 OK');
}

main().catch(e => { console.error(e); process.exit(1); });
