import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Share, Linking, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';

const TERRA = '#C0755A';
const TERRA_LIGHT = '#FBF2EF';
const DARK = '#3E2B22';
const PUBLIC_BASE = 'https://kerri.co.kr/coach/';
const SCREEN_WIDTH = Dimensions.get('window').width;
const HERO_HEIGHT = Math.round(SCREEN_WIDTH * 0.62);

interface ProfileData {
  display_name: string;
  avatar_url: string | null;
  sport: string | null;
  region_city: string | null;
  region_district: string | null;
  center_name: string | null;
  bio: string | null;
  coaching_years: number | null;
  has_player_career: boolean;
  career_details: string | null;
  certifications: string | null;
  awards: string | null;
  show_coaching_journey: boolean;
  public_slug: string | null;
  is_public: boolean;
}

interface LessonPackage {
  id: string;
  title: string;
  price: number;
  total_credits: number;
  duration_minutes: number;
  color: string;
}

export default function PublicPreviewScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [packages, setPackages] = useState<LessonPackage[]>([]);
  const [stats, setStats] = useState({ members: 0, lessons: 0, reports: 0 });

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const [profileRes, packagesRes] = await Promise.all([
      supabase.from('coach_profiles').select('*').eq('coach_id', user.id).maybeSingle(),
      supabase.from('lesson_packages')
        .select('id, title, price, total_credits, duration_minutes, color')
        .eq('coach_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
    ]);

    if (profileRes.data) {
      setProfile(profileRes.data);

      const [membersRes, lessonsRes, plansRes] = await Promise.all([
        supabase.from('members').select('id', { count: 'exact', head: true }).eq('coach_id', user.id),
        supabase.from('lessons').select('id').eq('coach_id', user.id),
        supabase.from('lesson_plans').select('*', { count: 'exact', head: true }).eq('coach_id', user.id),
      ]);

      let totalLessons = 0;
      const lessonIds = (lessonsRes.data ?? []).map((l: any) => l.id);
      if (lessonIds.length > 0) {
        const { data: attended } = await supabase
          .from('attendance')
          .select('lesson_id')
          .in('lesson_id', lessonIds)
          .eq('status', '출석');
        totalLessons = new Set((attended ?? []).map((r: any) => r.lesson_id)).size;
      }

      setStats({
        members: membersRes.count ?? 0,
        lessons: totalLessons,
        reports: plansRes.count ?? 0,
      });
    }

    setPackages(packagesRes.data ?? []);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadData();
  }, []));

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <SettingsHeader title="회원에게 보이는 프로필" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={TERRA} />
        </View>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <SettingsHeader title="회원에게 보이는 프로필" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: Colors.mutedFg }}>프로필 정보를 불러오지 못했어요.</Text>
        </View>
      </View>
    );
  }

  const regionLabel = [profile.region_city, profile.region_district].filter(Boolean).join(' ');
  const publicUrl = profile.is_public && profile.public_slug ? `${PUBLIC_BASE}${profile.public_slug}` : null;
  const initial = (profile.display_name || '코').slice(0, 1).toUpperCase();

  const careerRows = [
    { label: '코칭 경력', value: profile.coaching_years ? `${profile.coaching_years}년` : null },
    { label: '선수 경력', value: profile.has_player_career ? '있음' : null },
    { label: '주요 경력', value: profile.career_details || null },
    { label: '자격증', value: profile.certifications || null },
    { label: '수상·대회', value: profile.awards || null },
  ].filter(r => r.value !== null) as { label: string; value: string }[];

  const journeyStats = [
    { label: '함께한 회원', value: stats.members, display: `${stats.members}명` },
    { label: '진행한 레슨', value: stats.lessons, display: `${stats.lessons.toLocaleString()}회` },
    { label: '남긴 레슨 기록', value: stats.reports, display: `${stats.reports}개` },
  ].filter(s => s.value > 0);

  async function handleShare() {
    const url = publicUrl ?? 'https://kerri.co.kr';
    try {
      await Share.share({
        message: `${profile!.display_name} 코치 프로필\n${url}`,
      });
    } catch {}
  }

  async function handleInquiry() {
    if (publicUrl) {
      await Linking.openURL(publicUrl);
    }
  }

  const showCTA = publicUrl !== null;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SettingsHeader title="회원에게 보이는 프로필" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + (showCTA ? 90 : 24) }}
      >
        {/* ① 히어로 영역 */}
        <View style={[styles.hero, { height: HERO_HEIGHT }]}>
          {profile.avatar_url ? (
            <Image
              source={{ uri: profile.avatar_url }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.heroFallback]}>
              <Text style={styles.heroInitial}>{initial}</Text>
            </View>
          )}
          <View style={styles.heroOverlay} />
          <View style={styles.heroInfo}>
            {!!profile.sport && (
              <Text style={styles.heroSport}>{profile.sport.toUpperCase()}</Text>
            )}
            <Text style={styles.heroName}>{profile.display_name} 코치</Text>
            {!!regionLabel && (
              <View style={styles.heroRegionRow}>
                <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.85)" />
                <Text style={styles.heroRegion}>{regionLabel}</Text>
              </View>
            )}
          </View>
          <View style={styles.heroLogo}>
            <Text style={styles.heroLogoText}>KERRI</Text>
          </View>
        </View>

        {/* 비공개 안내 배너 */}
        {!profile.is_public && (
          <View style={styles.noticeBanner}>
            <Ionicons name="eye-off-outline" size={14} color={TERRA} />
            <Text style={styles.noticeText}>
              현재 비공개 상태예요. 공개 설정 후 회원에게 표시됩니다.
            </Text>
          </View>
        )}

        <View style={styles.body}>
          {/* ② 자기소개 */}
          {!!profile.bio && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>소개</Text>
              <Text style={styles.bioText}>{profile.bio}</Text>
            </View>
          )}

          {/* ③ 경력·자격 */}
          {careerRows.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="ribbon-outline" size={14} color={TERRA} />
                <Text style={styles.cardTitle}>경력·자격</Text>
              </View>
              {careerRows.map((row, i) => (
                <View
                  key={row.label}
                  style={[styles.careerRow, i < careerRows.length - 1 && styles.careerRowBorder]}
                >
                  <Text style={styles.careerLabel}>{row.label}</Text>
                  <Text style={styles.careerValue}>{row.value}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ④ 코칭 여정 */}
          {profile.show_coaching_journey && journeyStats.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="flame-outline" size={14} color={TERRA} />
                <Text style={styles.cardTitle}>코칭 여정</Text>
              </View>
              <View style={styles.journeyRow}>
                {journeyStats.map(s => (
                  <View key={s.label} style={styles.journeyCell}>
                    <Text style={styles.journeyValue}>{s.display}</Text>
                    <Text style={styles.journeyLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ⑤ 레슨권 */}
          {packages.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="ticket-outline" size={14} color={TERRA} />
                <Text style={styles.cardTitle}>레슨권</Text>
              </View>
              {packages.map((pkg, i) => (
                <View
                  key={pkg.id}
                  style={[styles.packageRow, i < packages.length - 1 && styles.packageRowBorder]}
                >
                  <View style={[styles.packageDot, { backgroundColor: pkg.color || TERRA }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.packageTitle}>{pkg.title}</Text>
                    <Text style={styles.packageMeta}>
                      {pkg.total_credits}회 · {pkg.duration_minutes}분 · {pkg.price.toLocaleString()}원
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ⑥ 하단 CTA */}
      {showCTA && (
        <View style={[styles.cta, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.inquiryBtn} onPress={handleInquiry} activeOpacity={0.85}>
            <Ionicons name="chatbubble-outline" size={16} color="#fff" />
            <Text style={styles.inquiryBtnText}>레슨 문의하기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
            <Ionicons name="share-outline" size={16} color={TERRA} />
            <Text style={styles.shareBtnText}>공유</Text>
          </TouchableOpacity>
        </View>
      )}
      {!showCTA && (
        <View style={[styles.cta, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={[styles.shareBtn, { flex: 1 }]} onPress={handleShare} activeOpacity={0.85}>
            <Ionicons name="share-outline" size={16} color={TERRA} />
            <Text style={styles.shareBtnText}>프로필 공유</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    backgroundColor: TERRA,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  heroFallback: {
    backgroundColor: TERRA,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroInitial: {
    fontSize: 80,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  heroInfo: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  heroSport: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  heroName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
  },
  heroRegionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroRegion: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  heroLogo: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  heroLogoText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1.5,
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: TERRA_LIGHT,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: `${TERRA}20`,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: TERRA,
    fontWeight: '600',
    lineHeight: 17,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 2,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: DARK,
  },
  bioText: {
    fontSize: 14,
    color: DARK,
    lineHeight: 22,
    marginTop: 8,
  },
  careerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  careerRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F6',
  },
  careerLabel: {
    width: 72,
    fontSize: 13,
    color: Colors.mutedFg,
    fontWeight: '500',
  },
  careerValue: {
    flex: 1,
    fontSize: 14,
    color: DARK,
    fontWeight: '500',
    lineHeight: 20,
  },
  journeyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  journeyCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: TERRA_LIGHT,
    borderRadius: 12,
  },
  journeyValue: {
    fontSize: 17,
    fontWeight: '800',
    color: DARK,
    marginBottom: 3,
  },
  journeyLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.mutedFg,
    textAlign: 'center',
  },
  packageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  packageRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F6',
  },
  packageDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  packageTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: DARK,
    marginBottom: 2,
  },
  packageMeta: {
    fontSize: 12,
    color: Colors.mutedFg,
  },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#EEF1F6',
  },
  inquiryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: TERRA,
    borderRadius: 12,
    paddingVertical: 14,
  },
  inquiryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1.5,
    borderColor: TERRA,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: TERRA,
  },
});
