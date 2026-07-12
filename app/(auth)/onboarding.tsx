import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Animated, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors, Radius, Shadow } from '../../lib/theme';

const TOTAL_STEPS = 5;

const COURT_TYPES = ['상가미니', '하프코트', '풀코트실내', '풀코트야외', '멀티코트'];
const LEVELS = ['입문', '초급', '중급', '상급', '선수'];
const CITIES = ['서울', '부산', '인천', '대구', '대전', '광주', '울산', '세종', '수원', '성남', '고양', '용인', '기타'];

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // 퀴즈 답변
  const [displayName, setDisplayName] = useState('');
  const [coachingYears, setCoachingYears] = useState('');
  const [courtType, setCourtType] = useState('');
  const [mainLevels, setMainLevels] = useState<string[]>([]);
  const [regionCity, setRegionCity] = useState('');
  const [centerName, setCenterName] = useState('');

  function toggleLevel(level: string) {
    setMainLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  }

  function canNext() {
    if (step === 1) return displayName.trim().length > 0;
    if (step === 2) return coachingYears.length > 0;
    if (step === 3) return courtType.length > 0;
    if (step === 4) return mainLevels.length > 0;
    if (step === 5) return regionCity.length > 0 && centerName.trim().length > 0;
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
        coaching_years: coachingYears ? parseInt(coachingYears, 10) : null,
        default_court_type: courtType || null,
        specialties: mainLevels.length > 0 ? mainLevels : null,
        region_city: regionCity || null,
        center_name: centerName.trim() || null,
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

  const progressWidth = `${(step / TOTAL_STEPS) * 100}%`;

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
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: progressWidth as any }]} />
        </View>
        <Text style={styles.stepIndicator}>{step} / {TOTAL_STEPS}</Text>

        {/* Step 1: 이름 */}
        {step === 1 && (
          <View style={styles.stepContainer}>
            <View style={styles.emojiWrap}><Text style={styles.emoji}>👋</Text></View>
            <Text style={styles.question}>코치님 이름이 뭔가요?</Text>
            <Text style={styles.hint}>회원들에게 표시되는 이름이에요</Text>
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
          </View>
        )}

        {/* Step 2: 경력 */}
        {step === 2 && (
          <View style={styles.stepContainer}>
            <View style={styles.emojiWrap}><Text style={styles.emoji}>🏆</Text></View>
            <Text style={styles.question}>코칭 경력이 얼마나 되셨나요?</Text>
            <Text style={styles.hint}>대략적인 연수로 알려주세요</Text>
            <View style={styles.yearsRow}>
              {['1', '2', '3', '5', '7', '10', '15', '20+'].map(y => (
                <TouchableOpacity
                  key={y}
                  style={[styles.chip, coachingYears === y && styles.chipActive]}
                  onPress={() => setCoachingYears(y)}
                >
                  <Text style={[styles.chipText, coachingYears === y && styles.chipTextActive]}>
                    {y === '20+' ? '20년+' : `${y}년`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Step 3: 코트 타입 */}
        {step === 3 && (
          <View style={styles.stepContainer}>
            <View style={styles.emojiWrap}><Text style={styles.emoji}>🎾</Text></View>
            <Text style={styles.question}>주로 어떤 코트에서 레슨하세요?</Text>
            <Text style={styles.hint}>가장 자주 사용하는 코트 한 개를 선택해주세요</Text>
            <View style={styles.optionList}>
              {COURT_TYPES.map(ct => (
                <TouchableOpacity
                  key={ct}
                  style={[styles.optionRow, courtType === ct && styles.optionRowActive]}
                  onPress={() => setCourtType(ct)}
                >
                  <Text style={[styles.optionText, courtType === ct && styles.optionTextActive]}>{ct}</Text>
                  {courtType === ct && <Ionicons name="checkmark-circle" size={22} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Step 4: 주요 레벨 */}
        {step === 4 && (
          <View style={styles.stepContainer}>
            <View style={styles.emojiWrap}><Text style={styles.emoji}>📊</Text></View>
            <Text style={styles.question}>주로 어떤 수준의 회원을 지도하세요?</Text>
            <Text style={styles.hint}>복수 선택 가능해요</Text>
            <View style={styles.chipWrap}>
              {LEVELS.map(lv => (
                <TouchableOpacity
                  key={lv}
                  style={[styles.chip, mainLevels.includes(lv) && styles.chipActive]}
                  onPress={() => toggleLevel(lv)}
                >
                  <Text style={[styles.chipText, mainLevels.includes(lv) && styles.chipTextActive]}>{lv}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Step 5: 지역 + 센터 */}
        {step === 5 && (
          <View style={styles.stepContainer}>
            <View style={styles.emojiWrap}><Text style={styles.emoji}>📍</Text></View>
            <Text style={styles.question}>어디서 레슨하세요?</Text>
            <Text style={styles.hint}>지역과 테니스장/센터 이름을 알려주세요</Text>

            <Text style={styles.subLabel}>지역</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityScroll}>
              {CITIES.map(city => (
                <TouchableOpacity
                  key={city}
                  style={[styles.chip, regionCity === city && styles.chipActive, { marginBottom: 0 }]}
                  onPress={() => setRegionCity(city)}
                >
                  <Text style={[styles.chipText, regionCity === city && styles.chipTextActive]}>{city}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[styles.subLabel, { marginTop: 20 }]}>테니스장 / 센터 이름</Text>
            <TextInput
              style={styles.textInput}
              placeholder="예: 한강 테니스장"
              placeholderTextColor={Colors.placeholder}
              value={centerName}
              onChangeText={setCenterName}
              returnKeyType="done"
            />
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
            style={[styles.nextBtn, !canNext() && styles.nextBtnDisabled, step > 1 && { flex: 1 }]}
            onPress={handleNext}
            disabled={!canNext() || loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.nextBtnText}>{step === TOTAL_STEPS ? '시작하기 🎾' : '다음'}</Text>
                  {step < TOTAL_STEPS && <Ionicons name="arrow-forward" size={18} color="#fff" />}
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
  scroll: { flexGrow: 1, padding: 24, paddingTop: 60, paddingBottom: 40 },

  progressBarBg: {
    height: 4, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2, marginBottom: 8,
  },
  progressBarFill: {
    height: 4, backgroundColor: '#fff', borderRadius: 2,
  },
  stepIndicator: {
    color: 'rgba(255,255,255,0.5)', fontSize: 13,
    textAlign: 'right', marginBottom: 40,
  },

  stepContainer: { flex: 1, marginBottom: 32 },
  emojiWrap: { marginBottom: 16 },
  emoji: { fontSize: 48 },
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

  yearsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
    marginBottom: 4,
  },
  chipActive: {
    backgroundColor: '#fff', borderColor: '#fff',
  },
  chipText: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  chipTextActive: { color: Colors.navy },

  optionList: { gap: 10 },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: Radius.md, paddingHorizontal: 18, paddingVertical: 16,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
  },
  optionRowActive: {
    backgroundColor: Colors.primary, borderColor: Colors.primary,
  },
  optionText: { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  optionTextActive: { color: '#fff' },

  subLabel: {
    fontSize: 13, fontWeight: '700',
    color: 'rgba(255,255,255,0.6)', marginBottom: 10,
  },
  cityScroll: { marginBottom: 4 },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  backBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
  },
  nextBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#fff',
    borderRadius: Radius.md, paddingVertical: 16,
    ...Shadow.sm,
  },
  nextBtnDisabled: { opacity: 0.35 },
  nextBtnText: { fontSize: 16, fontWeight: '800', color: Colors.navy },
});
