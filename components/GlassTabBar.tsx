import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, Animated, StyleSheet, Platform,
  useWindowDimensions, Keyboard, AccessibilityInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// ── 디자인 토큰 (PM 시안값) ────────────────────────────────
const MARGIN_H = 16;              // 좌우 여백
const BOTTOM_GAP = 10;            // Safe Area 위로 띄우는 간격 (8~12)
const BAR_HEIGHT = 70;            // 탭바 높이 (68~72)
const RADIUS = 32;                // 캡슐 모서리 (30~36)
const GLASS_BG = 'rgba(255,255,255,0.76)';       // 웜 화이트 글래스
const GLASS_BG_OPAQUE = 'rgba(252,248,244,0.98)'; // 투명도 줄이기 설정 시 대체(불투명 웜화이트)
const BORDER_HL = 'rgba(255,255,255,0.65)';      // 1px 화이트 하이라이트
const ACTIVE = '#C0755A';         // 테라코타
const INACTIVE = '#8C8782';       // 웜그레이
const CAPSULE_BG = 'rgba(192,117,90,0.12)';      // 연한 테라코타 캡슐
const CAPSULE_INSET_V = 6;        // 캡슐 상하 여백
const ANIM_MS = 200;              // 캡슐 이동 (180~220)

// 탭바 아래로 콘텐츠가 가리지 않도록 각 화면이 확보해야 하는 세로 공간
// (Safe Area는 각 화면에서 insets.bottom으로 별도 가산 — 여기엔 미포함)
export const FLOATING_TAB_BAR_SPACE = BAR_HEIGHT + BOTTOM_GAP;

type TabDef = { name: string; label: string; icon: keyof typeof Ionicons.glyphMap; iconOutline: keyof typeof Ionicons.glyphMap };
const TABS: TabDef[] = [
  { name: 'index', label: '홈', icon: 'home', iconOutline: 'home-outline' },
  { name: 'members', label: '회원', icon: 'people', iconOutline: 'people-outline' },
  { name: 'schedule', label: '스케줄', icon: 'calendar', iconOutline: 'calendar-outline' },
  { name: 'payments', label: '결제', icon: 'card', iconOutline: 'card-outline' },
  { name: 'profile', label: '프로필', icon: 'person', iconOutline: 'person-outline' },
];

export default function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [reduceMotion, setReduceMotion] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [keyboardUp, setKeyboardUp] = useState(false);

  // 현재 선택된 탭의 인덱스(보이는 5개 기준)
  const activeRouteName = state.routes[state.index]?.name;
  const activeIndex = Math.max(0, TABS.findIndex(t => t.name === activeRouteName));

  const innerWidth = width - MARGIN_H * 2;
  const tabWidth = innerWidth / TABS.length;
  const translateX = useRef(new Animated.Value(activeIndex * tabWidth)).current;

  // 접근성 설정 구독
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => mounted && setReduceMotion(v));
    const rm = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const rt = (AccessibilityInfo as any).isReduceTransparencyEnabled?.();
    if (rt?.then) rt.then((v: boolean) => mounted && setReduceTransparency(v));
    const rtSub = (AccessibilityInfo as any).addEventListener?.('reduceTransparencyChanged', setReduceTransparency);
    return () => { mounted = false; rm?.remove?.(); rtSub?.remove?.(); };
  }, []);

  // 키보드 열리면 탭바 숨김, 닫히면 복귀
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => setKeyboardUp(true));
    const h = Keyboard.addListener(hideEvt, () => setKeyboardUp(false));
    return () => { s.remove(); h.remove(); };
  }, []);

  // 선택 캡슐 이동
  useEffect(() => {
    const target = activeIndex * tabWidth;
    if (reduceMotion) {
      translateX.setValue(target);
      return;
    }
    Animated.timing(translateX, {
      toValue: target,
      duration: ANIM_MS,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, tabWidth, reduceMotion]);

  if (keyboardUp) return null;

  const bg = reduceTransparency ? GLASS_BG_OPAQUE : GLASS_BG;

  return (
    <View
      style={[styles.wrap, { paddingBottom: insets.bottom + BOTTOM_GAP }]}
      pointerEvents="box-none"
    >
      <View style={[styles.bar, { height: BAR_HEIGHT, backgroundColor: bg }]}>
        {/* 이동하는 선택 캡슐 */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.capsule,
            {
              width: tabWidth - 12,
              top: CAPSULE_INSET_V,
              bottom: CAPSULE_INSET_V,
              transform: [{ translateX }],
              left: 6,
            },
          ]}
        />

        {TABS.map((tab) => {
          const route = state.routes.find(r => r.name === tab.name);
          if (!route) return null;
          const focused = activeRouteName === tab.name;
          const color = focused ? ACTIVE : INACTIVE;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name as never);
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

          return (
            <Pressable
              key={tab.name}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.tab}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={tab.label}
            >
              <Ionicons name={focused ? tab.icon : tab.iconOutline} size={24} color={color} />
              <Text style={[styles.label, { color }]} numberOfLines={1}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: MARGIN_H,
    right: MARGIN_H,
    bottom: 0,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: BORDER_HL,
    paddingHorizontal: 6,
    overflow: 'hidden',
    // 다크 브라운 저불투명 약한 그림자
    shadowColor: '#3E2B22',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  capsule: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: CAPSULE_BG,
  },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
  },
  label: {
    fontSize: 11.5,
    fontWeight: '600',
  },
});
