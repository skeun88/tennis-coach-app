import { useEffect, useRef } from 'react';
import { Animated, StyleProp, View, ViewStyle } from 'react-native';

interface Props {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export default function SkeletonBox({ width, height, borderRadius = 8, style }: Props) {
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={[{ width: width as any, height, borderRadius }, style]}>
      <Animated.View
        style={{
          width: '100%', height: '100%', borderRadius,
          backgroundColor: '#E8E0D8', opacity,
        }}
      />
    </View>
  );
}
