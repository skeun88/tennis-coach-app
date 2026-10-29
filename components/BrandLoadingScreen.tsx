import { useEffect, useRef, useState } from 'react';
import { View, Image, Animated, Easing, StyleSheet, StatusBar, useWindowDimensions, TouchableOpacity, Text } from 'react-native';

const CREAM = '#F7F0E9';
const TERRA = '#C0755A';
const TERRA_LIGHT = 'rgba(192,117,90,0.18)';
const WARM_GRAY = '#9E9289';
const HINT_DELAY_MS = 3000;
const SPINNER_SIZE = 26;
const SPINNER_STROKE = 2.5;
// Matches SplashScreen.storyboard: imageView frame 348×114 pt (Avenir Next Bold, next native build)
const LOGO_W = 348;
const LOGO_H = 114;

interface Props {
  retry?: boolean;
  onRetry?: () => void;
}

export default function BrandLoadingScreen({ retry, onRetry }: Props) {
  const { height } = useWindowDimensions();
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

  // Logo center = screen center (matches native splash storyboard centerX/centerY constraints)
  const logoTop = height / 2 - LOGO_H / 2;
  const spinnerTop = height / 2 + LOGO_H / 2 + 32;
  const hintTop = spinnerTop + SPINNER_SIZE + 12;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={CREAM} />

      {/* Same image as SplashScreenLogo.imageset — 348×114 pt, screen center */}
      <Image
        source={require('../assets/images/kerri-logo.png')}
        style={[styles.logo, { top: logoTop }]}
        resizeMode="contain"
      />

      {/* Spinner: absolute position — does not shift logo */}
      <View style={[styles.spinnerContainer, { top: spinnerTop }]}>
        <View style={styles.spinnerTrack} />
        <Animated.View style={[styles.spinnerArc, { transform: [{ rotate }] }]} />
      </View>

      {/* Hint / retry: absolute position */}
      <View style={[styles.hintReserved, { top: hintTop }]}>
        {retry ? (
          <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryText}>재시도</Text>
          </TouchableOpacity>
        ) : showHint ? (
          <Text style={styles.hint}>잠시만 기다려 주세요</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CREAM,
  },
  logo: {
    position: 'absolute',
    alignSelf: 'center',
    width: LOGO_W,
    height: LOGO_H,
  },
  spinnerContainer: {
    position: 'absolute',
    alignSelf: 'center',
    width: SPINNER_SIZE,
    height: SPINNER_SIZE,
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
    position: 'absolute',
    alignSelf: 'center',
    height: 32,
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
