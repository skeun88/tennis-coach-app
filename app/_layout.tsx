import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { View, ActivityIndicator } from 'react-native';
import { Colors } from '../lib/theme';
import { getCurrentSubscription } from '../lib/subscription';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionChecked, setSubscriptionChecked] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
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

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inSubscriptionGroup = segments[0] === 'subscription';
    const inOnboarding = segments[0] === '(auth)' && (segments as string[])[1] === 'onboarding';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    // 이미 온보딩 중이면 아무것도 하지 않음
    if (inOnboarding) {
      return;
    }

    if (session && !inSubscriptionGroup) {
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
            return;
          }
          // 프로필 있으면 로그인 화면이면 탭으로, 아니면 구독 체크
          if (inAuthGroup) {
            router.replace('/(tabs)');
            return;
          }
          // 구독 상태 체크
          getCurrentSubscription().then((sub) => {
            setSubscriptionChecked(true);
            if (sub && (sub.status === 'blocked' || sub.status === 'cancelled')) {
              router.replace('/subscription/blocked');
            }
          }).catch(() => {
            setSubscriptionChecked(true);
          });
        });
      return;
    }

    setSubscriptionChecked(true);
  }, [session, loading, segments]);

  if (loading) {
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
      <Stack.Screen name="(auth)/onboarding" />
      <Stack.Screen name="members/[id]" options={{ headerShown: true, title: '회원 상세', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="members/new" options={{ headerShown: true, title: '회원 등록', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="lessons/[id]" options={{ headerShown: true, title: '레슨 상세', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="lessons/new" options={{ headerShown: true, title: '레슨 추가', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="lesson-packages/index" options={{ headerShown: true, title: '레슨권 관리', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="lesson-packages/new" options={{ headerShown: true, title: '레슨권 등록', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="members/ai-analysis" options={{ headerShown: false }} />
      <Stack.Screen name="settings/index" options={{ headerShown: true, title: '설정', headerBackTitle: '뒤로' }} />
      <Stack.Screen name="settings/notifications" options={{ headerShown: true, title: '알림 설정', headerBackTitle: '뒤로' }} />
    </Stack>
  );
}
