import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const EXPO_PROJECT_ID = '1ed6ab94-326e-4ac4-8436-7463181a3c34';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerCoachPushToken() {
  // Constants.isDevice는 SDK 54에서 deprecated — 시뮬레이터 체크 제거 후 예외로 처리
  if (Constants.appOwnership === 'expo') return; // Expo Go에서는 스킵

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'KERRI',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID });
  const token = tokenResult.data;
  if (!token) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('coach_push_tokens').upsert({
    coach_id: user.id,
    push_token: token,
    platform: Platform.OS as 'ios' | 'android',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'coach_id' });
}

async function callSendPush(payload: object) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  }).catch(() => {}); // 알림 실패해도 앱 동작에 영향 없도록
}

// PN-08: 코치 → 회원 메시지 알림
export async function notifyMemberMessage(memberId: string, coachName: string) {
  await callSendPush({
    recipient_type: 'member',
    recipient_id: memberId,
    title: '코치 메시지',
    body: '코치에게 새로운 메시지가 도착했습니다.',
    data: { screen: 'coach-chat' },
    notif_id: 'PN-08',
  });
}

// PN-04: 재등록 알림 (잔여 1회)
export async function notifyReregister(coachId: string, memberName: string, memberId: string) {
  await callSendPush({
    recipient_type: 'coach',
    recipient_id: coachId,
    title: '재등록 알림',
    body: `${memberName} 회원의 레슨이 1회 남았습니다.`,
    data: { screen: 'member', member_id: memberId },
    notif_id: 'PN-04',
  });
}

// PN-09: 스케줄 변경 알림
export async function notifyScheduleChange(memberId: string, date: string, time: string, lessonId: string) {
  const dateObj = new Date(`${date}T00:00:00+09:00`);
  const dateFormatted = dateObj.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  await callSendPush({
    recipient_type: 'member',
    recipient_id: memberId,
    title: '레슨 일정 변경',
    body: `레슨 일정이 변경되었습니다. 변경된 일정: ${dateFormatted} ${time}`,
    data: { screen: 'lesson', lesson_id: lessonId },
    notif_id: 'PN-09',
  });
}

// PN-10: 레슨 취소 알림
export async function notifyLessonCancel(memberId: string, coachName: string, lessonTitle: string) {
  await callSendPush({
    recipient_type: 'member',
    recipient_id: memberId,
    title: '레슨 취소',
    body: `${lessonTitle} 레슨이 취소되었습니다.`,
    data: { screen: 'home' },
    notif_id: 'PN-10',
  });
}

// PN-11: 레슨 횟수 안내
export async function notifyLessonCountUpdate(memberId: string, remainingCount: number) {
  await callSendPush({
    recipient_type: 'member',
    recipient_id: memberId,
    title: '레슨 완료',
    body: `오늘 레슨이 완료되었습니다. 남은 레슨 횟수: ${remainingCount}회`,
    data: { screen: 'history' },
    notif_id: 'PN-11',
  });
}
