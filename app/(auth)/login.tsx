import { useState, useEffect } from 'react';
import * as Updates from 'expo-updates';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import NaverLogin from '@react-native-seoul/naver-login';
import { login as kakaoLogin, loginWithKakaoAccount } from '@react-native-seoul/kakao-login';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';

WebBrowser.maybeCompleteAuthSession();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SOCIAL_AUTH_FN = `${SUPABASE_URL}/functions/v1/social-auth`;

// 네이버 네이티브 SDK 초기화 (앱 첫 로드 시)
const NAVER_APP_NAME = 'Kerri';
const NAVER_CONSUMER_KEY = process.env.EXPO_PUBLIC_NAVER_CLIENT_ID ?? '';
const NAVER_CONSUMER_SECRET = process.env.EXPO_PUBLIC_NAVER_CLIENT_SECRET ?? '';
const NAVER_SERVICE_URL_SCHEME_IOS = 'tenniscoach'; // app.json scheme과 동일

// 네이버 SDK 초기화 — 탑레벨에서 호출하면 null 에러 발생 (native module)
// useEffect 안에서 호출하도록 이동
function initNaverLogin() {
  try {
    if (NaverLogin && typeof NaverLogin.initialize === 'function') {
      NaverLogin.initialize({
        appName: NAVER_APP_NAME,
        consumerKey: NAVER_CONSUMER_KEY,
        consumerSecret: NAVER_CONSUMER_SECRET,
        serviceUrlSchemeIOS: NAVER_SERVICE_URL_SCHEME_IOS,
        disableNaverAppAuthIOS: false, // 네이버앱 → 없으면 외부 브라우저 (in-app 브라우저 충돌 방지)
      });
    }
  } catch (e) {
    // 개발 환경(Expo Go)에서는 native module 없음 — 무시
    console.warn('NaverLogin native module not available:', e);
  }
}

// 디자인 토큰
const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [snsLoading, setSnsLoading] = useState<'google' | 'apple' | 'kakao' | 'naver' | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  useEffect(() => {
    initNaverLogin();
  }, []);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleForgotPassword() {
    if (!email.trim()) {
      Alert.alert('이메일 입력', '비밀번호를 찾을 이메일을 먼저 입력해주세요.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'tenniscoach://reset-password',
    });
    setLoading(false);
    if (error) {
      Alert.alert('오류', error.message);
    } else {
      Alert.alert('비밀번호 재설정', `${email.trim()}로 재설정 링크를 보냈어요.\n메일함을 확인해주세요.`);
    }
  }

  async function handleAuth() {
    if (!email || !password) {
      Alert.alert('입력 오류', '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        Alert.alert('회원가입 오류', error.message);
      } else if (data.user?.identities?.length === 0) {
        Alert.alert(
          '이미 가입된 계정입니다',
          '해당 이메일로 이미 가입된 계정이 있어요.\n비밀번호를 잊으셨다면 비밀번호 찾기를 이용해주세요.',
          [
            { text: '취소', style: 'cancel' },
            { text: '비밀번호 찾기', onPress: handleForgotPassword },
          ]
        );
      } else {
        Alert.alert('확인', '이메일을 확인해주세요. 인증 후 로그인할 수 있습니다.');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) Alert.alert('로그인 오류', '이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    setLoading(false);
  }

  // Apple 로그인 — 네이티브 SDK
  async function handleAppleLogin() {
    setSnsLoading('apple');
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      // identityToken으로 Supabase 세션 발급
      if (!credential.identityToken) throw new Error('Apple identityToken을 받지 못했어요.');

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) throw error;
    } catch (e: any) {
      // 사용자가 취소한 경우
      if ((e as any).code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Apple 로그인 오류', e.message);
    } finally {
      setSnsLoading(null);
    }
  }

  // Google (기존 웹 OAuth 유지)
  async function handleOAuth(provider: 'google') {
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

  // 네이버 — 네이티브 SDK (원터치 로그인)
  async function handleNaverLogin() {
    setSnsLoading('naver');
    try {
      // 1. 네이버 네이티브 SDK → 액세스 토큰 직접 획득
      if (!NaverLogin || typeof NaverLogin.login !== 'function') {
        throw new Error('EAS 빌드에서만 사용 가능합니다.');
      }
      // 이전 캐시 토큰 제거 — 3초 타임아웃 (SDK 내부 상태 꼬임 방지)
      try {
        if (typeof NaverLogin.deleteToken === 'function') {
          await Promise.race([
            NaverLogin.deleteToken(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
          ]);
        }
      } catch { /* ignore */ }
      const { failureResponse, successResponse } = await NaverLogin.login();
      if (failureResponse) throw new Error(failureResponse.message);
      if (!successResponse?.accessToken) throw new Error('네이버 액세스 토큰을 받지 못했어요.');

      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

      // 2. Edge Function에 네이버 액세스 토큰 전달 → Supabase 세션 발급
      const res = await fetch(`${SOCIAL_AUTH_FN}`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'naver', naver_access_token: successResponse.accessToken }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.access_token && data.refresh_token) {
        await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
      } else {
        throw new Error('세션 토큰을 받지 못했어요.');
      }
    } catch (e: any) {
      if (e.message !== 'User cancelled') Alert.alert('네이버 로그인 오류', e.message);
    } finally {
      setSnsLoading(null);
    }
  }

  // 카카오 — 네이티브 SDK (카카오톡 앱 우선 → 카카오계정 폴백)
  async function handleKakaoNaver(provider: 'kakao' | 'naver') {
    if (provider === 'naver') { handleNaverLogin(); return; }
    setSnsLoading('kakao');
    try {
      // 1. 카카오톡 앱 로그인 시도 → 실패 시 카카오계정 웹뷰 폴백
      let token: { accessToken: string } | null = null;
      try {
        token = await kakaoLogin();
      } catch {
        token = await loginWithKakaoAccount();
      }
      if (!token?.accessToken) throw new Error('카카오 액세스 토큰을 받지 못했어요.');

      // 2. Edge Function에 카카오 액세스 토큰 전달 → Supabase 세션 발급
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
      const res = await fetch(SOCIAL_AUTH_FN, {
        method: 'POST',
        headers: { apikey: anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'kakao', kakao_access_token: token.accessToken }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.access_token && data.refresh_token) {
        await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      } else {
        throw new Error('세션 토큰을 받지 못했어요.');
      }
    } catch (e: any) {
      const msg = e.message ?? '';
      if (!msg.includes('cancel') && !msg.includes('Cancel') && msg !== 'User cancelled') {
        Alert.alert('카카오 로그인 오류', msg);
      }
    } finally {
      setSnsLoading(null);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* 브랜드 영역 — 좌측 정렬 */}
        <View style={styles.brand}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.wordmark}>KERRI</Text>
          <Text style={styles.tagline}>레슨에만 집중하세요</Text>
          <Text style={styles.taglineSub}>회원 관리부터 레슨 기록까지,{'\n'}케리가 함께합니다.</Text>
        </View>

        {/* 폼 영역 */}
        <View style={styles.form}>

          {/* 이메일 */}
          <TextInput
            style={[styles.input, emailFocused && styles.inputFocused]}
            placeholder="이메일"
            placeholderTextColor={WARM_GRAY}
            value={email}
            onChangeText={setEmail}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          {/* 비밀번호 */}
          <View style={[styles.inputContainer, passwordFocused && styles.inputFocused]}>
            <TextInput
              style={styles.inputInner}
              placeholder="비밀번호"
              placeholderTextColor={WARM_GRAY}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={WARM_GRAY} />
            </TouchableOpacity>
          </View>

          {/* 비밀번호 찾기 — 우측 정렬 */}
          {!isSignUp && (
            <TouchableOpacity style={styles.forgotRow} onPress={handleForgotPassword} disabled={loading}>
              <Text style={styles.forgotText}>비밀번호 찾기</Text>
            </TouchableOpacity>
          )}

          {/* 로그인 버튼 */}
          <TouchableOpacity style={styles.loginBtn} onPress={handleAuth} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.loginBtnText}>{isSignUp ? '회원가입' : '로그인'}</Text>
            }
          </TouchableOpacity>

          {/* 회원가입 전환 */}
          <TouchableOpacity style={styles.signupRow} onPress={() => setIsSignUp(v => !v)}>
            <Text style={styles.signupText}>
              {isSignUp ? '이미 계정이 있으신가요? ' : '계정이 없으신가요? '}
              <Text style={styles.signupLink}>{isSignUp ? '로그인' : '회원가입'}</Text>
            </Text>
          </TouchableOpacity>

          {/* 구분선 */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>간편 로그인</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* 카카오 전체 버튼 */}
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

          {/* 네이버 / Google / Apple — 한 줄 */}
          <View style={styles.snsRow}>
            {/* 네이버 */}
            <TouchableOpacity
              style={styles.snsIconBtn}
              onPress={() => handleKakaoNaver('naver')}
              disabled={snsLoading !== null}
            >
              {snsLoading === 'naver'
                ? <ActivityIndicator color={WARM_GRAY} size="small" />
                : <Text style={styles.naverN}>N</Text>
              }
            </TouchableOpacity>

            {/* Google */}
            <TouchableOpacity
              style={styles.snsIconBtn}
              onPress={() => handleOAuth('google')}
              disabled={snsLoading !== null}
            >
              {snsLoading === 'google'
                ? <ActivityIndicator color={WARM_GRAY} size="small" />
                : <Ionicons name="logo-google" size={22} color="#DB4437" />
              }
            </TouchableOpacity>

            {/* Apple — iOS만 */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.snsIconBtn}
                onPress={() => handleAppleLogin()}
                disabled={snsLoading !== null}
              >
                {snsLoading === 'apple'
                  ? <ActivityIndicator color={WARM_GRAY} size="small" />
                  : <Ionicons name="logo-apple" size={22} color={DARK_BROWN} />
                }
              </TouchableOpacity>
            )}
          </View>

          {/* 약관 */}
          <Text style={styles.termsText}>
            로그인 시{' '}
            <Text style={styles.termsLink}>이용약관</Text>
            {' 및 '}
            <Text style={styles.termsLink}>개인정보 처리방침</Text>
            {'에 동의합니다.'}
          </Text>
        </View>
      </ScrollView>

      {/* OTA 적용 확인용 마커 — update ID 끝 4자리 */}
      <Text style={styles.updateMarker}>
        {Updates.updateId ? `#${Updates.updateId.slice(-4)}` : 'dev'}
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  updateMarker: {
    position: 'absolute', bottom: 8, right: 12,
    fontSize: 10, color: 'rgba(62,43,34,0.2)',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 72, paddingBottom: 48 },

  // 브랜드
  brand: { marginBottom: 40 },
  logo: { width: 48, height: 48, borderRadius: 10, marginBottom: 20 },
  wordmark: { fontSize: 13, fontWeight: '800', color: TERRACOTTA, letterSpacing: 3, marginBottom: 12 },
  tagline: { fontSize: 24, fontWeight: '700', color: DARK_BROWN, marginBottom: 8, lineHeight: 30 },
  taglineSub: { fontSize: 14, color: WARM_GRAY, lineHeight: 21 },

  // 폼
  form: {},

  // 입력 — 이메일 (단독 TextInput)
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: WARM_GRAY_BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: DARK_BROWN,
    marginBottom: 12,
    minHeight: 48,
  },
  inputFocused: { borderColor: TERRACOTTA },

  // 입력 — 비밀번호 (View 래퍼)
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: WARM_GRAY_BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    marginBottom: 12,
  },
  inputInner: {
    flex: 1,
    fontSize: 15,
    color: DARK_BROWN,
    paddingVertical: 14,
  },
  eyeBtn: { padding: 4 },

  forgotRow: { alignItems: 'flex-end', marginBottom: 20 },
  forgotText: { fontSize: 13, color: TERRACOTTA, fontWeight: '600' },

  loginBtn: {
    backgroundColor: TERRACOTTA,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 16,
    minHeight: 48,
  },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  signupRow: { alignItems: 'center', marginBottom: 28 },
  signupText: { fontSize: 14, color: WARM_GRAY },
  signupLink: { color: TERRACOTTA, fontWeight: '700' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: WARM_GRAY_BORDER },
  dividerText: { fontSize: 12, color: WARM_GRAY, fontWeight: '500' },

  // 카카오
  kakaoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 12, paddingVertical: 14,
    backgroundColor: '#FEE500', marginBottom: 12,
    minHeight: 48,
  },
  kakaoBtnIcon: { fontSize: 18 },
  kakaoBtnText: { fontSize: 15, fontWeight: '700', color: '#3C1E1E' },

  // 소셜 3개 한 줄
  snsRow: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  snsIconBtn: {
    flex: 1, minHeight: 48, borderRadius: 12,
    borderWidth: 1.5, borderColor: WARM_GRAY_BORDER,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  naverN: { fontSize: 18, fontWeight: '900', color: '#03C75A' },

  // 약관
  termsText: { fontSize: 12, color: WARM_GRAY, textAlign: 'center', lineHeight: 18 },
  termsLink: { color: TERRACOTTA },
});
