import { LessonPlan } from '../types';

/** 테니스 코칭에서 자주 등장하는 핵심 키워드 seed */
export const KEYWORD_SEEDS: string[] = [
  '서브', '백핸드', '포핸드', '풋워크', '그립', '발리', '스매시',
  '발런스', '밸런스', '스텝', '스윙', '타이밍', '로테이션', '토스',
  '리턴', '드롭샷', '네트', '포지셔닝', '체중이동', '팔꿈치',
  '라켓', '임팩트', '준비동작', '팔로스루', '어깨', '허리',
  '스플릿스텝', '크로스', '다운더라인', '앵글', '무릎굽힘',
];

/** 제거할 불용어 (조사, 연결어, 레슨 관련 일반어) */
export const STOP_WORDS = new Set<string>([
  '이', '가', '은', '는', '을', '를', '에', '와', '과', '의', '도',
  '로', '으로', '에서', '하고', '하여', '해서', '때', '때문', '위해',
  '통해', '같은', '하는', '있는', '없는', '되는', '하면', '한다',
  '합니다', '있습니다', '없습니다', '됩니다', '해야', '필요', '중요',
  '연습', '레슨', '코치', '회원', '선수', '훈련', '개선', '향상',
  '목표', '동작', '방법', '시도', '집중', '확인', '진행', '다음',
  '이번', '지난', '오늘', '내일', '계속', '꾸준히', '잘', '더',
  '좀', '많이', '조금', '자연스럽게', '정확하게', '안정적으로',
]);

/**
 * 최근 레슨 플랜들에서 반복 이슈 태그를 추출한다.
 * @param plans - 최근 lesson_plan 배열 (최신순, 최대 5개 권장)
 * @returns 태그 문자열 배열 (# 없이), 최대 8개
 */
export function extractIssueTags(plans: LessonPlan[]): string[] {
  if (!plans || plans.length === 0) return [];

  // 각 플랜의 텍스트를 모음
  const planTexts = plans.map(p =>
    [p.improvement_points, p.summary, p.next_goals, p.session_goals]
      .filter(Boolean)
      .join(' ')
  );

  // 1) seed 키워드 등장 횟수 (몇 개 플랜에서 나왔는지)
  const seedFreq: Record<string, number> = {};
  for (const kw of KEYWORD_SEEDS) {
    let count = 0;
    for (const text of planTexts) {
      if (text.includes(kw)) count++;
    }
    if (count >= 1) seedFreq[kw] = count;
  }

  // 2) 자유 토큰 빈도 분석 (2자 이상, 불용어 제외)
  const tokenFreq: Record<string, number> = {};
  const allText = planTexts.join(' ');
  const tokens = allText
    .split(/[\s,.\n·•\-\(\)\[\]\{\}/\:;!?「」『』【】]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));

  for (const token of tokens) {
    tokenFreq[token] = (tokenFreq[token] ?? 0) + 1;
  }

  // 3) seed 키워드 우선, 그다음 고빈도 토큰
  const tags: Array<{ tag: string; score: number }> = [];

  // seed 키워드 추가 (2개 이상 플랜에서 등장한 것 우선)
  for (const [kw, freq] of Object.entries(seedFreq)) {
    tags.push({ tag: kw, score: freq * 3 }); // seed 가중치 3배
  }

  // 자유 토큰 중 seed에 없는 것만 추가 (2회 이상 등장)
  const seedSet = new Set(KEYWORD_SEEDS);
  for (const [token, freq] of Object.entries(tokenFreq)) {
    if (!seedSet.has(token) && freq >= 2 && token.length >= 2) {
      tags.push({ tag: token, score: freq });
    }
  }

  // 점수 내림차순 정렬
  tags.sort((a, b) => b.score - a.score);

  // 중복 제거 후 상위 8개
  const seen = new Set<string>();
  const result: string[] = [];
  for (const { tag } of tags) {
    if (!seen.has(tag) && result.length < 8) {
      seen.add(tag);
      result.push(tag);
    }
  }

  return result;
}
