# Social Preview Generator - 개선사항 추적 문서

> 작성일: 2025-08-12  
> 목적: 보안, 성능, 버그 개선사항을 체계적으로 추적하고 구현 진행상황을 관리

## 📊 개선사항 요약

| 우선순위 | 카테고리 | 완료 | 진행중 | 대기 | 총계 |
|---------|---------|------|--------|------|------|
| P0 (Critical) | 보안 | 5 | 0 | 7 | 12 |
| P1 (High) | 성능 | 0 | 0 | 6 | 6 |
| P2 (Medium) | 품질 | 0 | 0 | 5 | 5 |

---

## 🔴 P0: 보안 개선사항 (Critical - 즉시 수정 필요)

### 1. ✅ 정규식 버그 수정
- **파일**: `src/utils/validators.ts`
- **라인**: 260-279
- **상태**: ✅ 완료 (2025-08-12)
- **커밋**: [e6fecf7] fix(validation): correct control character regex patterns
- **문제**: 제어문자 탐지 정규식이 잘못되어 보안 검증 무력화
- **적용 수정**:
  ```javascript
  /[\x00-\x1f]/g  // 제어문자 범위 매칭
  /[\x7f-\x9f]/g  // 확장 제어문자 범위 매칭
  ```
- **추가 개선 제안**: 
  - 유니코드 제어문자도 함께 차단 (`\u202E`, `\u200E`, `\u200F` 등 bidi overrides)
  - 제어문자 필터를 단일 함수로 중앙집중화
  - Property-based testing 추가 (fast-check 활용)

### 2. ✅ 옵션 검증 누락
- **파일**: `src/index.ts`
- **라인**: 70-78
- **상태**: ✅ 완료 (2025-08-12)
- **커밋**: [b29244c] fix(validation): add options validation to generateImageWithTemplate
- **문제**: `generateImageWithTemplate` 직접 호출 시 입력 검증 우회 가능
- **적용 수정**: 함수 시작부에 `validateOptions(options)` 추가
- **추가 개선 제안**:
  - **검증 단일화**: 모든 진입점(템플릿별 경로, 헬퍼 함수)에서 동일 검증 재사용
  - **타입 브랜딩**: `SanitizedOptions` 브랜드 타입 도입으로 검증 전 데이터의 템플릿 레이어 진입 차단
  - **런타임 스키마 검증**: Zod 등 활용한 엄격한 스키마 검증과 TS 타입 이중화

### 3. ✅ SVG foreignObject 태그 허용
- **파일**: `src/utils/image-security.ts`
- **라인**: 206-236
- **상태**: ✅ 완료 (2025-08-12)
- **커밋**: [ad9832e] fix(security): remove dangerous foreignObject from SVG allowed tags
- **문제**: `foreignObject` 허용으로 HTML/JavaScript 삽입 가능
- **적용 수정**: `ALLOWED_TAGS`에서 `foreignObject` 제거
- **추가 개선 제안**:
  - **속성 레벨 보안**: `href/xlink:href`, `style`, `on*`, `filter`, `mask`, `use`(외부 참조) 제한/금지
  - **스타일 차단**: `<style>` 태그 금지, 인라인 `style` 속성도 차단 권장
  - **속성 화이트리스트 강화**: 안전한 속성만 허용하는 엄격한 리스트 적용

### 4. ✅ Sharp 보안 래퍼 미적용
- **파일**: `src/index.ts`
- **라인**: 246-268
- **상태**: ✅ 완료 (2025-08-12)
- **커밋**: [c6accd6] fix(security): apply Sharp security wrappers consistently
- **문제**: `processImageForTemplate`에서 일반 `sharp()` 사용으로 보안 설정 우회
- **적용 수정**: `createSecureSharpInstance()`와 `secureResize()` 래퍼로 교체
- **추가 개선 제안**:
  - **안전 한도 강화**: `limitInputPixels` 64M 제한, `sequentialRead()` 적용
  - **포맷 제한**: 지원 포맷 화이트리스트, 메타데이터 제거 기본값
  - **시간 제한**: 대형 이미지 처리 시간 제한/취소 토큰 설계
  - **메모리 최적화**: Sharp 인스턴스 풀링으로 메모리 풋프린트 감소

### 5. ✅ 색상 값 직접 삽입
- **파일**: `src/core/image-generator.ts`
- **라인**: 142-151
- **상태**: ✅ 완료 (2025-08-12)
- **커밋**: [e960fab] fix(validation): add color validation to SVG generation
- **문제**: `createBlankCanvas`에서 사용자 색상을 검증 없이 SVG에 삽입
- **적용 수정**: 모든 색상 사용 위치에 `validateColor()` 추가 (배경, 텍스트, 강조색)
- **추가 개선 제안**:
  - **엄격한 색상 형식**: HEX만 허용 (3/4/6/8자리), `rgb()/hsl()`은 정규식·범위체크로 엄격히 제한
  - **브랜드 타입**: `SanitizedColor` 타입으로 검증 후 템플릿에만 주입 가능하게 설계
  - **CSS 인젝션 차단**: 색상값 외 CSS 구문 완전 차단

### 6. ❌ Rate Limiting 부재
- **파일**: 전체 시스템 
- **상태**: ❌ 대기중 - 아키텍처 결정 필요
- **문제**: DoS 공격 방어 메커니즘 없음
- **구현 방향**:
  - **라이브러리 방식**: 코어에 직접 구현보다 `examples/middleware` 제공 권장
  - **서버 통합 가이드**: IP별 버킷 토큰, 동시성 제한 큐 예시 제공
  - **참고 구현**: express-rate-limit, 메모리/Redis 백엔드 옵션
- **추가 고려사항**:
  - 이미지 생성 비용 기반 제한 (CPU/메모리 사용량)
  - 사용자별 할당량 시스템
  - 우선순위 큐 (프리미엄 사용자 우대)
- **예상 작업시간**: 3시간 (가이드 + 예시)

### 7. ❌ DNS Rebinding 방어 미흡
- **파일**: `src/utils/secure-agent.ts`
- **상태**: ❌ 대기중 - 고도화 필요
- **문제**: Time-of-check-time-of-use (TOCTOU) 취약점으로 SSRF 우회 가능
- **강화 방안**:
  - **DNS 결과 고정**: 이름→IP 매핑을 TTL 캐시하고 연결 시점 재사용
  - **이중 검증**: DNS lookup + connect-time `socket.remoteAddress` 재검증
  - **사설망 차단**: RFC1918, 링크로컬, 멀티캐스트 IP 대역 완전 차단
  - **연결 전 재검증**: 소켓 연결 직전 대상 IP 다시 한번 검증
- **고급 공격 대비**:
  - IPv6 매핑된 IPv4 주소 (`::ffff:192.168.1.1`) 차단
  - DNS 레코드 TTL 조작 공격 대비
  - HTTP 리다이렉트 체이닝 제한
- **예상 작업시간**: 2시간

### 8. ❌ 검증 로직 분산 및 타입 안전성 부족
- **파일**: 전체 아키텍처
- **상태**: ❌ 신규 - 아키텍처 개선 필요
- **문제**: 검증 로직이 여러 파일에 분산, 검증되지 않은 데이터의 템플릿 레이어 유입 가능
- **개선 방안**:
  - **검증 단일화**: `validators.ts`에 모든 진입점 검증 수렴
  - **브랜드 타입 시스템**: 
    ```typescript
    type SanitizedText = string & { __brand: 'SanitizedText' };
    type SanitizedColor = string & { __brand: 'SanitizedColor' };
    type SafeUrl = string & { __brand: 'SafeUrl' };
    type SanitizedOptions = PreviewOptions & { __brand: 'SanitizedOptions' };
    ```
  - **런타임 스키마**: Zod 등으로 TS 타입과 런타임 검증 이중화
  - **게이트웨이 패턴**: 모든 외부 입력이 단일 검증 게이트를 통과하도록 강제
- **예상 작업시간**: 4시간

### 9. ❌ 유니코드 제어문자 및 고급 인젝션 대비 부족  
- **파일**: `src/utils/validators.ts`
- **상태**: ❌ 신규 - 추가 보안 강화 필요
- **문제**: 기본 ASCII 제어문자만 차단, 유니코드 Bidi override 등 고급 공격 미대비
- **추가 차단 대상**:
  - **Bidi overrides**: `\u202E` (RTL Override), `\u200E`, `\u200F` (LR/RL Mark)
  - **제로폭 문자**: `\u200B`, `\u200C`, `\u200D`, `\uFEFF`
  - **기타 제어문자**: `\u00AD` (Soft Hyphen), `\u034F` (Combining Grapheme Joiner)
- **중앙집중화**: 제어문자 필터를 단일 함수 `sanitizeControlChars()`로 분리
- **테스트 강화**: Property-based testing (fast-check) 활용
- **예상 작업시간**: 2시간

### 10. ❌ SVG 속성 레벨 보안 미흡
- **파일**: `src/utils/image-security.ts` 
- **상태**: ❌ 신규 - DOMPurify 설정 강화 필요
- **문제**: 태그 레벨 필터링만으로는 속성 기반 공격 차단 부족
- **위험 속성 차단**:
  - **링크 관련**: `href`, `xlink:href` (외부 리소스 로딩)
  - **이벤트 핸들러**: `on*` 속성 전체
  - **스타일 관련**: `style` 속성 (CSS 인젝션)
  - **참조 관련**: `use` 태그의 외부 참조, `filter`, `mask`
- **안전 속성만 허용**: 위치(`x`, `y`), 크기(`width`, `height`), 색상(`fill`, `stroke`) 등
- **스타일 완전 차단**: `<style>` 태그와 인라인 `style` 속성 모두 금지
- **예상 작업시간**: 1.5시간

### 11. ❌ Sharp 보안 설정 고도화  
- **파일**: `src/utils/image-security.ts`
- **상태**: ❌ 신규 - 보안 래퍼 강화 필요
- **문제**: 기본 래퍼는 적용했으나 고급 보안 설정 부족
- **추가 보안 설정**:
  ```typescript
  const secureSharpConfig = {
    limitInputPixels: 64_000_000, // 64MP 제한
    sequentialRead: true,          // 메모리 사용량 감소
    unlimited: false,              // 메모리 제한 활성화
    failOnError: true,             // 에러 시 즉시 실패
  };
  ```
- **시간 제한**: 대형 이미지 처리 타임아웃 (10초)
- **취소 토큰**: AbortController로 장시간 작업 중단 가능
- **포맷 화이트리스트**: JPEG, PNG, WebP, GIF만 허용
- **메타데이터 제거**: 기본값으로 EXIF, ICC 프로필 제거
- **예상 작업시간**: 2시간

### 12. ❌ 리소스 상수 하드코딩
- **파일**: 전체 코드베이스
- **상태**: ❌ 신규 - 설정 관리 개선 필요  
- **문제**: 타임아웃, 크기 제한, 픽셀 한도 등이 하드코딩되어 조정 어려움
- **개선 방안**:
  - **상수 파일 분리**: `src/constants.ts` 생성
  - **환경변수 지원**: 운영 환경별 설정 오버라이드 가능
  - **검증된 설정**: 설정값 자체도 유효성 검증
  - **타입 안전성**: 설정 스키마 정의 및 런타임 검증
- **주요 상수**:
  - `MAX_IMAGE_PIXELS`, `MAX_FILE_SIZE`, `REQUEST_TIMEOUT`
  - `RATE_LIMIT_WINDOW`, `MAX_CONCURRENT_JOBS`
- **예상 작업시간**: 1시간

---

## 🟡 P1: 성능 최적화 (High)

### 1. ❌ JPEG 최적화 미사용
- **파일**: `src/index.ts`, `src/core/image-generator.ts`
- **문제**: Progressive JPEG, mozjpeg 미사용
- **수정 방안**:
  ```javascript
  .jpeg({ 
    quality,
    progressive: true,
    mozjpeg: true 
  })
  ```
- **개선 효과**: 파일 크기 20-30% 감소
- **예상 작업시간**: 15분

### 2. ❌ 메타데이터 캐싱 부재
- **파일**: `src/core/metadata-extractor.ts`
- **문제**: 동일 URL 반복 요청 시 매번 외부 요청
- **수정 방안**: LRU 캐시 구현 (TTL: 5분, 최대 100개)
- **개선 효과**: 응답 시간 90% 단축 (캐시 히트 시)
- **예상 작업시간**: 1시간

### 3. ❌ DNS 조회 캐싱 미구현
- **파일**: `src/utils/secure-agent.ts`
- **문제**: 매번 DNS 조회 수행
- **수정 방안**: TTL 기반 DNS 캐시
- **개선 효과**: 네트워크 지연 감소
- **예상 작업시간**: 30분

### 4. ❌ Sharp 인스턴스 풀링 미사용
- **파일**: 전체
- **문제**: 매번 새 Sharp 인스턴스 생성
- **수정 방안**: 인스턴스 풀 구현 (최대 10개)
- **개선 효과**: 메모리 사용량 감소, 초기화 오버헤드 감소
- **예상 작업시간**: 1시간

### 5. ❌ 이미지 처리 파이프라인 비효율
- **파일**: `src/core/image-generator.ts`
- **문제**: blur, brightness, saturation 개별 적용
- **수정 방안**: Sharp 파이프라인 최적화
- **개선 효과**: 처리 시간 30% 단축
- **예상 작업시간**: 30분

### 6. ❌ file-type 동적 import 반복
- **파일**: `src/utils/image-security.ts`
- **문제**: 매번 동적 import 수행
- **수정 방안**: 모듈 레벨 캐싱
- **개선 효과**: import 오버헤드 제거
- **예상 작업시간**: 15분

---

## 🟢 P2: 코드 품질 및 유지보수성 (Medium)

### 1. ❌ 이미지 처리 로직 중복
- **파일**: `src/index.ts`, `src/core/image-generator.ts`
- **문제**: 동일 로직이 두 파일에 분산
- **수정 방안**: core 모듈로 통합 (SRP, DRY 원칙)
- **예상 작업시간**: 2시간

### 2. ❌ 매직 넘버 하드코딩
- **파일**: 전체
- **문제**: 타임아웃(8000ms, 12000ms), 크기 제한 등 하드코딩
- **수정 방안**: 설정 가능한 상수로 분리
- **예상 작업시간**: 1시간

### 3. ❌ 타입 안정성 부족
- **파일**: `src/core/metadata-extractor.ts`
- **문제**: `parseMetadata`에서 any 타입 과다 사용
- **수정 방안**: 엄격한 타입 정의 및 런타임 검증
- **예상 작업시간**: 1시간

### 4. ❌ 로깅 시스템 부재
- **파일**: 전체
- **문제**: 보안 이벤트, 성능 메트릭 로깅 없음
- **수정 방안**: winston 또는 pino 도입
- **예상 작업시간**: 2시간

### 5. ❌ 테스트 커버리지 부족
- **파일**: 테스트 파일들
- **문제**: 보안 함수, 엣지 케이스 테스트 부족
- **수정 방안**: 
  - 정규식 수정 테스트
  - SVG 보안 테스트
  - 옵션 검증 테스트
- **예상 작업시간**: 3시간

---

## 📋 구현 체크리스트

### Phase 1: 긴급 보안 수정 ✅ **완료** (2025-08-12)
- [x] 정규식 버그 수정 ([e6fecf7])
- [x] 옵션 검증 추가 ([b29244c]) 
- [x] foreignObject 제거 ([ad9832e])
- [x] Sharp 보안 래퍼 적용 ([c6accd6])
- [x] 색상 값 검증 추가 ([e960fab])
- [x] 테스트 실행 및 검증 (✅ 전체 테스트 통과)

### Phase 1.5: 고급 보안 강화 (신규 추가)
- [ ] 검증 로직 단일화 및 타입 브랜딩 시스템
- [ ] 유니코드 제어문자 및 Bidi override 차단
- [ ] SVG 속성 레벨 보안 강화
- [ ] Sharp 보안 설정 고도화
- [ ] 리소스 상수 중앙화 및 환경변수 지원

### Phase 2: 주요 보안 강화 (1주 내)
- [ ] Rate Limiting 구현
- [ ] DNS Rebinding 방어 강화
- [ ] 보안 이벤트 로깅
- [ ] 보안 테스트 추가

### Phase 3: 성능 최적화 (2주 내)
- [ ] JPEG 최적화 적용
- [ ] 메타데이터 캐싱
- [ ] DNS 캐싱
- [ ] Sharp 인스턴스 풀링
- [ ] 파이프라인 최적화
- [ ] 성능 벤치마크

### Phase 4: 코드 품질 개선 (1개월 내)
- [ ] 로직 통합 및 중복 제거
- [ ] 매직 넘버 상수화
- [ ] 타입 안정성 강화
- [ ] 로깅 시스템 구축
- [ ] 테스트 커버리지 80% 달성

---

## 📈 진행 상황 추적

### 2025-08-12 (Phase 1 완료)
- **초기 분석**: 전체 코드베이스 보안/성능/품질 분석
- **항목 확장**: 18개 → 23개 개선사항 (P0: 12개, P1: 6개, P2: 5개)
- **Phase 1 완료**: Critical 보안 수정 5개 항목 모두 완료
  - ✅ 정규식 버그 수정 → CSS/색상 인젝션 차단
  - ✅ 옵션 검증 누락 → 직접 호출 시 검증 우회 방지
  - ✅ SVG foreignObject 제거 → XSS 공격 벡터 제거
  - ✅ Sharp 보안 래퍼 적용 → 픽셀 폭탄 DoS 방어
  - ✅ 색상 값 검증 추가 → SVG 템플릿 인젝션 방지
- **품질 확인**: 전체 테스트 통과, 린트/빌드 성공
- **고급 보안 계획**: Phase 1.5 추가 (타입 브랜딩, 유니코드 차단, 속성 보안 등)

### 다음 단계
1. ✅ ~~P0 기본 보안 이슈 수정 완료~~ (2025-08-12)
2. 🔄 Phase 1.5: 고급 보안 강화 (타입 브랜딩, 유니코드 차단, SVG 속성 보안)
3. Phase 2: Rate Limiting 및 DNS Rebinding 방어 고도화

---

## 🔧 테스트 명령어

```bash
# 린팅
npm run lint

# 테스트
npm test

# 빌드
npm run build

# 타입 체크
npx tsc --noEmit

# 보안 감사
npm audit
```

---

## 📝 작업 지시사항

### 브랜치 전략
- **각 Phase별 별도 브랜치 생성**
  - Phase 1: `fix/critical-security-p0`
  - Phase 2: `enhance/security-improvements`
  - Phase 3: `perf/optimization`
  - Phase 4: `refactor/code-quality`
- **각 개별 수정사항도 필요시 세부 브랜치 생성**
  - 예: `fix/regex-validation-bug`
- **머지 순서**: Phase 1 → main → Phase 2 → main → ...

### 진행 관리
- **각 작업 시작 시**:
  - IMPROVEMENTS.md의 해당 항목 상태를 `🔄 진행중`으로 변경
  - 작업 시작 시각 기록
- **각 작업 완료 시**:
  - IMPROVEMENTS.md의 해당 항목 상태를 `✅ 완료`로 변경
  - 완료 시각 및 관련 커밋/PR 링크 추가
  - 테스트 결과 요약 추가
- **매일 작업 종료 시**:
  - 진행 상황 섹션에 일일 요약 추가

### 커밋 메시지 규칙
```
<type>(<scope>): <subject>

[IMPROVEMENTS-<번호>] <상세 설명>

- 변경사항 1
- 변경사항 2
```
- **type**: fix(보안), perf(성능), refactor(리팩토링), test(테스트), docs(문서)
- **scope**: validation, image-processing, metadata, security 등
- **번호**: IMPROVEMENTS.md의 항목 번호 (예: P0-1, P1-2)

### 테스트 및 검증
- **각 수정 후 필수 실행**:
  ```bash
  npm run lint        # 코드 스타일
  npm test           # 단위 테스트
  npm run build      # 빌드 성공 확인
  npx tsc --noEmit   # 타입 체크
  npm audit          # 보안 취약점 검사
  ```
- **성능 개선 작업 시**:
  - Before/After 벤치마크 결과 기록
  - 메모리 사용량 프로파일링
  - 응답 시간 측정 (p50, p95, p99)
- **보안 수정 시**:
  - PoC(Proof of Concept) 코드로 취약점 재현 테스트
  - 수정 후 동일 PoC로 방어 확인
  - Edge case 테스트 추가

### 코드 리뷰 체크리스트
- [ ] 기존 API 호환성 유지 확인
- [ ] 새로운 의존성 추가 시 라이센스 검토
- [ ] 성능 영향도 측정 (특히 이미지 처리 시간)
- [ ] 메모리 누수 가능성 검토
- [ ] 에러 처리 및 로깅 적절성
- [ ] 테스트 커버리지 유지/향상
- [ ] 문서 업데이트 필요성 검토

### 롤백 계획
- **각 Phase 배포 전**:
  - 현재 버전 태그 생성 (예: `v0.1.1-before-p0-fixes`)
  - 롤백 스크립트 준비
  - 주요 메트릭 베이스라인 기록
- **문제 발생 시**:
  - 즉시 이전 버전으로 롤백
  - 문제 원인 분석 후 IMPROVEMENTS.md에 기록
  - 수정 계획 수립 후 재시도

### 문서화
- **각 Phase 완료 시**:
  - CHANGELOG.md 업데이트
  - README.md 필요시 업데이트
  - API 문서 변경사항 반영
- **보안 수정 사항**:
  - 별도 SECURITY.md 파일에 상세 기록
  - CVE 할당 필요성 검토

### 모니터링
- **배포 후 24시간**:
  - 에러율 모니터링
  - 성능 메트릭 추적
  - 메모리 사용량 관찰
- **이상 징후 발견 시**:
  - 즉시 알림
  - 원인 분석 및 대응

### 협업 및 소통
- **일일 스탠드업** (혼자 작업 시에도 기록):
  - 어제 완료한 작업
  - 오늘 계획
  - 블로커 사항
- **Phase 완료 시**:
  - 전체 변경사항 요약
  - 학습한 내용 (Lessons Learned)
  - 다음 Phase 준비사항

### AI 도구 활용 지침
- **코드 수정 시**:
  - 항상 현재 코드를 먼저 읽고 이해한 후 수정
  - 수정 전후 diff 확인
  - 의도하지 않은 변경사항 검토
- **테스트 작성 시**:
  - 실제 취약점을 재현하는 테스트 우선 작성
  - Happy path와 Edge case 모두 포함
- **컨텍스트 관리**:
  - 작업 시작 시 IMPROVEMENTS.md 먼저 읽기
  - 중요 결정사항은 즉시 문서화
  - 세션 종료 전 진행상황 업데이트

### 백업 및 복구
- **작업 시작 전**:
  - 현재 상태 커밋 (WIP 커밋도 가능)
  - 중요 변경 전 로컬 백업
- **실수 발생 시**:
  - `git reflog`로 복구 지점 찾기
  - 필요시 이전 커밋으로 하드 리셋

### 의존성 관리
- **패키지 업데이트 시**:
  - 보안 패치는 즉시 적용
  - Major 버전 업그레이드는 별도 브랜치에서 테스트
  - package-lock.json 항상 커밋
- **새 패키지 추가 시**:
  - 번들 크기 영향 확인
  - 라이센스 호환성 검토
  - 보안 취약점 스캔

### 성능 기준선 (Baseline)
- **현재 성능 지표** (수정 전 측정 필요):
  - 1200x630 이미지 생성: ~XXXms
  - 메타데이터 추출: ~XXXms
  - 메모리 사용량: ~XXXMB
- **목표 성능**:
  - 이미지 생성: <500ms
  - 메타데이터 추출: <200ms
  - 메모리 사용량: <100MB

## 📝 참고사항

- 모든 보안 수정은 별도 브랜치에서 작업 후 철저한 테스트 필요
- 성능 개선은 벤치마크를 통해 효과 측정
- 코드 변경 시 기존 API 호환성 유지
- 각 수정사항에 대한 단위 테스트 작성 필수
- 급하게 수정하지 말고 충분히 검토 후 적용
- "왜" 이런 수정이 필요한지 항상 문서화