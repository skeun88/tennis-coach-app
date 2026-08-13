-- BUG-8 fix: sync total_credits for members where remaining_credits > total_credits
-- Root cause: payments.tsx credit recharge only updated remaining_credits, not total_credits
-- Fix: set total_credits from linked lesson_package; fallback to remaining_credits if no package
UPDATE members m
SET total_credits = COALESCE(
  (SELECT lp.total_credits FROM lesson_packages lp WHERE lp.id = m.lesson_package_id),
  m.remaining_credits
)
WHERE m.remaining_credits > m.total_credits;
