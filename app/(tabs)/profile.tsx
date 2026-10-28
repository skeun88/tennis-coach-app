import { useState, useCallback, useRef, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Modal, TextInput, ActivityIndicator,
  Image, Switch, Pressable, Platform, KeyboardAvoidingView, Animated,
} from 'react-native';
import SkeletonBox from '../../components/SkeletonBox';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import PlanUpsellModal from '../../components/PlanUpsellModal';
import { supabase } from '../../lib/supabase';
import { useSubscription } from '../../hooks/useSubscription';
import { Colors, Radius, Shadow } from '../../lib/theme';
import CoachQRModal from '../../components/CoachQRModal';
import CoachingStyleModal from '../../components/CoachingStyleModal';
import { FEATURE_SHARED_QR } from '../../lib/featureFlags';
import TerracottaRefreshControl from '../../components/TerracottaRefreshControl';
import { FLOATING_TAB_BAR_SPACE } from '../../components/GlassTabBar';
import SettingsHeader from '../../components/SettingsHeader';

type JourneyPopupKey = 'members' | 'lessons' | 'reports' | 'reviews' | 'duration';

const JOURNEY_INFO: Record<JourneyPopupKey, {
  icon: string; title: string; desc: string; badge: string;
}> = {
  members:  { icon: 'people-outline',            title: '함께한 회원',       desc: 'KERRI에서 코치님이 지금까지 등록한 누적 회원 수예요.',       badge: '전체 회원 등록 기준' },
  lessons:  { icon: 'calendar-outline',          title: '진행한 레슨',       desc: '출석 처리가 완료된 레슨이 차곡차곡 쌓여요.',                 badge: '출석 완료 기준' },
  reports:  { icon: 'document-text-outline',     title: '남긴 레슨 기록',    desc: '코치님이 회원의 성장을 위해 남긴 레슨 기록이에요.',           badge: '기록 작성 기준' },
  reviews:  { icon: 'heart-outline',              title: '받은 회원 후기',   desc: '회원이 남긴 소중한 후기가 이곳에 쌓일 예정이에요.',           badge: '후기 기능 준비 중' },
  duration: { icon: 'flame-outline',             title: 'KERRI와 함께한 시간', desc: '코치님이 KERRI와 함께 코칭을 기록해온 시간이에요.',         badge: 'KERRI 프로필 생성일 기준' },
};

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SPORTS = ['테니스', '배드민턴', '스쿼시', '탁구', '골프', '기타'];

const TERRA = '#C0755A';
const CREAM = '#F7F0E9';
const TERRA_LIGHT = '#FBF2EF';
const DARK = '#3E2B22';

const PC_PHOTO_SIZE = 72;

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

type EditData = ProfileInfo & CareerInfo;

function StatCell({ value, label, sub, right, bottom, onPress }: {
  value: string; label: string; sub?: string; right?: boolean; bottom?: boolean; onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={[stat.cell, right && stat.cellRight, bottom && stat.cellBottom]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
      accessibilityLabel={`${label} ${value} 상세 설명 보기`}
    >
      <Text style={stat.value}>{value}</Text>
      <Text style={stat.label}>{label}</Text>
      {sub ? <Text style={stat.sub}>{sub}</Text> : null}
    </TouchableOpacity>
  );
}

const EMPTY_PROFILE: ProfileInfo = {
  name: '', avatar_url: '', sport: '테니스',
  region_city: '', region_district: '', center_name: '', bio: '',
};
const EMPTY_CAREER: CareerInfo = {
  coaching_years: '', has_player_career: false,
  career_details: '', certifications: '', awards: '',
};

export default function ProfileScreen() {
  const { subscription, isActive, isTrial, trialEndsAt, canUse } = useSubscription();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [knowledgeList, setKnowledgeList] = useState<any[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [knowledgeModal, setKnowledgeModal] = useState(false);
  const [upsellVisible, setUpsellVisible] = useState(false);
  const [voiceUsedSeconds, setVoiceUsedSeconds] = useState(0);
  const VOICE_MONTHLY_LIMIT = 1800;


  const [coachId, setCoachId] = useState<string | null>(null);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const contentOpacity = useRef(new Animated.Value(0)).current;

  const [perf, setPerf] = useState<Performance>({
    totalLessons: 0, avgRetentionMonths: null,
    satisfactionAvg: null, satisfactionCount: 0, totalReports: 0,
  });
  const [membersCount, setMembersCount] = useState(0);
  const [joinedMonths, setJoinedMonths] = useState<number | null>(null);
  const [journeyPopup, setJourneyPopup] = useState<JourneyPopupKey | null>(null);
  const [journeyPublic, setJourneyPublic] = useState(false);
  const [journeyVisibilityModal, setJourneyVisibilityModal] = useState(false);
  const [journeyVisibilityDraft, setJourneyVisibilityDraft] = useState(false);
  const [savingJourneyVisibility, setSavingJourneyVisibility] = useState(false);

  const [profile, setProfile] = useState<ProfileInfo>(EMPTY_PROFILE);
  const [career, setCareer] = useState<CareerInfo>(EMPTY_CAREER);

  // 통합 편집 모달 state
  const [editModal, setEditModal] = useState(false);
  const [editScrollTarget, setEditScrollTarget] = useState<'profile' | 'career'>('profile');
  const [editData, setEditData] = useState<EditData>({ ...EMPTY_PROFILE, ...EMPTY_CAREER });
  const [isSaving, setIsSaving] = useState(false);
  const [sportPickerOpen, setSportPickerOpen] = useState(false);
  const editScrollRef = useRef<ScrollView>(null);
  const careerSectionY = useRef(0);

  const isDirty = editModal && (
    editData.name !== profile.name ||
    editData.avatar_url !== profile.avatar_url ||
    editData.sport !== profile.sport ||
    editData.region_city !== profile.region_city ||
    editData.region_district !== profile.region_district ||
    editData.center_name !== profile.center_name ||
    editData.bio !== profile.bio ||
    editData.coaching_years !== career.coaching_years ||
    editData.has_player_career !== career.has_player_career ||
    editData.career_details !== career.career_details ||
    editData.certifications !== career.certifications ||
    editData.awards !== career.awards
  );

  useEffect(() => {
    if (initialLoaded) {
      Animated.timing(contentOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [initialLoaded]);

  useEffect(() => {
    if (editModal && editScrollTarget === 'career') {
      const timer = setTimeout(() => {
        editScrollRef.current?.scrollTo({ y: careerSectionY.current, animated: true });
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [editModal, editScrollTarget]);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCoachId(user.id);

    const [allLessonsRes, plansRes, profileRes, membersRes] = await Promise.all([
      supabase.from('lessons').select('id, date').eq('coach_id', user.id),
      supabase.from('lesson_plans').select('*', { count: 'exact', head: true }).eq('coach_id', user.id),
      supabase.from('coach_profiles').select('*').eq('coach_id', user.id).maybeSingle(),
      supabase.from('members').select('id', { count: 'exact', head: true }).eq('coach_id', user.id),
    ]);
    setMembersCount(membersRes.count ?? 0);
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
    if (p?.created_at) {
      const created = new Date(p.created_at);
      const now = new Date();
      const months = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
      setJoinedMonths(Math.max(0, months));
    }
    setJourneyPublic(p?.show_coaching_journey ?? false);
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
    setInitialLoaded(true);
  }

  useFocusEffect(useCallback(() => { loadProfile(); }, []));

  const initial = (profile.name || '코').slice(0, 1).toUpperCase();
  const regionLabel = [profile.region_city, profile.region_district].filter(Boolean).join(' ');

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

  // 경력·자격 카드용 rows (종목·지역·센터 제외, 실제 데이터만)
  const careerRows = [
    { label: '코칭 경력', value: career.coaching_years ? `${career.coaching_years}년` : '' },
    { label: '선수 경력', value: career.has_player_career ? '있음' : '' },
    { label: '주요 경력', value: career.career_details },
    { label: '자격증', value: career.certifications },
    { label: '수상·대회', value: career.awards },
  ].filter(r => !!r.value);

  async function handlePickAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요합니다.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const uri = asset.uri;
    setUploadingAvatar(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const mimeType = asset.mimeType ?? 'image/jpeg';
      const ext = (mimeType.split('/')[1]?.toLowerCase() ?? 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
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
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
      });
      if (uploadResult.status >= 400) {
        throw new Error(`Storage 업로드 실패 (HTTP ${uploadResult.status})`);
      }

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const urlWithBust = `${publicUrl}?t=${Date.now()}`;
      setEditData(p => ({ ...p, avatar_url: urlWithBust }));
    } catch (e: any) {
      Alert.alert('오류', '프로필 사진을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function saveAll() {
    if (!editData.name.trim()) { Alert.alert('오류', '이름을 입력해주세요.'); return; }
    setIsSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setIsSaving(false); return; }
    const { error } = await supabase.from('coach_profiles').upsert({
      coach_id: user.id,
      display_name: editData.name.trim(),
      avatar_url: editData.avatar_url || null,
      sport: editData.sport,
      region_city: editData.region_city.trim() || null,
      region_district: editData.region_district.trim() || null,
      center_name: editData.center_name.trim() || null,
      bio: editData.bio.trim() || null,
      coaching_years: editData.coaching_years ? parseInt(editData.coaching_years, 10) : null,
      has_player_career: editData.has_player_career,
      career_details: editData.career_details.trim() || null,
      certifications: editData.certifications.trim() || null,
      awards: editData.awards.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'coach_id' });
    setIsSaving(false);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
    setProfile({
      name: editData.name,
      avatar_url: editData.avatar_url,
      sport: editData.sport,
      region_city: editData.region_city,
      region_district: editData.region_district,
      center_name: editData.center_name,
      bio: editData.bio,
    });
    setCareer({
      coaching_years: editData.coaching_years,
      has_player_career: editData.has_player_career,
      career_details: editData.career_details,
      certifications: editData.certifications,
      awards: editData.awards,
    });
    setEditModal(false);
  }

  function openEditModal(target: 'profile' | 'career') {
    setEditData({ ...profile, ...career });
    setEditScrollTarget(target);
    setSportPickerOpen(false);
    setEditModal(true);
  }

  function handleEditBack() {
    if (isDirty) {
      Alert.alert(
        '저장하지 않은 변경사항이 있어요',
        '나가면 변경사항이 사라져요.',
        [
          { text: '계속 편집', style: 'cancel' },
          { text: '나가기', style: 'destructive', onPress: () => setEditModal(false) },
        ]
      );
    } else {
      setEditModal(false);
    }
  }

  function openJourneyVisibility() {
    setJourneyVisibilityDraft(journeyPublic);
    setJourneyVisibilityModal(true);
  }

  async function saveJourneyVisibility(newValue: boolean) {
    setSavingJourneyVisibility(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingJourneyVisibility(false); return; }
    const snapshot = newValue
      ? { members_count: membersCount, lessons_count: perf.totalLessons, reports_count: perf.totalReports }
      : null;
    const { error } = await supabase.from('coach_profiles').upsert(
      { coach_id: user.id, show_coaching_journey: newValue, journey_snapshot: snapshot, updated_at: new Date().toISOString() },
      { onConflict: 'coach_id' }
    );
    setSavingJourneyVisibility(false);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
    setJourneyPublic(newValue);
    setJourneyVisibilityModal(false);
  }

  return (
    <Animated.View style={[styles.screen, { opacity: contentOpacity }]}>
      {/* 헤더 */}
      <View style={[styles.headerBar, { paddingTop: insets.top }]}>
        <Text style={styles.headerTitle}>마이</Text>
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
          <TerracottaRefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadProfile(); setRefreshing(false); }}
          />
        }
      >
        <View style={[styles.body, { paddingBottom: insets.bottom + FLOATING_TAB_BAR_SPACE + 24 }]}>

          {/* ── 스켈레톤 (최초 로딩 전) ── */}
          {!initialLoaded && (
            <>
              {/* 프로필 카드 스켈레톤 */}
              <View style={styles.profileCard}>
                <View style={{ flexDirection: 'row', padding: 18, gap: 14, alignItems: 'center' }}>
                  <SkeletonBox width={PC_PHOTO_SIZE} height={PC_PHOTO_SIZE} borderRadius={PC_PHOTO_SIZE / 2} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <SkeletonBox width={120} height={16} borderRadius={6} />
                    <SkeletonBox width={90} height={13} borderRadius={5} />
                    <SkeletonBox width={70} height={12} borderRadius={5} />
                  </View>
                </View>
                <View style={{ paddingHorizontal: 18, paddingBottom: 16, gap: 10 }}>
                  <SkeletonBox width="85%" height={13} borderRadius={6} />
                  <SkeletonBox width="100%" height={44} borderRadius={12} />
                </View>
              </View>
              {/* 나의 코칭 여정 카드 스켈레톤 */}
              <View style={styles.sectionCard}>
                <SkeletonBox width={100} height={16} borderRadius={6} style={{ marginBottom: 16 }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {[0,1,2,3].map(i => (
                    <View key={i} style={{ width: '50%', paddingVertical: 18, paddingHorizontal: 16, alignItems: 'center', gap: 6 }}>
                      <SkeletonBox width={60} height={22} borderRadius={6} />
                      <SkeletonBox width={50} height={12} borderRadius={4} />
                    </View>
                  ))}
                </View>
              </View>
              {/* 경력·자격 카드 스켈레톤 */}
              <View style={styles.sectionCard}>
                <SkeletonBox width={80} height={16} borderRadius={6} style={{ marginBottom: 16 }} />
                {[0,1,2].map(i => (
                  <View key={i} style={{ flexDirection: 'row', paddingVertical: 10, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: '#F0EAE4' }}>
                    <SkeletonBox width={60} height={13} borderRadius={4} style={{ marginRight: 12 }} />
                    <SkeletonBox width="55%" height={13} borderRadius={4} />
                  </View>
                ))}
              </View>
              {/* QR 카드 스켈레톤 */}
              <View style={[styles.aiCard, { gap: 0 }]}>
                <View style={styles.aiLeft}>
                  <SkeletonBox width={46} height={46} borderRadius={13} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <SkeletonBox width={90} height={15} borderRadius={6} />
                    <SkeletonBox width={120} height={12} borderRadius={4} />
                  </View>
                </View>
                <SkeletonBox width={50} height={12} borderRadius={4} />
              </View>
            </>
          )}

          {/* ── 실제 콘텐츠 (최초 로딩 후) ── */}
          {initialLoaded && <>

          {/* ── 코치 프로필 카드 (흰색 카드) ── */}
          <View style={styles.profileCard}>
            {/* 사진 + 기본정보 행 */}
            <View style={styles.pcRow}>
              {/* 왼쪽: 원형 프로필 사진 */}
              <View style={styles.pcAvatarWrap}>
                {profile.avatar_url ? (
                  <Image source={{ uri: profile.avatar_url }} style={styles.pcAvatarImg} />
                ) : (
                  <Text style={styles.pcAvatarInitial}>{initial}</Text>
                )}
              </View>
              {/* 오른쪽: 이름 / 종목·소속센터 / 지역 */}
              <View style={styles.pcInfo}>
                <Text style={styles.pcName} numberOfLines={1}>{profile.name || '코치'} 코치</Text>
                {!!(profile.sport || profile.center_name) && (
                  <Text style={styles.pcMeta} numberOfLines={1}>
                    {[profile.sport, profile.center_name].filter(Boolean).join(' · ')}
                  </Text>
                )}
                {!!regionLabel && (
                  <View style={styles.pcRegionRow}>
                    <Ionicons name="location-outline" size={11} color={Colors.placeholder} />
                    <Text style={styles.pcRegion} numberOfLines={1}>{regionLabel}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* 한 줄 소개 */}
            {profile.bio ? (
              <View style={styles.pcBioBox}>
                <Text style={styles.pcBioQuote}>"</Text>
                <Text style={styles.pcBio}>{profile.bio}</Text>
              </View>
            ) : (
              <TouchableOpacity onPress={() => openEditModal('profile')} activeOpacity={0.7} style={styles.pcBioBox}>
                <Text style={[styles.pcBioQuote, { color: Colors.placeholder }]}>"</Text>
                <Text style={styles.pcBioEmpty}>나만의 코칭 방향을 소개해보세요.</Text>
              </TouchableOpacity>
            )}

            {/* 하단 버튼 행 */}
            <View style={styles.pcBtnRow}>
              <TouchableOpacity style={styles.pcEditBtn} onPress={() => openEditModal('profile')} activeOpacity={0.8}>
                <Ionicons name="create-outline" size={14} color={TERRA} />
                <Text style={styles.pcEditBtnText}>프로필 편집</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pcViewBtn}
                onPress={() => Alert.alert('내 프로필 미리보기', '회원에게 공개되는 코치 프로필입니다.\n(준비 중입니다)')}
                activeOpacity={0.8}
              >
                <Text style={styles.pcViewBtnText}>회원에게 보이는 프로필</Text>
                <Ionicons name="chevron-forward" size={14} color={TERRA} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── 나의 코칭 여정 ── */}
          <View style={styles.sectionCard}>
            <View style={styles.statsHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="flame-outline" size={22} color="#C0755A" strokeWidth={1.8} />
                <Text style={styles.sectionTitle}>나의 코칭 여정</Text>
              </View>
              <TouchableOpacity
                style={journeyPublic ? styles.journeyPublicBadge : styles.journeyPrivateBadge}
                onPress={openJourneyVisibility}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={journeyPublic ? 'people-outline' : 'lock-closed'}
                  size={10}
                  color={journeyPublic ? '#059669' : TERRA}
                />
                <Text style={journeyPublic ? styles.journeyPublicBadgeText : styles.journeyPrivateBadgeText}>
                  {journeyPublic ? '회원 공개' : '나만 보기'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={stat.grid}>
              <Pressable
                onPress={() => setJourneyPopup('members')}
                style={({ pressed }) => [stat.cell, stat.cellRight, pressed && styles.journeyCellPressed]}
              >
                <Text style={stat.value}>{`${membersCount}명`}</Text>
                <Text style={stat.label}>함께한 회원</Text>
              </Pressable>
              <Pressable
                onPress={() => setJourneyPopup('lessons')}
                style={({ pressed }) => [stat.cell, pressed && styles.journeyCellPressed]}
              >
                <Text style={stat.value}>{`${perf.totalLessons.toLocaleString()}회`}</Text>
                <Text style={stat.label}>진행한 레슨</Text>
              </Pressable>
              <Pressable
                onPress={() => setJourneyPopup('reports')}
                style={({ pressed }) => [stat.cell, stat.cellRight, stat.cellBottom, pressed && styles.journeyCellPressed]}
              >
                <Text style={stat.value}>{`${perf.totalReports}개`}</Text>
                <Text style={stat.label}>남긴 레슨 기록</Text>
              </Pressable>
              <Pressable
                onPress={() => setJourneyPopup('reviews')}
                style={({ pressed }) => [stat.cell, stat.cellBottom, pressed && styles.journeyCellPressed]}
              >
                <Text style={stat.value}>—</Text>
                <Text style={stat.label}>받은 회원 후기</Text>
              </Pressable>
            </View>
            {joinedMonths !== null && (
              <>
                <View style={styles.journeyDivider} />
                <Pressable
                  onPress={() => setJourneyPopup('duration')}
                  style={({ pressed }) => [styles.journeyFooter, pressed && styles.journeyFooterPressed]}
                >
                  <Image source={require('../../assets/images/kerri-symbol.jpg')} style={styles.kerriLogoSmall} />
                  <Text style={styles.journeyFooterText}>
                    {joinedMonths > 0
                      ? `KERRI와 함께한 지 ${joinedMonths}개월`
                      : 'KERRI 코칭 여정이 시작됐어요!'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          {/* ── 프로필 완성도 ── */}
          {completionPct < 100 && <View style={styles.completionCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.completionTitle}>프로필 완성도 {completionPct}%</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${completionPct}%` as any }]} />
              </View>
              <Text style={styles.completionTip}>{completionTip}</Text>
            </View>
            <TouchableOpacity onPress={() => openEditModal('profile')} style={styles.completionBtn}>
              <Text style={styles.completionBtnText}>완성하기 →</Text>
            </TouchableOpacity>
          </View>}

          {/* ── 경력·자격 ── */}
          <View style={styles.sectionCard}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="ribbon-outline" size={15} color={TERRA} />
                <Text style={styles.sectionTitle}>경력·자격</Text>
              </View>
              <TouchableOpacity
                onPress={() => openEditModal('career')}
                style={styles.editChip}
              >
                <Ionicons name="pencil-outline" size={11} color={TERRA} />
                <Text style={styles.editChipText}>편집</Text>
              </TouchableOpacity>
            </View>

            {careerRows.length === 0 ? (
              <View>
                <Text style={styles.careerEmptyText}>코치님의 경력과 자격을 소개해보세요</Text>
                <TouchableOpacity onPress={() => openEditModal('career')} style={styles.careerAddBtn} activeOpacity={0.7}>
                  <Ionicons name="add-circle-outline" size={15} color={TERRA} />
                  <Text style={styles.careerAddBtnText}>경력 추가</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ gap: 0 }}>
                {careerRows.map((row, i) => (
                  <View key={row.label} style={[styles.introRow, i < careerRows.length - 1 && styles.introRowBorder]}>
                    <Text style={styles.introLabel}>{row.label}</Text>
                    <Text style={styles.introValue}>{row.value}</Text>
                  </View>
                ))}
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
                <Ionicons name="hardware-chip-outline" size={22} color={TERRA} />
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

          {/* ── 내 초대 QR ── */}
          {coachId ? (
            <TouchableOpacity
              style={styles.aiCard}
              onPress={() => (FEATURE_SHARED_QR ? router.push('/connect/qr') : setQrModalVisible(true))}
              activeOpacity={0.8}
            >
              <View style={styles.aiLeft}>
                <View style={styles.aiIconWrap}>
                  <Ionicons name="qr-code-outline" size={22} color={TERRA} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aiTitle}>내 초대 QR</Text>
                  <Text style={styles.aiSub}>회원을 초대해보세요</Text>
                </View>
              </View>
              <Text style={styles.aiArrow}>QR 보기 →</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.aiCard, { opacity: 0.4 }]}>
              <View style={styles.aiLeft}>
                <View style={styles.aiIconWrap}>
                  <Ionicons name="qr-code-outline" size={22} color={TERRA} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aiTitle}>내 초대 QR</Text>
                  <Text style={styles.aiSub}>회원을 초대해보세요</Text>
                </View>
              </View>
            </View>
          )}

          <View style={{ height: 24 }} />
          </>}
        </View>
      </ScrollView>

      {/* ── 통합 프로필 편집 모달 (전체화면) ── */}
      <Modal
        visible={editModal}
        transparent={false}
        animationType="slide"
        onRequestClose={handleEditBack}
      >
        <View style={styles.editScreen}>
          <SettingsHeader
            title="프로필 편집"
            onBack={handleEditBack}
            right={
              <TouchableOpacity
                style={[styles.editSaveBtn, (!isDirty || isSaving) && styles.editSaveBtnDisabled]}
                onPress={saveAll}
                disabled={!isDirty || isSaving}
              >
                {isSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.editSaveBtnText}>저장</Text>
                }
              </TouchableOpacity>
            }
          />
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
          >
            <ScrollView
              ref={editScrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={styles.editScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* ── 기본 정보 영역 ── */}
              <Text style={styles.editSectionHeader}>기본 정보</Text>

              {/* 프로필 사진 */}
              <View style={styles.editAvatarSection}>
                <View style={styles.editAvatarWrap}>
                  <View style={styles.editAvatarCircle}>
                    {uploadingAvatar ? (
                      <ActivityIndicator color={TERRA} size="small" />
                    ) : editData.avatar_url ? (
                      <Image source={{ uri: editData.avatar_url }} style={styles.editAvatarImg} />
                    ) : (
                      <Text style={styles.editAvatarInitial}>
                        {(editData.name || '코').slice(0, 1).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.editAvatarCameraBtn}
                    onPress={handlePickAvatar}
                    disabled={uploadingAvatar}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="camera" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* 코치 이름 */}
              <Text style={styles.editLabel}>코치 이름 *</Text>
              <TextInput
                style={styles.input}
                value={editData.name}
                onChangeText={v => setEditData(p => ({ ...p, name: v }))}
                placeholder="코치 이름"
                placeholderTextColor={Colors.placeholder}
              />

              {/* 종목 */}
              <Text style={styles.editLabel}>종목 *</Text>
              <TouchableOpacity style={styles.picker} onPress={() => setSportPickerOpen(o => !o)}>
                <Text style={styles.pickerTxt}>{editData.sport || '종목 선택'}</Text>
                <Ionicons name={sportPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.mutedFg} />
              </TouchableOpacity>
              {sportPickerOpen && (
                <View style={styles.pickerList}>
                  {SPORTS.map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.pickerOption, editData.sport === s && styles.pickerOptionSel]}
                      onPress={() => { setEditData(p => ({ ...p, sport: s })); setSportPickerOpen(false); }}
                    >
                      <Text style={[styles.pickerOptionTxt, editData.sport === s && { color: TERRA, fontWeight: '700' }]}>{s}</Text>
                      {editData.sport === s && <Ionicons name="checkmark" size={14} color={TERRA} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* 활동 지역 */}
              <Text style={styles.editLabel}>활동 지역</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={editData.region_city}
                  onChangeText={v => setEditData(p => ({ ...p, region_city: v }))}
                  placeholder="시·도 (예: 서울)"
                  placeholderTextColor={Colors.placeholder}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={editData.region_district}
                  onChangeText={v => setEditData(p => ({ ...p, region_district: v }))}
                  placeholder="시·군·구 (예: 강남구)"
                  placeholderTextColor={Colors.placeholder}
                />
              </View>

              {/* 소속 센터 */}
              <Text style={styles.editLabel}>소속 센터</Text>
              <TextInput
                style={styles.input}
                value={editData.center_name}
                onChangeText={v => setEditData(p => ({ ...p, center_name: v }))}
                placeholder="센터 또는 클럽명"
                placeholderTextColor={Colors.placeholder}
              />

              {/* 한 줄 소개 */}
              <Text style={styles.editLabel}>한 줄 소개</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={editData.bio}
                onChangeText={v => setEditData(p => ({ ...p, bio: v }))}
                placeholder="나를 한 문장으로 소개해보세요"
                placeholderTextColor={Colors.placeholder}
                multiline
                maxLength={80}
              />
              <Text style={styles.charCount}>{editData.bio.length}/80</Text>

              {/* ── 경력·자격 영역 ── */}
              <View
                onLayout={e => { careerSectionY.current = e.nativeEvent.layout.y; }}
              >
                <View style={styles.editSectionDivider} />
                <Text style={styles.editSectionHeader}>경력·자격</Text>

                {/* 코칭 경력 */}
                <Text style={styles.editLabel}>코칭 경력</Text>
                <View style={styles.yearInputRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={editData.coaching_years}
                    onChangeText={v => setEditData(c => ({ ...c, coaching_years: v.replace(/[^0-9]/g, '') }))}
                    placeholder="예: 7"
                    placeholderTextColor={Colors.placeholder}
                    keyboardType="numeric"
                    maxLength={2}
                  />
                  <Text style={styles.yearUnit}>년</Text>
                </View>

                {/* 선수 경력 */}
                <Text style={styles.editLabel}>선수 경력</Text>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>{editData.has_player_career ? '있음' : '없음'}</Text>
                  <Switch
                    value={editData.has_player_career}
                    onValueChange={v => setEditData(c => ({ ...c, has_player_career: v }))}
                    trackColor={{ false: Colors.border, true: TERRA }}
                    thumbColor="#fff"
                  />
                </View>

                {/* 주요 경력 */}
                <Text style={styles.editLabel}>주요 경력</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={editData.career_details}
                  onChangeText={v => setEditData(c => ({ ...c, career_details: v }))}
                  placeholder={'예: 전 대학 선수\n○○테니스아카데미 수석코치'}
                  placeholderTextColor={Colors.placeholder}
                  multiline
                />

                {/* 자격증 */}
                <Text style={styles.editLabel}>자격증</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={editData.certifications}
                  onChangeText={v => setEditData(c => ({ ...c, certifications: v }))}
                  placeholder={'예: 생활체육지도자 2급\nKTA 공인 코치'}
                  placeholderTextColor={Colors.placeholder}
                  multiline
                />

                {/* 수상·대회 이력 */}
                <Text style={styles.editLabel}>수상·대회 이력</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={editData.awards}
                  onChangeText={v => setEditData(c => ({ ...c, awards: v }))}
                  placeholder={'예: 2023 전국 동호인 대회 우승'}
                  placeholderTextColor={Colors.placeholder}
                  multiline
                />
              </View>

              <View style={{ height: 40 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── AI 코칭 모델 관리 모달 ── */}
      <CoachingStyleModal
        visible={knowledgeModal}
        onClose={() => setKnowledgeModal(false)}
        onSaved={(count) => setKnowledgeCount(prev => prev + count)}
        onDeleted={() => setKnowledgeCount(prev => prev - 1)}
        knowledgeList={knowledgeList}
        onKnowledgeListChange={setKnowledgeList}
      />

      {/* ── 코칭 여정 항목 설명 팝업 ── */}
      <Modal
        visible={journeyPopup !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setJourneyPopup(null)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setJourneyPopup(null)}>
          <TouchableOpacity
            style={[styles.journeyPopupSheet, { paddingBottom: insets.bottom + 12 }]}
            activeOpacity={1}
            onPress={() => {}}
          >
            <View style={styles.handle} />
            {journeyPopup !== null && (() => {
              const info = JOURNEY_INFO[journeyPopup];
              const value =
                journeyPopup === 'members'  ? `${membersCount}명` :
                journeyPopup === 'lessons'  ? `${perf.totalLessons.toLocaleString()}회` :
                journeyPopup === 'reports'  ? `${perf.totalReports}개` :
                journeyPopup === 'reviews'  ? '—' :
                joinedMonths !== null && joinedMonths > 0 ? `${joinedMonths}개월` : '이제 시작이에요!';
              return (
                <>
                  <View style={styles.journeyPopupIconWrap}>
                    {journeyPopup === 'duration'
                      ? <Image source={require('../../assets/images/kerri-symbol.jpg')} style={{ width: 52, height: 52, resizeMode: 'cover' }} />
                      : <Ionicons name={info.icon as any} size={26} color={TERRA} />}
                  </View>
                  <Text style={styles.journeyPopupTitle}>{info.title}</Text>
                  <Text style={styles.journeyPopupValue}>{value}</Text>
                  <Text style={styles.journeyPopupDesc}>{info.desc}</Text>
                  <View style={styles.journeyPopupBadgeWrap}>
                    <Text style={styles.journeyPopupBadgeText}>{info.badge}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.saveBtn, { marginTop: 16 }]}
                    onPress={() => setJourneyPopup(null)}
                  >
                    <Text style={styles.saveBtnTxt}>확인했어요</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── 코칭 여정 공개 설정 바텀시트 ── */}
      <Modal
        visible={journeyVisibilityModal}
        transparent
        animationType="slide"
        onRequestClose={() => setJourneyVisibilityModal(false)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setJourneyVisibilityModal(false)}>
          <TouchableOpacity
            style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}
            activeOpacity={1}
            onPress={() => {}}
          >
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>코칭 여정 공개 설정</Text>
            <Text style={styles.journeyModalDesc}>
              {'코칭 여정에 표시된 숫자를 회원에게 공개할지 선택할 수 있어요.'}
            </Text>

            <TouchableOpacity
              style={[styles.journeyOption, journeyVisibilityDraft === false && styles.journeyOptionSelected]}
              onPress={() => setJourneyVisibilityDraft(false)}
              activeOpacity={0.7}
            >
              <View style={[styles.journeyOptionIcon, { backgroundColor: TERRA_LIGHT }]}>
                <Ionicons name="lock-closed" size={18} color={TERRA} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.journeyOptionTitle}>나만 보기</Text>
                <Text style={styles.journeyOptionDesc}>코치님만 확인할 수 있어요.</Text>
              </View>
              {journeyVisibilityDraft === false && (
                <Ionicons name="checkmark-circle" size={22} color={TERRA} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.journeyOption, journeyVisibilityDraft === true && styles.journeyOptionSelected]}
              onPress={() => setJourneyVisibilityDraft(true)}
              activeOpacity={0.7}
            >
              <View style={[styles.journeyOptionIcon, { backgroundColor: '#F0FDF4' }]}>
                <Ionicons name="people-outline" size={18} color="#059669" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.journeyOptionTitle}>회원에게 공개</Text>
                <Text style={styles.journeyOptionDesc}>{'회원에게 보이는 코치 프로필에 함께 표시돼요.'}</Text>
              </View>
              {journeyVisibilityDraft === true && (
                <Ionicons name="checkmark-circle" size={22} color="#059669" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, savingJourneyVisibility && { opacity: 0.6 }]}
              disabled={savingJourneyVisibility}
              onPress={() => {
                if (journeyVisibilityDraft === true && !journeyPublic) {
                  Alert.alert(
                    '코칭 여정을 회원에게 공개할까요?',
                    '함께한 회원, 진행한 레슨, 남긴 레슨 기록 등의 숫자가 회원 프로필에 표시됩니다.',
                    [
                      { text: '취소', style: 'cancel' },
                      { text: '공개하기', onPress: () => saveJourneyVisibility(true) },
                    ]
                  );
                } else {
                  saveJourneyVisibility(journeyVisibilityDraft);
                }
              }}
            >
              {savingJourneyVisibility
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveBtnTxt}>설정 저장</Text>
              }
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
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
    </Animated.View>
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

  // ── 새 프로필 카드 (흰색) ──
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    marginBottom: 14,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 14,
    shadowColor: '#C0755A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
  },
  pcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  pcAvatarWrap: {
    width: PC_PHOTO_SIZE, height: PC_PHOTO_SIZE,
    borderRadius: PC_PHOTO_SIZE / 2,
    backgroundColor: TERRA_LIGHT,
    borderWidth: 2, borderColor: '#F1C9BA',
    overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  pcAvatarImg: { width: PC_PHOTO_SIZE, height: PC_PHOTO_SIZE, borderRadius: PC_PHOTO_SIZE / 2 },
  pcAvatarInitial: { fontSize: 26, fontWeight: '800', color: TERRA },
  pcInfo: { flex: 1, gap: 3 },
  pcName: { fontSize: 18, fontWeight: '800', color: DARK },
  pcMeta: { fontSize: 14, color: Colors.mutedFg, fontWeight: '500' },
  pcRegionRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  pcRegion: { fontSize: 13, color: Colors.placeholder },
  pcBioBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginBottom: 12,
  },
  pcBioQuote: { fontSize: 18, fontWeight: '800', color: TERRA, lineHeight: 22, marginTop: -1 },
  pcBio: { flex: 1, fontSize: 13, color: DARK, lineHeight: 20 },
  pcBioEmpty: { flex: 1, fontSize: 13, color: Colors.placeholder, lineHeight: 20 },
  pcBtnRow: {
    flexDirection: 'row', gap: 8,
  },
  pcEditBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: TERRA_LIGHT,
    borderRadius: 10,
    paddingHorizontal: 13, paddingVertical: 9,
  },
  pcEditBtnText: { fontSize: 13, fontWeight: '700', color: TERRA },
  pcViewBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: `${TERRA}10`,
    borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 9,
  },
  pcViewBtnText: { fontSize: 13, fontWeight: '600', color: TERRA },

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
  journeyPrivateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: TERRA_LIGHT, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  journeyPrivateBadgeText: { fontSize: 10, fontWeight: '700', color: TERRA },
  journeyPublicBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F0FDF4', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  journeyPublicBadgeText: { fontSize: 10, fontWeight: '700', color: '#059669' },
  journeyModalDesc: {
    fontSize: 13, color: Colors.mutedFg, lineHeight: 19,
    marginBottom: 20, marginTop: -4,
  },
  journeyOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1.5, borderColor: Colors.borderLight,
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  journeyOptionSelected: {
    borderColor: TERRA, backgroundColor: TERRA_LIGHT,
  },
  journeyOptionIcon: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  journeyOptionTitle: { fontSize: 14, fontWeight: '700', color: DARK, marginBottom: 2 },
  journeyOptionDesc: { fontSize: 12, color: Colors.mutedFg, lineHeight: 17 },
  journeyDivider: {
    height: 1, backgroundColor: Colors.borderLight, marginTop: 4, marginBottom: 10,
  },
  journeyFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  kerriLogoSmall: { width: 20, height: 20, resizeMode: 'contain' },
  journeyFooterText: { fontSize: 13, color: TERRA, fontWeight: '600' },
  journeyFooterPressed: { backgroundColor: CREAM, borderRadius: 8 },
  journeyCellPressed: { backgroundColor: CREAM },

  // 항목 설명 팝업
  journeyPopupSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 8,
    marginTop: 'auto' as any,
  },
  journeyPopupIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: TERRA_LIGHT,
    justifyContent: 'center', alignItems: 'center',
    marginTop: 12, marginBottom: 10,
    overflow: 'hidden' as const,
  },
  journeyPopupTitle: { fontSize: 13, fontWeight: '700', color: Colors.mutedFg, marginBottom: 2 },
  journeyPopupValue: { fontSize: 28, fontWeight: '800', color: DARK, marginBottom: 10 },
  journeyPopupDesc: { fontSize: 14, color: DARK, lineHeight: 21 },
  journeyPopupBadgeWrap: {
    alignSelf: 'flex-start',
    backgroundColor: TERRA_LIGHT, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4, marginTop: 10,
  },
  journeyPopupBadgeText: { fontSize: 11, fontWeight: '700', color: TERRA },

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

  // Career card
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
  introRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 11 },
  introRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  introLabel: { width: 74, fontSize: 13, color: Colors.mutedFg, fontWeight: '500', paddingTop: 1 },
  introValue: { flex: 1, fontSize: 14, color: DARK, fontWeight: '500', lineHeight: 20 },
  careerEmptyText: { fontSize: 14, color: Colors.mutedFg, marginBottom: 10 },
  careerAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: TERRA_LIGHT, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  careerAddBtnText: { fontSize: 13, fontWeight: '700', color: TERRA },

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

  // Modals (journey popups)
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48 },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: DARK, marginBottom: 16 },

  // 통합 편집 모달
  editScreen: { flex: 1, backgroundColor: '#fff' },
  editScrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  editSectionHeader: {
    fontSize: 16, fontWeight: '800', color: DARK,
    marginTop: 16, marginBottom: 4,
  },
  editSectionDivider: {
    height: 1, backgroundColor: Colors.borderLight,
    marginVertical: 20,
  },
  editLabel: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, marginBottom: 6, marginTop: 14 },
  editSaveBtn: {
    backgroundColor: TERRA, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
    minWidth: 52, alignItems: 'center', justifyContent: 'center',
    minHeight: 34,
  },
  editSaveBtnDisabled: { backgroundColor: Colors.borderLight },
  editSaveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // 편집 모달: 아바타
  editAvatarSection: { alignItems: 'center', marginTop: 8, marginBottom: 4 },
  editAvatarWrap: { position: 'relative', width: 88, height: 88 },
  editAvatarCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: TERRA_LIGHT,
    borderWidth: 2, borderColor: '#F1C9BA',
    overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
  },
  editAvatarImg: { width: 88, height: 88, borderRadius: 44 },
  editAvatarInitial: { fontSize: 28, fontWeight: '800', color: TERRA },
  editAvatarCameraBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: TERRA,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#fff',
  },

  // 편집 모달: 입력 필드
  input: {
    backgroundColor: Colors.mutedBg, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.foreground,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 4,
  },
  multilineInput: { minHeight: 72, textAlignVertical: 'top', paddingTop: 12 },
  charCount: { fontSize: 11, color: Colors.placeholder, textAlign: 'right', marginBottom: 4 },
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
  yearInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  yearUnit: { fontSize: 15, color: DARK, fontWeight: '600' },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.mutedBg, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 4,
  },
  switchLabel: { fontSize: 15, color: Colors.foreground, fontWeight: '600' },

  // journey popup save btn (공유)
  saveBtn: {
    backgroundColor: TERRA, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8,
  },
  saveBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
