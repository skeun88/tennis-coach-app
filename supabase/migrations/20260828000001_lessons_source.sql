-- 레슨 생성 출처 구분 컬럼 추가
-- auto: 정기 일정에서 자동 생성된 레슨
-- manual: 코치가 직접 추가한 레슨 (기본값)
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('auto', 'manual'));

COMMENT ON COLUMN public.lessons.source IS 'auto = 정기 일정에서 자동 생성, manual = 코치가 직접 추가';
