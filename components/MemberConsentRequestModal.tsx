import {
  View, Text, StyleSheet, Modal, TouchableOpacity, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/theme';

interface Props {
  visible: boolean;
  memberName: string;
  onSendRequest: () => void;
  onQRConsent: () => void;
  onLater: () => void;
}

export default function MemberConsentRequestModal({
  visible, memberName, onSendRequest, onQRConsent, onLater,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onLater}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.content}>
            {/* 아이콘 */}
            <View style={styles.iconWrap}>
              <Ionicons name="person-circle-outline" size={40} color={Colors.primary} />
            </View>

            <Text style={styles.title}>회원 동의가 필요해요</Text>
            <Text style={styles.desc}>
              AI 레슨 기록을 만들려면{'\n'}{memberName || '회원'}님의 최초 1회 동의가 필요합니다.
            </Text>

            {/* 동의 배너 */}
            <View style={styles.infoBanner}>
              <Ionicons name="shield-checkmark-outline" size={16} color={Colors.primary} />
              <Text style={styles.infoBannerText}>
                회원이 직접 동의해야 하며, 코치가 대신 동의할 수 없어요.
              </Text>
            </View>

            {/* 버튼 3개 */}
            <TouchableOpacity style={styles.primaryBtn} onPress={onSendRequest} activeOpacity={0.85}>
              <Ionicons name="send-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>동의 요청 보내기</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={onQRConsent} activeOpacity={0.85}>
              <Ionicons name="qr-code-outline" size={18} color={Colors.primary} />
              <Text style={styles.secondaryBtnText}>QR로 동의받기</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.laterBtn} onPress={onLater} activeOpacity={0.7}>
              <Text style={styles.laterBtnText}>나중에 하기</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  content: { padding: 24, paddingBottom: 36, alignItems: 'center' },
  iconWrap: {
    width: 68, height: 68, borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20, fontWeight: '800', color: Colors.foreground,
    marginBottom: 8, textAlign: 'center',
  },
  desc: {
    fontSize: 14, color: Colors.mutedFg, lineHeight: 22,
    textAlign: 'center', marginBottom: 16,
  },
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: 12, padding: 12, marginBottom: 24, width: '100%',
  },
  infoBannerText: { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14,
    paddingVertical: 15, width: '100%', justifyContent: 'center',
    marginBottom: 10,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: Colors.primary,
    borderRadius: 14, paddingVertical: 14,
    width: '100%', justifyContent: 'center', marginBottom: 10,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  laterBtn: { paddingVertical: 10 },
  laterBtnText: { fontSize: 15, color: Colors.mutedFg },
});
