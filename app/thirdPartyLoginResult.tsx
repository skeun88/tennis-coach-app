// 네이버 SDK 콜백 URL (tenniscoach:///thirdPartyLoginResult)이
// AppDelegate에서 NaverThirdPartyLoginConnection으로 처리되어야 하지만,
// 혹시 Expo Router로 넘어올 경우를 대비한 빈 라우트.
// 실제로는 이 화면이 렌더링되지 않아야 함.
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function ThirdPartyLoginResult() {
  const router = useRouter();
  useEffect(() => {
    // 이 화면이 뜨면 AppDelegate 처리가 안 된 것 — 그냥 뒤로 보냄
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(auth)/login');
    }
  }, []);
  return null;
}
