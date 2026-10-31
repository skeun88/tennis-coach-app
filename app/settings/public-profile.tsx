import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';

const TERRA = '#C0755A';
const BASE_URL = 'kerri.co.kr/coach/';
const BIO_MIN = 20;

// 한글 → 로마자 변환 (Revised Romanization 간이 구현)
const INITIALS = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const VOWELS   = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const FINALS   = ['','k','k','k','n','n','n','t','l','k','m','l','l','l','p','l','m','p','p','t','t','ng','t','t','k','t','p','t'];

function romanizeKorean(text: string): string {
  let result = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const offset = code - 0xAC00;
      const jong = offset % 28;
      const jung = Math.floor(offset / 28) % 21;
      const cho  = Math.floor(offset / 28 / 21);
      result += INITIALS[cho] + VOWELS[jung] + FINALS[jong];
    } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      result += char.toLowerCase();
    } else if (code >= 48 && code <= 57) {
      result += char;
    } else {
      result += '-';
    }
  }
  return result.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function suggestSlug(displayName: string, regionDistrict: string, sport: string): string {
  const namePart = romanizeKorean(displayName || '');
  const regionPart = romanizeKorean(regionDistrict || '');
  const sportPart = romanizeKorean(sport || 'tennis');
  const parts = [namePart, regionPart, sportPart].filter(Boolean);
  return parts.join('-').replace(/-+/g, '-').slice(0, 60);
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug);
}

export default function PublicProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [isPublic, setIsPublic] = useState(false);
  const [slug, setSlug] = useState('');
  const [regionDistrict, setRegionDistrict] = useState('');
  const [bio, setBio] = useState('');

  const [originalSlug, setOriginalSlug] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [sport, setSport] = useState('테니스');

  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase.from('coach_profiles').select('*').eq('coach_id', user.id).maybeSingle();
    if (data) {
      setIsPublic(data.is_public ?? false);
      setRegionDistrict(data.region_district ?? '');
      setBio(data.bio ?? '');
      setDisplayName(data.display_name ?? '');
      setSport(data.sport ?? '테니스');
      if (data.public_slug) {
        setSlug(data.public_slug);
        setOriginalSlug(data.public_slug);
        setSlugStatus('available');
      } else {
        const suggested = suggestSlug(data.display_name ?? '', data.region_district ?? '', data.sport ?? '테니스');
        setSlug(suggested);
      }
    }
    setLoading(false);
  }

  function handleSlugChange(val: string) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSlug(cleaned);
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    if (!cleaned) { setSlugStatus('idle'); return; }
    if (!isValidSlug(cleaned)) { setSlugStatus('invalid'); return; }
    if (cleaned === originalSlug) { setSlugStatus('available'); return; }
    setSlugStatus('checking');
    slugCheckTimer.current = setTimeout(() => checkSlugAvailability(cleaned), 600);
  }

  async function checkSlugAvailability(val: string) {
    const { data } = await supabase.from('coach_profiles').select('coach_id').eq('public_slug', val).maybeSingle();
    const { data: { user } } = await supabase.auth.getUser();
    if (data && data.coach_id !== user?.id) {
      setSlugStatus('taken');
    } else {
      setSlugStatus('available');
    }
  }

  const canGoPublic = !!slug && slugStatus === 'available' && regionDistrict.trim().length >= 2 && bio.trim().length >= BIO_MIN;

  async function handleSave() {
    if (!slug.trim()) { Alert.alert('입력 오류', 'URL 슬러그를 입력해주세요.'); return; }
    if (!isValidSlug(slug)) { Alert.alert('입력 오류', '슬러그는 영문 소문자·숫자·하이픈만 사용 가능하고 최소 3자이어야 합니다.'); return; }
    if (slugStatus === 'taken') { Alert.alert('입력 오류', '이미 사용 중인 슬러그예요.'); return; }
    if (!regionDistrict.trim()) { Alert.alert('입력 오류', '활동 지역(구/동)을 입력해주세요.'); return; }
    if (bio.trim().length < BIO_MIN) { Alert.alert('입력 오류', `한 줄 소개는 최소 ${BIO_MIN}자 이상 입력해주세요.`); return; }
    if (isPublic && !canGoPublic) { Alert.alert('입력 오류', '공개하려면 모든 항목을 채워주세요.'); return; }

    if (originalSlug && slug !== originalSlug && isPublic) {
      const go = await new Promise<boolean>(resolve =>
        Alert.alert(
          '슬러그 변경 주의',
          `기존 링크(${BASE_URL}${originalSlug})가 깨집니다.\n계속할까요?`,
          [{ text: '취소', onPress: () => resolve(false), style: 'cancel' }, { text: '변경', onPress: () => resolve(true) }]
        )
      );
      if (!go) return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const { error } = await supabase.from('coach_profiles').upsert({
      coach_id: user.id,
      public_slug: slug.trim(),
      region_district: regionDistrict.trim(),
      bio: bio.trim(),
      is_public: isPublic,
    }, { onConflict: 'coach_id' });

    setSaving(false);
    if (error) { Alert.alert('오류', error.message); return; }
    setOriginalSlug(slug.trim());
    Alert.alert('저장됨', isPublic ? `공개 URL: ${BASE_URL}${slug}` : '저장됐어요.');
  }

  async function handleCopyUrl() {
    await Clipboard.setStringAsync(`https://${BASE_URL}${slug}`);
    Alert.alert('복사됨', '링크가 복사됐어요.');
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={TERRA} /></View>;

  const slugIndicator = {
    idle: null,
    checking: <ActivityIndicator size="small" color={Colors.mutedFg} />,
    available: <Ionicons name="checkmark-circle" size={18} color={Colors.success} />,
    taken: <Ionicons name="close-circle" size={18} color={Colors.destructive} />,
    invalid: <Ionicons name="alert-circle" size={18} color={Colors.warning} />,
  }[slugStatus];

  const slugStatusText = {
    idle: '',
    checking: '중복 확인 중...',
    available: slug === originalSlug ? '현재 슬러그' : '사용 가능해요',
    taken: '이미 사용 중이에요',
    invalid: '영문 소문자·숫자·하이픈만, 최소 3자',
  }[slugStatus];

  return (
    <View style={{ flex: 1 }}>
      <SettingsHeader title="공개 프로필 설정" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>

        {/* 공개 ON/OFF */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>프로필 공개</Text>
              <Text style={styles.toggleDesc}>
                {isPublic ? '현재 공개 중이에요' : canGoPublic ? '모든 항목이 채워졌어요. 공개할 수 있어요.' : '아래 항목을 모두 채워야 공개할 수 있어요.'}
              </Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={v => {
                if (v && !canGoPublic) {
                  Alert.alert('항목 미완성', '슬러그, 활동 지역, 한 줄 소개를 모두 채워주세요.');
                  return;
                }
                setIsPublic(v);
              }}
              trackColor={{ false: Colors.border, true: TERRA }}
              thumbColor="#fff"
            />
          </View>

          {isPublic && slug && (
            <TouchableOpacity style={styles.urlBox} onPress={handleCopyUrl} activeOpacity={0.7}>
              <Ionicons name="link-outline" size={16} color={TERRA} />
              <Text style={styles.urlText} numberOfLines={1}>{BASE_URL}{slug}</Text>
              <Ionicons name="copy-outline" size={16} color={TERRA} />
            </TouchableOpacity>
          )}
        </View>

        {/* 슬러그 */}
        <View style={styles.section}>
          <Text style={styles.label}>프로필 URL 슬러그 *</Text>
          <Text style={styles.hint}>영문 소문자·숫자·하이픈만. 저장 후 변경 시 기존 링크가 깨져요.</Text>
          {originalSlug && slug !== originalSlug && (
            <View style={styles.warnBox}>
              <Ionicons name="warning-outline" size={14} color={Colors.warning} />
              <Text style={styles.warnText}>변경하면 기존 링크({BASE_URL}{originalSlug})가 깨져요.</Text>
            </View>
          )}
          <View style={styles.slugRow}>
            <Text style={styles.slugPrefix}>kerri.co.kr/coach/</Text>
            <TextInput
              style={styles.slugInput}
              value={slug}
              onChangeText={handleSlugChange}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="my-slug"
              placeholderTextColor={Colors.placeholder}
            />
            <View style={{ width: 24, alignItems: 'center' }}>{slugIndicator}</View>
          </View>
          {slugStatusText ? (
            <Text style={[styles.slugStatus,
              slugStatus === 'available' && { color: Colors.success },
              slugStatus === 'taken' && { color: Colors.destructive },
              slugStatus === 'invalid' && { color: Colors.warning },
            ]}>{slugStatusText}</Text>
          ) : null}
        </View>

        {/* 활동 지역 */}
        <View style={styles.section}>
          <Text style={styles.label}>활동 지역 (구/동) *</Text>
          <TextInput
            style={styles.input}
            value={regionDistrict}
            onChangeText={setRegionDistrict}
            placeholder="예: 강남구, 마포구, 분당구"
            placeholderTextColor={Colors.placeholder}
          />
        </View>

        {/* 한 줄 소개 */}
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={styles.label}>한 줄 소개 *</Text>
            <Text style={[styles.hint, bio.trim().length >= BIO_MIN ? { color: Colors.success } : {}]}>
              {bio.trim().length}/{BIO_MIN}자 이상
            </Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={bio}
            onChangeText={setBio}
            placeholder="코치 소개를 입력하세요. 검색 엔진에 노출되는 설명이에요."
            placeholderTextColor={Colors.placeholder}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={300}
          />
        </View>

        <TouchableOpacity style={[styles.saveBtn, { backgroundColor: TERRA }]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: {
    backgroundColor: '#fff', borderRadius: 12,
    margin: 16, marginBottom: 0, padding: 16,
  },
  label: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginBottom: 6 },
  hint: { fontSize: 12, color: Colors.placeholder, marginBottom: 8 },
  input: {
    backgroundColor: Colors.mutedBg, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: Colors.foreground,
    borderWidth: 1, borderColor: Colors.border,
  },
  textArea: { minHeight: 90, paddingTop: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLabel: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  toggleDesc: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },
  urlBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FBF2EF', borderRadius: 10, padding: 10, marginTop: 12,
  },
  urlText: { flex: 1, fontSize: 13, color: TERRA, fontWeight: '600' },
  slugRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slugPrefix: { fontSize: 13, color: Colors.mutedFg, fontWeight: '500' },
  slugInput: {
    flex: 1, backgroundColor: Colors.mutedBg, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: Colors.foreground,
    borderWidth: 1, borderColor: Colors.border,
  },
  slugStatus: { fontSize: 12, marginTop: 4, color: Colors.mutedFg },
  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF9EB', borderRadius: 8, padding: 8, marginBottom: 8,
  },
  warnText: { fontSize: 12, color: Colors.warning, flex: 1 },
  saveBtn: { margin: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
