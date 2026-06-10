/**
 * CoachQRModal
 *
 * 코치 초대 QR 코드 전체화면 모달.
 * - QR 데이터: `kerri://join?coach_id=<coach_uuid>`
 * - [이미지로 저장] / [공유하기] 버튼 포함
 * - profile.tsx 및 index.tsx 에서 공용 사용
 */
import React, { useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius } from '../lib/theme';

interface CoachQRModalProps {
  visible: boolean;
  onClose: () => void;
  coachId: string;
  coachName?: string;
}

export default function CoachQRModal({
  visible,
  onClose,
  coachId,
  coachName,
}: CoachQRModalProps) {
  const qrValue = `kerri://join?coach_id=${coachId}`;
  const viewShotRef = useRef<any>(null);
  const [saving, setSaving] = useState(false);

  async function captureQR(): Promise<string | null> {
    try {
      const uri = await viewShotRef.current?.capture?.();
      return uri ?? null;
    } catch {
      return null;
    }
  }

  async function handleSave() {
    setSaving(true);
    const uri = await captureQR();
    if (!uri) {
      Alert.alert('저장 실패', 'QR 코드 이미지를 생성하지 못했어요.');
      setSaving(false);
      return;
    }
    const destPath = `${FileSystem.documentDirectory}kerri_qr_${coachId}.png`;
    try {
      await FileSystem.copyAsync({ from: uri, to: destPath });
      Alert.alert('저장 완료', '갤러리에 저장되었어요 📷');
    } catch {
      Alert.alert('저장 실패', '이미지 저장 중 오류가 발생했어요.');
    }
    setSaving(false);
  }

  async function handleCopy() {
    setSaving(true);
    const uri = await captureQR();
    if (!uri) {
      Alert.alert('복사 실패', 'QR 코드 이미지를 생성하지 못했어요.');
      setSaving(false);
      return;
    }
    try {
      // base64로 읽어서 클립보드에 복사
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Clipboard.setStringAsync(`data:image/png;base64,${base64}`);
      Alert.alert('복사 완료', 'QR 코드 이미지가 클립보드에 복사되었어요 📋');
    } catch {
      Alert.alert('복사 실패', '클립보드 복사 중 오류가 발생했어요.');
    }
    setSaving(false);
  }

  async function handleShare() {
    setSaving(true);
    const uri = await captureQR();
    if (!uri) {
      Alert.alert('공유 실패', 'QR 코드 이미지를 생성하지 못했어요.');
      setSaving(false);
      return;
    }
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert('공유 불가', '이 기기에서는 공유 기능을 사용할 수 없어요.');
      setSaving(false);
      return;
    }
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: `${coachName ?? '코치'} 초대 QR 코드`,
    });
    setSaving(false);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* 닫기 버튼 */}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color={Colors.mutedFg} />
          </TouchableOpacity>

          {/* 타이틀 */}
          <Text style={styles.title}>내 초대 QR</Text>
          <Text style={styles.subtitle}>
            QR 코드를 스캔하면 회원이 바로 등록돼요
          </Text>

          {/* QR 캡처 영역 */}
          <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1.0 }}>
            <View style={styles.qrCard}>
              {/* 상단 브랜드 */}
              <View style={styles.qrBrand}>
                <Ionicons name="tennisball" size={16} color={Colors.primary} />
                <Text style={styles.qrBrandText}>KERRI</Text>
              </View>

              <QRCode
                value={qrValue}
                size={200}
                color={Colors.navy}
                backgroundColor={Colors.white}
                logo={undefined}
              />

              {/* 하단 이름 */}
              {coachName ? (
                <Text style={styles.qrCoachName}>{coachName} 코치</Text>
              ) : null}
              <Text style={styles.qrHint}>kerri://join</Text>
            </View>
          </ViewShot>

          {/* 딥링크 값 (참고용 소형 텍스트) */}
          <Text style={styles.qrValue} numberOfLines={1} ellipsizeMode="middle">
            {qrValue}
          </Text>

          {/* 액션 버튼들 */}
          {saving ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 20 }} />
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleSave}>
                <Ionicons name="download-outline" size={16} color={Colors.primary} />
                <Text style={styles.actionBtnText}>저장</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={handleCopy}>
                <Ionicons name="copy-outline" size={16} color={Colors.primary} />
                <Text style={styles.actionBtnText}>복사</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnPrimary]}
                onPress={handleShare}
              >
                <Ionicons name="share-outline" size={16} color={Colors.white} />
                <Text style={[styles.actionBtnText, { color: Colors.white }]}>공유</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.mutedBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.navy,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.mutedFg,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 19,
  },
  qrCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  qrBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 14,
  },
  qrBrandText: {
    fontSize: 14,
    fontWeight: '900',
    color: Colors.primary,
    letterSpacing: 1.5,
  },
  qrCoachName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.navy,
    marginTop: 14,
  },
  qrHint: {
    fontSize: 11,
    color: Colors.mutedFg,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  qrValue: {
    fontSize: 11,
    color: Colors.placeholder,
    marginTop: 12,
    maxWidth: 300,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
  },
  actionBtnPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
});
