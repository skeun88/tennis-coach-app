/**
 * 클라이언트 피처플래그 (lib/beta.ts 패턴).
 * 미설정 = OFF 가 기본값. 운영 빌드에는 값을 넣지 않으면 자동으로 꺼진 상태로 동작.
 */

// 코치 공용 QR · 8자리 연결코드(신규 회원 연결 요청) 기능 전체 게이트.
export const FEATURE_SHARED_QR =
  process.env.EXPO_PUBLIC_FEATURE_SHARED_QR_ENABLED === 'true';

// 초대 QR 에 인코딩할 HTTPS 초대주소 베이스 (예: https://kerri.co.kr/join).
// 환경별로 .env* 에서 주입. 비어있으면 QR 대신 연결코드 입력만 안내.
export const INVITE_BASE_URL = (
  process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? ''
).replace(/\/+$/, '');

/** 토큰으로 최종 HTTPS 초대주소 생성. 베이스 미설정 시 빈 문자열. */
export function buildInviteUrl(token: string): string {
  if (!INVITE_BASE_URL || !token) return '';
  return `${INVITE_BASE_URL}/${token}`;
}
