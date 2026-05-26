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

interface CoachStats {
  totalMembers: number;
  totalLessons: number;
  reportRate: number;
}

interface ProfileInfo {
  name: string;
  avatar_url: string;
  sport: string;
  region_city: string;
  region_district: string;
  center_name: string;
  bio: string;
}

interface CareerInfo {
  coaching_years: string;
  has_player_career: boolean;
  career_details: string;
  certifications: string;
  awards: string;
}

// ─── 서브 컴포넌트 ───────────────────────
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
      <Text style={[styles.infoValue, multiline && { flex: 1, textAlign: 'right' }]} numberOfLines={multiline ? 2 : 1}>
        {value || '-'}
      </Text>
    </View>
  );
}

function ModalLabel({ children }: { children: string }) {
  return <Text style={styles.modalLabel}>{children}</Text>;
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
  const [stats, setStats] = useState<CoachStats>({ totalMembers: 0, totalLessons: 0, reportRate: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // 섹션 1
  const [profile, setProfile] = useState<ProfileInfo>({ name: '', avatar_url: '', sport: '테니스', region_city: '', region_district: '', center_name: '', bio: '' });
  const [profileModal, setProfileModal] = useState(false);
  const [editProfile, setEditProfile] = useState<ProfileInfo>({ name: '', avatar_url: '', sport: '테니스', region_city: '', region_district: '', center_name: '', bio: '' });
  const [sportPickerOpen, setSportPickerOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // 섹션 4
  const [career, setCareer] = useState<CareerInfo>({ coaching_years: '', has_player_career: false, career_details: '', certifications: '', awards: '' });
  const [careerModal, setCareerModal] = useState(false);
  const [editCareer, setEditCareer] = useState<CareerInfo>({ coaching_years: '', has_player_career: false, career_details: '', certifications: '', awards: '' });
  const [savingCareer, setSavingCareer] = useState(false);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setEmail(user.email ?? '');

    const [membersRes, lessonIdsRes, plansRes, profileRes] = await Promise.all([
      supabase.from('members').select('*', { count: 'exact', head: true }).eq('coach_id', user.id),
      supabase.from('lessons').select('id').eq('coach_id', user.id),
      supabase.from('lesson_plans').select('*', { count: 'exact', head: true }).eq('coach_id', user.id),
      supabase.from('coach_profiles').select('*').eq('id', user.id).maybeSingle(),
    ]);

    const totalMembers = membersRes.count ?? 0;
    const myLessonIds = (lessonIdsRes.data ?? []).map((l: any) => l.id);
    let totalLessons = 0;
    if (myLessonIds.length > 0) {
      const { data: attended } = await supabase.from('attendance').select('lesson_id').in('lesson_id', myLessonIds).eq('status', '출석');
      totalLessons = new Set((attended ?? []).map((r: any) => r.lesson_id)).size;
    }
    const totalPlans = plansRes.count ?? 0;
    const reportRate = totalLessons > 0 ? Math.round((totalPlans / totalLessons) * 100) : 0;
    setStats({ totalMembers, totalLessons, reportRate });

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
      if (error) {
        setEditProfile(p => ({ ...p, avatar_url: uri }));
      } else {
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(filePath);
        setEditProfile(p => ({ ...p, avatar_url: pub.publicUrl }));
      }
    } catch { setEditProfile(p => ({ ...p, avatar_url: uri })); }
    finally { setUploadingAvatar(false); }
  }

  async function saveProfile() {
    if (!editProfile.name.trim()) { Alert.alert('오류', '이름을 입력해주세요.'); return; }
    setSavingProfile(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingProfile(false); return; }
    const { error } = await supabase.from('coach_profiles').upsert({
      id: user.id,
      name: editProfile.name.trim(),
      avatar_url: editProfile.avatar_url || null,
      sport: editProfile.sport,
      region_city: editProfile.region_city.trim() || null,
      region_district: editProfile.region_district.trim() || null,
      center_name: editProfile.center_name.trim() || null,
      bio: editProfile.bio.trim() || null,
      updated_at: new Date().toISOString(),
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
                : <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
              }
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
          <View style={styles.statsStrip}>
            <View style={styles.statItem}><Text style={styles.statNum}>{stats.totalMembers}명</Text><Text style={styles.statLbl}>누적 회원</Text></View>
            <View style={styles.statDiv} />
            <View style={styles.statItem}><Text style={styles.statNum}>{stats.totalLessons}회</Text><Text style={styles.statLbl}>누적 레슨</Text></View>
            <View style={styles.statDiv} />
            <View style={styles.statItem}><Text style={styles.statNum}>{stats.reportRate}%</Text><Text style={styles.statLbl}>리포트율</Text></View>
          </View>
        </View>

        <View style={styles.body}>

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

      {/* ══ 모달: 1. 기본 프로필 ══ */}
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
                      : <Ionicons name="camera-outline" size={28} color={Colors.navy} />
                  }
                  <View style={styles.avatarEditOverlay}>
                    <Ionicons name="camera" size={12} color="#fff" />
                    <Text style={styles.avatarEditOverlayTxt}>사진 변경</Text>
                  </View>
                </TouchableOpacity>
              </View>

              <ModalLabel>코치 이름 *</ModalLabel>
              <TextInput style={styles.input} value={editProfile.name} onChangeText={v => setEditProfile(p => ({ ...p, name: v }))} placeholder="코치 이름" placeholderTextColor={Colors.placeholder} />

              <ModalLabel>종목 *</ModalLabel>
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

              <ModalLabel>활동 지역</ModalLabel>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput style={[styles.input, { flex: 1 }]} value={editProfile.region_city} onChangeText={v => setEditProfile(p => ({ ...p, region_city: v }))} placeholder="시 (예: 서울)" placeholderTextColor={Colors.placeholder} />
                <TextInput style={[styles.input, { flex: 1 }]} value={editProfile.region_district} onChangeText={v => setEditProfile(p => ({ ...p, region_district: v }))} placeholder="구 (예: 강남구)" placeholderTextColor={Colors.placeholder} />
              </View>

              <ModalLabel>소속 센터</ModalLabel>
              <TextInput style={styles.input} value={editProfile.center_name} onChangeText={v => setEditProfile(p => ({ ...p, center_name: v }))} placeholder="센터 또는 클럽명" placeholderTextColor={Colors.placeholder} />

              <ModalLabel>한 줄 소개</ModalLabel>
              <TextInput style={[styles.input, { minHeight: 60, textAlignVertical: 'top', paddingTop: 12 }]} value={editProfile.bio} onChangeText={v => setEditProfile(p => ({ ...p, bio: v }))} placeholder="나를 한 문장으로 소개해보세요" placeholderTextColor={Colors.placeholder} multiline maxLength={80} />
              <Text style={styles.charCount}>{editProfile.bio.length}/80</Text>

              <SaveBtn onPress={saveProfile} loading={savingProfile} />
              <CancelBtn onPress={() => setProfileModal(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ══ 모달: 4. 경력 정보 ══ */}
      <Modal visible={careerModal} transparent animationType="slide" onRequestClose={() => setCareerModal(false)}>
        <View style={styles.overlay}>
          <ScrollView style={{ maxHeight: '92%' }} keyboardShouldPersistTaps="handled">
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>경력 정보</Text>

              <ModalLabel>코칭 경력 (연수)</ModalLabel>
              <TextInput style={styles.input} value={editCareer.coaching_years} onChangeText={v => setEditCareer(c => ({ ...c, coaching_years: v.replace(/[^0-9]/g, '') }))} placeholder="예: 7" placeholderTextColor={Colors.placeholder} keyboardType="numeric" maxLength={2} />

              <ModalLabel>선수 경력</ModalLabel>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{editCareer.has_player_career ? '있음' : '없음'}</Text>
                <Switch value={editCareer.has_player_career} onValueChange={v => setEditCareer(c => ({ ...c, has_player_career: v }))} trackColor={{ false: Colors.border, true: Colors.navy }} thumbColor="#fff" />
              </View>

              <ModalLabel>주요 경력</ModalLabel>
              <TextInput style={[styles.input, styles.multilineInput]} value={editCareer.career_details} onChangeText={v => setEditCareer(c => ({ ...c, career_details: v }))} placeholder={'예: 전 대학 선수\n○○테니스아카데미 수석코치'} placeholderTextColor={Colors.placeholder} multiline />

              <ModalLabel>자격증</ModalLabel>
              <TextInput style={[styles.input, styles.multilineInput]} value={editCareer.certifications} onChangeText={v => setEditCareer(c => ({ ...c, certifications: v }))} placeholder={'예: 생활체육지도자 2급\nKTA 공인 코치'} placeholderTextColor={Colors.placeholder} multiline />

              <ModalLabel>수상 / 대회 경력</ModalLabel>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  hero: { backgroundColor: Colors.primary, paddingBottom: 24 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  logoutBtn: { padding: 4 },
  avatarSection: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
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
  statsStrip: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: 'rgba(255,255,255,.08)', borderRadius: Radius.lg, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,.1)' },
  statItem: { flex: 1, alignItems: 'center' },
  statDiv: { width: 1, backgroundColor: 'rgba(255,255,255,.15)' },
  statNum: { fontSize: 18, fontWeight: '800', color: '#fff' },
  statLbl: { fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 2 },
  body: { paddingHorizontal: 16, paddingTop: 20 },
  section: { marginBottom: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: Colors.navy },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto', backgroundColor: Colors.navy + '10', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  editBtnText: { fontSize: 12, fontWeight: '700', color: Colors.navy },
  card: { backgroundColor: Colors.card, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.sm },
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
