import { useState, useEffect, useRef, useCallback } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, TouchableOpacity, Animated, StyleSheet, Platform,
} from 'react-native';
import { Colors } from '../../lib/theme';
import { supabase } from '../../lib/supabase';

// ── 전역 예약 요청 토스트 ─────────────────────────────────────
function RequestToast({
  request,
  onGoSchedule,
  onDismiss,
}: {
  request: any;
  onGoSchedule: () => void;
  onDismiss: () => void;
}) {
  const translateY = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
    // 12초 후 자동 닫힘
    const t = setTimeout(onDismiss, 12000);
    return () => clearTimeout(t);
  }, [request?.id]);

  if (!request) return null;

  return (
    <Animated.View style={[styles.toast, { transform: [{ translateY }] }]}>
      <View style={styles.toastLeft}>
        <View style={styles.toastIcon}>
          <Ionicons name="calendar" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.toastTitle}>새 레슨 예약 요청</Text>
          <Text style={styles.toastBody} numberOfLines={1}>
            {request.member?.name ?? '회원'} · {request.requested_date} {request.start_time?.slice(0, 5)}
          </Text>
        </View>
      </View>
      <View style={styles.toastActions}>
        <TouchableOpacity style={styles.toastActionBtn} onPress={onGoSchedule}>
          <Text style={styles.toastActionText}>확인하기</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDismiss} style={{ padding: 4 }}>
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  const [toastRequest, setToastRequest] = useState<any>(null);

  // Realtime + 폴링으로 pending 요청 감지
  useEffect(() => {
    let myCoachId: string | null = null;
    let ch: any = null;
    let pollTimer: ReturnType<typeof setInterval>;

    async function checkPending(uid: string) {
      const { data } = await supabase
        .from('lesson_requests')
        .select('*, member:members(name)')
        .eq('coach_id', uid)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        // 이미 표시 중인 것과 다를 때만 업데이트
        setToastRequest((prev: any) => {
          if (prev?.id === data[0].id) return prev;
          return data[0];
        });
      }
    }

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      myCoachId = user.id;

      // 최초 로드
      checkPending(user.id);

      // 15초 폴링
      pollTimer = setInterval(() => checkPending(user.id!), 15000);

      // Realtime 구독
      ch = supabase.channel('global_lesson_requests_' + user.id)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'lesson_requests',
        }, async (payload) => {
          const req = payload.new as any;
          if (req.coach_id !== myCoachId) return;
          const { data: mem } = await supabase.from('members').select('name').eq('id', req.member_id).maybeSingle();
          setToastRequest({ ...req, member: { name: mem?.name ?? '회원' } });
        })
        .subscribe();
    });

    return () => {
      if (ch) supabase.removeChannel(ch);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  function handleGoSchedule() {
    if (!toastRequest) return;
    // 스케줄탭으로 이동 + 날짜/시간 파라미터 전달
    router.push({
      pathname: '/(tabs)/schedule',
      params: {
        highlightDate: toastRequest.requested_date,
        highlightTime: toastRequest.start_time,
        highlightMember: toastRequest.member?.name ?? '',
        highlightEnd: toastRequest.end_time,
        requestId: toastRequest.id,
      },
    } as any);
    setToastRequest(null);
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors.navy,
          tabBarInactiveTintColor: Colors.mutedFg,
          tabBarStyle: {
            borderTopWidth: 1,
            borderTopColor: Colors.border,
            paddingBottom: 4,
            backgroundColor: Colors.white,
          },
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: Colors.white,
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: '홈',
            tabBarLabel: '홈',
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
            headerTitle: '테니스 코치',
          }}
        />
        <Tabs.Screen
          name="members"
          options={{
            title: '회원',
            tabBarLabel: '회원',
            tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
            headerTitle: '회원 관리',
          }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: '스케줄',
            tabBarLabel: '스케줄',
            tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
            headerTitle: '레슨 스케줄',
          }}
        />
        <Tabs.Screen
          name="payments"
          options={{
            title: '결제',
            tabBarLabel: '결제',
            tabBarIcon: ({ color, size }) => <Ionicons name="card" size={size} color={color} />,
            headerTitle: '결제 관리',
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: '내 프로필',
            tabBarLabel: '프로필',
            tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            href: null,
            headerTitle: 'KERRI 도우미',
            headerShown: true,
            headerStyle: { backgroundColor: Colors.primary },
            headerTintColor: Colors.white,
          }}
        />
      </Tabs>

      {/* 전역 예약 요청 토스트 */}
      {toastRequest && (
        <RequestToast
          request={toastRequest}
          onGoSchedule={handleGoSchedule}
          onDismiss={() => setToastRequest(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 8,
    left: 12,
    right: 12,
    backgroundColor: Colors.navy,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 9999,
    gap: 10,
  },
  toastLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  toastIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  toastTitle: { fontSize: 13, fontWeight: '800', color: '#fff', marginBottom: 2 },
  toastBody: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  toastActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toastActionBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10,
  },
  toastActionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
