import { useState, useEffect, useRef, useCallback } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, TouchableOpacity, Animated, StyleSheet, Platform,
} from 'react-native';
import { Colors } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import GlassTabBar from '../../components/GlassTabBar';

// ── 전역 예약 요청 토스트 ─────────────────────────────────────
function formatToastTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function RequestToast({
  request,
  onConfirm,
  onDismiss,
}: {
  request: any;
  onConfirm: () => void;
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

  const isWeb = request.source === 'web';
  const title = isWeb ? '신규 상담 문의 요청' : '새 레슨 예약 요청';
  const guestOrMember = isWeb
    ? (request.guest_name ?? '문의자')
    : (request.member?.name ?? '회원');
  const subText = isWeb
    ? `${guestOrMember} · ${formatToastTime(request.created_at)} 접수`
    : `${guestOrMember} · ${request.requested_date} ${request.start_time?.slice(0, 5)}`;

  return (
    <Animated.View style={[styles.toast, { transform: [{ translateY }] }]}>
      <View style={styles.toastLeft}>
        <View style={styles.toastIcon}>
          <Ionicons name={isWeb ? 'chatbubble-ellipses' : 'calendar'} size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.toastTitle}>{title}</Text>
          <Text style={styles.toastBody} numberOfLines={1}>{subText}</Text>
        </View>
      </View>
      <View style={styles.toastActions}>
        <TouchableOpacity style={styles.toastActionBtn} onPress={onConfirm}>
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
        // 웹 문의는 미확인(viewed_at IS NULL)인 것만, 앱 예약은 모두 표시
        .or('source.neq.web,viewed_at.is.null')
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        // 이미 표시 중인 것과 다를 때만 업데이트
        setToastRequest((prev: any) => {
          if (prev?.id === data[0].id) return prev;
          return data[0];
        });
      } else {
        // pending 항목이 없으면 토스트 닫기
        setToastRequest((prev: any) => (prev ? null : prev));
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
          if (req.source === 'web') {
            // 웹 문의: guest_name 사용, member 조회 불필요
            setToastRequest({ ...req, member: null });
          } else {
            const { data: mem } = await supabase.from('members').select('name').eq('id', req.member_id).maybeSingle();
            setToastRequest({ ...req, member: { name: mem?.name ?? '회원' } });
          }
        })
        .subscribe();
    });

    return () => {
      if (ch) supabase.removeChannel(ch);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  function handleConfirmRequest() {
    if (!toastRequest) return;
    setToastRequest(null);

    if (toastRequest.source === 'web') {
      // 웹 문의: viewed_at 기록 후 상담 상세로 이동
      supabase.from('lesson_requests')
        .update({ viewed_at: new Date().toISOString() })
        .eq('id', toastRequest.id)
        .then(() => {});
      router.navigate({ pathname: '/consultations/[id]', params: { id: toastRequest.id } } as any);
    } else {
      // 앱 예약: 스케줄탭으로 이동
      router.navigate({
        pathname: '/(tabs)/schedule',
        params: {
          highlightDate: toastRequest.requested_date,
          highlightTime: toastRequest.start_time,
          highlightMember: toastRequest.member?.name ?? '',
          highlightEnd: toastRequest.end_time,
          requestId: toastRequest.id,
        },
      } as any);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <GlassTabBar {...props} />}
        screenOptions={{
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.mutedFg,
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: '홈',
            tabBarLabel: '홈',
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />,
            headerTitle: '테니스 코치',
          }}
        />
        <Tabs.Screen
          name="members"
          options={{
            title: '회원',
            tabBarLabel: '회원',
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? 'people' : 'people-outline'} size={size} color={color} />,
            headerTitle: '회원 관리',
          }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: '스케줄',
            tabBarLabel: '스케줄',
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={size} color={color} />,
            headerTitle: '레슨 스케줄',
          }}
        />
        <Tabs.Screen
          name="payments"
          options={{
            title: '결제',
            tabBarLabel: '결제',
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? 'card' : 'card-outline'} size={size} color={color} />,
            headerTitle: '결제 관리',
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: '마이',
            tabBarLabel: '마이',
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            href: null,
            headerShown: false,
            tabBarStyle: { display: 'none' },
          }}
        />
      </Tabs>

      {/* 전역 예약 요청 토스트 */}
      {toastRequest && (
        <RequestToast
          request={toastRequest}
          onConfirm={handleConfirmRequest}
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
