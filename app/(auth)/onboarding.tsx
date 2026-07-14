import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors, Radius, Shadow } from '../../lib/theme';

const TOTAL_STEPS = 3;

const CITIES = ['서울', '부산', '인천', '대구', '대전', '광주', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];

// 나중에 확장용 — 지금은 테니스 고정
const SPORTS = ['테니스'];

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: 이름 (네이버/소셜 로그인 시 user_metadata.full_name 자동 세팅)
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      // 네이버/카카오 로그인 시 social-auth가 full_name을 user_metadata에 저장함
      const name = user.user_metadata?.full_name ?? '';
      if (name) setDisplayName(name);
    });
  }, []);

  // 이메일 (표시용)
  const [email, setEmail] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      // 네이버: invite_xxx@kerri.app 아니라 실제 네이버 이메일
      const rawEmail = user.email ?? '';
      const isSynthetic = rawEmail.startsWith('invite_') && rawEmail.endsWith('@kerri.app');
      if (!isSynthetic) setEmail(rawEmail);
    });
  }, []);

  // Step 2: 지역
  const [regionCity, setRegionCity] = useState('');
  const [regionDistrict, setRegionDistrict] = useState('');

  // Step 3: 종목 (지금은 테니스 고정)
  const [sport, setSport] = useState('테니스');

  function canNext() {
    if (step === 1) return displayName.trim().length > 0;
    if (step === 2) return regionCity.length > 0;
    if (step === 3) return sport.length > 0;
    return false;
  }

  async function handleFinish() {
    if (!canNext()) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');

      const { error } = await supabase.from('coach_profiles').upsert({
        coach_id: user.id,
        display_name: displayName.trim(),
        region_city: regionCity,
        region_district: regionDistrict.trim() || null,
        sport: sport,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'coach_id' });

      if (error) throw error;
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '저장 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function handleNext() {
    if (step < TOTAL_STEPS) {
      setStep(s => s + 1);
    } else {
      handleFinish();
    }
  }

  const progressPct = `${(step / TOTAL_STEPS) * 100}%`;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 진행바 */}
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: progressPct as any }]} />
        </View>
        <Text style={styles.stepLabel}>{step} / {TOTAL_STEPS}</Text>

        {/* ── Step 1: 이름 ── */}
        {step === 1 && (
          <View style={styles.stepWrap}>
            <Text style={styles.emoji}>👋</Text>
            <Text style={styles.question}>코치님 이름이 뭔가요?</Text>
            <Text style={styles.hint}>회원들에게 표시되는 이름이에요 — 수정할 수 있어요</Text>
            <TextInput
              style={styles.textInput}
              placeholder="예: 김민준"
              placeholderTextColor={Colors.placeholder}
              value={displayName}
              onChangeText={setDisplayName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={canNext() ? handleNext : undefined}
            />
            {!!email && (
              <View style={styles.emailRow}>
                <Ionicons name="mail-outline" size={14} color="rgba(255,255,255,0.5)" />
                <Text style={styles.emailText}>{email}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Step 2: 지역 ── */}
        {step === 2 && (
          <View style={styles.stepWrap}>
            <Text style={styles.emoji}>📍</Text>
            <Text style={styles.question}>어느 지역에서 레슨하세요?</Text>
            <Text style={styles.hint}>시/도를 먼저 선택해주세요</Text>

            <View style={styles.chipGrid}>
              {CITIES.map(city => (
                <TouchableOpacity
                  key={city}
                  style={[styles.chip, regionCity === city && styles.chipActive]}
                  onPress={() => setRegionCity(city)}
                >
                  <Text style={[styles.chipText, regionCity === city && styles.chipTextActive]}>{city}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.hint, { marginTop: 24, marginBottom: 8 }]}>구/군 (선택)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="예: 마포구"
              placeholderTextColor={Colors.placeholder}
              value={regionDistrict}
              onChangeText={setRegionDistrict}
              returnKeyType="done"
            />
          </View>
        )}

        {/* ── Step 3: 종목 ── */}
        {step === 3 && (
          <View style={styles.stepWrap}>
            <Text style={styles.emoji}>🎾</Text>
            <Text style={styles.question}>어떤 종목을 가르치세요?</Text>
            <Text style={styles.hint}>현재는 테니스만 지원해요. 곧 다른 종목도 추가될 예정이에요!</Text>

            <View style={styles.optionList}>
              {SPORTS.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.optionRow, sport === s && styles.optionRowActive]}
                  onPress={() => setSport(s)}
                >
                  <Text style={[styles.optionText, sport === s && styles.optionTextActive]}>{s}</Text>
                  {sport === s && <Ionicons name="checkmark-circle" size={22} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color="rgba(255,255,255,0.5)" />
              <Text style={styles.infoText}>
                코칭 경력, 아카데미명, 전문 분야 등{'\n'}추가 정보는 가입 후 프로필에서 설정할 수 있어요.
              </Text>
            </View>
          </View>
        )}

        {/* 버튼 */}
        <View style={styles.btnRow}>
          {step > 1 && (
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep(s => s - 1)}>
              <Ionicons name="arrow-back" size={20} color={Colors.mutedFg} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.nextBtn, !canNext() && styles.nextBtnDisabled]}
            onPress={handleNext}
            disabled={!canNext() || loading}
          >
            {loading
              ? <ActivityIndicator color={Colors.navy} />
              : <>
                  <Text style={styles.nextBtnText}>
                    {step === TOTAL_STEPS ? '시작하기 🎾' : '다음'}
                  </Text>
                  {step < TOTAL_STEPS && <Ionicons name="arrow-forward" size={18} color={Colors.navy} />}
                </>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.navy },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },

  progressBg: {
    height: 4, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2, marginBottom: 8,
  },
  progressFill: {
    height: 4, backgroundColor: '#fff', borderRadius: 2,
  },
  stepLabel: {
    color: 'rgba(255,255,255,0.5)', fontSize: 13,
    textAlign: 'right', marginBottom: 44,
  },

  stepWrap: { flex: 1, marginBottom: 32 },
  emoji: { fontSize: 48, marginBottom: 16 },
  question: {
    fontSize: 26, fontWeight: '800', color: '#fff',
    lineHeight: 34, marginBottom: 8,
  },
  hint: {
    fontSize: 15, color: 'rgba(255,255,255,0.6)',
    marginBottom: 28, lineHeight: 22,
  },

  textInput: {
    backgroundColor: '#fff', borderRadius: Radius.md,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 18, color: Colors.foreground, fontWeight: '600',
    ...Shadow.sm,
  },

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
  },
  chipActive: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  chipTextActive: { color: Colors.navy },

  optionList: { gap: 10, marginBottom: 24 },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: Radius.md, paddingHorizontal: 18, paddingVertical: 18,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
  },
  optionRowActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionText: { fontSize: 17, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  optionTextActive: { color: '#fff' },

  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: Radius.md, padding: 14,
  },
  infoText: {
    flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 20,
  },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  backBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
  },
  nextBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#fff',
    borderRadius: Radius.md, paddingVertical: 16,
    ...Shadow.sm,
  },
  nextBtnDisabled: { opacity: 0.35 },
  nextBtnText: { fontSize: 16, fontWeight: '800', color: Colors.navy },
  emailRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12, opacity: 0.6,
  },
  emailText: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
});
