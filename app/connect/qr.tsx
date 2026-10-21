/**
 * 내 초대 QR (코치) — 공용 QR + 8자리 연결 코드 표시.
 * - 활성 링크가 없으면 최초 1회 자동 발급(ensureInviteLink). 재발급 버튼 없음.
 * - QR payload 는 HTTPS 초대주소(EXPO_PUBLIC_INVITE_BASE_URL + token). 커스텀 스킴 미사용.
 * - 하단에 pending 연결 요청 카드(0건이면 숨김).
 * - 피처플래그 OFF 상태에서는 프로필에서 이 화면으로 진입하지 않음(기존 CoachQRModal 유지).
 */
import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  ScrollView, Share,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { Colors, Radius } from '../../lib/theme';
import SettingsHeader from '../../components/SettingsHeader';
import { buildInviteUrl } from '../../lib/featureFlags';
import { ensureInviteLink, fetchConnectionRequests } from '../../lib/sharedInvite';

export default function CoachInviteQRScreen() {
  const router = useRouter();
  const viewShotRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [connectCode, setConnectCode] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const link = await ensureInviteLink();
      setToken(link.token);
      setConnectCode(link.connect_code);
    } catch (e: any) {
      Alert.alert('오류', '초대 링크를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      const reqs = await fetchConnectionRequests();
      setPendingCount(reqs.filter((r) => r.status === 'pending').length);
    } catch {
      /* 요청 카드 집계 실패는 조용히 무시 */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      refreshPending();
    }, [load, refreshPending]),
  );

  const inviteUrl = token ? buildInviteUrl(token) : '';

  async function captureQR(): Promise<string | null> {
    try { return (await viewShotRef.current?.capture?.()) ?? null; } catch { return null; }
  }

  async function handleSaveQR() {
    if (!inviteUrl) return;
    setBusy(true);
    const uri = await captureQR();
    if (!uri) { Alert.alert('저장 실패', 'QR 코드 이미지를 생성하지 못했어요.'); setBusy(false); return; }
    try {
      const dest = `${FileSystem.documentDirectory}kerri_invite_qr.png`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      Alert.alert('저장 완료', '갤러리에 저장되었어요 📷');
    } catch { Alert.alert('저장 실패', '이미지 저장 중 오류가 발생했어요.'); }
    setBusy(false);
  }

  async function handleCopyCode() {
    if (!connectCode) return;
    await Clipboard.setStringAsync(connectCode);
    Alert.alert('복사 완료', '연결 코드를 복사했어요 📋');
  }

  async function handleShare() {
    setBusy(true);
    try {
      if (inviteUrl) {
        await Share.share({
          message: `KERRI 연결 초대\n아래 링크로 접속하거나 연결 코드를 입력해 주세요.\n\n${inviteUrl}\n\n연결 코드: ${connectCode ?? ''}`,
        });
      } else {
        // 초대주소 미설정 시 QR 이미지 공유로 폴백
        const uri = await captureQR();
        if (uri && (await Sharing.isAvailableAsync())) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
        } else if (connectCode) {
          await Share.share({ message: `KERRI 연결 코드: ${connectCode}` });
        }
      }
    } catch { /* 사용자가 공유 취소 */ }
    setBusy(false);
  }

  return (
    <View style={styles.container}>
      <SettingsHeader title="내 초대 QR" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.desc}>회원에게 QR을 보여주거나 연결 코드를 알려주세요.</Text>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 48 }} />
        ) : (
          <>
            {/* QR 카드 */}
            <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1.0 }}>
              <View style={styles.qrCard}>
                <View style={styles.qrBrand}>
                  <Ionicons name="tennisball" size={16} color={Colors.primary} />
                  <Text style={styles.qrBrandText}>KERRI</Text>
                </View>
                {inviteUrl ? (
                  <QRCode value={inviteUrl} size={200} color={Colors.navy} backgroundColor={Colors.white} />
                ) : (
                  <View style={styles.qrPlaceholder}>
                    <Ionicons name="qr-code-outline" size={64} color={Colors.placeholder} />
                    <Text style={styles.qrPlaceholderTxt}>QR은 초대 페이지 준비 후{'\n'}활성화됩니다</Text>
                  </View>
                )}
                <Text style={styles.qrHint}>KERRI Member</Text>
              </View>
            </ViewShot>

            {/* 연결 코드 */}
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>연결 코드</Text>
              <Text style={styles.codeValue}>{connectCode ?? '--------'}</Text>
              <Text style={styles.codeHelp}>QR을 스캔하기 어려울 때 회원이 직접 입력할 수 있어요.</Text>
            </View>

            {/* 액션 버튼 */}
            {busy ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 18 }} />
            ) : (
              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn} onPress={handleSaveQR} disabled={!inviteUrl}>
                  <Ionicons name="download-outline" size={16} color={inviteUrl ? Colors.primary : Colors.placeholder} />
                  <Text style={[styles.actionTxt, !inviteUrl && { color: Colors.placeholder }]}>QR 저장</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={handleCopyCode}>
                  <Ionicons name="copy-outline" size={16} color={Colors.primary} />
                  <Text style={styles.actionTxt}>코드 복사</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={handleShare}>
                  <Ionicons name="share-outline" size={16} color={Colors.white} />
                  <Text style={[styles.actionTxt, { color: Colors.white }]}>공유하기</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 하단 요청 카드 (0건이면 숨김) */}
            {pendingCount > 0 && (
              <TouchableOpacity
                style={styles.reqCard}
                activeOpacity={0.85}
                onPress={() => router.push('/connect/requests')}
              >
                <View style={styles.reqHeader}>
                  <Text style={styles.reqTitle}>새 회원 요청</Text>
                  <View style={styles.badge}><Text style={styles.badgeTxt}>{pendingCount}건</Text></View>
                </View>
                <Text style={styles.reqDesc}>회원이 QR 또는 연결 코드로 연결을 요청했어요.</Text>
                <View style={styles.reqBtn}>
                  <Text style={styles.reqBtnTxt}>요청 확인하기</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.white} />
                </View>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, alignItems: 'center' },
  desc: { fontSize: 14, color: Colors.mutedFg, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  qrCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 20,
    alignItems: 'center', borderWidth: 1.5, borderColor: Colors.border,
  },
  qrBrand: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 14 },
  qrBrandText: { fontSize: 14, fontWeight: '900', color: Colors.primary, letterSpacing: 1.5 },
  qrPlaceholder: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', gap: 10 },
  qrPlaceholderTxt: { fontSize: 12, color: Colors.placeholder, textAlign: 'center', lineHeight: 17 },
  qrHint: { fontSize: 11, color: Colors.mutedFg, marginTop: 10, letterSpacing: 0.3 },
  codeBox: {
    marginTop: 20, width: '100%', backgroundColor: Colors.white, borderRadius: Radius.lg,
    paddingVertical: 18, paddingHorizontal: 16, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  codeLabel: { fontSize: 13, color: Colors.mutedFg, fontWeight: '600', marginBottom: 6 },
  codeValue: { fontSize: 30, fontWeight: '800', color: Colors.navy, letterSpacing: 6 },
  codeHelp: { fontSize: 12, color: Colors.mutedFg, textAlign: 'center', marginTop: 8, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18, width: '100%' },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.primary,
    backgroundColor: Colors.white,
  },
  actionBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  actionTxt: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  reqCard: {
    marginTop: 26, width: '100%', backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: 18, borderWidth: 1, borderColor: Colors.border,
  },
  reqHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  reqTitle: { fontSize: 16, fontWeight: '800', color: Colors.navy },
  badge: { backgroundColor: Colors.primaryLight, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  badgeTxt: { fontSize: 12, fontWeight: '800', color: Colors.primary },
  reqDesc: { fontSize: 13, color: Colors.mutedFg, lineHeight: 19, marginBottom: 14 },
  reqBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 12,
  },
  reqBtnTxt: { fontSize: 14, fontWeight: '700', color: Colors.white },
});
