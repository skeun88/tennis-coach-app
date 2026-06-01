import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { PlanId, createTrialSubscription } from '../../lib/subscription';

const TOSS_CLIENT_KEY = 'test_ck_XZYkKL4MrjOxJb6G74A180zJwlEW';

export default function RegisterCardScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: PlanId }>();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const webViewRef = useRef<WebView>(null);

  // 빌링키 발급 HTML (토스 SDK 사용)
  const getBillingHtml = (customerKey: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://js.tosspayments.com/v1/payment"></script>
</head>
<body>
<script>
  const tossPayments = TossPayments('${TOSS_CLIENT_KEY}');
  tossPayments.requestBillingAuth('카드', {
    customerKey: '${customerKey}',
    successUrl: 'kerricoach://billing/success',
    failUrl: 'kerricoach://billing/fail',
  }).catch(function(error) {
    if (error.code !== 'USER_CANCEL') {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  });
</script>
</body>
</html>
  `;

  const handleNavigationChange = async (event: WebViewNavigation) => {
    const { url } = event;

    // 성공 콜백 처리
    if (url.startsWith('kerricoach://billing/success')) {
      setProcessing(true);
      const urlObj = new URL(url.replace('kerricoach://', 'https://'));
      const authKey = urlObj.searchParams.get('authKey');
      const customerKey = urlObj.searchParams.get('customerKey');

      if (!authKey || !customerKey) {
        Alert.alert('오류', '카드 등록에 실패했습니다.');
        setProcessing(false);
        return;
      }

      try {
        // 서버사이드에서 빌링키 발급 (Edge Function 호출)
        const { data, error } = await supabase.functions.invoke('issue-billing-key', {
          body: { authKey, customerKey, planId },
        });

        if (error || !data?.billingKey) {
          throw new Error(error?.message || '빌링키 발급 실패');
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('로그인 필요');

        const subscription = await createTrialSubscription(
          user.id,
          planId || 'basic',
          data.billingKey,
          customerKey
        );

        if (!subscription) throw new Error('구독 생성 실패');

        router.replace('/subscription/trial-started');
      } catch (err: any) {
        Alert.alert('오류', err.message || '카드 등록 중 오류가 발생했습니다.');
        setProcessing(false);
      }
    }

    // 실패 콜백
    if (url.startsWith('kerricoach://billing/fail')) {
      Alert.alert('카드 등록 실패', '다시 시도해 주세요.');
    }
  };

  const getCustomerKey = async (): Promise<string> => {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || 'unknown';
  };

  const [customerKey, setCustomerKey] = React.useState('');
  React.useEffect(() => {
    getCustomerKey().then(setCustomerKey);
  }, []);

  if (!customerKey) return null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>카드 등록</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          💳 카드를 등록하면 1달 무료 체험이 시작됩니다.{'\n'}
          체험 기간 중 언제든지 취소할 수 있습니다.
        </Text>
      </View>

      {processing ? (
        <View style={styles.processingView}>
          <ActivityIndicator size="large" color="#4A90D9" />
          <Text style={styles.processingText}>구독을 등록하는 중...</Text>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ html: getBillingHtml(customerKey) }}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={handleNavigationChange}
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
        />
      )}

      {loading && !processing && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4A90D9" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backText: { fontSize: 16, color: '#4A90D9' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e' },
  infoBox: {
    margin: 16,
    backgroundColor: '#EBF4FF',
    borderRadius: 12,
    padding: 14,
  },
  infoText: { fontSize: 13, color: '#4A90D9', lineHeight: 20 },
  webview: { flex: 1 },
  processingView: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  processingText: { fontSize: 16, color: '#555' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
});
