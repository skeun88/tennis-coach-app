# 🎾 테니스 코치 앱

테니스 코치를 위한 회원 관리 전용 모바일 앱입니다.

## 주요 기능

- **회원 관리** — 회원 등록/수정/비활성화, 레벨 관리
- **레슨 스케줄** — 날짜별 레슨 추가 및 관리
- **출석 체크** — 출석/결석/지각/조퇴 실시간 기록
- **결제 관리** — 수강료 청구 및 납부 현황 관리
- **회원 메모** — 개인별 성장 기록 및 메모

---

## 시작하기

### 1. Supabase 프로젝트 생성

1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성
2. `supabase/schema.sql` 내용을 **SQL Editor**에 붙여넣고 실행
3. **Project Settings → API** 에서 URL과 anon key 복사

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열고 실제 값으로 교체:

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### 3. 의존성 설치 및 실행

```bash
npm install
npx expo start
```

QR 코드를 **Expo Go** 앱으로 스캔하거나, iOS/Android 에뮬레이터로 실행하세요.

---

## 파일 구조

```
tennis-coach-app/
├── app/
│   ├── _layout.tsx          # 루트 레이아웃 (인증 라우팅)
│   ├── (auth)/
│   │   └── login.tsx        # 로그인/회원가입
│   ├── (tabs)/
│   │   ├── _layout.tsx      # 탭 네비게이션
│   │   ├── index.tsx        # 홈 (대시보드)
│   │   ├── members.tsx      # 회원 목록
│   │   ├── schedule.tsx     # 레슨 스케줄
│   │   └── payments.tsx     # 결제 관리
│   ├── members/
│   │   ├── [id].tsx         # 회원 상세 (정보/출석/결제/메모)
│   │   └── new.tsx          # 회원 등록
│   └── lessons/
│       ├── [id].tsx         # 레슨 상세 + 출석 체크
│       └── new.tsx          # 레슨 추가
├── lib/
│   └── supabase.ts          # Supabase 클라이언트
├── types/
│   └── index.ts             # TypeScript 타입 정의
└── supabase/
    └── schema.sql           # DB 스키마 (Supabase에서 실행)
```

---

## 기술 스택

- **React Native + Expo** (SDK 54)
- **Expo Router** (파일 기반 라우팅)
- **Supabase** (인증 + PostgreSQL DB + RLS 보안)
- **TypeScript**
- **@expo/vector-icons** (Ionicons)

---

## 빌드 (배포)

```bash
# iOS
npx expo run:ios

# Android
npx expo run:android

# EAS Build (권장)
npm install -g eas-cli
eas build --platform ios
eas build --platform android
```
# kerri
