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
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inSubscriptionGroup = segments[0] === 'subscription';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (session && inAuthGroup) {
      router.replace('/(tabs)');
      return;
    }

    // 로그인 상태에서 구독 상태 체크 (인증/구독 화면 제외)
    if (session && !inAuthGroup && !inSubscriptionGroup) {
      getCurrentSubscription().then((sub) => {
        setSubscriptionChecked(true);
        if (sub && (sub.status === 'blocked' || sub.status === 'cancelled')) {
          router.replace('/subscription/blocked');
        }
      }).catch(() => {
        setSubscriptionChecked(true);
      });
    } else {
      setSubscriptionChecked(true);
    }
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
