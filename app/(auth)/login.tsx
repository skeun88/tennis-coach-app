import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../lib/theme';

WebBrowser.maybeCompleteAuthSession();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SOCIAL_AUTH_FN = `${SUPABASE_URL}/functions/v1/social-auth`;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [snsLoading, setSnsLoading] = useState<'google' | 'apple' | 'kakao' | 'naver' | null>(null);
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

  // Google / Apple (Supabase 기본 OAuth)
  async function handleOAuth(provider: 'google' | 'apple') {
    setSnsLoading(provider);
    try {
      const redirectTo = AuthSession.makeRedirectUri({ scheme: 'tenniscoach', path: 'auth/callback' });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success' && result.url) {
        const params = new URLSearchParams(new URL(result.url).hash.replace('#', ''));
        const at = params.get('access_token');
        const rt = params.get('refresh_token');
        if (at && rt) await supabase.auth.setSession({ access_token: at, refresh_token: rt });
      }
    } catch (e: any) {
      if (e.message !== 'User cancelled') Alert.alert('로그인 오류', e.message);
    } finally {
      setSnsLoading(null);
    }
  }

  // 카카오 / 네이버 (Edge Function 경유)
  async function handleKakaoNaver(provider: 'kakao' | 'naver') {
    setSnsLoading(provider);
    try {
      const redirectTo = AuthSession.makeRedirectUri({ scheme: 'tenniscoach', path: 'auth/callback' });
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

      // 1. Edge Function에서 인증 URL 받기
      const res = await fetch(
        `${SOCIAL_AUTH_FN}?provider=${provider}&redirect_uri=${encodeURIComponent(redirectTo)}`,
        { headers: { apikey: anonKey, 'Content-Type': 'application/json' } },
      );
      const resText = await res.text();
      let parsed: any = {};
      try { parsed = JSON.parse(resText); } catch { throw new Error(`서버 응답 오류: ${resText}`); }
      if (parsed.error) throw new Error(parsed.error);
      const authUrl = parsed.url;
      if (!authUrl) throw new Error(`인증 URL을 받지 못했어요. 응답: ${resText}`);

      // 2. 브라우저로 인증
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectTo);
      if (result.type !== 'success') return;

      // 3. 콜백 URL에서 code 추출 → Edge Function에 전달
      const callbackUrl = new URL(result.url);
      const code = callbackUrl.searchParams.get('code');
      if (!code) throw new Error('인증 코드를 받지 못했어요.');

      const tokenRes = await fetch(
        `${SOCIAL_AUTH_FN}?provider=${provider}&code=${code}&redirect_uri=${encodeURIComponent(redirectTo)}`,
        { headers: { apikey: anonKey } },
      );
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.error);

      // 4. magic link로 세션 처리
      if (tokenData.magicLink) {
        const magicResult = await WebBrowser.openAuthSessionAsync(tokenData.magicLink, redirectTo);
        if (magicResult.type === 'success' && magicResult.url) {
          const params = new URLSearchParams(new URL(magicResult.url).hash.replace('#', ''));
          const at = params.get('access_token');
          const rt = params.get('refresh_token');
          if (at && rt) await supabase.auth.setSession({ access_token: at, refresh_token: rt });
        }
      }
    } catch (e: any) {
      if (e.message !== 'User cancelled') Alert.alert('로그인 오류', e.message);
    } finally {
      setSnsLoading(null);
    }
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
              <Ionicons name="mail-outline" size={18} color={Colors.mutedFg} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="coach@example.com"
                placeholderTextColor={Colors.placeholder}
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
              <Ionicons name="lock-closed-outline" size={18} color={Colors.mutedFg} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="비밀번호"
                placeholderTextColor={Colors.placeholder}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.mutedFg} />
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

          {/* 구분선 */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>SNS로 계속하기</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* 카카오 */}
          <TouchableOpacity
            style={styles.kakaoBtn}
            onPress={() => handleKakaoNaver('kakao')}
            disabled={snsLoading !== null}
          >
            {snsLoading === 'kakao'
              ? <ActivityIndicator color="#3C1E1E" size="small" />
              : <>
                  <Text style={styles.kakaoBtnIcon}>💬</Text>
                  <Text style={styles.kakaoBtnText}>카카오로 계속하기</Text>
                </>
            }
          </TouchableOpacity>

          {/* 네이버 */}
          <TouchableOpacity
            style={styles.naverBtn}
            onPress={() => handleKakaoNaver('naver')}
            disabled={snsLoading !== null}
          >
            {snsLoading === 'naver'
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <Text style={styles.naverBtnIcon}>N</Text>
                  <Text style={styles.naverBtnText}>네이버로 계속하기</Text>
                </>
            }
          </TouchableOpacity>

          {/* 구글 */}
          <TouchableOpacity
            style={styles.snsButton}
            onPress={() => handleOAuth('google')}
            disabled={snsLoading !== null}
          >
            {snsLoading === 'google'
              ? <ActivityIndicator color={Colors.foreground} size="small" />
              : <>
                  <Ionicons name="logo-google" size={18} color="#DB4437" />
                  <Text style={styles.snsButtonText}>Google로 계속하기</Text>
                </>
            }
          </TouchableOpacity>

          {/* 애플 (iOS만) */}
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.snsButton, styles.appleButton]}
              onPress={() => handleOAuth('apple')}
              disabled={snsLoading !== null}
            >
              {snsLoading === 'apple'
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons name="logo-apple" size={18} color="#fff" />
                    <Text style={[styles.snsButtonText, { color: '#fff' }]}>Apple로 계속하기</Text>
                  </>
              }
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
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
  cardTitle: { fontSize: 20, fontWeight: '700', color: Colors.foreground, marginBottom: 20, textAlign: 'center' },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, marginBottom: 6 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.mutedBg, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: Colors.foreground },
  button: {
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchBtn: { marginTop: 16, alignItems: 'center' },
  switchText: { fontSize: 14, color: Colors.mutedFg },
  switchLink: { color: Colors.navy, fontWeight: '700' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 12, color: Colors.placeholder, fontWeight: '500' },

  // 카카오
  kakaoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 12, paddingVertical: 13,
    backgroundColor: '#FEE500', marginBottom: 10,
  },
  kakaoBtnIcon: { fontSize: 18 },
  kakaoBtnText: { fontSize: 15, fontWeight: '700', color: '#3C1E1E' },

  // 네이버
  naverBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 12, paddingVertical: 13,
    backgroundColor: '#03C75A', marginBottom: 10,
  },
  naverBtnIcon: { fontSize: 16, fontWeight: '900', color: '#fff', width: 20, textAlign: 'center' },
  naverBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // 구글/애플
  snsButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: 12, paddingVertical: 13,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: '#fff', marginBottom: 10,
  },
  appleButton: { backgroundColor: '#000', borderColor: '#000', marginBottom: 0 },
  snsButtonText: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
});
