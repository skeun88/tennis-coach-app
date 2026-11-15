import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ReanimatedSwipeable, { SwipeableMethods, SwipeDirection } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { Colors, Radius } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';

interface CoachNotification {
  id: string;
  title: string;
  body: string;
  type: 'lesson_reminder' | 'member_message' | 'general' | 'ai_report' | 'absence_reported';
  is_read: boolean;
  reference_id: string | null;
  reference_type: 'lesson' | 'member' | null;
  created_at: string;
}

const TYPE_CONFIG = {
  lesson_reminder:  { icon: 'calendar-outline' as const, label: '레슨 알림', color: Colors.primary },
  member_message:   { icon: 'chatbubble-outline' as const, label: '회원 메시지', color: '#3B82F6' },
  ai_report:        { icon: 'document-text-outline' as const, label: 'AI 레슨 기록', color: Colors.primary },
  absence_reported: { icon: 'person-remove-outline' as const, label: '결석 알림', color: '#F97316' },
  general:          { icon: 'notifications-outline' as const, label: '알림', color: Colors.mutedFg },
};

const DELETE_BTN_WIDTH = 80;

function formatTime(iso: string): string {
  const now = new Date();
  const d = new Date(iso);
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

function DeleteAction({
  progress,
  onDelete,
}: {
  progress: SharedValue<number>;
  onDelete: () => void;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  return (
    <View style={styles.deleteContainer}>
      <Reanimated.View style={[{ flex: 1, width: '100%' }, style]}>
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
          <Ionicons name="trash-outline" size={20} color="#fff" />
          <Text style={styles.deleteText}>삭제</Text>
        </TouchableOpacity>
      </Reanimated.View>
    </View>
  );
}

export default function NotificationInboxScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<CoachNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [navigating, setNavigating] = useState(false);
  const swipeableRefs = useRef<Map<string, React.RefObject<SwipeableMethods | null>>>(new Map());
  const openIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from('coach_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (err) {
        console.warn('[알림함] 조회 오류 (빈 상태 표시):', err.message);
        setNotifications([]);
      } else {
        setNotifications(data ?? []);
      }
    } catch (e: any) {
      console.warn('[알림함] 예외 (빈 상태 표시):', e.message);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    markAllRead();
  }, [load]);

  const markAllRead = async () => {
    await supabase
      .from('coach_notifications')
      .update({ is_read: true })
      .eq('is_read', false);
  };

  const handleDelete = useCallback(async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    openIdRef.current = null;
    swipeableRefs.current.delete(id);
    await supabase.from('coach_notifications').delete().eq('id', id);
  }, []);

  const handlePress = async (item: CoachNotification) => {
    if (!item.reference_id) return;

    if (item.type === 'absence_reported') {
      router.push(`/lessons/${item.reference_id}` as any);
      return;
    }

    if (item.type === 'ai_report' || (item.type === 'general' && item.reference_type === 'lesson')) {
      setNavigating(true);
      try {
        const { data } = await supabase
          .from('lesson_plans')
          .select('member_id, member:members(name, level)')
          .eq('id', item.reference_id)
          .maybeSingle();
        if (data?.member_id) {
          router.push({
            pathname: '/members/plan-detail',
            params: {
              planId: item.reference_id,
              memberId: data.member_id,
              memberName: (data.member as any)?.name ?? '',
              memberLevel: (data.member as any)?.level ?? '',
            },
          } as any);
        } else {
          router.push(`/lessons/${item.reference_id}` as any);
        }
      } catch (e: any) {
        console.warn('[알림함] plan-detail 이동 오류:', e.message);
      } finally {
        setNavigating(false);
      }
      return;
    }

    if (item.reference_type === 'lesson') {
      router.push(`/lessons/${item.reference_id}` as any);
    }
  };

  const renderItem = ({ item }: { item: CoachNotification }) => {
    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.general;

    if (!swipeableRefs.current.has(item.id)) {
      swipeableRefs.current.set(item.id, React.createRef<SwipeableMethods | null>());
    }
    const itemRef = swipeableRefs.current.get(item.id)!;

    const renderRightActions = (progress: SharedValue<number>) => (
      <DeleteAction progress={progress} onDelete={() => handleDelete(item.id)} />
    );

    return (
      <ReanimatedSwipeable
        ref={itemRef}
        renderRightActions={renderRightActions}
        rightThreshold={40}
        overshootRight={false}
        friction={2}
        onSwipeableWillOpen={(direction: SwipeDirection) => {
          if (direction !== SwipeDirection.RIGHT) return;
          // 다른 열린 항목 닫기
          if (openIdRef.current && openIdRef.current !== item.id) {
            swipeableRefs.current.get(openIdRef.current)?.current?.close();
          }
          openIdRef.current = item.id;
        }}
        onSwipeableClose={(direction: SwipeDirection) => {
          if (direction !== SwipeDirection.RIGHT) return;
          if (openIdRef.current === item.id) openIdRef.current = null;
        }}
      >
        <TouchableOpacity
          style={[styles.item, !item.is_read && styles.itemUnread]}
          activeOpacity={item.reference_type || item.type === 'ai_report' ? 0.7 : 1}
          onPress={() => !navigating && handlePress(item)}
          disabled={navigating}
        >
          <View style={[styles.iconWrap, { backgroundColor: cfg.color + '18' }]}>
            <Ionicons name={cfg.icon} size={20} color={cfg.color} />
          </View>
          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              {!item.is_read && <View style={styles.dot} />}
            </View>
            <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
            <Text style={styles.time}>{formatTime(item.created_at)}</Text>
          </View>
          {(item.reference_type || item.type === 'ai_report') ? (
            navigating
              ? <ActivityIndicator size="small" color={Colors.mutedFg} />
              : <Ionicons name="chevron-forward" size={16} color={Colors.mutedFg} />
          ) : null}
        </TouchableOpacity>
      </ReanimatedSwipeable>
    );
  };

  return (
    <View style={styles.screen}>
      <SettingsHeader title="알림" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="notifications-off-outline" size={48} color={Colors.placeholder} />
          <Text style={styles.emptyText}>알림이 없어요</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.mutedBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  list: { paddingVertical: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  itemUnread: { backgroundColor: '#FDF8F6' },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '600', color: Colors.foreground, flex: 1 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  body: { fontSize: 13, color: Colors.mutedFg, lineHeight: 18 },
  time: { fontSize: 11, color: Colors.placeholder, marginTop: 2 },
  sep: { height: 1, backgroundColor: Colors.borderLight, marginLeft: 68 },
  emptyText: { fontSize: 14, color: Colors.mutedFg, textAlign: 'center' },
  deleteContainer: {
    width: DELETE_BTN_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#EF4444',
  },
  deleteBtn: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  deleteText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
