/**
 * 코치 공용 QR / 연결 요청 데이터 액세스 (코치 앱 전용).
 * - 쓰기는 모두 SECURITY DEFINER RPC 경유 (issue/process). 테이블 직접 쓰기 없음.
 * - 조회는 RLS(coach_id = auth.uid())로 본인 데이터만.
 * - 재발급(reissue)은 의도적으로 노출하지 않음(기존 공유 QR 무효화 위험).
 */
import { supabase } from './supabase';

export interface InviteLink {
  token: string;
  connect_code: string;
}

export interface ConnectionRequest {
  id: string;
  coach_id: string;
  request_id: string;
  member_name: string;
  phone_raw: string | null;
  phone_norm: string | null;
  status: 'pending' | 'processed' | 'rejected' | 'cancelled';
  process_type: 'existing_member' | 'new_member' | null;
  matched_member_id: string | null;
  source: string;
  created_at: string;
  processed_at: string | null;
}

/** 현재 코치의 활성 초대 링크 조회(없으면 null). */
export async function getActiveInviteLink(): Promise<InviteLink | null> {
  const { data, error } = await supabase
    .from('coach_invite_links')
    .select('token, connect_code')
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data ? { token: data.token, connect_code: data.connect_code } : null;
}

/**
 * 활성 링크를 보장: 있으면 그대로 반환, 없을 때만 최초 1회 발급.
 * 재발급(p_reissue=true)은 호출하지 않음 — MVP UI에서 재발급 미노출.
 */
export async function ensureInviteLink(): Promise<InviteLink> {
  const existing = await getActiveInviteLink();
  if (existing) return existing;
  const { data, error } = await supabase.rpc('issue_coach_invite_link', {
    p_reissue: false,
  });
  if (error) throw error;
  // RPC는 coach_invite_links 행을 반환
  const row: any = Array.isArray(data) ? data[0] : data;
  return { token: row.token, connect_code: row.connect_code };
}

/** 현재 코치의 연결 요청 전체(최신순). */
export async function fetchConnectionRequests(): Promise<ConnectionRequest[]> {
  const { data, error } = await supabase
    .from('member_connection_requests')
    .select(
      'id, coach_id, request_id, member_name, phone_raw, phone_norm, status, process_type, matched_member_id, source, created_at, processed_at',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConnectionRequest[];
}

export interface MemberLite {
  id: string;
  name: string;
  phone: string | null;
}

/** 숫자만 남긴 전화번호(뒤 11자리까지). phone_norm 과 비교용. */
function digits(phone?: string | null): string {
  return (phone ?? '').replace(/[^0-9]/g, '');
}

/**
 * 요청 전화번호(phone_norm)와 일치하는 기존 회원을 찾는다.
 * members.phone 은 원문 포맷이므로 클라에서 숫자만 비교.
 */
export async function findMemberByPhone(
  phoneNorm: string | null,
): Promise<MemberLite | null> {
  if (!phoneNorm) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('members')
    .select('id, name, phone')
    .eq('coach_id', user.id)
    .eq('is_active', true);
  if (error) throw error;
  const target = digits(phoneNorm);
  const hit = (data ?? []).find((m: any) => digits(m.phone) === target);
  return hit ? { id: hit.id, name: hit.name, phone: hit.phone } : null;
}

/** 기존 회원과 연결 처리. */
export async function processExisting(requestId: string, memberId: string) {
  const { error } = await supabase.rpc('process_connection_request', {
    p_id: requestId,
    p_action: 'process_existing',
    p_member_id: memberId,
  });
  if (error) throw error;
}

/** 신규로 등록한 회원과 연결 처리(회원 생성 직후 호출). */
export async function processNew(requestId: string, memberId: string) {
  const { error } = await supabase.rpc('process_connection_request', {
    p_id: requestId,
    p_action: 'process_new',
    p_member_id: memberId,
  });
  if (error) throw error;
}

/** 요청 거절. */
export async function rejectRequest(requestId: string) {
  const { error } = await supabase.rpc('process_connection_request', {
    p_id: requestId,
    p_action: 'reject',
  });
  if (error) throw error;
}
