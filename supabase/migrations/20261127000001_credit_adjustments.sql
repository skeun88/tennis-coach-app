-- 레슨 횟수 조정 이력 테이블
-- 잔여 횟수 추가/차감 시 변경 전·후·사유를 기록

CREATE TABLE IF NOT EXISTS public.credit_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  coach_id        uuid NOT NULL,
  before_credits  integer NOT NULL,
  delta           integer NOT NULL,       -- 양수=추가, 음수=차감
  after_credits   integer NOT NULL,
  reason          text NOT NULL DEFAULT '',
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_adjustments_member_id_idx
  ON public.credit_adjustments(member_id);
CREATE INDEX IF NOT EXISTS credit_adjustments_created_at_idx
  ON public.credit_adjustments(created_at DESC);

ALTER TABLE public.credit_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_own_credit_adjustments"
  ON public.credit_adjustments
  FOR ALL
  USING (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());
