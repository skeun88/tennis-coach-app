-- Migration: lesson_plans 비동기 분석 지원 컬럼 추가
-- 생성일: 2026-07-15
-- 목적: 백그라운드 네트워크 오류 방지를 위한 비동기 AI 분석 흐름 지원

ALTER TABLE lesson_plans
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS audio_storage_path TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT NULL;

-- 기존 레코드는 모두 completed 처리
UPDATE lesson_plans SET status = 'completed' WHERE status IS NULL OR status = 'completed';

-- 인덱스 생성 (조회 성능 최적화)
CREATE INDEX IF NOT EXISTS idx_lesson_plans_status ON lesson_plans(status);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_coach_status ON lesson_plans(coach_id, status);
