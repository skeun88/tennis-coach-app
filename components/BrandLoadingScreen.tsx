import { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet, StatusBar, useWindowDimensions, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CREAM = '#F7F0E9';
const TERRA = '#C0755A';
const TERRA_LIGHT = 'rgba(192,117,90,0.18)';
const WARM_GRAY = '#9E9289';
const HINT_DELAY_MS = 3000;
const SPINNER_SIZE = 26;
const SPINNER_STROKE = 2.5;

interface Props {
  retry?: boolean;
  onRetry?: () => void;
}

export default function BrandLoadingScreen({ retry, onRetry }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 20) }]}>
      <StatusBar barStyle="dark-content" backgroundColor={CREAM} />

      <View style={styles.center}>
        <Text
          style={[styles.wordmark, { width: width * 0.81 }]}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          KERRI
        </Text>

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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
  },
  wordmark: {
    fontSize: 180,
    fontWeight: '900',
    color: TERRA,
    letterSpacing: -2,
    textAlign: 'center',
  },
  spinnerContainer: {
    width: SPINNER_SIZE,
    height: SPINNER_SIZE,
    marginTop: 44,
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
