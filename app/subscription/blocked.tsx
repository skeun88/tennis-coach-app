import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

export default function BlockedScreen() {
  const router = useRouter();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="lock-closed" size={72} color="#e74c3c" />
        </View>
        <Text style={styles.title}>구독이 만료되었습니다</Text>
        <Text style={styles.subtitle}>
          서비스를 계속 이용하려면{'\n'}구독을 시작해 주세요.
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/subscription/select-plan')}
        >
          <Ionicons name="card-outline" size={20} color="#fff" />
          <Text style={styles.primaryButtonText}>구독 시작하기</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleSignOut}
        >
          <Text style={styles.secondaryButtonText}>로그아웃</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  iconContainer: { marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '800', color: '#1a1a2e', marginBottom: 12, textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 22, marginBottom: 40 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    padding: 18,
    width: '100%',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryButton: { padding: 12 },
  secondaryButtonText: { color: '#888', fontSize: 15 },
});
