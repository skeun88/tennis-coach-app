import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleAuth() {
    if (!email || !password) {
      Alert.alert('입력 오류', '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) Alert.alert('회원가입 오류', error.message);
      else Alert.alert('확인', '이메일을 확인해주세요. 인증 후 로그인할 수 있습니다.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) Alert.alert('로그인 오류', '이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name="tennisball" size={48} color="#fff" />
          </View>
          <Text style={styles.appName}>테니스 코치</Text>
          <Text style={styles.subtitle}>회원 관리 전용 앱</Text>
        </View>

        {/* Form */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{isSignUp ? '새 계정 만들기' : '코치 로그인'}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>이메일</Text>
            <View style={styles.inputRow}>
              <Ionicons name="mail-outline" size={18} color="#888" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="coach@example.com"
                placeholderTextColor="#bbb"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>비밀번호</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color="#888" style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="비밀번호"
                placeholderTextColor="#bbb"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#888" />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>{isSignUp ? '회원가입' : '로그인'}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.switchBtn} onPress={() => setIsSignUp(v => !v)}>
            <Text style={styles.switchText}>
              {isSignUp ? '이미 계정이 있으신가요? ' : '계정이 없으신가요? '}
              <Text style={styles.switchLink}>{isSignUp ? '로그인' : '회원가입'}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a7a4a' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 32 },
  iconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  appName: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginBottom: 20, textAlign: 'center' },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f5f5f5', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#eee',
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: '#1a1a1a' },
  button: {
    backgroundColor: '#1a7a4a', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchBtn: { marginTop: 16, alignItems: 'center' },
  switchText: { fontSize: 14, color: '#888' },
  switchLink: { color: '#1a7a4a', fontWeight: '700' },
});
