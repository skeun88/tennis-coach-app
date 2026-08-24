import { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, StatusBar, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TERRA = '#C0755A';
const CREAM = '#F7F0E9';
const CREAM_DIM = 'rgba(247,240,233,0.65)';
const CREAM_FAINT = 'rgba(247,240,233,0.45)';

// Show status text and dots only after this delay to prevent momentary flash
const STATUS_DELAY_MS = 400;

export default function BrandLoadingScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const breathAnim = useRef(new Animated.Value(0.9)).current;
  const dot1 = useRef(new Animated.Value(0.35)).current;
  const dot2 = useRef(new Animated.Value(0.35)).current;
  const dot3 = useRef(new Animated.Value(0.35)).current;
  const [showStatus, setShowStatus] = useState(false);

  // Logo at 45% of screen width, capped at 200px — matches native splash proportions
  const logoSize = Math.min(width * 0.45, 200);

  useEffect(() => {
    const timer = setTimeout(() => setShowStatus(true), STATUS_DELAY_MS);

    const breath = Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(breathAnim, { toValue: 0.9, duration: 2000, useNativeDriver: true }),
      ])
    );
    breath.start();

    const dots = Animated.loop(
      Animated.sequence([
        Animated.timing(dot1, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(dot2, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(dot3, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.delay(400),
        Animated.parallel([
          Animated.timing(dot1, { toValue: 0.35, duration: 200, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 0.35, duration: 200, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 0.35, duration: 200, useNativeDriver: true }),
        ]),
      ])
    );
    dots.start();

    return () => {
      clearTimeout(timer);
      breath.stop();
      dots.stop();
    };
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 20) }]}>
      <StatusBar barStyle="light-content" backgroundColor={TERRA} />

      <View style={styles.center}>
        <Animated.Image
          source={require('../assets/splash-icon.png')}
          style={[{ width: logoSize, height: logoSize, tintColor: CREAM, marginBottom: 12 }, { opacity: breathAnim }]}
          resizeMode="contain"
        />
        <Text style={styles.wordmark}>KERRI</Text>
      </View>

      {showStatus && (
        <View style={styles.bottom}>
          <Text style={styles.status}>오늘의 레슨을 준비하고 있어요</Text>
          <View style={styles.dots}>
            <Animated.View style={[styles.dot, { opacity: dot1 }]} />
            <Animated.View style={[styles.dot, { opacity: dot2 }]} />
            <Animated.View style={[styles.dot, { opacity: dot3 }]} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TERRA,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wordmark: {
    fontSize: 36,
    fontWeight: '800',
    color: CREAM,
    letterSpacing: 8,
  },
  bottom: {
    alignItems: 'center',
    paddingBottom: 20,
    minHeight: 50,
  },
  status: {
    fontSize: 13,
    color: CREAM_DIM,
    marginBottom: 14,
  },
  dots: {
    flexDirection: 'row',
    gap: 7,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: CREAM_FAINT,
  },
});
