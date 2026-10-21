import { MemberLevel } from '../../types';

export type MemberBasicFieldKey = 'name' | 'phone' | 'email' | 'birthDate' | 'joinDate' | 'level' | 'notes';

export type MemberFormValues = {
  name: string;
  phone: string;
  email: string;
  birthDate: string;
  joinDate: string;
  level?: MemberLevel | null;
  notes: string;
};

export const MEMBER_LEVELS: MemberLevel[] = ['입문', '초급', '중급', '상급', '선수'];

export const MEMBER_BASIC_FIELD_KEYS: MemberBasicFieldKey[] = [
  'name',
  'phone',
  'email',
  'birthDate',
  'joinDate',
  'level',
  'notes',
];

export const buildMemberUpsertPayload = (values: MemberFormValues) => ({
  name: values.name.trim(),
  phone: values.phone.trim(),
  email: values.email.trim() || null,
  birth_date: values.birthDate.trim() || null,
  join_date: values.joinDate.trim() || null,
  // 레벨은 명시적으로 선택한 경우에만 저장 (미선택 시 키 자체를 보내지 않음)
  ...(values.level ? { level: values.level } : {}),
  notes: values.notes.trim() || null,
});
