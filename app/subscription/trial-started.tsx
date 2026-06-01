import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TrialStartedScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="checkmark-circle" size={80} color="#2ecc71" />
        </View>
        <Text style={styles.title}>무료 체험 시작!</Text>
        <Text style={styles.subtitle}>
          30일 동안 무료로 사용할 수 있습니다.{'\n'}
          체험 종료 후 자동으로 결제가 시작됩니다.
        </Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>체험 기간 안내</Text>
          <Text style={styles.infoItem}>✅ 30일 무료 체험</Text>
          <Text style={styles.infoItem}>✅ 언제든지 취소 가능</Text>
          <Text style={styles.infoItem}>✅ 체험 종료 3일 전 알림 발송</Text>
        </View>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.buttonText}>시작하기</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  iconContainer: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '800', color: '#1a1a2e', marginBottom: 12 },
  subtitle: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 32,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  infoTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  infoItem: { fontSize: 14, color: '#444' },
  button: {
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    padding: 18,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
