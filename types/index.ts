export type MemberLevel = '입문' | '초급' | '중급' | '고급' | '선수';
export type PaymentStatus = '납부완료' | '미납' | '부분납부';
export type AttendanceStatus = '출석' | '결석' | '지각' | '조퇴';

export interface Member {
  id: string;
  coach_id: string;
  name: string;
  phone: string;
  email?: string;
  birth_date?: string;
  level: MemberLevel;
  join_date: string;
  notes?: string;
  photo_url?: string;
  is_active: boolean;
  total_credits: number;
  remaining_credits: number;
  created_at: string;
  updated_at: string;
}

export interface Lesson {
  id: string;
  coach_id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  location?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface LessonMember {
  id: string;
  lesson_id: string;
  member_id: string;
  member?: Member;
}

export interface Attendance {
  id: string;
  lesson_id: string;
  member_id: string;
  status: AttendanceStatus;
  notes?: string;
  deduct_credit: boolean;
  created_at: string;
  lesson?: Lesson;
  member?: Member;
}

export interface Payment {
  id: string;
  coach_id: string;
  member_id: string;
  amount: number;
  paid_amount: number;
  due_date: string;
  paid_date?: string;
  status: PaymentStatus;
  description: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  member?: Member;
}

export interface LessonTranscript {
  id: string;
  coach_id: string;
  member_id: string;
  lesson_id?: string;
  transcript: string;
  duration_seconds?: number;
  recorded_at: string;
  created_at: string;
}

export interface DrillSuggestion {
  name: string;
  purpose: string;
  method: string;
  reps: string;
  court_adaptation?: string;
}

export interface LessonPlan {
  id: string;
  coach_id: string;
  member_id: string;
  transcript_id?: string;
  summary: string;
  improvement_points: string;
  next_goals: string;
  session_goals?: string;
  drill_suggestions?: DrillSuggestion[];
  court_type?: string;
  duration_minutes?: number;
  raw_response?: string;
  created_at: string;
  updated_at: string;
}

export interface LessonCredit {
  id: string;
  coach_id: string;
  member_id: string;
  total_credits: number;
  remaining_credits: number;
  package_name: string;
  purchase_date: string;
  expiry_date?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface LessonCheckConfirmation {
  id: string;
  attendance_id: string;
  coach_checked_at?: string;
  member_confirmed_at?: string;
  status: 'pending' | 'confirmed' | 'disputed';
  created_at: string;
}

export interface MemberNote {
  id: string;
  member_id: string;
  coach_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}
