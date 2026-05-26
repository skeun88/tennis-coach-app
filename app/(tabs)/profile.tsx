import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, Modal, TextInput, ActivityIndicator,
  Image, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { Colors, Radius, Shadow } from '../../lib/theme';

const SPORTS = ['테니스', '배드민턴', '스쿼시', '탁구', '골프', '기타'];

// ─── KERRI 등급 ───────────────────────────
const GRADES = [
  { key: 'Diamond', label: 'Diamond', color: '#60A5FA', icon: 'diamond' },
  { key: 'Gold',    label: 'Gold',    color: '#F59E0B', icon: 'trophy' },
  { key: 'Silver',  label: 'Silver',  color: '#94A3B8', icon: 'medal' },
  { key: 'Bronze',  label: 'Bronze',  color: '#CD7F32', icon: 'ribbon' },
] as const;

function getGrade(totalLessons: number, feedbackRate: number, retentionRate: number) {
  if (totalLessons >= 100 && feedbackRate >= 70 && retentionRate >= 70) return GRADES[0]; // Diamond
  if (totalLessons >= 100 && feedbackRate >= 70)                        return GRADES[1]; // Gold
  if (totalLessons >= 30)                                                return GRADES[2]; // Silver
  return GRADES[3]; // Bronze
}

// Diamond 요건 기준으로 next grade hint 계산
function getNextHint(totalLessons: number, feedbackRate: number, retentionRate: number) {
  const grade = getGrade(totalLessons, feedbackRate, retentionRate);
  if (grade.key === 'Bronze') {
    const need = 30 - totalLessons;
    return `Silver까지 레슨 ${need}회 남았어요`;
  }
  if (grade.key === 'Silver') {
    const hints = [];
    if (totalLessons < 100) hints.push(`레슨 ${100 - totalLessons}회`);
    if (feedbackRate < 70)  hints.push(`피드백률 ${70 - feedbackRate}%p`);
    return `Gold까지 ${hints.join(', ')} 남았어요`;
  }
  if (grade.key === 'Gold') {
    return `Diamond까지 회원 유지율 ${Math.max(0, 70 - retentionRate)}%p 남았어요`;
  }
  return 'KERRI 최고 등급 달성! 🎉';
}

// ─── 타입 ─────────────────────────────────
interface Performance {
  totalLessons: number;
  feedbackRate: number;
  retentionRate: number;
  totalMembers: number;
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

// ─── 서브 컴포넌트 ────────────────────────
function SectionCard({ icon, title, onEdit, children }: { icon: string; title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Ionicons name={icon as any} size={15} color={Colors.navy} />
        <Text style={styles.sectionTitle}>{title}</Text>
        <TouchableOpacity style={styles.editBtn} onPress={onEdit}>
          <Ionicons name="pencil-outline" size={12} color={Colors.navy} />
          <Text style={styles.editBtnText}>수정</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function InfoRow({ icon, label, value, multiline, last }: { icon: string; label: string; value?: string; multiline?: boolean; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <View style={styles.infoIcon}><Ionicons name={icon as any} size={15} color={Colors.mutedFg} /></View>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, multiline && { flex: 1, textAlign: 'right' }]} numberOfLines={multiline ? 2 : 1}>{value || '-'}</Text>
    </View>
  );
}

function MetricCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={metric.card}>
      <View style={[metric.iconWrap, { backgroundColor: (color ?? Colors.navy) + '15' }]}>
        <Ionicons name={icon as any} size={18} color={color ?? Colors.navy} />
      </View>
      <Text style={metric.value}>{value}</Text>
      <Text style={metric.label}>{label}</Text>
      {sub ? <Text style={metric.sub}>{sub}</Text> : null}
    </View>
  );
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

// ─── 메인 스크린 ─────────────────────────
export default function ProfileScreen() {
  const [email, setEmail] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [perf, setPerf] = useState<Performance>({ totalLessons: 0, feedbackRate: 0, retentionRate: 0, totalMembers: 0 });

  const [profile, setProfile] = useState<ProfileInfo>({ name: '', avatar_url: '', sport: '테니스', region_city: '', region_district: '', center_name: '', bio: '' });
  const [profileModal, setProfileModal] = useState(false);
  const [editProfile, setEditProfile] = useState<ProfileInfo>({ name: '', avatar_url: '', sport: '테니스', region_city: '', region_district: '', center_name: '', bio: '' });
  const [sportPickerOpen, setSportPickerOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [career, setCareer] = useState<CareerInfo>({ coaching_years: '', has_player_career: false, career_details: '', certifications: '', awards: '' });
  const [careerModal, setCareerModal] = useState(false);
  const [editCareer, setEditCareer] = useState<CareerInfo>({ coaching_years: '', has_player_career: false, career_details: '', certifications: '', awards: '' });
  const [savingCareer, setSavingCareer] = useState(false);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setEmail(user.email ?? '');

    // ── 기본 쿼리
    const [membersRes, lessonIdsRes, plansRes, profileRes] = await Promise.all([
      supabase.from('members').select('*', { count: 'exact', head: true }).eq('coach_id', user.id),
      supabase.from('lessons').select('id').eq('coach_id', user.id),
      supabase.from('lesson_plans').select('*', { count: 'exact', head: true }).eq('coach_id', user.id),
      supabase.from('coach_profiles').select('*').eq('id', user.id).maybeSingle(),
    ]);

    const totalMembers = membersRes.count ?? 0;
    const myLessonIds = (lessonIdsRes.data ?? []).map((l: any) => l.id);

    // ── 총 진행 레슨 수 (출석 기준)
    let totalLessons = 0;
    let activeMembers = 0;
    if (myLessonIds.length > 0) {
      const { data: attended } = await supabase
        .from('attendance')
        .select('lesson_id, member_id')
        .in('lesson_id', myLessonIds)
        .eq('status', '출석');

      totalLessons = new Set((attended ?? []).map((r: any) => r.lesson_id)).size;

      // ── 회원 유지율: 최근 3개월 내 출석한 distinct member 수 / 전체 회원
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const cutoff = threeMonthsAgo.toISOString().slice(0, 10);

      const { data: recentLessons } = await supabase
        .from('lessons')
        .select('id')
        .eq('coach_id', user.id)
        .gte('date', cutoff);

      const recentIds = (recentLessons ?? []).map((l: any) => l.id);
      if (recentIds.length > 0) {
        const { data: recentAttended } = await supabase
          .from('attendance')
          .select('member_id')
          .in('lesson_id', recentIds)
          .eq('status', '출석');
        activeMembers = new Set((recentAttended ?? []).map((r: any) => r.member_id)).size;
      }
    }

    // ── 피드백 기록률
    const totalPlans = plansRes.count ?? 0;
    const feedbackRate = totalLessons > 0 ? Math.round((totalPlans / totalLessons) * 100) : 0;
    const retentionRate = totalMembers > 0 ? Math.round((activeMembers / totalMembers) * 100) : 0;

    setPerf({ totalLessons, feedbackRate, retentionRate, totalMembers });

    // ── 프로필
    const p = profileRes.data;
    setProfile({
      name: p?.name ?? user.email?.split('@')[0] ?? '코치',
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
  }

  useFocusEffect(useCallback(() => { loadProfile(); }, []));

  const initial = (profile.name || '코').slice(0, 1).toUpperCase();
  const regionLabel = [profile.region_city, profile.region_district].filter(Boolean).join(' ');
  const grade = getGrade(perf.totalLessons, perf.feedbackRate, perf.retentionRate);
  const nextHint = getNextHint(perf.totalLessons, perf.feedbackRate, perf.retentionRate);

  // 다음 등급까지 진행 바 (Bronze→Silver 기준)
  const gradeProgress = Math.min(100, grade.key === 'Bronze'
    ? Math.round((perf.totalLessons / 30) * 100)
    : grade.key === 'Silver'
    ? Math.round((Math.min(perf.totalLessons, 100) / 100) * 100)
    : grade.key === 'Gold'
    ? Math.round((perf.retentionRate / 70) * 100)
    : 100
  );

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
      const res = await fetch(uri);
      const blob = await res.blob();
      const ext = uri.split('.').pop() ?? 'jpg';
      const filePath = `${user.id}/avatar.${ext}`;
      const { error } = await supabase.storage.from('avatars').upload(filePath, blob, { upsert: true, contentType: `image/${ext}` });
      const url = error ? uri : supabase.storage.from('avatars').getPublicUrl(filePath).data.publicUrl;
      setEditProfile(p => ({ ...p, avatar_url: url }));
    } catch { setEditProfile(p => ({ ...p, avatar_url: uri })); }
    finally { setUploadingAvatar(false); }
  }

  async function saveProfile() {
    if (!editProfile.name.trim()) { Alert.alert('오류', '이름을 입력해주세요.'); return; }
    setSavingProfile(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingProfile(false); return; }
    const { error } = await supabase.from('coach_profiles').upsert({
      id: user.id, name: editProfile.name.trim(), avatar_url: editProfile.avatar_url || null,
      sport: editProfile.sport, region_city: editProfile.region_city.trim() || null,
      region_district: editProfile.region_district.trim() || null,
      center_name: editProfile.center_name.trim() || null,
      bio: editProfile.bio.trim() || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    setSavingProfile(false);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
    setProfile({ ...editProfile });
    setProfileModal(false);
  }

  async function saveCareer() {
    setSavingCareer(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingCareer(false); return; }
    const { error } = await supabase.from('coach_profiles').upsert({
      id: user.id,
      coaching_years: editCareer.coaching_years ? parseInt(editCareer.coaching_years, 10) : null,
      has_player_career: editCareer.has_player_career,
      career_details: editCareer.career_details.trim() || null,
      certifications: editCareer.certifications.trim() || null,
      awards: editCareer.awards.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    setSavingCareer(false);
    if (error) { Alert.alert('오류', '저장에 실패했습니다.'); return; }
    setCareer({ ...editCareer });
    setCareerModal(false);
  }

  async function handleSignOut() {
    Alert.alert('로그아웃', '로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadProfile(); setRefreshing(false); }} tintColor={Colors.mint} />}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroTitle}>내 프로필</Text>
            <TouchableOpacity onPress={handleSignOut} style={styles.logoutBtn}>
              <Ionicons name="log-out-outline" size={20} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
          <View style={styles.avatarSection}>
            <TouchableOpacity style={styles.avatarRing} onPress={() => { setEditProfile({ ...profile }); setProfileModal(true); }}>
              {profile.avatar_url
                ? <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
                : <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>}
              <View style={styles.cameraPin}><Ionicons name="camera" size={11} color="#fff" /></View>
            </TouchableOpacity>
            <Text style={styles.heroName}>{profile.name} 코치</Text>
            {profile.bio ? <Text style={styles.heroBio}>{profile.bio}</Text> : null}
            {(regionLabel || profile.center_name) ? (
              <View style={styles.metaRow}>
                {regionLabel ? <View style={styles.metaItem}><Ionicons name="location-outline" size={12} color="rgba(255,255,255,.6)" /><Text style={styles.metaText}>{regionLabel}</Text></View> : null}
                {profile.center_name ? <View style={styles.metaItem}><Ionicons name="business-outline" size={12} color="rgba(255,255,255,.6)" /><Text style={styles.metaText}>{profile.center_name}</Text></View> : null}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.body}>

          {/* ══ KERRI 코칭 실적 (정량 데이터) ══ */}
          <View style={styles.section}>
            {/* 등급 카드 */}
            <View style={[styles.gradeCard, { borderColor: grade.color + '40' }]}>
              <View style={styles.gradeLeft}>
                <View style={[styles.gradeIconWrap, { backgroundColor: grade.color + '20' }]}>
                  <Ionicons name={grade.icon as any} size={22} color={grade.color} />
                </View>
                <View>
                  <Text style={styles.gradeLabel}>KERRI 등급</Text>
                  <Text style={[styles.gradeName, { color: grade.color }]}>{grade.label}</Text>
                </View>
              </View>
              <View style={styles.gradeRight}>
                <Text style={styles.gradeHint}>{nextHint}</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${gradeProgress}%` as any, backgroundColor: grade.color }]} />
                </View>
              </View>
            </View>

            {/* 3대 지표 */}
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="bar-chart-outline" size={15} color={Colors.navy} />
              <Text style={styles.sectionTitle}>코칭 실적</Text>
              <Text style={styles.sectionSub}>KERRI 검증 · 조작 불가</Text>
            </View>
            <View style={metric.grid}>
              <MetricCard
                icon="flash"
                label="총 진행 레슨"
                value={`${perf.totalLessons}회`}
                sub="출석 기준"
                color={Colors.navy}
              />
              <MetricCard
                icon="people"
                label="회원 유지율"
                value={perf.totalMembers > 0 ? `${perf.retentionRate}%` : '-'}
                sub="최근 3개월"
                color="#10B981"
              />
              <MetricCard
                icon="document-text"
                label="피드백 기록률"
                value={`${perf.feedbackRate}%`}
                sub="AI 리포트 기준"
                color="#8B5CF6"
              />
            </View>

            {/* AI 리포트 유도 배너 */}
            {perf.totalLessons < 30 && (
              <View style={styles.aiBanner}>
                <Ionicons name="mic" size={16} color="#8B5CF6" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.aiBannerTitle}>AI 음성 분석으로 레슨 리포트를 쌓으세요</Text>
                  <Text style={styles.aiBannerSub}>30회 달성 시 코칭 스타일 태그가 프로필에 자동 표시됩니다</Text>
                </View>
                <View style={[styles.progressTrack, { width: 48 }]}>
                  <View style={[styles.progressFill, { width: `${Math.round((perf.totalLessons / 30) * 100)}%` as any, backgroundColor: '#8B5CF6' }]} />
                </View>
              </View>
            )}
          </View>

          {/* ── 1. 기본 프로필 ── */}
          <SectionCard icon="person-circle-outline" title="기본 프로필" onEdit={() => { setEditProfile({ ...profile }); setProfileModal(true); }}>
            <InfoRow icon="person-outline" label="이름" value={profile.name} />
            <InfoRow icon="tennisball-outline" label="종목" value={profile.sport} />
            <InfoRow icon="location-outline" label="활동 지역" value={regionLabel || undefined} />
            <InfoRow icon="business-outline" label="소속 센터" value={profile.center_name} last />
          </SectionCard>

          {/* ── 4. 경력 정보 ── */}
          <SectionCard icon="document-text-outline" title="경력 정보" onEdit={() => { setEditCareer({ ...career }); setCareerModal(true); }}>
            <InfoRow icon="time-outline" label="코칭 경력" value={career.coaching_years ? `${career.coaching_years}년` : undefined} />
            <InfoRow icon="trophy-outline" label="선수 경력" value={career.has_player_career ? '있음' : '없음'} />
            <InfoRow icon="briefcase-outline" label="주요 경력" value={career.career_details} multiline />
            <InfoRow icon="ribbon-outline" label="자격증" value={career.certifications} multiline />
            <InfoRow icon="medal-outline" label="수상 / 대회" value={career.awards} multiline last />
          </SectionCard>

          {/* ── 계정 ── */}
          <View style={styles.section}>
            <TouchableOpacity style={styles.logoutRow} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={16} color={Colors.destructive} />
              <Text style={styles.logoutRowText}>로그아웃</Text>
            </TouchableOpacity>
            <Text style={styles.emailHint}>{email}</Text>
          </View>

          <View style={{ height: 60 }} />
        </View>
      </ScrollView>

      {/* ── 하단 바 ── */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.previewBtn}>
          <Ionicons name="eye-outline" size={18} color="#fff" />
          <Text style={styles.previewBtnText}>내 프로필 미리보기</Text>
        </TouchableOpacity>
      </View>

      {/* ══ 모달: 기본 프로필 ══ */}
      <Modal visible={profileModal} transparent animationType="slide" onRequestClose={() => setProfileModal(false)}>
        <View style={styles.overlay}>
          <ScrollView style={{ maxHeight: '92%' }} keyboardShouldPersistTaps="handled">
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>기본 프로필</Text>

              <View style={styles.avatarEditWrap}>
                <TouchableOpacity style={styles.avatarEditBtn} onPress={handlePickAvatar} disabled={uploadingAvatar}>
                  {uploadingAvatar
                    ? <ActivityIndicator color={Colors.navy} />
                    : editProfile.avatar_url
                      ? <Image source={{ uri: editProfile.avatar_url }} style={styles.avatarEditImg} />
                      : <Ionicons name="camera-outline" size={28} color={Colors.navy} />}
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
                      <Text style={[styles.pickerOptionTxt, editProfile.sport === s && { color: Colors.navy, fontWeight: '700' }]}>{s}</Text>
                      {editProfile.sport === s && <Ionicons name="checkmark" size={14} color={Colors.navy} />}
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

      {/* ══ 모달: 경력 정보 ══ */}
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
                <Switch value={editCareer.has_player_career} onValueChange={v => setEditCareer(c => ({ ...c, has_player_career: v }))} trackColor={{ false: Colors.border, true: Colors.navy }} thumbColor="#fff" />
              </View>

              <Text style={styles.modalLabel}>주요 경력</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={editCareer.career_details} onChangeText={v => setEditCareer(c => ({ ...c, career_details: v }))} placeholder={'예: 전 대학 선수\n○○테니스아카데미 수석코치'} placeholderTextColor={Colors.placeholder} multiline />

              <Text style={styles.modalLabel}>자격증</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={editCareer.certifications} onChangeText={v => setEditCareer(c => ({ ...c, certifications: v }))} placeholder={'예: 생활체육지도자 2급\nKTA 공인 코치'} placeholderTextColor={Colors.placeholder} multiline />

              <Text style={styles.modalLabel}>수상 / 대회 경력</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={editCareer.awards} onChangeText={v => setEditCareer(c => ({ ...c, awards: v }))} placeholder={'예: 2023 전국 동호인 대회 우승\n○○오픈 준우승'} placeholderTextColor={Colors.placeholder} multiline />

              <SaveBtn onPress={saveCareer} loading={savingCareer} />
              <CancelBtn onPress={() => setCareerModal(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ─── 스타일 ───────────────────────────────
const metric = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  card: { flex: 1, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 14, alignItems: 'center', ...Shadow.sm },
  iconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  value: { fontSize: 20, fontWeight: '800', color: Colors.navy, marginBottom: 2 },
  label: { fontSize: 11, fontWeight: '700', color: Colors.mutedFg, textAlign: 'center' },
  sub: { fontSize: 10, color: Colors.placeholder, marginTop: 2, textAlign: 'center' },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  hero: { backgroundColor: Colors.primary, paddingBottom: 24 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  logoutBtn: { padding: 4 },
  avatarSection: { alignItems: 'center', paddingTop: 8, paddingBottom: 20 },
  avatarRing: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: Colors.mint + '50', justifyContent: 'center', alignItems: 'center', marginBottom: 10, position: 'relative' },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: 76, height: 76, borderRadius: 38 },
  avatarText: { fontSize: 30, fontWeight: '800', color: Colors.navy },
  cameraPin: { position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.navy, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: Colors.primary },
  heroName: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 4 },
  heroBio: { fontSize: 13, color: 'rgba(255,255,255,.7)', marginBottom: 8, paddingHorizontal: 24, textAlign: 'center' },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 12, color: 'rgba(255,255,255,.6)' },

  body: { paddingHorizontal: 16, paddingTop: 20 },
  section: { marginBottom: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: Colors.navy },
  sectionSub: { fontSize: 11, color: Colors.placeholder, marginLeft: 4 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto', backgroundColor: Colors.navy + '10', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  editBtnText: { fontSize: 12, fontWeight: '700', color: Colors.navy },
  card: { backgroundColor: Colors.card, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.sm },

  // 등급 카드
  gradeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.xl, borderWidth: 1.5, padding: 16, marginBottom: 14, gap: 14, ...Shadow.sm },
  gradeLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gradeIconWrap: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  gradeLabel: { fontSize: 11, color: Colors.mutedFg, fontWeight: '600' },
  gradeName: { fontSize: 18, fontWeight: '800' },
  gradeRight: { flex: 1 },
  gradeHint: { fontSize: 11, color: Colors.mutedFg, marginBottom: 6 },
  progressTrack: { height: 5, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3 },

  // AI 배너
  aiBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#8B5CF6' + '10', borderRadius: Radius.lg, borderWidth: 1, borderColor: '#8B5CF6' + '30', padding: 14, marginTop: 4 },
  aiBannerTitle: { fontSize: 13, fontWeight: '700', color: '#8B5CF6', marginBottom: 2 },
  aiBannerSub: { fontSize: 11, color: Colors.mutedFg },

  // InfoRow
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  infoIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.navy + '10', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  infoLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.navy },
  infoValue: { fontSize: 14, color: Colors.mutedFg, maxWidth: '55%', textAlign: 'right' },

  logoutRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: Colors.card, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border },
  logoutRowText: { fontSize: 14, fontWeight: '600', color: Colors.destructive },
  emailHint: { fontSize: 11, color: Colors.placeholder, marginTop: 6, textAlign: 'center' },

  bottomBar: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.white, paddingBottom: 28 },
  previewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.navy },
  previewBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48 },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.navy, marginBottom: 16 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: Colors.mutedBg, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.foreground, borderWidth: 1, borderColor: Colors.border, marginBottom: 4 },
  multilineInput: { minHeight: 72, textAlignVertical: 'top', paddingTop: 12 },
  charCount: { fontSize: 11, color: Colors.placeholder, textAlign: 'right', marginBottom: 8 },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.mutedBg, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border, marginBottom: 4 },
  pickerTxt: { fontSize: 15, color: Colors.foreground },
  pickerList: { backgroundColor: '#fff', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginBottom: 8 },
  pickerOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  pickerOptionSel: { backgroundColor: Colors.navy + '08' },
  pickerOptionTxt: { fontSize: 15, color: Colors.foreground },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.mutedBg, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border, marginBottom: 4 },
  switchLabel: { fontSize: 15, color: Colors.foreground, fontWeight: '600' },
  saveBtn: { backgroundColor: Colors.navy, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8 },
  saveBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelBtnTxt: { fontSize: 15, color: Colors.mutedFg, fontWeight: '600' },
  avatarEditWrap: { alignItems: 'center', marginBottom: 8 },
  avatarEditBtn: { width: 88, height: 88, borderRadius: 44, overflow: 'hidden', backgroundColor: Colors.navy + '12', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  avatarEditImg: { width: 88, height: 88, borderRadius: 44 },
  avatarEditOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,.4)', paddingVertical: 5, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 3 },
  avatarEditOverlayTxt: { fontSize: 10, color: '#fff', fontWeight: '600' },
});
