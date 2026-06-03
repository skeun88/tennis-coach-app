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
        <View style={styles.hintBox}>
          <Ionicons name="information-circle-outline" size={16} color="#4A90D9" />
          <Text style={styles.hintText}>
            구독 완료! 회원 추가 화면으로 돌아가서 회원을 다시 등록해주세요.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/members/new')}
        >
          <Text style={styles.buttonText}>회원 추가하러 가기</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.secondaryButtonText}>홈으로</Text>
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
    marginBottom: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  infoTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  infoItem: { fontSize: 14, color: '#444' },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#EBF4FF',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    marginBottom: 24,
    gap: 8,
  },
  hintText: { fontSize: 13, color: '#4A90D9', lineHeight: 18, flex: 1 },
  button: {
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    padding: 18,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    padding: 12,
    width: '100%',
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#888', fontSize: 14 },
});
