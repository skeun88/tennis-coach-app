import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { Text } from 'react-native';
import { getCurrentSubscription } from '../lib/subscription';
import { registerCoachPushToken } from '../lib/notifications';
import { IS_BETA } from '../lib/beta';
import BrandLoadingScreen from '../components/BrandLoadingScreen';
import { configurePurchases, loginPurchases, logoutPurchases } from '../lib/purchases';
import {
  fetchHomeData,
  persistHomeData,
  loadCachedHomeData,
} from '../lib/homeDataLoader';

// Android 시스템 폰트 크기 설정이 레이아웃을 깨트리지 않도록 전역 비활성화
if ((Text as any).defaultProps == null) (Text as any).defaultProps = {};
(Text as any).defaultProps.allowFontScaling = false;

const PRELOAD_TIMEOUT_MS = 8000;
const MIN_LOADING_MS = 600;

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNavigationReady, setIsNavigationReady] = useState(false);
  const [preloading, setPreloading] = useState(false);
  const loadingStartedAt = useRef(Date.now());
  const router = useRouter();
  const segments = useSegments();

  // Enforces minimum 600ms display time for the loading screen
  const setNavReady = useCallback(() => {
    const elapsed = Date.now() - loadingStartedAt.current;
    const remaining = MIN_LOADING_MS - elapsed;
    if (remaining > 0) {
      setTimeout(() => setIsNavigationReady(true), remaining);
    } else {
      setIsNavigationReady(true);
    }
  }, []);

  useEffect(() => { configurePurchases(); }, []);

  useEffect(() => {
    if (session?.user.id) {
      loginPurchases(session.user.id).catch(() => {});
    } else {
      logoutPurchases();
    }
  }, [session?.user.id]);

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

    // Use INITIAL_SESSION event to avoid race condition where getSession() returns
    // null before the persisted token is loaded, which caused the login screen flash.
    // Fallback: if INITIAL_SESSION never fires (rare SDK edge case), unblock after 5s.
    const fallback = setTimeout(() => setLoading(false), 5000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        clearTimeout(fallback);
        setSession(session);
        setLoading(false);
        return;
      }
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/reset-password');
      }
    });

    return () => {
      clearTimeout(fallback);
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
      setNavReady();
      return;
    }

    if (inOnboarding) {
      setNavReady();
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
            setNavReady();
            return;
          }

          if (inAuthGroup) {
            // 구독 체크
            if (!IS_BETA) {
              try {
                const sub = await getCurrentSubscription();
                if (sub && (sub.status === 'blocked' || sub.status === 'cancelled')) {
                  router.replace('/subscription/blocked');
                  setNavReady();
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
                const result = await Promise.race<any>([
                  fetchHomeData(uid, session.user.email ?? ''),
                  new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), PRELOAD_TIMEOUT_MS)),
                ]);
                await persistHomeData(uid, result);
              }
            } catch {
              // 오류 시 캐시 있으면 사용, 없으면 home에서 직접 로드
            } finally {
              setPreloading(false);
            }

            router.replace('/(tabs)');
            setNavReady();
            return;
          }

          if (IS_BETA) { setNavReady(); return; }
          getCurrentSubscription().then((sub) => {
            if (sub && (sub.status === 'blocked' || sub.status === 'cancelled')) {
              router.replace('/subscription/blocked');
            }
            setNavReady();
          }).catch(() => {
            setNavReady();
          });
        });
      return;
    }

    setNavReady();
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
