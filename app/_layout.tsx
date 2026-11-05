import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { Text } from 'react-native';
import * as Font from 'expo-font';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold } from '@expo-google-fonts/manrope';
import { getCurrentSubscription } from '../lib/subscription';
import { registerCoachPushToken } from '../lib/notifications';
import { IS_BETA } from '../lib/beta';
import BrandLoadingScreen from '../components/BrandLoadingScreen';

SplashScreen.preventAutoHideAsync().catch(() => {});
import { configurePurchases, loginPurchases, logoutPurchases, syncRevenueCatToDb } from '../lib/purchases';
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
  const [startupError, setStartupError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const router = useRouter();
  const segments = useSegments();

  // ── lesson_absence 딥링크 핸들링 ──────────────────────────────────
  const pendingLessonDeeplinkRef = useRef<string | null>(null);
  const lastNavLessonRef = useRef<{ id: string; ts: number } | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const navReadyRef = useRef(false);

  useEffect(() => {
    Font.loadAsync({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold })
      .catch(() => {})
      .finally(() => setFontsLoaded(true));
  }, []);

  // Check for OTA update before showing any UI; reload immediately if found.
  // Native splash stays visible throughout (preventAutoHideAsync above).
  useEffect(() => {
    if (__DEV__) { setUpdateChecked(true); return; }
    (async () => {
      try {
        const result = await Promise.race([
          Updates.checkForUpdateAsync(),
          new Promise<{ isAvailable: boolean }>(res => setTimeout(() => res({ isAvailable: false }), 3000)),
        ]);
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
          return;
        }
      } catch {}
      setUpdateChecked(true);
    })();
  }, []);

  useEffect(() => {
    if (updateChecked) SplashScreen.hideAsync().catch(() => {});
  }, [updateChecked]);

  const setNavReady = useCallback(() => {
    setIsNavigationReady(true);
    navReadyRef.current = true;
  }, []);

  const handleRetry = useCallback(() => {
    setStartupError(false);
    setIsNavigationReady(false);
    setRetryCount(c => c + 1);
  }, []);



  useEffect(() => { configurePurchases(); }, []);

  useEffect(() => {
    if (session?.user.id) {
      const userId = session.user.id;
      syncPromiseRef.current = loginPurchases(userId)
        .then(() => syncRevenueCatToDb(userId))
        .catch(() => {});
    } else {
      syncPromiseRef.current = null;
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
        sessionRef.current = session;
        setLoading(false);
        return;
      }
      setSession(session);
      sessionRef.current = session;
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

  // ── 푸시 탭 → 화면 딥링크 ──────────────────────────────────────────
  const pendingReviewDeeplinkRef = useRef(false);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;

      if (data?.type === 'lesson_absence') {
        const lessonId = data.lesson_id as string | undefined;
        if (!lessonId) return;
        const doNavLesson = () => {
          const last = lastNavLessonRef.current;
          if (last && last.id === lessonId && Date.now() - last.ts < 5000) return;
          lastNavLessonRef.current = { id: lessonId, ts: Date.now() };
          router.push(`/lessons/${lessonId}`);
        };
        if (sessionRef.current && navReadyRef.current) {
          doNavLesson();
        } else {
          pendingLessonDeeplinkRef.current = lessonId;
        }
        return;
      }

      if (data?.type === 'review') {
        if (sessionRef.current && navReadyRef.current) {
          router.push('/coach-reviews');
        } else {
          pendingReviewDeeplinkRef.current = true;
        }
        return;
      }
    });
    return () => sub.remove();
  }, []);

  // 앱 시작 후 nav ready + session이 확보되면 대기 중인 deeplink 처리
  useEffect(() => {
    if (!isNavigationReady || !session) return;
    const lessonId = pendingLessonDeeplinkRef.current;
    if (lessonId) {
      pendingLessonDeeplinkRef.current = null;
      const last = lastNavLessonRef.current;
      if (!last || last.id !== lessonId || Date.now() - last.ts >= 5000) {
        lastNavLessonRef.current = { id: lessonId, ts: Date.now() };
        setTimeout(() => router.push(`/lessons/${lessonId}`), 200);
      }
    }
    if (pendingReviewDeeplinkRef.current) {
      pendingReviewDeeplinkRef.current = false;
      setTimeout(() => router.push('/coach-reviews'), 200);
    }
  }, [isNavigationReady, session]);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inSubscriptionGroup = segments[0] === 'subscription';
    const inOnboarding = segments[0] === '(auth)' && (segments as string[])[1] === 'onboarding';
    const inPrivacyPolicy = segments[0] === '(auth)' && (segments as string[])[1] === 'privacy-policy';
    const inResetPassword = (segments as string[])[0] === 'reset-password';
    // True on first launch before any navigation has resolved
    const atRoot = !segments[0];

    if (!session && !inAuthGroup && !inResetPassword) {
      router.replace('/(auth)/login');
      setNavReady();
      return;
    }

    if (inOnboarding || inPrivacyPolicy) {
      setNavReady();
      return;
    }

    if (session && !inSubscriptionGroup) {
      registerCoachPushToken().catch(() => {});
      // 기존 사용자 동의 기록 소급 저장 (없는 경우에만, 실패 무시)
      void (async () => {
        try {
          const { data } = await supabase.from('consent_logs').select('id').eq('user_id', session.user.id).limit(1);
          if (!data || data.length === 0) {
            await supabase.from('consent_logs').insert([
              { user_id: session.user.id, consent_type: 'privacy', version: '1.0', platform: 'ios' },
              { user_id: session.user.id, consent_type: 'terms', version: '1.0', platform: 'ios' },
            ]);
          }
        } catch {}
      })();
      supabase
        .from('coach_profiles')
        .select('coach_id')
        .eq('coach_id', session.user.id)
        .maybeSingle()
        .then(async ({ data, error }) => {
          // Network/Supabase error — show retry rather than log out
          if (error) {
            setStartupError(true);
            return;
          }
          setStartupError(false);

          if (!data) {
            router.replace('/(auth)/onboarding');
            setNavReady();
            return;
          }

          // inAuthGroup: returning from a login/signup flow
          // atRoot: fresh app launch before any route resolves
          if (inAuthGroup || atRoot) {
            // 구독 체크: sync 완료 후 읽도록 최대 2.5초 대기. 타임아웃 시 통과.
            if (!IS_BETA) {
              try {
                await Promise.race([
                  syncPromiseRef.current ?? Promise.resolve(),
                  new Promise<void>(res => setTimeout(res, 2500)),
                ]);
                const sub = await getCurrentSubscription();
                if (sub && (sub.status === 'blocked' || sub.status === 'cancelled')) {
                  router.replace('/subscription/blocked');
                  setNavReady();
                  return;
                }
              } catch {}
            }

            // Background preload — does not delay navigation; home handles its own loading
            void (async () => {
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
              } catch {}
            })();

            router.replace('/(tabs)');
            setNavReady();
            return;
          }

          if (IS_BETA) { setNavReady(); return; }
          Promise.race([
            syncPromiseRef.current ?? Promise.resolve(),
            new Promise<void>(res => setTimeout(res, 2500)),
          ]).catch(() => {}).then(() => getCurrentSubscription()).then((sub) => {
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
  }, [session, loading, segments, retryCount]);

  if (loading || !isNavigationReady || startupError) {
    return <BrandLoadingScreen retry={startupError} onRetry={handleRetry} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="members/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="members/new" options={{ headerShown: false }} />
      <Stack.Screen name="lessons/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="lessons/new" options={{ headerShown: false }} />
      <Stack.Screen name="lesson-packages/index" options={{ headerShown: false }} />
      <Stack.Screen name="lesson-packages/new" options={{ headerShown: false }} />
      <Stack.Screen name="members/ai-analysis" options={{ headerShown: false }} />
      <Stack.Screen name="notifications/inbox" options={{ headerShown: false }} />
      <Stack.Screen name="settings/index" options={{ headerShown: false }} />
      <Stack.Screen name="settings/notifications" options={{ headerShown: false }} />
      <Stack.Screen name="settings/availability" options={{ headerShown: false }} />
      <Stack.Screen name="settings/faq" options={{ headerShown: false }} />
      <Stack.Screen name="subscription" options={{ headerShown: false }} />
      <Stack.Screen name="connect/qr" options={{ headerShown: false }} />
      <Stack.Screen name="connect/requests" options={{ headerShown: false }} />
      <Stack.Screen name="consultations/index" options={{ headerShown: false }} />
      <Stack.Screen name="consultations/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="thirdPartyLoginResult" options={{ headerShown: false }} />
      <Stack.Screen name="coach-reviews" options={{ headerShown: false }} />
    </Stack>
  );
}
