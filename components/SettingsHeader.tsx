import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const DARK = '#3E2B22';   // KERRI dark brown — 제목 + 뒤로가기
const WHITE = '#FFFFFF';
const DIVIDER = 'rgba(62,43,34,0.07)'; // 매우 연한 웜그레이 구분선

interface Props {
  title: string;
  /** 우측 슬롯(예: 저장됨 배지). 없으면 좌측 캡슐과 균형을 위해 빈 공간 유지. */
  right?: React.ReactNode;
  /** 기본값 router.back() */
  onBack?: () => void;
}

/**
 * 모든 설정 화면 공통 상단 내비게이션 바.
 * - iOS Safe Area 포함, 배경 화이트, 중앙 제목, 좌측 캡슐 뒤로가기(아이콘+"뒤로")
 * - 하단 매우 연한 웜그레이 구분선, 스크롤과 무관하게 고정(ScrollView 바깥에 렌더)
 * - 터치 영역 최소 44px
 */
export default function SettingsHeader({ title, right, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const handleBack = onBack ?? (() => router.back());

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={WHITE} />
      <View style={styles.row}>
        <View style={styles.side}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backCapsule}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={18} color={DARK} />
            <Text style={styles.backText}>뒤로</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title} numberOfLines={1}>{title}</Text>

        <View style={[styles.side, styles.sideRight]}>
          {right ?? null}
        </View>
      </View>
      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: WHITE },
  row: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  side: { minWidth: 76, justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  title: {
    position: 'absolute',
    left: 76,
    right: 76,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: DARK,
  },
  backCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 1,
    minHeight: 36,
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 13,
    borderRadius: 999,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: 'rgba(62,43,34,0.06)',
    // 약한 그림자
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  backText: { fontSize: 15, fontWeight: '600', color: DARK },
  divider: {
    height: Platform.OS === 'android' ? 1 : StyleSheet.hairlineWidth,
    backgroundColor: DIVIDER,
  },
});
