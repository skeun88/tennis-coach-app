import { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Modal, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { supabase } from '../lib/supabase';
import { Colors } from '../lib/theme';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const TERRA = '#C0755A';
const TERRA_LIGHT = '#FBF2EF';
const DARK = '#3E2B22';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved?: (count: number) => void;
  onDeleted?: () => void;
  knowledgeList?: any[];
  onKnowledgeListChange?: (list: any[]) => void;
}

export default function CoachingStyleModal({ visible, onClose, onSaved, onDeleted, knowledgeList = [], onKnowledgeListChange }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [knowledgeUploading, setKnowledgeUploading] = useState(false);
  const [knowledgeText, setKnowledgeText] = useState('');
  const [knowledgeCategory, setKnowledgeCategory] = useState('기타');
  const [voiceRecordingDuration, setVoiceRecordingDuration] = useState(0);
  const [knowledgeFileUploading, setKnowledgeFileUploading] = useState(false);
  const audioRecorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: false });
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function handleClose() {
    if (isRecording) {
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      audioRecorder.stop().catch(() => {});
      setIsRecording(false);
    }
    setKnowledgeText('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.cont}>
          <View style={styles.head}>
            <Text style={styles.modalTitle}>코칭 스타일 관리</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={24} color={Colors.foreground} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
            {/* 가이드 카드 */}
            <View style={styles.guideCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Ionicons name="bulb-outline" size={18} color={Colors.primary} />
                <Text style={styles.guideTitle}>코칭 스타일을 AI에게 알려주세요</Text>
              </View>
              <Text style={styles.guideBody}>
                음성 또는 텍스트로 입력하면 AI가 학습해 리포트를 코치님 스타일로 작성해요.{'\n\n'}
                <Text style={styles.guideBold}>예시</Text>{'\n'}
                • "초보자는 임팩트 타점부터 교정한다"{'\n'}
                • "서브 토스 불안정 시 매 레슨 5분 반복"{'\n'}
                • '"랠리" 같은 테니스 용어 음성인식 정확도 높여줘'{'\n\n'}
                <Text style={styles.guideBold}>팁</Text>{'  '}스타일·드릴·피드백 방식을 추가할수록 정확해져요
              </Text>
            </View>

            <Text style={styles.modalLabel}>카테고리</Text>
            <View style={styles.categoryRow}>
              {['포핸드', '백핸드', '서브', '전술', '멘탈', '기타'].map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryBtn, knowledgeCategory === cat && styles.categoryBtnActive]}
                  onPress={() => setKnowledgeCategory(cat)}
                >
                  <Text style={[styles.categoryBtnText, knowledgeCategory === cat && styles.categoryBtnTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 음성 녹음 */}
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
                        onSaved?.(result.saved);
                        handleClose();
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
                  <Ionicons name={isRecording ? 'stop-circle' : 'mic'} size={22} color="#fff" />
                  <Text style={styles.uploadBtnText}>{isRecording ? `녹음 중... ${voiceRecordingDuration}초 (탭하면 완료)` : '음성으로 코칭 스타일 녹음'}</Text>
                </>
              )}
            </TouchableOpacity>

            {/* 텍스트 직접 입력 */}
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
                      onSaved?.(result.saved);
                      handleClose();
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

            {/* 파일 업로드 */}
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
                    onSaved?.(json.saved);
                    handleClose();
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

            {/* 등록된 목록 */}
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
                          onKnowledgeListChange?.(knowledgeList.filter(x => x.id !== k.id));
                          onDeleted?.();
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
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cont: { flex: 1, backgroundColor: Colors.background },
  head: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: DARK },
  modalLabel: { fontSize: 12, fontWeight: '700', color: Colors.mutedFg, marginBottom: 6, marginTop: 12 },
  guideCard: { backgroundColor: '#FAF4F0', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#EDE0D4' },
  guideTitle: { fontSize: 15, fontWeight: '700', color: '#5C4033' },
  guideBody: { fontSize: 14, color: '#7A6658', lineHeight: 22 },
  guideBold: { fontWeight: '700', color: '#5C4033' },
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
