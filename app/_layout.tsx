import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { Text } from 'react-native';
import { getCurrentSubscription } from '../lib/subscription';
import { registerCoachPushToken } from '../lib/notifications';
import { IS_BETA } from '../lib/beta';
import BrandLoadingScreen from '../components/BrandLoadingScreen';
import {
  fetchHomeData,
  persistHomeData,
  loadCachedHomeData,
} from '../lib/homeDataLoader';

// Android 시스템 폰트 크기 설정이 레이아웃을 깨트리지 않도록 전역 비활성화
if ((Text as any).defaultProps == null) (Text as any).defaultProps = {};
(Text as any).defaultProps.allowFontScaling = false;

const PRELOAD_TIMEOUT_MS = 8000;

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNavigationReady, setIsNavigationReady] = useState(false);
  const [preloading, setPreloading] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    const handleDeepLinkUrl = async (url: string) => {
      const fragment = url.split('#')[1] ?? '';
      const params = Object.fromEntries(new URLSearchParams(fragment));
      if (params.access_token && params.refresh_token) {
        await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
      }
    };

    Linking.getInitialURL().then(url => { if (url) handleDeepLinkUrl(url); });
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
    const inResetPassword = (segments as string[])[0] === 'reset-password';

    if (!session && !inAuthGroup && !inResetPassword) {
      router.replace('/(auth)/login');
      setIsNavigationReady(true);
      return;
    }

    if (inOnboarding) {
      setIsNavigationReady(true);
      return;
    }

    if (session && !inSubscriptionGroup) {
      registerCoachPushToken().catch(() => {});
      supabase
        .from('coach_profiles')
        .select('coach_id')
        .eq('coach_id', session.user.id)
        .maybeSingle()
        .then(async ({ data }) => {
          if (!data) {
            router.replace('/(auth)/onboarding');
            setIsNavigationReady(true);
            return;
          }

          if (inAuthGroup) {
            // 구독 체크
            if (!IS_BETA) {
              try {
                const sub = await getCurrentSubscription();
                if (sub && (sub.status === 'blocked' || sub.status === 'cancelled')) {
                  router.replace('/subscription/blocked');
                  setIsNavigationReady(true);
                  return;
                }
              } catch {}
            }

            // 홈 데이터 프리로드 (캐시 없거나 stale일 때만)
            setPreloading(true);
            try {
              const uid = session.user.id;
              const cached = await loadCachedHomeData(uid);
              if (!cached) {
                // 처음 실행 — 네트워크로 fetch
                const result = await Promise.race<any>([
                  fetchHomeData(uid, session.user.email ?? ''),
                  new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), PRELOAD_TIMEOUT_MS)),
                ]);
                await persistHomeData(uid, result);
              }
              // stale cache면 home screen이 백그라운드에서 갱신함
            } catch {
              // 오류 시 캐시 있으면 사용, 없으면 home에서 직접 로드
            } finally {
              setPreloading(false);
            }

            router.replace('/(tabs)');
            setIsNavigationReady(true);
            return;
          }

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

  if (loading || !isNavigationReady || preloading) {
    return <BrandLoadingScreen />;
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
      <Stack.Screen name="subscription" options={{ headerShown: false }} />
    </Stack>
  );
}
