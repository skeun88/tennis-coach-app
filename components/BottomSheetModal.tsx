import React, { useRef, useEffect } from 'react';
import { Modal, View, Pressable, Animated, PanResponder, StyleSheet } from 'react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  paddingBottom?: number;
}

export default function BottomSheetModal({ visible, onClose, children, paddingBottom = 40 }: Props) {
  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible) translateY.setValue(0);
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 8,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) {
          Animated.timing(translateY, {
            toValue: 700,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            onCloseRef.current();
            translateY.setValue(0);
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onCloseRef.current()}>
      <Pressable style={styles.overlay} onPress={() => onCloseRef.current()}>
        <Pressable onPress={() => {}} style={styles.sheetOuter}>
          <Animated.View style={[styles.sheet, { paddingBottom, transform: [{ translateY }] }]}>
            <View {...panResponder.panHandlers} style={styles.dragArea}>
              <View style={styles.dragHandle} />
            </View>
            {children}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheetOuter: { width: '100%' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  dragArea: { paddingTop: 10, paddingBottom: 4, alignItems: 'center' },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9CFC7' },
});
