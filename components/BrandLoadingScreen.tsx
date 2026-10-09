import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Animated, Easing, StyleSheet, StatusBar, TouchableOpacity } from 'react-native';

const CREAM = '#F7F0E9';
const TERRA = '#C0755A';
const TERRA_LIGHT = 'rgba(192,117,90,0.18)';
const WARM_GRAY = '#9E9289';
const HINT_DELAY_MS = 3000;
const SPINNER_SIZE = 26;
const SPINNER_STROKE = 2.5;

// 네이티브 스플래시(expo-splash-screen)와 반드시 동일하게 유지할 것.
// app.json의 "imageWidth"와 아래 WORDMARK_WIDTH가 같아야 네이티브→React 전환 시
// 워드마크가 움직이지 않는다. 에셋 실제 비율 2663x726.
const WORDMARK = require('../assets/kerri-wordmark.png');
const WORDMARK_WIDTH = 240; // == app.json expo-splash-screen imageWidth
const WORDMARK_ASPECT = 2663 / 726;
const WORDMARK_HEIGHT = WORDMARK_WIDTH / WORDMARK_ASPECT;
// 워드마크는 화면 정중앙(네이티브와 동일). 스피너/힌트는 그 아래에 절대배치해
// 워드마크 위치를 밀어올리지 않는다.
const BELOW_OFFSET = WORDMARK_HEIGHT / 2 + 44;

interface Props {
  retry?: boolean;
  onRetry?: () => void;
}

export default function BrandLoadingScreen({ retry, onRetry }: Props) {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), HINT_DELAY_MS);

    const spin = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spin.start();

    return () => {
      clearTimeout(timer);
      spin.stop();
    };
  }, []);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={CREAM} />

      {/* 워드마크: 화면 정중앙 (네이티브 스플래시와 동일 위치/크기) */}
      <View style={styles.centerFill} pointerEvents="none">
        <Image
          source={WORDMARK}
          style={{ width: WORDMARK_WIDTH, height: WORDMARK_HEIGHT }}
          resizeMode="contain"
          fadeDuration={0}
        />
      </View>

      {/* 스피너 + 힌트: 워드마크 아래에 절대배치 */}
      <View style={styles.centerFill} pointerEvents="box-none">
        <View style={{ transform: [{ translateY: BELOW_OFFSET }], alignItems: 'center' }}>
          <View style={styles.spinnerContainer}>
            <View style={styles.spinnerTrack} />
            <Animated.View style={[styles.spinnerArc, { transform: [{ rotate }] }]} />
          </View>

          <View style={styles.hintReserved}>
            {retry ? (
              <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
                <Text style={styles.retryText}>재시도</Text>
              </TouchableOpacity>
            ) : showHint ? (
              <Text style={styles.hint}>잠시만 기다려 주세요</Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CREAM,
  },
  centerFill: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerContainer: {
    width: SPINNER_SIZE,
    height: SPINNER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerTrack: {
    position: 'absolute',
    width: SPINNER_SIZE,
    height: SPINNER_SIZE,
    borderRadius: SPINNER_SIZE / 2,
    borderWidth: SPINNER_STROKE,
    borderColor: TERRA_LIGHT,
  },
  spinnerArc: {
    position: 'absolute',
    width: SPINNER_SIZE,
    height: SPINNER_SIZE,
    borderRadius: SPINNER_SIZE / 2,
    borderWidth: SPINNER_STROKE,
    borderTopColor: TERRA,
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  },
  hintReserved: {
    height: 32,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 14,
    color: WARM_GRAY,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  retryText: {
    fontSize: 14,
    color: TERRA,
    fontWeight: '600',
  },
});
