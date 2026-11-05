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
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius } from '../lib/theme';

interface CoachQRModalProps {
  visible: boolean;
  onClose: () => void;
  coachId: string;
  coachName?: string;
  publicSlug?: string | null;
}

export default function CoachQRModal({
  visible,
  onClose,
  coachId,
  coachName,
  publicSlug,
}: CoachQRModalProps) {
  const qrValue = publicSlug
    ? `https://kerri.co.kr/coach/${publicSlug}`
    : `kerri-member://qr-onboarding?coach_id=${coachId}`;
  const profileUrl = publicSlug ? `https://kerri.co.kr/coach/${publicSlug}` : null;
  const viewShotRef = useRef<any>(null);
  const [saving, setSaving] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  function showToast() {
    setToastVisible(true);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  }

  async function handleCopyProfileUrl() {
    if (!profileUrl) return;
    try {
      await Clipboard.setStringAsync(profileUrl);
      showToast();
    } catch {
      Alert.alert('복사 실패', '클립보드 복사 중 오류가 발생했어요.');
    }
  }

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
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert('저장 불가', '이 기기에서는 저장 기능을 사용할 수 없어요.');
      setSaving(false);
      return;
    }
    // 공유 시트에서 "이미지 저장" 선택하면 갤러리에 저장됩니다
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
    setSaving(false);
  }

  async function handleCopy() {
    const copyTarget = profileUrl ?? qrValue;
    try {
      await Clipboard.setStringAsync(copyTarget);
      if (profileUrl) {
        showToast();
      } else {
        Alert.alert('복사 완료', 'QR 링크가 클립보드에 복사되었어요 📋');
      }
    } catch {
      Alert.alert('복사 실패', '클립보드 복사 중 오류가 발생했어요.');
    }
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
      UTI: 'public.png',
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
          <Text style={styles.title}>나의 코치 프로필 공유</Text>
          <Text style={styles.subtitle}>
            {publicSlug
              ? '레슨 중에도 새로운 문의를 놓치지 마세요'
              : 'QR 코드를 스캔하면 회원이 바로 등록돼요'}
          </Text>
          {publicSlug ? (
            <Text style={styles.subDesc}>
              인스타그램이나 레슨장에 프로필을 공유해 보세요. 레슨에 관심 있는 누구나 내 프로필을 확인하고 간편하게 문의할 수 있어요.
            </Text>
          ) : null}

          {/* QR 캡처 영역 */}
          <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1.0 }}>
            <View style={styles.qrCard}>
              {/* 상단 브랜드 — 공식 로고 에셋 */}
              <View style={styles.qrBrand}>
                <Image
                  source={require('../assets/images/kerri-logo.png')}
                  style={styles.qrLogoImg}
                  resizeMode="contain"
                />
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
              {/* 카드 내부 안내 문구 — 위치 교환: 기존 URL row 대신 앱 설치 안내 */}
              {publicSlug ? (
                <Text style={styles.qrNoticeInCard}>앱 설치 없이 웹에서 레슨 문의 가능</Text>
              ) : (
                <Text style={styles.qrHint}>KERRI Member</Text>
              )}
            </View>
          </ViewShot>

          {/* 카드 외부 — 프로필 URL + 복사 (publicSlug 있을 때) */}
          {publicSlug && profileUrl ? (
            <View style={styles.qrUrlRow}>
              <Text style={styles.qrUrlText} numberOfLines={1} ellipsizeMode="tail">
                {profileUrl}
              </Text>
              <TouchableOpacity
                onPress={handleCopyProfileUrl}
                hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
                style={styles.qrCopyIconBtn}
              >
                <Ionicons name="copy-outline" size={16} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          ) : !publicSlug ? (
            <Text style={styles.qrValue} numberOfLines={1} ellipsizeMode="middle">
              {qrValue}
            </Text>
          ) : null}

          {/* 복사 토스트 */}
          {toastVisible && (
            <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
              <Text style={styles.toastText}>프로필 링크를 복사했어요</Text>
            </Animated.View>
          )}

          {/* 액션 버튼들 */}
          {saving ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 20 }} />
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleSave}>
                <Ionicons name="download-outline" size={16} color={Colors.primary} />
                <Text style={styles.actionBtnText}>QR 저장</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => { if (profileUrl) Linking.openURL(profileUrl); }}
              >
                <Ionicons name="open-outline" size={16} color={Colors.primary} />
                <Text style={styles.actionBtnText}>홈페이지 보기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnPrimary]}
                onPress={handleShare}
              >
                <Ionicons name="share-outline" size={16} color={Colors.white} />
                <Text style={[styles.actionBtnText, { color: Colors.white }]}>공유하기</Text>
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
    marginBottom: 8,
    lineHeight: 19,
    fontWeight: '600',
  },
  subDesc: {
    fontSize: 12,
    color: Colors.mutedFg,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
    paddingHorizontal: 4,
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
    alignItems: 'center',
    marginBottom: 14,
  },
  qrLogoImg: {
    width: 108,
    height: 36,
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
  qrNoticeInCard: {
    fontSize: 11,
    color: Colors.primary,
    marginTop: 5,
    fontWeight: '600',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  qrUrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    maxWidth: 280,
    gap: 6,
    paddingHorizontal: 4,
  },
  qrUrlText: {
    flex: 1,
    fontSize: 12,
    color: Colors.mutedFg,
    letterSpacing: 0.2,
  },
  qrCopyIconBtn: {
    padding: 4,
  },
  toast: {
    backgroundColor: Colors.navy,
    borderRadius: Radius.md,
    paddingVertical: 9,
    paddingHorizontal: 18,
    marginTop: 12,
  },
  toastText: {
    fontSize: 13,
    color: Colors.white,
    fontWeight: '600',
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
