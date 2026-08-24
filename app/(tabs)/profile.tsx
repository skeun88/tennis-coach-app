import { useState, useCallback, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, Modal, TextInput, ActivityIndicator,
  Image, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import PlanUpsellModal from '../../components/PlanUpsellModal';
import * as DocumentPicker from 'expo-document-picker';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { supabase } from '../../lib/supabase';
import { useSubscription } from '../../hooks/useSubscription';
import { PLANS } from '../../lib/subscription';
import { Colors, Radius, Shadow } from '../../lib/theme';
import CoachQRModal from '../../components/CoachQRModal';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SPORTS = ['테니스', '배드민턴', '스쿼시', '탁구', '골프', '기타'];

const TERRA = '#C0755A';
const CREAM = '#F7F0E9';
const TERRA_LIGHT = '#FBF2EF';
const DARK = '#3E2B22';

interface Performance {
  totalLessons: number;
  avgRetentionMonths: number | null;
  satisfactionAvg: number | null;
  satisfactionCount: number;
  totalReports: number;
}

interface ProfileInfo {
  name: string; avatar_url: string; sport: string;
  region_city: string; region_district: string;
  center_name: string; bio: string;
}

interface CareerInfo {
  coaching_years: string; has_player_career: boolean;
  career_details: string; certifications: string; awards: string;
}

function SaveBtn({ onPress, loading }: { onPress: () => void; loading: boolean }) {
  return (
    <TouchableOpacity style={styles.saveBtn} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnTxt}>저장하기</Text>}
    </TouchableOpacity>
  );
}

function CancelBtn({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.cancelBtn} onPress={onPress}>
      <Text style={styles.cancelBtnTxt}>취소</Text>
    </TouchableOpacity>
  );
}

function StatCell({ value, label, sub, right, bottom }: {
  value: string; label: string; sub?: string; right?: boolean; bottom?: boolean;
}) {
  return (
    <View style={[stat.cell, right && stat.cellRight, bottom && stat.cellBottom]}>
      <Text style={stat.value}>{value}</Text>
      <Text style={stat.label}>{label}</Text>
      {sub ? <Text style={stat.sub}>{sub}</Text> : null}
    </View>
  );
}

export default function ProfileScreen() {
  const { subscription, isActive, isTrial, trialDaysLeft, canUse } = useSubscription();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [knowledgeList, setKnowledgeList] = useState<any[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [knowledgeModal, setKnowledgeModal] = useState(false);
  const [knowledgeUploading, setKnowledgeUploading] = useState(false);
  const [knowledgeCategory, setKnowledgeCategory] = useState('기타');
  const [knowledgeText, setKnowledgeText] = useState('');
  const [knowledgeFileUploading, setKnowledgeFileUploading] = useState(false);
  const [upsellVisible, setUpsellVisible] = useState(false);
  const audioRecorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: false });
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceRecordingDuration, setVoiceRecordingDuration] = useState(0);
  const [voiceUsedSeconds, setVoiceUsedSeconds] = useState(0);
  const VOICE_MONTHLY_LIMIT = 1800;

  const planLabel = subscription ? PLANS[subscription.plan_id]?.name ?? subscription.plan_id : null;
  const statusLabel = isTrial
    ? `무료 체험 중 (${trialDaysLeft}일 남음)`
    : subscription?.status === 'active' ? '구독 중'
    : subscription?.status === 'cancelled' ? '해지됨'
    : subscription?.status === 'past_due' ? '결제 실패'
    : null;

  const [coachId, setCoachId] = useState<string | null>(null);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [perf, setPerf] = useState<Performance>({
    totalLessons: 0, avgRetentionMonths: null,
    satisfactionAvg: null, satisfactionCount: 0, totalReports: 0,
  });

  const [profile, setProfile] = useState<ProfileInfo>({
    name: '', avatar_url: '', sport: '테니스',
    region_city: '', region_district: '', center_name: '', bio: '',
  });
  const [profileModal, setProfileModal] = useState(false);
  const [editProfile, setEditProfile] = useState<ProfileInfo>({
    name: '', avatar_url: '', sport: '테니스',
    region_city: '', region_district: '', center_name: '', bio: '',
  });
  const [sportPickerOpen, setSportPickerOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [career, setCareer] = useState<CareerInfo>({
    coaching_years: '', has_player_career: false,
    career_details: '', certifications: '', awards: '',
  });
  const [careerModal, setCareerModal] = useState(false);
  const [editCareer, setEditCareer] = useState<CareerInfo>({
    coaching_years: '', has_player_career: false,
    career_details: '', certifications: '', awards: '',
  });
  const [savingCareer, setSavingCareer] = useState(false);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCoachId(user.id);

    const [allLessonsRes, plansRes, profileRes] = await Promise.all([
      supabase.from('lessons').select('id, date').eq('coach_id', user.id),
      supabase.from('lesson_plans').select('*', { count: 'exact', head: true }).eq('coach_id', user.id),
      supabase.from('coach_profiles').select('*').eq('coach_id', user.id).maybeSingle(),
    ]);
    const reviewsRes = { data: [] as any[] };

    const totalReports = plansRes.count ?? 0;
    const allLessons = allLessonsRes.data ?? [];
    const allLessonIds = allLessons.map((l: any) => l.id);

    const reviews = reviewsRes.data ?? [];
    const satisfactionCount = reviews.length;
    const satisfactionAvg = satisfactionCount > 0
      ? Math.round((reviews.reduce((s: number, r: any) => s + r.rating, 0) / satisfactionCount) * 10) / 10
      : null;

    let totalLessons = 0;
    let avgRetentionMonths: number | null = null;

    if (allLessonIds.length > 0) {
      const { data: allAttended } = await supabase
        .from('attendance')
        .select('lesson_id, member_id')
        .in('lesson_id', allLessonIds)
        .eq('status', '출석');

      const attended = allAttended ?? [];
      totalLessons = new Set(attended.map((r: any) => r.lesson_id)).size;

      const lessonDateMap = new Map<string, string>();
      allLessons.forEach((l: any) => lessonDateMap.set(l.id, l.date));

      const memberFirstDate = new Map<string, string>();
      const memberLastDate  = new Map<string, string>();
      attended.forEach((r: any) => {
        const date = lessonDateMap.get(r.lesson_id);
        if (!date) return;
        const mid = r.member_id;
        if (!memberFirstDate.has(mid) || date < memberFirstDate.get(mid)!) memberFirstDate.set(mid, date);
        if (!memberLastDate.has(mid)  || date > memberLastDate.get(mid)!)  memberLastDate.set(mid, date);
      });

      const today = new Date();
      const churnedDurations: number[] = [];
      memberLastDate.forEach((lastDate, mid) => {
        const last = new Date(lastDate + 'T00:00:00');
        const diffDays = (today.getTime() - last.getTime()) / 86400000;
        if (diffDays >= 30) {
          const first = new Date((memberFirstDate.get(mid) ?? lastDate) + 'T00:00:00');
          const months = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
          churnedDurations.push(months);
        }
      });

      if (churnedDurations.length >= 5) {
        const avg = churnedDurations.reduce((a, b) => a + b, 0) / churnedDurations.length;
        avgRetentionMonths = Math.round(avg * 10) / 10;
      }
    }

    setPerf({ totalLessons, avgRetentionMonths, satisfactionAvg, satisfactionCount, totalReports });

    const p = profileRes.data;
    setProfile({
      name: p?.display_name ?? user.email?.split('@')[0] ?? '코치',
      avatar_url: p?.avatar_url ?? '',
      sport: p?.sport ?? '테니스',
      region_city: p?.region_city ?? '',
      region_district: p?.region_district ?? '',
      center_name: p?.center_name ?? '',
      bio: p?.bio ?? '',
    });
    setCareer({
      coaching_years: p?.coaching_years != null ? String(p.coaching_years) : '',
      has_player_career: p?.has_player_career ?? false,
      career_details: p?.career_details ?? '',
      certifications: p?.certifications ?? '',
      awards: p?.awards ?? '',
    });

    const currentYearMonth = new Date().toISOString().slice(0, 7);
    const [kListRes, voiceRes] = await Promise.all([
      supabase
        .from('tennis_knowledge')
        .select('id, title, category, created_at')
        .eq('coach_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('coach_voice_usage')
        .select('used_seconds')
        .eq('coach_id', user.id)
        .eq('year_month', currentYearMonth)
        .maybeSingle(),
    ]);
    setKnowledgeList(kListRes.data || []);
    setKnowledgeCount(kListRes.data?.length || 0);
    setVoiceUsedSeconds(voiceRes.data?.used_seconds ?? 0);
  }

  useFocusEffect(useCallback(() => { loadProfile(); }, []));

  const initial = (profile.name || '코').slice(0, 1).toUpperCase();
  const regionLabel = [profile.region_city, profile.region_district].filter(Boolean).join(' ');
  const sportCenter = [profile.sport, profile.center_name].filter(Boolean).join(' · ');

  const voiceRemainMin = Math.floor((VOICE_MONTHLY_LIMIT - voiceUsedSeconds) / 60);
  const voiceExceeded = voiceUsedSeconds >= VOICE_MONTHLY_LIMIT;

  // Profile completion
  const completionItems = [
    { label: '활동 지역', done: !!(profile.region_city || profile.region_district) },
    { label: '소속 센터', done: !!profile.center_name },
    { label: '한 줄 소개', done: !!profile.bio },
    { label: '코칭 경력', done: !!career.coaching_years },
    { label: '주요 경력', done: !!career.career_details },
    { label: '자격증', done: !!career.certifications },
    { label: '수상 경력', done: !!career.awards },
  ];
  const completionPct = Math.round(completionItems.filter(i => i.done).length / completionItems.length * 100);
  const missingLabels = completionItems.filter(i => !i.done).map(i => i.label);
  const completionTip = completionPct === 100
    ? '프로필이 완성됐어요!'
    : `${missingLabels.slice(0, 2).join(', ')}을 추가해 보세요`;

  async function handlePickAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요합니다.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setUploadingAvatar(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists || ((fileInfo as any).size ?? 0) < 1000) {
        Alert.alert('오류', '이미지 파일을 읽을 수 없습니다. 다른 사진을 선택해주세요.');
        return;
      }
      const ext = (uri.split('.').pop()?.toLowerCase() ?? 'jpg').replace(/[^a-z]/g, '') || 'jpg';
      const filePath = `${user.id}/avatar.${ext}`;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('인증 토큰 없음');
      const { data: existingFiles } = await supabase.storage.from('avatars').list(user.id);
      const oldAvatars = (existingFiles ?? []).filter(f => f.name.startsWith('avatar.'));
      if (oldAvatars.length > 0) {
        await supabase.storage.from('avatars').remove(oldAvatars.map(f => `${user.id}/${f.name}`));
      }
      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/avatars/${filePath}`;
      const uploadResult = await FileSystem.uploadAsync(uploadUrl, uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `image/${ext}`,
          'x-upsert': 'true',
        },
      });
      if (uploadResult.status >= 400) throw new Error(`이미지 업로드 실패 (${uploadResult.status})`);
      const { data: fileList } = await supabase.storage.from('avatars').list(user.id, { search: `avatar.${ext}` });
      const storedFile = fileList?.find(f => f.name === `avatar.${ext}`);
      const storedSize = (storedFile?.metadata as any)?.size ?? 0;
      if (storedSize === 0) {
        await supabase.storage.from('avatars').remove([filePath]);
        throw new Error('이미지가 올바르게 업로드되지 않았습니다. 다른 사진을 선택해주세요.');
      }
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
      setEditProfile(p => ({ ...p, avatar_url: `${publicUrl}?t=${Date.now()}` }));
    } catch (e: any) {
      Alert.alert('업로드 실패', e?.message ?? '이미지 업로드에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function saveProfile() {
    if (!editProfile.name.trim()) { Alert.alert('오류', '이름을 입력해주세요.'); return; }
    setSavingProfile(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingProfile(false); return; }
    const { error } = await supabase.from('coach_profiles').upsert({
      coach_id: user.id, display_name: editProfile.name.trim(), avatar_url: editProfile.avatar_url || null,
      sport: editProfile.sport, region_city: editProfile.region_city.trim() || null,
      region_district: editProfile.region_district.trim() || null,
      center_name: editProfile.center_name.trim() || null,
      bio: editProfile.bio.trim() || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'coach_id' });
    setSavingProfile(false);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
    setProfile({ ...editProfile }); setProfileModal(false);
  }

  async function saveCareer() {
    setSavingCareer(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingCareer(false); return; }
    const { error } = await supabase.from('coach_profiles').upsert({
      coach_id: user.id,
      coaching_years: editCareer.coaching_years ? parseInt(editCareer.coaching_years, 10) : null,
      has_player_career: editCareer.has_player_career,
      career_details: editCareer.career_details.trim() || null,
      certifications: editCareer.certifications.trim() || null,
      awards: editCareer.awards.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'coach_id' });
    setSavingCareer(false);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
    setCareer({ ...editCareer }); setCareerModal(false);
  }

  const openProfileEdit = () => { setEditProfile({ ...profile }); setProfileModal(true); };
  const openCareerEdit = () => { setEditCareer({ ...career }); setCareerModal(true); };

  // Coach intro rows
  const introRows = [
    { label: '전문 종목', value: profile.sport },
    { label: '활동 지역', value: regionLabel },
    { label: '소속 센터', value: profile.center_name },
    { label: '코칭 경력', value: career.coaching_years ? `${career.coaching_years}년` : '' },
    { label: '선수 경력', value: career.has_player_career ? '있음' : '' },
    { label: '주요 경력', value: career.career_details },
    { label: '자격증', value: career.certifications },
    { label: '수상 / 대회', value: career.awards },
  ].filter(r => !!r.value);

  const hasMissingCareer = !career.certifications || !career.awards;

  return (
    <View style={styles.screen}>
      {/* 헤더 */}
      <View style={[styles.headerBar, { paddingTop: insets.top }]}>
        <Text style={styles.headerTitle}>프로필</Text>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/settings')}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={20} color={DARK} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadProfile(); setRefreshing(false); }}
            tintColor={TERRA}
          />
        }
      >
        <View style={styles.body}>

          {/* ── 브랜딩 카드 ── */}
          <View style={styles.brandCard}>
            <TouchableOpacity style={styles.brandEditBtn} onPress={openProfileEdit}>
              <Ionicons name="create-outline" size={17} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>

            {/* 스포트라이트 + 아바타 */}
            <View style={styles.brandAvatarWrap}>
              <View style={styles.spotlight} />
              <View style={styles.brandAvatar}>
                {profile.avatar_url ? (
                  <Image source={{ uri: profile.avatar_url }} style={styles.brandAvatarImg} />
                ) : (
                  <Text style={styles.brandAvatarText}>{initial}</Text>
                )}
              </View>
            </View>

            <Text style={styles.brandName}>{profile.name || '코치'} 코치</Text>
            {!!sportCenter && <Text style={styles.brandSub}>{sportCenter}</Text>}
            {!!regionLabel && <Text style={styles.brandRegion}>{regionLabel}</Text>}

            <View style={styles.kerriBadge}>
              <Ionicons name="shield-checkmark-outline" size={11} color={CREAM} />
              <Text style={styles.kerriBadgeText}>KERRI 검증</Text>
            </View>

            <TouchableOpacity
              style={styles.previewBtn}
              onPress={() => Alert.alert('내 프로필 미리보기', '회원에게 공개되는 코치 프로필입니다.\n(준비 중입니다)')}
              activeOpacity={0.75}
            >
              <Text style={styles.previewBtnText}>내 프로필 미리보기</Text>
              <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.75)" />
            </TouchableOpacity>
          </View>

          {/* ── 코칭 실적 ── */}
          <View style={styles.sectionCard}>
            <View style={styles.statsHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="bar-chart-outline" size={15} color={TERRA} />
                <Text style={styles.sectionTitle}>코칭 실적</Text>
              </View>
              {canUse('coaching_stats_public')
                ? <Text style={styles.verifiedBadge}>KERRI 검증 · 조작 불가</Text>
                : <View style={styles.blindBadge}><Text style={styles.blindBadgeText}>Pro 공개</Text></View>
              }
            </View>

            {!canUse('coaching_stats_public') && (
              <View style={styles.blindWrap}>
                <View style={[stat.grid, { opacity: 0.12 }]}>
                  <StatCell value="●●●회" label="누적 레슨" right />
                  <StatCell value="●●개월" label="평균 유지" />
                  <StatCell value="●.●" label="만족도" right bottom />
                  <StatCell value="●●개" label="레슨 리포트" bottom />
                </View>
                <View style={styles.blindOverlay}>
                  <View style={styles.blindIcon}>
                    <Ionicons name="lock-closed" size={20} color={TERRA} />
                  </View>
                  <Text style={styles.blindTitle}>Pro 공개 기능</Text>
                  <Text style={styles.blindDesc}>{"데이터는 지금도 쌓이고 있어요.\nPro로 업그레이드하면 내 코칭 실적이 공개됩니다."}</Text>
                  <TouchableOpacity style={styles.blindBtn} onPress={() => setUpsellVisible(true)}>
                    <Ionicons name="star" size={13} color="#fff" />
                    <Text style={styles.blindBtnText}>Pro로 공개하기</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {canUse('coaching_stats_public') && (
              <View style={stat.grid}>
                <StatCell
                  value={`${perf.totalLessons.toLocaleString()}회`}
                  label="누적 레슨"
                  sub="출석 체크 기준"
                  right
                />
                <StatCell
                  value={perf.avgRetentionMonths !== null ? `${perf.avgRetentionMonths}개월` : '-'}
                  label="평균 유지"
                  sub={perf.avgRetentionMonths !== null ? '이탈 회원 기준' : '데이터 쌓는 중'}
                />
                <StatCell
                  value={perf.satisfactionAvg !== null ? `${perf.satisfactionAvg}` : '-'}
                  label="만족도"
                  sub={perf.satisfactionCount > 0 ? `${perf.satisfactionCount}명 평가` : '아직 받은 리뷰가 없어요'}
                  right bottom
                />
                <StatCell
                  value={`${perf.totalReports}개`}
                  label="레슨 리포트"
                  sub="발송 완료 기준"
                  bottom
                />
              </View>
            )}
          </View>

          {/* ── 프로필 완성도 ── */}
          <View style={styles.completionCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.completionTitle}>프로필 완성도 {completionPct}%</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${completionPct}%` as any }]} />
              </View>
              <Text style={styles.completionTip}>{completionTip}</Text>
            </View>
            <TouchableOpacity onPress={openProfileEdit} style={styles.completionBtn}>
              <Text style={styles.completionBtnText}>완성하기 →</Text>
            </TouchableOpacity>
          </View>

          {/* ── 코치 소개 ── */}
          <View style={styles.sectionCard}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="person-outline" size={15} color={TERRA} />
                <Text style={styles.sectionTitle}>코치 소개</Text>
              </View>
              <TouchableOpacity
                onPress={introRows.length === 0 || !career.career_details ? openCareerEdit : openProfileEdit}
                style={styles.editChip}
              >
                <Ionicons name="pencil-outline" size={11} color={TERRA} />
                <Text style={styles.editChipText}>수정</Text>
              </TouchableOpacity>
            </View>

            {introRows.length === 0 ? (
              <TouchableOpacity onPress={openProfileEdit} style={styles.emptyIntro}>
                <Text style={styles.emptyIntroText}>프로필 정보를 입력해 보세요 →</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ gap: 0 }}>
                {introRows.map((row, i) => (
                  <View key={row.label} style={[styles.introRow, i < introRows.length - 1 && styles.introRowBorder]}>
                    <Text style={styles.introLabel}>{row.label}</Text>
                    <Text style={styles.introValue} numberOfLines={2}>{row.value}</Text>
                  </View>
                ))}
                {hasMissingCareer && (
                  <TouchableOpacity onPress={openCareerEdit} style={styles.introAddRow}>
                    <Text style={styles.introAddText}>자격증 및 수상 추가하기 →</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* ── AI 코칭 모델 ── */}
          <TouchableOpacity
            style={styles.aiCard}
            onPress={() => {
              if (!canUse('ai_analysis')) { setUpsellVisible(true); return; }
              setKnowledgeModal(true);
            }}
            activeOpacity={0.8}
          >
            <View style={styles.aiLeft}>
              <View style={styles.aiIconWrap}>
                <Ionicons name="analytics-outline" size={22} color={TERRA} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiTitle}>나의 AI 코칭 모델</Text>
                <Text style={styles.aiSub}>코칭 스타일 {knowledgeCount}개 학습 중</Text>
                <Text style={[styles.aiVoice, voiceExceeded && { color: Colors.destructive }]}>
                  {voiceExceeded ? '음성 한도 초과' : `음성 학습 ${voiceRemainMin}분 남음`}
                </Text>
              </View>
            </View>
            <Text style={styles.aiArrow}>관리하기 →</Text>
          </TouchableOpacity>

          {/* ── 구독 + QR ── */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/subscription/manage')}
              activeOpacity={0.8}
            >
              <Ionicons name="card-outline" size={22} color={TERRA} style={{ marginBottom: 8 }} />
              <Text style={styles.actionTitle}>{planLabel ? `${planLabel} 플랜` : '구독'}</Text>
              {statusLabel ? <Text style={styles.actionSub}>{statusLabel}</Text> : null}
              <Text style={styles.actionArrow}>구독 관리 →</Text>
            </TouchableOpacity>

            {coachId ? (
              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => setQrModalVisible(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="qr-code-outline" size={22} color={TERRA} style={{ marginBottom: 8 }} />
                <Text style={styles.actionTitle}>내 초대 QR</Text>
                <Text style={styles.actionSub}>회원을 초대해보세요</Text>
                <Text style={styles.actionArrow}>QR 보기 →</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.actionCard, { opacity: 0.4 }]}>
                <Ionicons name="qr-code-outline" size={22} color={TERRA} style={{ marginBottom: 8 }} />
                <Text style={styles.actionTitle}>내 초대 QR</Text>
              </View>
            )}
          </View>

          <View style={{ height: 80 }} />
        </View>
      </ScrollView>

      {/* ── 모달: 기본 프로필 ── */}
      <Modal visible={profileModal} transparent animationType="slide" onRequestClose={() => setProfileModal(false)}>
        <View style={styles.overlay}>
          <ScrollView style={{ maxHeight: '92%' }} keyboardShouldPersistTaps="handled">
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>기본 프로필</Text>
              <View style={styles.avatarEditWrap}>
                <TouchableOpacity style={styles.avatarEditBtn} onPress={handlePickAvatar} disabled={uploadingAvatar}>
                  {uploadingAvatar ? <ActivityIndicator color={TERRA} />
                    : editProfile.avatar_url ? <Image source={{ uri: editProfile.avatar_url }} style={styles.avatarEditImg} />
                    : <Ionicons name="camera-outline" size={28} color={TERRA} />}
                  <View style={styles.avatarEditOverlay}>
                    <Ionicons name="camera" size={12} color="#fff" />
                    <Text style={styles.avatarEditOverlayTxt}>사진 변경</Text>
                  </View>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalLabel}>코치 이름 *</Text>
              <TextInput style={styles.input} value={editProfile.name} onChangeText={v => setEditProfile(p => ({ ...p, name: v }))} placeholder="코치 이름" placeholderTextColor={Colors.placeholder} />
              <Text style={styles.modalLabel}>종목 *</Text>
              <TouchableOpacity style={styles.picker} onPress={() => setSportPickerOpen(o => !o)}>
                <Text style={styles.pickerTxt}>{editProfile.sport || '종목 선택'}</Text>
                <Ionicons name={sportPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.mutedFg} />
              </TouchableOpacity>
              {sportPickerOpen && (
                <View style={styles.pickerList}>
                  {SPORTS.map(s => (
                    <TouchableOpacity key={s} style={[styles.pickerOption, editProfile.sport === s && styles.pickerOptionSel]} onPress={() => { setEditProfile(p => ({ ...p, sport: s })); setSportPickerOpen(false); }}>
                      <Text style={[styles.pickerOptionTxt, editProfile.sport === s && { color: TERRA, fontWeight: '700' }]}>{s}</Text>
                      {editProfile.sport === s && <Ionicons name="checkmark" size={14} color={TERRA} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={styles.modalLabel}>활동 지역</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput style={[styles.input, { flex: 1 }]} value={editProfile.region_city} onChangeText={v => setEditProfile(p => ({ ...p, region_city: v }))} placeholder="시 (예: 서울)" placeholderTextColor={Colors.placeholder} />
                <TextInput style={[styles.input, { flex: 1 }]} value={editProfile.region_district} onChangeText={v => setEditProfile(p => ({ ...p, region_district: v }))} placeholder="구 (예: 강남구)" placeholderTextColor={Colors.placeholder} />
              </View>
              <Text style={styles.modalLabel}>소속 센터</Text>
              <TextInput style={styles.input} value={editProfile.center_name} onChangeText={v => setEditProfile(p => ({ ...p, center_name: v }))} placeholder="센터 또는 클럽명" placeholderTextColor={Colors.placeholder} />
              <Text style={styles.modalLabel}>한 줄 소개</Text>
              <TextInput style={[styles.input, { minHeight: 60, textAlignVertical: 'top', paddingTop: 12 }]} value={editProfile.bio} onChangeText={v => setEditProfile(p => ({ ...p, bio: v }))} placeholder="나를 한 문장으로 소개해보세요" placeholderTextColor={Colors.placeholder} multiline maxLength={80} />
              <Text style={styles.charCount}>{editProfile.bio.length}/80</Text>
              <SaveBtn onPress={saveProfile} loading={savingProfile} />
              <CancelBtn onPress={() => setProfileModal(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── 모달: 경력 정보 ── */}
      <Modal visible={careerModal} transparent animationType="slide" onRequestClose={() => setCareerModal(false)}>
        <View style={styles.overlay}>
          <ScrollView style={{ maxHeight: '92%' }} keyboardShouldPersistTaps="handled">
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>경력 정보</Text>
              <Text style={styles.modalLabel}>코칭 경력 (연수)</Text>
              <TextInput style={styles.input} value={editCareer.coaching_years} onChangeText={v => setEditCareer(c => ({ ...c, coaching_years: v.replace(/[^0-9]/g, '') }))} placeholder="예: 7" placeholderTextColor={Colors.placeholder} keyboardType="numeric" maxLength={2} />
              <Text style={styles.modalLabel}>선수 경력</Text>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{editCareer.has_player_career ? '있음' : '없음'}</Text>
                <Switch value={editCareer.has_player_career} onValueChange={v => setEditCareer(c => ({ ...c, has_player_career: v }))} trackColor={{ false: Colors.border, true: TERRA }} thumbColor="#fff" />
              </View>
              <Text style={styles.modalLabel}>주요 경력</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={editCareer.career_details} onChangeText={v => setEditCareer(c => ({ ...c, career_details: v }))} placeholder={'예: 전 대학 선수\n○○테니스아카데미 수석코치'} placeholderTextColor={Colors.placeholder} multiline />
              <Text style={styles.modalLabel}>자격증</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={editCareer.certifications} onChangeText={v => setEditCareer(c => ({ ...c, certifications: v }))} placeholder={'예: 생활체육지도자 2급\nKTA 공인 코치'} placeholderTextColor={Colors.placeholder} multiline />
              <Text style={styles.modalLabel}>수상 / 대회 경력</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={editCareer.awards} onChangeText={v => setEditCareer(c => ({ ...c, awards: v }))} placeholder={'예: 2023 전국 동호인 대회 우승'} placeholderTextColor={Colors.placeholder} multiline />
              <SaveBtn onPress={saveCareer} loading={savingCareer} />
              <CancelBtn onPress={() => setCareerModal(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── AI 코칭 모델 관리 모달 ── */}
      <Modal visible={knowledgeModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setKnowledgeModal(false)}>
        <View style={styles.knowledgeModalCont}>
          <View style={styles.knowledgeModalHead}>
            <Text style={styles.modalTitle}>코칭 스타일 관리</Text>
            <TouchableOpacity onPress={() => setKnowledgeModal(false)}>
              <Ionicons name="close" size={24} color={Colors.foreground} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
            <Text style={styles.modalLabel}>카테고리</Text>
            <View style={styles.categoryRow}>
              {['포핸드','백핸드','서브','전술','멘탈','기타'].map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryBtn, knowledgeCategory === cat && styles.categoryBtnActive]}
                  onPress={() => setKnowledgeCategory(cat)}
                >
                  <Text style={[styles.categoryBtnText, knowledgeCategory === cat && styles.categoryBtnTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.uploadBtn, isRecording && styles.uploadBtnRecording]}
              onPress={async () => {
                if (!isRecording) {
                  try {
                    const status = await AudioModule.requestRecordingPermissionsAsync();
                    if (!status.granted) { Alert.alert('오류', '녹음을 시작할 수 없어요.'); return; }
                    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
                    await audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
                    audioRecorder.record();
                    setVoiceRecordingDuration(0);
                    voiceTimerRef.current = setInterval(() => setVoiceRecordingDuration(d => d + 1), 1000);
                    setIsRecording(true);
                  } catch { Alert.alert('오류', '녹음을 시작할 수 없어요.'); }
                } else {
                  setKnowledgeUploading(true);
                  if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
                  const durationSeconds = voiceRecordingDuration;
                  setIsRecording(false);
                  await audioRecorder.stop();
                  const uri = audioRecorder.uri;
                  if (uri) {
                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      const { data: { session } } = await supabase.auth.getSession();
                      const form = new FormData();
                      form.append('coach_id', user!.id);
                      form.append('category', knowledgeCategory);
                      form.append('duration_seconds', String(durationSeconds));
                      form.append('audio', { uri, type: 'audio/m4a', name: 'recording.m4a' } as any);
                      const res = await fetch(`${SUPABASE_URL}/functions/v1/add-coach-knowledge`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${session?.access_token}` },
                        body: form,
                      });
                      const result = await res.json();
                      if (result.success) {
                        Alert.alert('완료', `${result.saved}개 항목이 등록됐어요!`);
                        setKnowledgeModal(false);
                        setKnowledgeCount(prev => prev + result.saved);
                        setVoiceUsedSeconds(prev => prev + durationSeconds);
                      } else {
                        Alert.alert('오류', result.error || '등록 실패');
                      }
                    } catch { Alert.alert('오류', '업로드 실패'); }
                  }
                  setKnowledgeUploading(false);
                }
              }}
              disabled={knowledgeUploading}
            >
              {knowledgeUploading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name={isRecording ? "stop-circle" : "mic"} size={22} color="#fff" />
                  <Text style={styles.uploadBtnText}>{isRecording ? '녹음 중... 탭하면 완료' : '음성으로 코칭 스타일 녹음'}</Text>
                </>
              )}
            </TouchableOpacity>

            <View>
              <Text style={styles.modalLabel}>텍스트로 직접 입력</Text>
              <TextInput
                style={styles.knowledgeTextInput}
                placeholder="코칭 철학, 훈련 방법, 기술 포인트 등 자유롭게 입력하세요"
                placeholderTextColor={Colors.mutedFg}
                multiline
                numberOfLines={5}
                value={knowledgeText}
                onChangeText={setKnowledgeText}
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.uploadBtn, { backgroundColor: '#059669', marginTop: 8 }, (!knowledgeText.trim() || knowledgeUploading) && { opacity: 0.5 }]}
                disabled={!knowledgeText.trim() || knowledgeUploading}
                onPress={async () => {
                  setKnowledgeUploading(true);
                  try {
                    const { data: { user } } = await supabase.auth.getUser();
                    const { data: { session } } = await supabase.auth.getSession();
                    const res = await fetch(`${SUPABASE_URL}/functions/v1/add-coach-knowledge`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ coach_id: user!.id, category: knowledgeCategory, text: knowledgeText }),
                    });
                    const result = await res.json();
                    if (result.success) {
                      Alert.alert('완료', `${result.saved}개 항목이 등록됐어요!`);
                      setKnowledgeText('');
                      setKnowledgeModal(false);
                      setKnowledgeCount(prev => prev + result.saved);
                    } else {
                      Alert.alert('오류', result.error || '등록 실패');
                    }
                  } catch { Alert.alert('오류', '텍스트 등록 실패'); }
                  setKnowledgeUploading(false);
                }}
              >
                {knowledgeUploading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={22} color="#fff" />
                    <Text style={styles.uploadBtnText}>텍스트로 등록</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.uploadBtn, { backgroundColor: '#6366F1' }, knowledgeFileUploading && { opacity: 0.6 }]}
              disabled={knowledgeFileUploading}
              onPress={async () => {
                try {
                  const result = await DocumentPicker.getDocumentAsync({ type: 'text/plain', copyToCacheDirectory: true });
                  if (result.canceled || !result.assets?.[0]) return;
                  const file = result.assets[0];
                  setKnowledgeFileUploading(true);
                  const { data: { user } } = await supabase.auth.getUser();
                  const { data: { session } } = await supabase.auth.getSession();
                  const form = new FormData();
                  form.append('coach_id', user!.id);
                  form.append('category', knowledgeCategory);
                  form.append('file', { uri: file.uri, type: 'text/plain', name: file.name } as any);
                  const res = await fetch(`${SUPABASE_URL}/functions/v1/add-coach-knowledge`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${session?.access_token}` },
                    body: form,
                  });
                  const json = await res.json();
                  if (json.success) {
                    Alert.alert('완료', `${json.saved}개 항목이 등록됐어요!`);
                    setKnowledgeModal(false);
                    setKnowledgeCount(prev => prev + json.saved);
                  } else {
                    Alert.alert('오류', json.error || '파일 등록 실패');
                  }
                } catch { Alert.alert('오류', '파일 업로드 실패'); }
                setKnowledgeFileUploading(false);
              }}
            >
              {knowledgeFileUploading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="document-text" size={22} color="#fff" />
                  <Text style={styles.uploadBtnText}>텍스트 파일(.txt) 업로드</Text>
                </>
              )}
            </TouchableOpacity>

            {knowledgeList.length > 0 && (
              <View>
                <Text style={styles.modalLabel}>등록된 코칭 스타일</Text>
                {knowledgeList.map(k => (
                  <View key={k.id} style={styles.knowledgeItem}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.knowledgeItemCategory}>{k.category}</Text>
                      <Text style={styles.knowledgeItemTitle} numberOfLines={1}>{k.title}</Text>
                    </View>
                    <TouchableOpacity onPress={async () => {
                      Alert.alert('삭제', `"${k.title}" 삭제할까요?`, [
                        { text: '취소', style: 'cancel' },
                        { text: '삭제', style: 'destructive', onPress: async () => {
                          await supabase.from('tennis_knowledge').delete().eq('id', k.id);
                          setKnowledgeList(prev => prev.filter(x => x.id !== k.id));
                          setKnowledgeCount(prev => prev - 1);
                        }},
                      ]);
                    }}>
                      <Ionicons name="trash-outline" size={16} color={Colors.mutedFg} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      <PlanUpsellModal
        visible={upsellVisible}
        onClose={() => setUpsellVisible(false)}
        context={canUse('coaching_stats_collect') ? 'coaching_stats_public' : 'generic_pro'}
        currentPlanId={subscription?.plan_id ?? 'free'}
      />

      {coachId ? (
        <CoachQRModal
          visible={qrModalVisible}
          onClose={() => setQrModalVisible(false)}
          coachId={coachId}
          coachName={profile.name}
        />
      ) : null}
    </View>
  );
}

const stat = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: '50%',
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  cellRight: {
    borderRightWidth: 1,
    borderRightColor: Colors.borderLight,
  },
  cellBottom: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  value: { fontSize: 22, fontWeight: '800', color: DARK, marginBottom: 3 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, textAlign: 'center' },
  sub: { fontSize: 10, color: Colors.placeholder, marginTop: 2, textAlign: 'center' },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },

  // Header
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: CREAM,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: DARK },
  settingsBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'center', alignItems: 'center',
  },

  body: { paddingHorizontal: 16, paddingBottom: 20 },

  // Branding card
  brandCard: {
    backgroundColor: TERRA,
    borderRadius: 22,
    padding: 24,
    marginBottom: 14,
    alignItems: 'center',
    overflow: 'hidden',
  },
  brandEditBtn: {
    position: 'absolute', top: 16, right: 16,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  brandAvatarWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 14, marginTop: 8 },
  spotlight: {
    position: 'absolute',
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  brandAvatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
  },
  brandAvatarImg: { width: 80, height: 80, borderRadius: 40 },
  brandAvatarText: { fontSize: 32, fontWeight: '800', color: '#fff' },
  brandName: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 4 },
  brandSub: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: '500', marginBottom: 2 },
  brandRegion: { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginBottom: 12 },
  kerriBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    marginBottom: 14,
  },
  kerriBadgeText: { fontSize: 11, fontWeight: '700', color: CREAM },
  previewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  },
  previewBtnText: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },

  // Section cards
  sectionCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 18,
    marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  statsHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 4,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: DARK },
  verifiedBadge: { fontSize: 10, color: Colors.mutedFg, fontWeight: '600' },
  blindBadge: {
    backgroundColor: TERRA_LIGHT, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  blindBadgeText: { fontSize: 10, fontWeight: '700', color: TERRA },
  blindWrap: { position: 'relative', marginTop: 8 },
  blindOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 12, justifyContent: 'center', alignItems: 'center',
    paddingVertical: 20, gap: 8,
  },
  blindIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: TERRA_LIGHT,
    justifyContent: 'center', alignItems: 'center', marginBottom: 2,
  },
  blindTitle: { fontSize: 15, fontWeight: '800', color: TERRA },
  blindDesc: { fontSize: 12, color: '#888', textAlign: 'center', lineHeight: 18, paddingHorizontal: 16 },
  blindBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: TERRA, borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 9, marginTop: 4,
  },
  blindBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Completion card
  completionCard: {
    backgroundColor: '#fff', borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  completionTitle: { fontSize: 14, fontWeight: '700', color: DARK, marginBottom: 8 },
  progressTrack: {
    height: 5, backgroundColor: Colors.borderLight,
    borderRadius: 3, overflow: 'hidden', marginBottom: 6,
  },
  progressFill: { height: 5, backgroundColor: TERRA, borderRadius: 3 },
  completionTip: { fontSize: 12, color: Colors.mutedFg },
  completionBtn: {
    backgroundColor: TERRA_LIGHT, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  completionBtnText: { fontSize: 12, fontWeight: '700', color: TERRA, textAlign: 'center' },

  // Intro card
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 14,
  },
  editChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: TERRA_LIGHT, borderRadius: 8,
    paddingHorizontal: 9, paddingVertical: 5,
  },
  editChipText: { fontSize: 12, fontWeight: '700', color: TERRA },
  introRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  introRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  introLabel: { width: 74, fontSize: 13, color: Colors.mutedFg, fontWeight: '500' },
  introValue: { flex: 1, fontSize: 14, color: DARK, fontWeight: '500', lineHeight: 20 },
  introAddRow: { paddingTop: 12 },
  introAddText: { fontSize: 13, color: TERRA, fontWeight: '600' },
  emptyIntro: { paddingVertical: 8 },
  emptyIntroText: { fontSize: 14, color: TERRA, fontWeight: '600' },

  // AI card
  aiCard: {
    backgroundColor: TERRA_LIGHT,
    borderRadius: 20, padding: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
    borderWidth: 1, borderColor: `${TERRA}30`,
  },
  aiLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  aiIconWrap: {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  aiTitle: { fontSize: 15, fontWeight: '700', color: DARK, marginBottom: 2 },
  aiSub: { fontSize: 13, color: Colors.mutedFg, marginBottom: 1 },
  aiVoice: { fontSize: 12, color: TERRA, fontWeight: '600' },
  aiArrow: { fontSize: 12, color: TERRA, fontWeight: '700' },

  // Action row (Subscription + QR)
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  actionCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 20, padding: 18,
    alignItems: 'flex-start',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  actionTitle: { fontSize: 15, fontWeight: '700', color: DARK, marginBottom: 3 },
  actionSub: { fontSize: 12, color: Colors.mutedFg, marginBottom: 8 },
  actionArrow: { fontSize: 12, color: TERRA, fontWeight: '700', marginTop: 4 },

  // Modals
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48 },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: DARK, marginBottom: 16 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: Colors.mutedBg, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.foreground,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 4,
  },
  multilineInput: { minHeight: 72, textAlignVertical: 'top', paddingTop: 12 },
  charCount: { fontSize: 11, color: Colors.placeholder, textAlign: 'right', marginBottom: 8 },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.mutedBg, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 4,
  },
  pickerTxt: { fontSize: 15, color: Colors.foreground },
  pickerList: { backgroundColor: '#fff', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginBottom: 8 },
  pickerOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  pickerOptionSel: { backgroundColor: `${TERRA}08` },
  pickerOptionTxt: { fontSize: 15, color: Colors.foreground },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.mutedBg, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 4,
  },
  switchLabel: { fontSize: 15, color: Colors.foreground, fontWeight: '600' },
  saveBtn: {
    backgroundColor: TERRA, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8,
  },
  saveBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelBtnTxt: { fontSize: 15, color: Colors.mutedFg, fontWeight: '600' },
  avatarEditWrap: { alignItems: 'center', marginBottom: 8 },
  avatarEditBtn: {
    width: 88, height: 88, borderRadius: 44, overflow: 'hidden',
    backgroundColor: `${TERRA}12`,
    justifyContent: 'center', alignItems: 'center', position: 'relative',
  },
  avatarEditImg: { width: 88, height: 88, borderRadius: 44 },
  avatarEditOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,.4)', paddingVertical: 5,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 3,
  },
  avatarEditOverlayTxt: { fontSize: 10, color: '#fff', fontWeight: '600' },

  // Knowledge modal
  knowledgeModalCont: { flex: 1, backgroundColor: Colors.background },
  knowledgeModalHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#fff' },
  categoryBtnActive: { backgroundColor: TERRA, borderColor: TERRA },
  categoryBtnText: { fontSize: 13, color: Colors.mutedFg },
  categoryBtnTextActive: { color: '#fff', fontWeight: '700' },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: TERRA, borderRadius: 12, padding: 16 },
  uploadBtnRecording: { backgroundColor: Colors.destructive },
  uploadBtnText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  knowledgeTextInput: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontSize: 14, color: Colors.foreground, minHeight: 120, backgroundColor: '#FAFAFA' },
  knowledgeItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  knowledgeItemCategory: { fontSize: 11, color: TERRA, backgroundColor: TERRA_LIGHT, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontWeight: '600' },
  knowledgeItemTitle: { fontSize: 13, color: Colors.foreground, flex: 1 },
});
