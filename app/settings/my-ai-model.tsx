import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Animated, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const TERRA = '#C0755A';
const TERRA_LIGHT = '#FBF2EF';
const DARK = '#3E2B22';

// 종목별 카테고리 — 테니스 하드코딩 대신 config로 분리 가능하도록 배열로 관리
const CATEGORIES = ['포핸드', '백핸드', '서브', '전술', '멘탈', '기타'];

type KnowledgeItem = {
  id: string;
  category: string;
  title: string;
  content?: string;
  created_at: string;
};

export default function MyAiModelScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [principles, setPrinciples] = useState<KnowledgeItem[]>([]);

  // 직접 등록 섹션
  const [addOpen, setAddOpen] = useState(false);
  const [category, setCategory] = useState('기타');
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);

  // 수정 모달
  const [editItem, setEditItem] = useState<KnowledgeItem | null>(null);
  const [editCategory, setEditCategory] = useState('기타');
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // 음성 녹음
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const audioRecorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: false });
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 토스트
  const [toastMsg, setToastMsg] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadPrinciples();
  }, []);

  function showToast(msg: string) {
    setToastMsg(msg);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }

  async function loadPrinciples() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('tennis_knowledge')
      .select('id, category, title, content, created_at')
      .eq('coach_id', user.id)
      .order('created_at', { ascending: false });
    setPrinciples(data ?? []);
    setLoading(false);
  }

  async function handleDelete(item: KnowledgeItem) {
    Alert.alert('삭제', `"${item.title}" 항목을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => {
        await supabase.from('tennis_knowledge').delete().eq('id', item.id);
        setPrinciples(prev => prev.filter(x => x.id !== item.id));
        showToast('삭제됐어요');
      }},
    ]);
  }

  function openEditModal(item: KnowledgeItem) {
    setEditItem(item);
    setEditCategory(item.category);
    setEditTitle(item.title);
    setEditContent(item.content ?? '');
  }

  function closeEditModal() {
    setEditItem(null);
    setEditTitle('');
    setEditContent('');
  }

  async function handleEditSave() {
    if (!editItem || !editTitle.trim()) return;
    setEditSaving(true);
    const { error } = await supabase.from('tennis_knowledge').update({
      category: editCategory,
      title: editTitle.trim(),
      content: editContent.trim() || null,
    }).eq('id', editItem.id);
    setEditSaving(false);
    if (error) { Alert.alert('오류', '저장에 실패했어요.'); return; }
    setPrinciples(prev => prev.map(x =>
      x.id === editItem.id
        ? { ...x, category: editCategory, title: editTitle.trim(), content: editContent.trim() || undefined }
        : x
    ));
    closeEditModal();
    showToast('수정됐어요');
  }

  async function handleVoiceToggle() {
    if (!isRecording) {
      try {
        const status = await AudioModule.requestRecordingPermissionsAsync();
        if (!status.granted) { Alert.alert('권한 필요', '마이크 접근 권한이 필요해요.'); return; }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
        audioRecorder.record();
        setRecordingDuration(0);
        voiceTimerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
        setIsRecording(true);
      } catch { Alert.alert('오류', '녹음을 시작할 수 없어요.'); }
    } else {
      setUploading(true);
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      const duration = recordingDuration;
      setIsRecording(false);
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (uri) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          const { data: { session } } = await supabase.auth.getSession();
          const form = new FormData();
          form.append('coach_id', user!.id);
          form.append('category', category);
          form.append('duration_seconds', String(duration));
          form.append('audio', { uri, type: 'audio/m4a', name: 'recording.m4a' } as any);
          const res = await fetch(`${SUPABASE_URL}/functions/v1/add-coach-knowledge`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session?.access_token}` },
            body: form,
          });
          const result = await res.json();
          if (result.success) {
            showToast(`${result.saved}개 원칙이 추가됐어요`);
            await loadPrinciples();
            setAddOpen(false);
          } else {
            Alert.alert('오류', result.error || '등록 실패');
          }
        } catch { Alert.alert('오류', '업로드 실패'); }
      }
      setUploading(false);
    }
  }

  async function handleTextSubmit() {
    if (!inputText.trim()) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/add-coach-knowledge`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ coach_id: user!.id, category, text: inputText }),
      });
      const result = await res.json();
      if (result.success) {
        showToast(`${result.saved}개 원칙이 추가됐어요`);
        setInputText('');
        await loadPrinciples();
        setAddOpen(false);
      } else {
        Alert.alert('오류', result.error || '등록 실패');
      }
    } catch { Alert.alert('오류', '텍스트 등록 실패'); }
    setUploading(false);
  }

  async function handleFileUpload() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'text/plain', copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      setFileUploading(true);
      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('coach_id', user!.id);
      form.append('category', category);
      form.append('file', { uri: file.uri, type: 'text/plain', name: file.name } as any);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/add-coach-knowledge`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        body: form,
      });
      const result = await res.json();
      if (result.success) {
        showToast(`${result.saved}개 원칙이 추가됐어요`);
        await loadPrinciples();
        setAddOpen(false);
      } else {
        Alert.alert('오류', result.error || '파일 등록 실패');
      }
    } catch { Alert.alert('오류', '파일 업로드 실패'); }
    setFileUploading(false);
  }

  return (
    <View style={{ flex: 1 }}>
      <SettingsHeader title="나의 AI 코칭 모델" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>

          {/* ── 소개 카드 ── */}
          <View style={styles.introCard}>
            <View style={styles.introIconRow}>
              <Ionicons name="hardware-chip-outline" size={20} color={TERRA} />
              <Text style={styles.introTitle}>어떻게 작동하나요?</Text>
            </View>
            <Text style={styles.introBody}>
              코치님이 등록한 코칭 원칙은 레슨 리포트를 작성할 때 참고 자료로 활용돼요.{'\n\n'}
              원칙이 많을수록 코치님 스타일에 맞는 리포트가 만들어질 가능성이 높아져요.
              AI 모델을 직접 재학습하는 것은 아니에요.
            </Text>
          </View>

          {/* ── 내 코칭 원칙 목록 ── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>내 코칭 원칙</Text>
            <Text style={styles.sectionCount}>{principles.length}개</Text>
          </View>

          {loading ? (
            <View style={styles.centerPad}><ActivityIndicator color={TERRA} /></View>
          ) : principles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="document-text-outline" size={32} color={Colors.border} />
              <Text style={styles.emptyText}>아직 등록된 코칭 원칙이 없어요</Text>
              <Text style={styles.emptySubText}>아래 직접 등록에서 추가해보세요</Text>
            </View>
          ) : (
            <View style={styles.card}>
              {principles.map((item, idx) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.principleRow, idx > 0 && styles.principleRowBorder]}
                  onPress={() => openEditModal(item)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.principleTopRow}>
                      <Text style={styles.categoryTag}>{item.category}</Text>
                    </View>
                    <Text style={styles.principleTitle} numberOfLines={2}>{item.title}</Text>
                    {item.content ? (
                      <Text style={styles.principleContent} numberOfLines={2}>{item.content}</Text>
                    ) : null}
                  </View>
                  <View style={styles.principleActions}>
                    <TouchableOpacity
                      style={styles.editBtn}
                      onPress={() => openEditModal(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="pencil-outline" size={15} color={TERRA} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => handleDelete(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={15} color={Colors.mutedFg} />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── 직접 등록 ── */}
          <TouchableOpacity
            style={styles.addToggleBtn}
            onPress={() => setAddOpen(v => !v)}
            activeOpacity={0.8}
          >
            <Ionicons name={addOpen ? 'chevron-up' : 'add-circle-outline'} size={20} color={TERRA} />
            <Text style={styles.addToggleBtnText}>직접 등록</Text>
          </TouchableOpacity>

          {addOpen && (
            <View style={styles.addCard}>
              {/* 카테고리 선택 */}
              <Text style={styles.fieldLabel}>카테고리</Text>
              <View style={styles.categoryRow}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catBtn, category === cat && styles.catBtnActive]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={[styles.catBtnText, category === cat && styles.catBtnTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 음성 입력 */}
              <TouchableOpacity
                style={[styles.inputBtn, isRecording && styles.inputBtnRecording]}
                onPress={handleVoiceToggle}
                disabled={uploading}
                activeOpacity={0.8}
              >
                {uploading && isRecording === false ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name={isRecording ? 'stop-circle' : 'mic'} size={20} color="#fff" />
                    <Text style={styles.inputBtnText}>
                      {isRecording ? `녹음 중... ${recordingDuration}초 (탭하면 완료)` : '음성으로 입력'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* 텍스트 입력 */}
              <Text style={styles.fieldLabel}>텍스트로 입력</Text>
              <TextInput
                style={styles.textInput}
                placeholder="코칭 철학, 훈련 방법, 기술 포인트 등 자유롭게 입력하세요"
                placeholderTextColor={Colors.placeholder}
                multiline
                numberOfLines={4}
                value={inputText}
                onChangeText={setInputText}
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.inputBtn, styles.inputBtnGreen, (!inputText.trim() || uploading) && { opacity: 0.45 }]}
                disabled={!inputText.trim() || uploading}
                onPress={handleTextSubmit}
                activeOpacity={0.8}
              >
                {uploading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    <Text style={styles.inputBtnText}>텍스트로 등록</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* 파일 업로드 */}
              <TouchableOpacity
                style={[styles.inputBtn, styles.inputBtnIndigo, fileUploading && { opacity: 0.6 }]}
                disabled={fileUploading}
                onPress={handleFileUpload}
                activeOpacity={0.8}
              >
                {fileUploading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="document-text" size={20} color="#fff" />
                    <Text style={styles.inputBtnText}>텍스트 파일(.txt) 업로드</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 48 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {toastMsg ? (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={styles.toastText}>{toastMsg}</Text>
        </Animated.View>
      ) : null}

      {/* ── 수정 모달 ── */}
      <Modal
        visible={editItem !== null}
        transparent
        animationType="slide"
        onRequestClose={closeEditModal}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={closeEditModal}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
            <TouchableOpacity
              style={[styles.editSheet, { paddingBottom: insets.bottom + 16 }]}
              activeOpacity={1}
              onPress={() => {}}
            >
              <View style={styles.editSheetHandle} />
              <Text style={styles.editSheetTitle}>코칭 원칙 수정</Text>

              <Text style={styles.editSheetLabel}>카테고리</Text>
              <View style={styles.categoryRow}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catBtn, editCategory === cat && styles.catBtnActive]}
                    onPress={() => setEditCategory(cat)}
                  >
                    <Text style={[styles.catBtnText, editCategory === cat && styles.catBtnTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.editSheetLabel}>제목</Text>
              <TextInput
                style={styles.editSheetInput}
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="원칙 제목"
                placeholderTextColor={Colors.placeholder}
              />

              <Text style={styles.editSheetLabel}>내용 (선택)</Text>
              <TextInput
                style={[styles.editSheetInput, { minHeight: 80, textAlignVertical: 'top' }]}
                value={editContent}
                onChangeText={setEditContent}
                placeholder="구체적인 내용을 입력하세요"
                placeholderTextColor={Colors.placeholder}
                multiline
              />

              <TouchableOpacity
                style={[styles.editSheetSaveBtn, (editSaving || !editTitle.trim()) && { opacity: 0.5 }]}
                disabled={editSaving || !editTitle.trim()}
                onPress={handleEditSave}
                activeOpacity={0.8}
              >
                {editSaving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.editSheetSaveBtnText}>저장</Text>
                )}
              </TouchableOpacity>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { paddingTop: 12, paddingBottom: 48 },
  centerPad: { paddingVertical: 32, alignItems: 'center' },

  introCard: {
    backgroundColor: '#FAF4F0',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDE0D4',
  },
  introIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  introTitle: { fontSize: 15, fontWeight: '700', color: DARK },
  introBody: { fontSize: 13, color: '#7A6658', lineHeight: 20 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  sectionCount: { fontSize: 13, color: Colors.mutedFg },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },

  emptyCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  emptyText: { fontSize: 14, color: Colors.mutedFg, fontWeight: '600' },
  emptySubText: { fontSize: 12, color: Colors.placeholder },

  principleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  principleRowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  principleTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  categoryTag: {
    fontSize: 11,
    color: TERRA,
    backgroundColor: TERRA_LIGHT,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    fontWeight: '700',
    overflow: 'hidden',
  },
  principleTitle: { fontSize: 13, color: Colors.foreground, lineHeight: 18 },
  principleContent: { fontSize: 12, color: Colors.mutedFg, lineHeight: 17, marginTop: 2 },
  principleActions: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 2 },
  editBtn: { padding: 4 },
  deleteBtn: { padding: 4 },

  addToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: TERRA_LIGHT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE0D4',
  },
  addToggleBtnText: { fontSize: 15, fontWeight: '700', color: TERRA },

  addCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#fff',
  },
  catBtnActive: { backgroundColor: TERRA, borderColor: TERRA },
  catBtnText: { fontSize: 13, color: Colors.mutedFg },
  catBtnTextActive: { color: '#fff', fontWeight: '700' },

  inputBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: TERRA,
    borderRadius: 12,
    padding: 14,
  },
  inputBtnRecording: { backgroundColor: Colors.destructive },
  inputBtnGreen: { backgroundColor: '#059669' },
  inputBtnIndigo: { backgroundColor: '#6366F1' },
  inputBtnText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },

  textInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: Colors.foreground,
    minHeight: 100,
    backgroundColor: '#FAFAFA',
  },

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

  // 수정 모달
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 4,
  },
  editSheetHandle: {
    width: 40, height: 4, backgroundColor: Colors.border,
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  editSheetTitle: { fontSize: 17, fontWeight: '800', color: DARK, marginBottom: 12 },
  editSheetLabel: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, marginTop: 10, marginBottom: 6 },
  editSheetInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: Colors.foreground,
    backgroundColor: '#FAFAFA',
  },
  editSheetSaveBtn: {
    backgroundColor: TERRA,
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    marginTop: 16,
  },
  editSheetSaveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
