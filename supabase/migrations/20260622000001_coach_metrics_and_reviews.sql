-- ============================================================
-- coach_metrics: 코치별 집계 지표 (이벤트 발생 시 or 배치 갱신)
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_metrics (
  coach_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_lessons     INT  NOT NULL DEFAULT 0,   -- 출석 체크 '출석' 누적
  total_reports     INT  NOT NULL DEFAULT 0,   -- 발송 완료된 리포트 누적
  avg_retention_months NUMERIC(5,1),           -- 이탈 회원 평균 유지 기간(개월), 5명 미만 NULL
  churned_count     INT  NOT NULL DEFAULT 0,   -- 이탈 확정 회원 수
  satisfaction_avg  NUMERIC(3,2),              -- 만족도 단순 평균 (NULL = 리뷰 없음)
  satisfaction_count INT NOT NULL DEFAULT 0,   -- 리뷰 작성 회원 수
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_metrics_own" ON coach_metrics
  FOR ALL USING (coach_id = auth.uid());

-- ============================================================
-- coach_reviews: 회원 → 코치 만족도 리뷰
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES members(id)   ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (coach_id, member_id)   -- 회원 1명당 코치 1개 리뷰
);

ALTER TABLE coach_reviews ENABLE ROW LEVEL SECURITY;
-- 코치는 자신의 리뷰 읽기 가능
CREATE POLICY "coach_reviews_read_own" ON coach_reviews
  FOR SELECT USING (coach_id = auth.uid());
-- 회원은 자신이 쓴 리뷰 insert/update (회원앱 연동 시 사용)
CREATE POLICY "coach_reviews_member_write" ON coach_reviews
  FOR ALL USING (member_id = auth.uid());

-- ============================================================
-- member_status: 회원 상태 머신 컬럼 추가
-- (진행중 | 판정보류 | 이탈 | 복귀)
-- ============================================================
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS churn_status TEXT NOT NULL DEFAULT '진행중'
    CHECK (churn_status IN ('진행중', '판정보류', '이탈', '복귀')),
  ADD COLUMN IF NOT EXISTS first_attended_at DATE,   -- 첫 출석일 (고정)
  ADD COLUMN IF NOT EXISTS last_attended_at  DATE;   -- 마지막 출석일 (갱신)
