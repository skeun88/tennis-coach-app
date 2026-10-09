import React, { useEffect, useState } from 'react';
import { RefreshControl, RefreshControlProps } from 'react-native';

const TERRA = '#C0755A';

/**
 * 당겨서 새로고침 인디케이터를 테라코타로 고정하는 공용 래퍼.
 *
 * New Architecture(Fabric) iOS에서 RefreshControl의 tintColor/title이 최초 마운트 시
 * 네이티브 컨트롤에 적용되지 않는 RN 버그(facebook/react-native #56343, #53987, 0.81.x).
 * 초기 마운트는 무시되지만 "이후 업데이트"에는 정상 적용되는 특성을 이용해,
 * tintColor를 undefined로 마운트한 뒤 → 네이티브 마운트 완료 후 TERRA로 바꿔
 * 업데이트 경로를 강제로 태워 색이 반영되도록 한다.
 *
 * 타이밍 안정성을 위해 다음 두 프레임(rAF×2, 네이티브 커밋 직후)과
 * 500ms 폴백 두 경로로 재적용한다(둘 다 같은 값이라 중복 렌더 없음).
 * tintColor(iOS) / colors(Android) 모두 테라코타로 고정, 나머지 props는 그대로 전달.
 */
export default function TerracottaRefreshControl(props: RefreshControlProps) {
  const [tint, setTint] = useState<string | undefined>(undefined);
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setTint(TERRA));
    });
    const fallback = setTimeout(() => setTint(TERRA), 500);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(fallback);
    };
  }, []);
  return <RefreshControl {...props} tintColor={tint} colors={[TERRA]} />;
}
