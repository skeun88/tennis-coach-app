import React, { useEffect, useState } from 'react';
import { RefreshControl, RefreshControlProps } from 'react-native';

const TERRA = '#C0755A';

/**
 * 당겨서 새로고침 인디케이터를 테라코타로 고정하는 공용 래퍼.
 *
 * New Architecture(Fabric) iOS에서 RefreshControl의 tintColor가 최초 마운트 시
 * 네이티브 컨트롤에 적용되지 않는 RN 버그(facebook/react-native #56343, #53987, 0.81.x) 우회:
 * 마운트 직후 tintColor를 undefined → 테라코타로 재적용해 색이 반영되도록 강제한다.
 *
 * tintColor(iOS) / colors(Android) 모두 테라코타로 고정하고,
 * refreshing·onRefresh 등 나머지 props는 그대로 전달한다.
 */
export default function TerracottaRefreshControl(props: RefreshControlProps) {
  const [tint, setTint] = useState<string | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => setTint(TERRA), 50);
    return () => clearTimeout(t);
  }, []);
  return <RefreshControl {...props} tintColor={tint} colors={[TERRA]} />;
}
