# Cloudflare Mobile Sync

[English](./README.md) | 한국어

모바일 앱을 위한 작고 단순한 자가 호스팅 인증·증분 동기화 스타터입니다. 사용하는 개발자가 자신의 Cloudflare 계정에 Worker 하나와 D1 데이터베이스 하나를 직접 배포합니다. 이 프로젝트는 여러 앱이 함께 쓰는 공유 서비스를 운영하지 않습니다.

HTTP 프로토콜은 특정 플랫폼에 종속되지 않습니다. Expo SDK 57을 첫 번째 어댑터로 지원하지만, 공용 스키마와 동기화 로직은 Expo, React Native, Node.js, Cloudflare 런타임에 의존하지 않도록 분리했습니다.

## 구현된 기능

- Better Auth 1.6.23 기반 데이터베이스 세션과 D1 직접 연동
- Google, Kakao OIDC, Naver OAuth 서버 어댑터
- Expo SDK 57 SecureStore 쿠키 브리지와 고정 앱 스킴 콜백
- 멱등 mutation, collection별 cursor pull, 삭제 원문을 지우는 tombstone을 사용하는 compare-and-set 레코드 동기화
- D1 마이그레이션, 사용자별 쿼리 제한, 요청 속도 제한, 런타임 검증, 안정적인 오류 형식
- 로그인 전에도 로컬에서 사용할 수 있고 사용자가 요청할 때만 동기화하는 Expo 예제
- 사용자 간 접근 차단과 계정 삭제 실패 사례를 포함한 Workers 런타임 통합 테스트

유지관리자 소유의 참조 인스턴스에는 Worker가 배포되어 있고, Google OAuth 자격 증명과 Worker 콜백도 설정되어 있습니다. 새 로컬 마이그레이션 0004와 0005는 명시적인 원격 마이그레이션과 전환 검증 전까지 참조 인스턴스에서 활성화되었다고 보지 않습니다. 이 인스턴스는 공개 샌드박스가 아니므로 다른 애플리케이션에서 사용하면 안 됩니다. 별사타 Expo 소비 앱에서는 기존 Android Google 로그인, 앱 복귀, 세션 복원, 로그아웃을 검증했지만 새 보안 handoff는 다시 검증해야 합니다. 개미지옥 Godot 소비 앱도 별도 Worker와 D1에서 Android 로그인과 콜백 복귀를 검증했습니다. 계정 삭제 회귀 검사와 iOS 검증은 남아 있으므로 이번 소스 릴리스는 모든 제공자와 플랫폼의 운영 준비 완료를 주장하지 않습니다. Kakao와 Naver는 아직 실제 자격 증명을 설정하지 않았습니다.

## 워크스페이스 구조

```text
apps/worker               Cloudflare Worker, Better Auth, D1 마이그레이션
packages/api-contract     이식 가능한 Zod 스키마와 TypeScript 타입
packages/client-core      주입형 HTTP 전송, 재시도, 동기화 로직
packages/expo-client      Expo SecureStore, 링크, 인증 어댑터
examples/expo-app         local-first 종단 간 참조 앱
docs                      아키텍처, 보안, API, 운영 가이드, ADR
```

## 빠른 시작

Node.js 22.13–24와 pnpm 11.9.0이 필요합니다.

```bash
pnpm install
pnpm --filter @cloudflare-mobile-sync/worker migrate:local
pnpm --filter @cloudflare-mobile-sync/worker dev
```

`apps/worker/.dev.vars.example`을 `apps/worker/.dev.vars`로 복사하고 로컬 환경에 맞는 값으로 바꾸세요. 실제 `.dev.vars`는 절대 커밋하면 안 됩니다. 다른 터미널에서 다음 명령으로 Expo 예제를 실행합니다.

```bash
pnpm --filter @cloudflare-mobile-sync/expo-app dev
```

Expo 예제에는 `EXPO_PUBLIC_MOBILE_SYNC_URL`이 필요합니다. `examples/expo-app/.env.example`을 `.env.local`로 복사하고 선택한 시뮬레이터나 기기에서 접근할 수 있는 Worker 주소를 설정하세요. 로컬 전용으로 사용할 때는 `EXPO_PUBLIC_MOBILE_SYNC_PROVIDERS`를 비워 둡니다. Worker에 Google 자격 증명을 설정한 뒤 `google`로 바꾸면 로그인 선택지가 표시됩니다. OAuth 콜백을 검증하려면 `cloudflare-mobile-sync` 스킴이 컴파일된 Expo development build가 필요합니다. Expo Go는 OAuth 검증 대상으로 지원하지 않습니다.

## 자가 호스팅

[자가 호스팅 가이드](./docs/SELF_HOSTING.md)부터 확인하세요. 저장소에 커밋된 Wrangler 설정은 유지관리자의 참조 배포를 설명합니다. 다른 개발자가 원격 명령을 실행하려면 Worker 이름, D1 데이터베이스, 공개 주소, 앱 origin, 제공자 secret을 모두 자신의 값으로 교체해야 합니다.

첫 공개 배포는 사전 릴리스 소스 코드만 제공합니다. 워크스페이스 패키지는 실수로 npm에 게시되지 않도록 `private: true`를 유지하며 현재 npm에서 설치할 수 없습니다. 공개 상태와 남은 제공자·플랫폼 검증 범위는 [공개 릴리스 체크리스트](./docs/PUBLIC_RELEASE.md)를 확인하세요.

## 품질 검사 명령

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:preflight
pnpm security:secrets
pnpm security:audit
pnpm check
```

자세한 내용은 [설정](./docs/CONFIGURATION.md), [API](./docs/API.md), [운영](./docs/OPERATIONS.md), [인증 제공자 설정](./docs/PROVIDERS.md), [보안 모델](./docs/SECURITY.md), [동기화 보존](./docs/SYNC_RETENTION.md), [보안 문제 제보](./SECURITY.md), [기술 조사 기준](./docs/RESEARCH.md) 문서를 참고하세요.

유지관리자의 소비 앱 배포는 서로 격리되어 있습니다. 인증 기능만 사용하는 개미지옥 설정은 [ANT HELL 배포 문서](./docs/ANT_HELL_DEPLOYMENT.md)를 참고하세요. 별사타 Worker나 D1 데이터베이스를 공유하지 않습니다.

## 의도적으로 제외한 범위

이 프로젝트는 Firebase, CRDT 엔진, 공유 멀티테넌트 SaaS, 실시간 구독 서비스가 아닙니다. 동기화 payload는 허용된 collection 안에서 불투명한 JSON으로 취급합니다. 충돌이 생기면 호스트 앱이 레코드 단위로 어떤 값을 유지할지 명시적으로 선택해야 합니다. 오래된 기기를 위한 별도 reset·snapshot 프로토콜을 설계하기 전까지 tombstone은 삭제하지 않고 계속 보관합니다.

## 라이선스

소스 코드는 [MIT 라이선스](./LICENSE)로 제공합니다. 패키지 manifest를 비공개로 유지하는 이유는 의도하지 않은 npm 게시를 막기 위한 것입니다. 소스 코드가 공개되어도 유지관리자의 배포 인스턴스가 공개 호스팅 서비스로 바뀌는 것은 아닙니다.
