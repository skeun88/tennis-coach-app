import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { IS_BETA } from '../lib/beta';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;

const CREAM = '#F7F0E9';
const TERRACOTTA = '#C0755A';
const DARK_BROWN = '#3E2B22';
const WARM_GRAY = '#9E8E85';
const WARM_GRAY_BORDER = '#D9CFC9';

const TOPUP = { credits: 10, price: 4900 };

interface Props {
  visible: boolean;
  onClose: () => void;
  onTopupSuccess: (newBalance: number) => void;
  onUpgradePress: () => void;
  currentPlanId: string;
  authToken: string;
}

export default function ReportTopupModal({
  visible,
  onClose,
  onTopupSuccess,
  onUpgradePress,
  currentPlanId,
  authToken,
}: Props) {
  if (IS_BETA) return null;

  const [loading, setLoading] = useState(false);

  async function handlePurchase() {
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/topup-report-credits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ product_id: '10' }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        Alert.alert('결제 실패', data.error ?? '결제 중 오류가 발생했습니다.');
        return;
      }

      Alert.alert(
        `${TOPUP.credits}회 충전이 완료됐어요`,
        `현재 추가 충전: ${data.new_balance}회 남음`,
        [{ text: '확인', onPress: () => onTopupSuccess(data.new_balance) }]
      );
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />

          <View style={s.iconWrap}>
            <Ionicons name="flash" size={28} color={TERRACOTTA} />
          </View>

          <Text style={s.title}>AI 레슨 기록 충전</Text>
          <Text style={s.subtitle}>
            {currentPlanId === 'free'
              ? 'AI 레슨 기록을 모두 사용했어요.\n더 많은 기록을 위해 플랜을 업그레이드해보세요.'
              : 'AI 레슨 기록이 더 필요할 때\n10회씩 추가할 수 있어요.'}
          </Text>

          {currentPlanId !== 'free' && (
            <>
              <View style={s.productCard}>
                <View style={s.productLeft}>
                  <Text style={s.productCredits}>AI 레슨 기록 {TOPUP.credits}회 충전</Text>
                  <Text style={s.productNote}>· 1회 결제 · 자동결제 없음 · 월이 바뀌어도 유지</Text>
                </View>
                <Text style={s.productPrice}>{TOPUP.price.toLocaleString()}원</Text>
              </View>

              <TouchableOpacity
                style={[s.purchaseBtn, loading && { opacity: 0.6 }]}
                onPress={handlePurchase}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.purchaseBtnText}>{TOPUP.credits}회 충전 · {TOPUP.price.toLocaleString()}원</Text>
                }
              </TouchableOpacity>

              {currentPlanId !== 'pro' && (
                <TouchableOpacity style={s.upgradeRow} onPress={onUpgradePress} activeOpacity={0.7}>
                  <Text style={s.upgradeText}>Pro로 업그레이드하면 매달 50개 기본 제공 →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {currentPlanId === 'free' && (
            <TouchableOpacity style={s.purchaseBtn} onPress={onUpgradePress} activeOpacity={0.85}>
              <Text style={s.purchaseBtnText}>요금제 보기</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelBtnText}>나중에 하기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingBottom: 44, alignItems: 'center',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: WARM_GRAY_BORDER, alignSelf: 'center', marginVertical: 12 },
  iconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: TERRACOTTA + '15',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 14, marginTop: 4,
  },
  title: { fontSize: 20, fontWeight: '800', color: DARK_BROWN, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: WARM_GRAY, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  productCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', backgroundColor: CREAM,
    borderRadius: 14, padding: 16, marginBottom: 16,
    borderWidth: 1.5, borderColor: TERRACOTTA + '40',
  },
  productLeft: { flex: 1 },
  productCredits: { fontSize: 15, fontWeight: '700', color: DARK_BROWN, marginBottom: 4 },
  productNote: { fontSize: 11, color: WARM_GRAY, lineHeight: 16 },
  productPrice: { fontSize: 18, fontWeight: '800', color: TERRACOTTA },
  purchaseBtn: {
    backgroundColor: TERRACOTTA, borderRadius: 14,
    paddingVertical: 15, alignItems: 'center', width: '100%', marginBottom: 10,
  },
  purchaseBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  upgradeRow: { paddingVertical: 8, alignItems: 'center', marginBottom: 4, width: '100%' },
  upgradeText: { fontSize: 12, color: TERRACOTTA, fontWeight: '600', textAlign: 'center' },
  cancelBtn: { paddingVertical: 10 },
  cancelBtnText: { fontSize: 14, color: WARM_GRAY },
});
