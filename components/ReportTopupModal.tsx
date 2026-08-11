import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useState } from 'react';
import { Colors } from '../lib/theme';
import { TOPUP_PRODUCTS, TopupProductId } from '../lib/subscription';
import { IS_BETA } from '../lib/beta';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 충전 완료 후 리포트 생성 자동 재시도 콜백 */
  onTopupSuccess: (newBalance: number) => void;
  onUpgradePress: () => void;
  currentPlanId: string;
  authToken: string;
}

export default function ReportTopupModal({
  visible,
  onClose,
  onTopupSuccess,
  // IS_BETA early return below
  onUpgradePress,
  currentPlanId,
  authToken,
}: Props) {
  if (IS_BETA) return null;

  const [selectedProduct, setSelectedProduct] = useState<TopupProductId>('30');
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
        body: JSON.stringify({ product_id: selectedProduct }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        Alert.alert('결제 실패', data.error ?? '결제 중 오류가 발생했습니다.');
        return;
      }

      const product = TOPUP_PRODUCTS.find(p => p.id === selectedProduct)!;
      Alert.alert(
        `🎉 ${product.credits}개 충전 완료`,
        `잔여 리포트: ${data.new_balance}개\n\n리포트 생성을 이어서 진행합니다.`,
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
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* 헤더 */}
          <View style={styles.header}>
            <View style={styles.pill} />
          </View>

          {/* 안내 */}
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>AI 리포트를 모두 사용했습니다.</Text>
            <Text style={styles.noticeBody}>
              추가 충전 후 현재 레슨 리포트를{'\n'}바로 이어서 생성할 수 있습니다.
            </Text>
            <View style={styles.noticeHints}>
              <Text style={styles.hintText}>※ 기존 녹음 데이터는 유지됩니다</Text>
              <Text style={styles.hintText}>※ 결제 완료 후 자동으로 생성됩니다</Text>
            </View>
          </View>

          {/* 상품 선택 */}
          <View style={styles.products}>
            {TOPUP_PRODUCTS.map(product => (
              <TouchableOpacity
                key={product.id}
                style={[styles.productCard, selectedProduct === product.id && styles.productCardSelected]}
                onPress={() => setSelectedProduct(product.id)}
                activeOpacity={0.8}
              >
                {product.isRecommended && (
                  <View style={styles.recommendBadge}>
                    <Text style={styles.recommendBadgeText}>추천</Text>
                  </View>
                )}
                <Text style={[styles.productCredits, selectedProduct === product.id && styles.productCreditsSelected]}>
                  +{product.credits}개
                </Text>
                <Text style={[styles.productPrice, selectedProduct === product.id && styles.productPriceSelected]}>
                  {product.price.toLocaleString()}원
                </Text>
                <Text style={styles.productPerUnit}>
                  개당 {product.pricePerUnit}원
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 충전 버튼 */}
          <TouchableOpacity
            style={[styles.purchaseBtn, loading && { opacity: 0.6 }]}
            onPress={handlePurchase}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.purchaseBtnText}>추가 충전하기</Text>
            }
          </TouchableOpacity>

          {/* 구분선 */}
          <View style={styles.separator}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>또는</Text>
            <View style={styles.separatorLine} />
          </View>

          {/* 업그레이드 유도 */}
          {currentPlanId !== 'pro' && (
            <TouchableOpacity style={styles.upgradeRow} onPress={onUpgradePress} activeOpacity={0.7}>
              <Text style={styles.upgradeText}>
                Pro로 업그레이드하면 매달 50개 자동 지급됩니다 →
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  header: { alignItems: 'center', paddingVertical: 12 },
  pill: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  notice: { marginBottom: 20, alignItems: 'center', gap: 8 },
  noticeTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground, textAlign: 'center' },
  noticeBody: { fontSize: 14, color: Colors.mutedFg, textAlign: 'center', lineHeight: 22 },
  noticeHints: { gap: 4, marginTop: 4 },
  hintText: { fontSize: 12, color: Colors.placeholder, textAlign: 'center' },
  products: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  productCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
  },
  productCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  recommendBadge: {
    position: 'absolute',
    top: -10,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  recommendBadgeText: { fontSize: 11, color: '#fff', fontWeight: '700' },
  productCredits: { fontSize: 16, fontWeight: '800', color: Colors.foreground },
  productCreditsSelected: { color: Colors.navy },
  productPrice: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  productPriceSelected: { color: Colors.navy },
  productPerUnit: { fontSize: 11, color: Colors.placeholder },
  purchaseBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  purchaseBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  separator: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  separatorLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  separatorText: { fontSize: 12, color: Colors.placeholder },
  upgradeRow: { paddingVertical: 8, alignItems: 'center', marginBottom: 8 },
  upgradeText: { fontSize: 13, color: Colors.primary, fontWeight: '600', textAlign: 'center' },
  cancelBtn: { paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, color: Colors.mutedFg },
});
