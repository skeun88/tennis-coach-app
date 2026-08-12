import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { View, ActivityIndicator, Text } from 'react-native';
import { Colors } from '../lib/theme';
import { getCurrentSubscription } from '../lib/subscription';
import { registerCoachPushToken } from '../lib/notifications';
import { IS_BETA } from '../lib/beta';

// Android 시스템 폰트 크기 설정이 레이아웃을 깨트리지 않도록 전역 비활성화
if ((Text as any).defaultProps == null) (Text as any).defaultProps = {};
(Text as any).defaultProps.allowFontScaling = false;

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNavigationReady, setIsNavigationReady] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    // 딥링크 URL에서 Supabase 토큰 추출 후 세션 설정 (비밀번호 재설정 등)
    const handleDeepLinkUrl = async (url: string) => {
      console.log('[DEEPLINK]', url);
      const fragment = url.split('#')[1] ?? '';
      const params = Object.fromEntries(new URLSearchParams(fragment));
      if (params.access_token && params.refresh_token) {
        await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
      }
    };

    // 앱이 딥링크로 최초 실행된 경우
    Linking.getInitialURL().then(url => { if (url) handleDeepLinkUrl(url); });
    // 앱이 이미 실행 중일 때 딥링크 수신
    const linkSub = Linking.addEventListener('url', ({ url }) => handleDeepLinkUrl(url));

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/reset-password');
      }
    });

    return () => {
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inSubscriptionGroup = segments[0] === 'subscription';
    const inOnboarding = segments[0] === '(auth)' && (segments as string[])[1] === 'onboarding';
    // 비밀번호 재설정 딥링크 경로 — 세션 없어도 redirect 금지
    const inResetPassword = (segments as string[])[0] === 'reset-password';

    if (!session && !inAuthGroup && !inResetPassword) {
      router.replace('/(auth)/login');
      setIsNavigationReady(true);
      return;
    }

    // 이미 온보딩 중이면 아무것도 하지 않음
    if (inOnboarding) {
      setIsNavigationReady(true);
      return;
    }

    if (session && !inSubscriptionGroup) {
      registerCoachPushToken().catch(() => {});
      // 코치 프로필 있는지 확인 → 없으면 온보딩 (인증 후 딥링크 진입 포함)
      supabase
        .from('coach_profiles')
        .select('coach_id')
        .eq('coach_id', session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) {
            // 프로필 없음 → 무조건 온보딩 (inAuthGroup 여부 관계없이)
            router.replace('/(auth)/onboarding');
            setIsNavigationReady(true);
            return;
          }
          // 프로필 있으면 로그인 화면이면 탭으로, 아니면 구독 체크
          if (inAuthGroup) {
            router.replace('/(tabs)');
            setIsNavigationReady(true);
            return;
          }
          // 구독 상태 체크
          if (IS_BETA) { setIsNavigationReady(true); return; }
          getCurrentSubscription().then((sub) => {
            if (sub && (sub.status === 'blocked' || sub.status === 'cancelled')) {
              router.replace('/subscription/blocked');
            }
            setIsNavigationReady(true);
          }).catch(() => {
            setIsNavigationReady(true);
          });
        });
      return;
    }

    setIsNavigationReady(true);
  }, [session, loading, segments]);

  if (loading || !isNavigationReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.navy }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="members/[id]" options={{ headerShown: true, title: '회원 상세', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="members/new" options={{ headerShown: true, title: '회원 등록', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="lessons/[id]" options={{ headerShown: true, title: '레슨 상세', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="lessons/new" options={{ headerShown: true, title: '레슨 추가', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="lesson-packages/index" options={{ headerShown: true, title: '레슨권 관리', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="lesson-packages/new" options={{ headerShown: true, title: '레슨권 등록', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="members/ai-analysis" options={{ headerShown: false }} />
      <Stack.Screen name="settings/index" options={{ headerShown: true, title: '설정', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="settings/notifications" options={{ headerShown: true, title: '알림 설정', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="settings/availability" options={{ headerShown: false }} />
    </Stack>
  );
}
