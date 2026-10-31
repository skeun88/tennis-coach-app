import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';

export const PENDING_NEW_PACKAGE_KEY = 'pending_new_package_id';

const PRESET_COLORS = [Colors.primary, Colors.info, Colors.navy, Colors.destructive, '#ea580c', '#0891b2', '#65a30d'];

export default function NewLessonPackageScreen() {
  const router = useRouter();
  const { editId, fromMemberNew } = useLocalSearchParams<{ editId?: string; fromMemberNew?: string }>();
  const isEdit = !!editId;

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [totalCredits, setTotalCredits] = useState('10');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [creditsPreset, setCreditsPreset] = useState<string>('10');
  const [durationPreset, setDurationPreset] = useState<string>('60');
  const [color, setColor] = useState(Colors.primary);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);

  const CREDITS_PRESETS = [
    { key: '1', label: '원타임\n체험레슨' },
    { key: '10', label: '10회' },
    { key: '20', label: '20회' },
    { key: 'custom', label: '기타' },
  ];
  const DURATION_PRESETS = [
    { key: '20', label: '20분' },
    { key: '30', label: '30분' },
    { key: '40', label: '40분' },
    { key: '60', label: '60분' },
    { key: 'custom', label: '기타' },
  ];

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const { data } = await supabase.from('lesson_packages').select('*').eq('id', editId).single();
      if (data) {
        setTitle(data.title);
        setPrice(String(data.price));
        const cr = String(data.total_credits);
        setTotalCredits(cr);
        const cpKey = ['1', '10', '20'].includes(cr) ? cr : 'custom';
        setCreditsPreset(cpKey);
        const dr = String(data.duration_minutes);
        setDurationMinutes(dr);
        const dpKey = ['20', '30', '40', '60'].includes(dr) ? dr : 'custom';
        setDurationPreset(dpKey);
        setColor(data.color);
        setNotes(data.notes ?? '');
      }
      setLoadingEdit(false);
    })();
  }, [editId]);

  async function handleSave() {
    if (!title.trim()) { Alert.alert('입력 오류', '레슨권 제목을 입력해주세요.'); return; }
    if (!price.trim() || isNaN(Number(price))) { Alert.alert('입력 오류', '가격을 숫자로 입력해주세요.'); return; }
    if (creditsPreset === 'custom' && (!totalCredits.trim() || isNaN(Number(totalCredits)) || parseInt(totalCredits) < 1)) {
      Alert.alert('입력 오류', '횟수를 올바르게 입력해주세요.'); return;
    }
    if (durationPreset === 'custom' && (!durationMinutes.trim() || isNaN(Number(durationMinutes)) || parseInt(durationMinutes) < 1)) {
      Alert.alert('입력 오류', '레슨 시간을 올바르게 입력해주세요.'); return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const payload = {
      coach_id: user.id,
      title: title.trim(),
      days: [],
      price: parseInt(price) || 0,
      total_credits: parseInt(totalCredits) || 10,
      duration_minutes: parseInt(durationMinutes) || 60,
      color,
      notes: notes.trim() || null,
      is_active: true,
    };

    let error;
    let createdId: string | undefined;
    if (isEdit) {
      ({ error } = await supabase.from('lesson_packages').update(payload).eq('id', editId));
    } else {
      const { data: created, error: insertError } = await supabase.from('lesson_packages').insert(payload).select('id').single();
      error = insertError;
      createdId = created?.id;
    }

    setLoading(false);
    if (error) {
      console.error('lesson_packages error:', JSON.stringify(error));
      Alert.alert('오류', error.message || '저장에 실패했습니다.');
    } else if (fromMemberNew && createdId) {
      await AsyncStorage.setItem(PENDING_NEW_PACKAGE_KEY, createdId);
      router.back();
    } else {
      Alert.alert('완료', isEdit ? '레슨권이 수정됐습니다.' : '레슨권이 등록됐습니다.', [
        { text: '확인', onPress: () => router.back() }
      ]);
    }
  }

  if (loadingEdit) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }

  // 미리보기 카드
  const priceNum = parseInt(price) || 0;

  return (
    <View style={{ flex: 1 }}>
      <SettingsHeader title={isEdit ? '레슨권 수정' : '레슨권 등록'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* 미리보기 카드 */}
        <View style={styles.previewCard}>
          <View style={styles.previewTop}>
            <View style={[styles.previewDot, { backgroundColor: color }]} />
            <Text style={styles.previewTitle}>{title || '레슨권 제목'}</Text>
          </View>
          <View style={styles.previewMeta}>
            <Text style={styles.previewMetaText}>⏱ {durationMinutes}분</Text>
            <Text style={styles.previewMetaText}>🎾 {creditsPreset === '1' ? '원타임' : `${totalCredits}회`}</Text>
            <Text style={styles.previewMetaText}>💳 {priceNum.toLocaleString()}원</Text>
          </View>
        </View>

        {/* 기본 정보 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>기본 정보</Text>

          <Text style={styles.label}>레슨권 제목 *</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 주 2회 60분 패키지"
            value={title}
            onChangeText={setTitle}
          />

          <Text style={styles.label}>가격 (원) *</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 300000"
            value={price}
            onChangeText={setPrice}
            keyboardType="number-pad"
          />


          <Text style={styles.label}>기본 횟수</Text>
          <View style={styles.optionRow}>
            {CREDITS_PRESETS.map(p => (
              <TouchableOpacity
                key={p.key}
                style={[styles.optionBtn, creditsPreset === p.key && styles.optionBtnActive]}
                onPress={() => {
                  setCreditsPreset(p.key);
                  if (p.key !== 'custom') setTotalCredits(p.key);
                }}
              >
                <Text style={[styles.optionBtnText, creditsPreset === p.key && styles.optionBtnTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {creditsPreset === 'custom' && (
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder="횟수 입력"
              value={totalCredits}
              onChangeText={setTotalCredits}
              keyboardType="number-pad"
            />
          )}

          <Text style={[styles.label, { marginTop: 12 }]}>레슨 시간</Text>
          <View style={styles.optionRow}>
            {DURATION_PRESETS.map(p => (
              <TouchableOpacity
                key={p.key}
                style={[styles.optionBtn, durationPreset === p.key && styles.optionBtnActive]}
                onPress={() => {
                  setDurationPreset(p.key);
                  if (p.key !== 'custom') setDurationMinutes(p.key);
                }}
              >
                <Text style={[styles.optionBtnText, durationPreset === p.key && styles.optionBtnTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {durationPreset === 'custom' && (
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder="분 입력"
              value={durationMinutes}
              onChangeText={setDurationMinutes}
              keyboardType="number-pad"
            />
          )}
        </View>

        {/* 카드 색상 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>카드 색상</Text>
          <View style={styles.colorRow}>
            {PRESET_COLORS.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchSelected]}
                onPress={() => setColor(c)}
              >
                {color === c && <Ionicons name="checkmark" size={16} color="#fff" />}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 메모 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>메모</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="특이사항, 조건 등"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity style={[styles.saveBtn, { backgroundColor: color }]} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{isEdit ? '수정 완료' : '레슨권 등록'}</Text>}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  previewCard: {
    backgroundColor: '#fff', margin: 16, borderRadius: 14, padding: 16,shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  previewTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  previewDot: { width: 12, height: 12, borderRadius: 6 },
  previewTitle: { fontSize: 17, fontWeight: '800', color: Colors.foreground, flex: 1 },
  previewMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  previewMetaText: { fontSize: 13, color: Colors.mutedFg },
  section: { backgroundColor: '#fff', borderRadius: 12, margin: 16, marginBottom: 0, padding: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, marginBottom: 6 },
  input: {
    backgroundColor: Colors.mutedBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: Colors.foreground, marginBottom: 12, borderWidth: 1, borderColor: Colors.border,
  },
  textArea: { minHeight: 80, paddingTop: 10 },
  colorRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  optionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  optionBtn: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    backgroundColor: Colors.mutedBg, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', minWidth: 60,
  },
  optionBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  optionBtnText: { fontSize: 13, fontWeight: '600', color: Colors.mutedFg, textAlign: 'center' },
  optionBtnTextActive: { color: Colors.primary },
  colorSwatch: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  colorSwatchSelected: { borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  saveBtn: { margin: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
