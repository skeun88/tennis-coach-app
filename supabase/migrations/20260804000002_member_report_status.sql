alter table lesson_plans
  add column if not exists member_report_status text,
  add column if not exists member_report_error text;
