export type ScheduleType = 'regular' | 'by_date' | 'later';

/**
 * 저장된 데이터로 일정 방식을 계산한다.
 * - regular: fixed_schedule_days 또는 fixed_schedule_times에 유효한 고정 일정이 있음
 * - by_date: 고정 일정 없고 개별 lesson 일정이 있음 (hasIndividualLessons = true)
 * - later: 고정 일정도 없고 개별 일정도 없음
 */
export function detectScheduleType(
  member: {
    fixed_schedule_days?: number[] | null;
    fixed_schedule_times?: Record<string, string[]> | null;
  },
  hasIndividualLessons: boolean,
): ScheduleType {
  const hasFix =
    (member.fixed_schedule_days?.length ?? 0) > 0 ||
    Object.keys(member.fixed_schedule_times ?? {}).length > 0;
  if (hasFix) return 'regular';
  if (hasIndividualLessons) return 'by_date';
  return 'later';
}
