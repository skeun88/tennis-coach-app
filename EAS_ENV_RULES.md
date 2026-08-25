# ⚠️ EAS Update 환경변수 규칙

> 2026-08-12 Karen이 직접 발견한 핵심 사실. 모르면 환경변수가 빌드에 빠진다.

## 핵심 규칙

**`eas update`는 `eas.json`의 `env` 블록이 아니라 로컬 `.env` 파일을 읽는다.**

## EXPO_PUBLIC_* 변수 추가 절차

1. **로컬 `.env` 파일에 추가**
   ```
   EXPO_PUBLIC_NEW_VAR=value
   ```

2. **`eas update` 실행**
   ```bash
   eas update --branch production --message "..."
   ```

3. **배포 출력에서 포함 여부 확인**
   ```
   env: export EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_NEW_VAR ...
   ```
   목록에 없으면 번들에 포함되지 않은 것.

## eas.json env 블록의 역할

```json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_IS_BETA": "true"   ← eas build 전용
      }
    }
  }
}
```

`eas.json`의 `env`는 **`eas build`** (네이티브 빌드) 시에만 적용됨.
`eas update` (JS 번들 업데이트)에는 적용되지 않음.

## 요약표

| 방식 | `eas build` | `eas update` |
|------|------------|--------------|
| `.env` | ✅ 적용됨 | ✅ 적용됨 |
| `eas.json env` | ✅ 적용됨 | ❌ 적용 안 됨 |
