import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, Switch, KeyboardAvoidingView, Platform, Linking, Animated,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';
import CoachQRModal from '../../components/CoachQRModal';

const TERRA = '#C0755A';
const BASE_URL = 'kerri.co.kr/coach/';
const FULL_BASE_URL = 'https://kerri.co.kr/coach/';

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
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [savingSlug, setSavingSlug] = useState(false);

  const [coachId, setCoachId] = useState<string>('');
  const [coachName, setCoachName] = useState<string>('');
  const [isPublic, setIsPublic] = useState(false);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [draftSlug, setDraftSlug] = useState('');

  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [addressOpen, setAddressOpen] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  function showCopyToast() {
    setToastVisible(true);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  }

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setCoachId(user.id);

    const { data } = await supabase
      .from('coach_profiles')
      .select('is_public, public_slug, display_name, region_district, sport')
      .eq('coach_id', user.id)
      .maybeSingle();

    if (data) {
      setIsPublic(data.is_public ?? false);
      setCoachName(data.display_name ?? '');
      if (data.public_slug) {
        setSavedSlug(data.public_slug);
        setDraftSlug(data.public_slug);
        setSlugStatus('available');
      } else {
        const suggested = suggestSlug(data.display_name ?? '', data.region_district ?? '', data.sport ?? '테니스');
        setDraftSlug(suggested);
        if (isValidSlug(suggested)) {
          setSlugStatus('checking');
          checkSlugAvailability(suggested, user.id);
        }
      }
    }
    setLoading(false);
  }

  function handleDraftSlugChange(val: string) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setDraftSlug(cleaned);
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    if (!cleaned) { setSlugStatus('idle'); return; }
    if (!isValidSlug(cleaned)) { setSlugStatus('invalid'); return; }
    if (cleaned === savedSlug) { setSlugStatus('available'); return; }
    setSlugStatus('checking');
    slugCheckTimer.current = setTimeout(() => checkSlugAvailability(cleaned, coachId), 600);
  }

  async function checkSlugAvailability(val: string, uid: string) {
    const { data } = await supabase
      .from('coach_profiles')
      .select('coach_id')
      .eq('public_slug', val)
      .maybeSingle();
    if (data && data.coach_id !== uid) {
      setSlugStatus('taken');
    } else {
      setSlugStatus('available');
    }
  }

  async function handleTogglePublic(newVal: boolean) {
    if (newVal && !savedSlug) {
      Alert.alert('주소 필요', '공개하려면 먼저 프로필 주소를 저장해주세요.');
      setAddressOpen(true);
      return;
    }
    setTogglingPublic(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setTogglingPublic(false); return; }
    const { error } = await supabase
      .from('coach_profiles')
      .update({ is_public: newVal })
      .eq('coach_id', user.id);
    setTogglingPublic(false);
    if (error) {
      Alert.alert('오류', error.message);
    } else {
      setIsPublic(newVal);
    }
  }

  async function handleSaveSlug() {
    if (!draftSlug.trim()) return;
    if (!isValidSlug(draftSlug)) {
      Alert.alert('입력 오류', '프로필 주소는 영문 소문자·숫자·하이픈만 사용 가능하고 최소 3자이어야 합니다.');
      return;
    }
    if (slugStatus === 'taken') {
      Alert.alert('중복', '이미 사용 중인 주소예요.');
      return;
    }
    if (slugStatus === 'checking') {
      Alert.alert('잠시 후', '중복 확인 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    if (savedSlug && draftSlug !== savedSlug) {
      const go = await new Promise<boolean>(resolve =>
        Alert.alert(
          '주소 변경',
          `기존 링크(${BASE_URL}${savedSlug})는 새 주소로 자동 연결됩니다.\n계속할까요?`,
          [
            { text: '취소', onPress: () => resolve(false), style: 'cancel' },
            { text: '변경', onPress: () => resolve(true) },
          ]
        )
      );
      if (!go) return;
    }

    setSavingSlug(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingSlug(false); return; }

    if (savedSlug && draftSlug !== savedSlug) {
      await supabase.from('coach_slug_redirects').insert({
        old_slug: savedSlug,
        new_slug: draftSlug,
        coach_id: user.id,
      });
    }

    const { error } = await supabase
      .from('coach_profiles')
      .update({ public_slug: draftSlug })
      .eq('coach_id', user.id);

    setSavingSlug(false);
    if (error) {
      Alert.alert('오류', error.message);
    } else {
      setSavedSlug(draftSlug);
      setSlugStatus('available');
      Alert.alert('저장됨', `프로필 주소가 저장됐어요.\n${BASE_URL}${draftSlug}`);
    }
  }

  async function handleCopyUrl() {
    const slug = savedSlug || draftSlug;
    await Clipboard.setStringAsync(`${FULL_BASE_URL}${slug}`);
    showCopyToast();
  }

  async function handlePreview() {
    const slug = savedSlug || draftSlug;
    await Linking.openURL(`${FULL_BASE_URL}${slug}`);
  }

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <SettingsHeader title="공개 프로필 설정" />
        <View style={styles.center}><ActivityIndicator color={TERRA} /></View>
      </View>
    );
  }

  const currentUrl = `${BASE_URL}${savedSlug || draftSlug || '...'}`;

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
    available: draftSlug === savedSlug ? '현재 주소' : '사용 가능해요',
    taken: '이미 사용 중이에요',
    invalid: '영문 소문자·숫자·하이픈만, 최소 3자',
  }[slugStatus];

  const slugChanged = draftSlug !== savedSlug && isValidSlug(draftSlug) && slugStatus === 'available';

  return (
    <View style={{ flex: 1 }}>
      <SettingsHeader title="공개 프로필 설정" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>

          {/* ── 공개 설정 카드 ── */}
          <View style={styles.card}>
            {/* 토글 행 */}
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>프로필 공개</Text>
                <Text style={styles.toggleDesc}>
                  {isPublic ? '지금 공개 중이에요' : '비공개 상태예요'}
                </Text>
              </View>
              {togglingPublic
                ? <ActivityIndicator color={TERRA} style={{ marginRight: 4 }} />
                : (
                  <Switch
                    value={isPublic}
                    onValueChange={handleTogglePublic}
                    trackColor={{ false: Colors.border, true: TERRA }}
                    thumbColor="#fff"
                  />
                )
              }
            </View>

            {/* URL 표시 (항상 보임) */}
            <View style={styles.urlBox}>
              <Ionicons name="link-outline" size={15} color={TERRA} />
              <Text style={styles.urlText} numberOfLines={1}>{currentUrl}</Text>
            </View>

            {/* 액션 버튼 행 */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={handlePreview} activeOpacity={0.7}>
                <Ionicons name="eye-outline" size={16} color={TERRA} />
                <Text style={styles.actionBtnText}>미리보기</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={handleCopyUrl} activeOpacity={0.7}>
                <Ionicons name="copy-outline" size={16} color={TERRA} />
                <Text style={styles.actionBtnText}>복사</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => setQrVisible(true)}
                activeOpacity={0.7}
                disabled={!coachId}
              >
                <Ionicons name="qr-code-outline" size={16} color={TERRA} />
                <Text style={styles.actionBtnText}>QR</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── 프로필 주소 변경 (접힘) ── */}
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.collapseHeader}
              onPress={() => setAddressOpen(v => !v)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.collapseTitle}>프로필 주소 변경</Text>
                {!addressOpen && savedSlug && (
                  <Text style={styles.collapseSubtitle}>{BASE_URL}{savedSlug}</Text>
                )}
              </View>
              <Ionicons
                name={addressOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={Colors.mutedFg}
              />
            </TouchableOpacity>

            {addressOpen && (
              <View style={styles.collapseBody}>
                <Text style={styles.hint}>영문 소문자·숫자·하이픈만. 변경 시 기존 링크는 자동으로 새 주소로 연결돼요.</Text>

                <View style={styles.slugRow}>
                  <Text style={styles.slugPrefix}>kerri.co.kr/coach/</Text>
                  <TextInput
                    style={styles.slugInput}
                    value={draftSlug}
                    onChangeText={handleDraftSlugChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="hyunsu-tennis"
                    placeholderTextColor={Colors.placeholder}
                  />
                  <View style={{ width: 24, alignItems: 'center' }}>{slugIndicator}</View>
                </View>

                {slugStatusText ? (
                  <Text style={[
                    styles.slugStatusText,
                    slugStatus === 'available' && { color: Colors.success },
                    slugStatus === 'taken' && { color: Colors.destructive },
                    slugStatus === 'invalid' && { color: Colors.warning },
                  ]}>{slugStatusText}</Text>
                ) : null}

                <TouchableOpacity
                  style={[styles.saveSlugBtn, !slugChanged && styles.saveSlugBtnDisabled]}
                  onPress={handleSaveSlug}
                  disabled={!slugChanged || savingSlug}
                  activeOpacity={0.8}
                >
                  {savingSlug
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.saveSlugBtnText}>주소 저장</Text>
                  }
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <CoachQRModal
        visible={qrVisible}
        onClose={() => setQrVisible(false)}
        coachId={coachId}
        coachName={coachName}
        publicSlug={savedSlug}
      />

      {toastVisible && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={styles.toastText}>링크가 복사됐어요</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { paddingTop: 12, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  toggleLabel: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  toggleDesc: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },

  urlBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FBF2EF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  urlText: { flex: 1, fontSize: 13, color: TERRA, fontWeight: '600' },

  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: TERRA,
    borderRadius: 10,
    paddingVertical: 9,
  },
  actionBtnText: { fontSize: 13, fontWeight: '700', color: TERRA },

  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  collapseTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  collapseSubtitle: { fontSize: 12, color: Colors.mutedFg, marginTop: 2 },

  collapseBody: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 14,
    gap: 8,
  },
  hint: { fontSize: 12, color: Colors.placeholder, lineHeight: 18 },

  slugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  slugPrefix: { fontSize: 13, color: Colors.mutedFg, fontWeight: '500' },
  slugInput: {
    flex: 1,
    backgroundColor: Colors.mutedBg,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: Colors.foreground,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  slugStatusText: { fontSize: 12, color: Colors.mutedFg },

  saveSlugBtn: {
    marginTop: 6,
    backgroundColor: TERRA,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveSlugBtnDisabled: {
    backgroundColor: Colors.border,
  },
  saveSlugBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  toast: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: 'rgba(50,50,50,0.88)',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
