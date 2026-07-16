import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { Colors, Radius, Shadow } from '../lib/theme';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleReset() {
    if (!password || password.length < 6) {
      Alert.alert('오류', '비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('오류', '비밀번호가 일치하지 않습니다.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      Alert.alert('오류', error.message);
    } else {
      Alert.alert('완료', '비밀번호가 변경되었습니다.', [
        { text: '확인', onPress: () => router.replace('/(tabs)') },
      ]);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name="lock-closed-outline" size={32} color={Colors.primary} />
          </View>
          <Text style={styles.title}>새 비밀번호 설정</Text>
          <Text style={styles.subtitle}>새로 사용할 비밀번호를 입력해주세요.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>새 비밀번호</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.mutedFg} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="6자 이상 입력"
                placeholderTextColor={Colors.placeholder}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPw(v => !v)}>
                <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.mutedFg} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>비밀번호 확인</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.mutedFg} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="비밀번호 다시 입력"
                placeholderTextColor={Colors.placeholder}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry={!showPw}
                autoCapitalize="none"
              />
            </View>
          </View>

          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleReset} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>비밀번호 변경</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 28 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.mutedFg, textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: Radius.xl, padding: 24, ...Shadow.md },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, marginBottom: 6 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.mutedBg, borderRadius: Radius.md,
    paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.border,
  },
  inputIcon: { marginRight: 8 },
  input: { fontSize: 15, color: Colors.foreground, paddingVertical: 12 },
  btn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
