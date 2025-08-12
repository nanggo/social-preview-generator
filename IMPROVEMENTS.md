# Social Preview Generator - 개선사항 추적 문서

> 작성일: 2025-08-12  
> 목적: 보안, 성능, 버그 개선사항을 체계적으로 추적하고 구현 진행상황을 관리

## 📊 개선사항 요약

| 우선순위 | 카테고리 | 완료 | 진행중 | 대기 | 총계 |
|---------|---------|------|--------|------|------|
| P0 (Critical) | 보안 | 0 | 0 | 7 | 7 |
| P1 (High) | 성능 | 0 | 0 | 6 | 6 |
| P2 (Medium) | 품질 | 0 | 0 | 5 | 5 |

---

## 🔴 P0: 보안 개선사항 (Critical - 즉시 수정 필요)

### 1. ❌ 정규식 버그 수정
- **파일**: `src/utils/validators.ts`
- **라인**: 260-279
- **문제**: 제어문자 탐지 정규식이 잘못되어 보안 검증 무력화
- **현재 코드**:
  ```javascript
  /\x00-\x1f/g  // 잘못됨 - 리터럴 문자열 매칭
  /\x7f-\x9f/g  // 잘못됨
  ```
- **수정 코드**:
  ```javascript
  /[\x00-\x1f]/g  // 올바름 - 제어문자 범위 매칭
  /[\x7f-\x9f]/g  // 올바름
  ```
- **영향도**: CSS/색상 인젝션 공격 가능
- **예상 작업시간**: 5분

### 2. ❌ 옵션 검증 누락
- **파일**: `src/index.ts`
- **라인**: 70-78
- **문제**: `generateImageWithTemplate` 직접 호출 시 입력 검증 우회 가능
- **수정 방안**:
  ```javascript
  export async function generateImageWithTemplate(
    metadata: ExtractedMetadata,
    template: TemplateConfig,
    options: PreviewOptions
  ): Promise<Buffer> {
    // 추가 필요
    validateOptions(options);
    
    const width = options.width || DEFAULT_DIMENSIONS.width;
    const height = options.height || DEFAULT_DIMENSIONS.height;
    // ...
  }
  ```
- **영향도**: 악의적 입력으로 시스템 자원 고갈 가능
- **예상 작업시간**: 10분

### 3. ❌ SVG foreignObject 태그 허용
- **파일**: `src/utils/image-security.ts`
- **라인**: 206-236
- **문제**: `foreignObject` 허용으로 HTML/JavaScript 삽입 가능
- **수정 방안**: `ALLOWED_TAGS` 배열에서 `foreignObject` 제거
- **영향도**: XSS 공격 벡터
- **예상 작업시간**: 5분

### 4. ❌ Sharp 보안 래퍼 미적용
- **파일**: `src/index.ts`
- **라인**: 246-268
- **문제**: `processImageForTemplate`에서 일반 `sharp()` 사용
- **수정 방안**:
  ```javascript
  // 변경 전
  let processedImage = sharp(imageBuffer).resize(...)
  
  // 변경 후
  const secureImage = createSecureSharpInstance(imageBuffer);
  let processedImage = secureResize(secureImage, width, height, {...})
  ```
- **영향도**: 픽셀 폭탄 공격 가능
- **예상 작업시간**: 15분

### 5. ❌ 색상 값 직접 삽입
- **파일**: `src/core/image-generator.ts`
- **라인**: 142-151
- **문제**: `createBlankCanvas`에서 사용자 색상을 검증 없이 SVG에 삽입
- **수정 방안**:
  ```javascript
  const backgroundColor = validateColor(options.colors?.background || '#1a1a2e');
  const accentColor = validateColor(options.colors?.accent || '#16213e');
  ```
- **영향도**: SVG 인젝션 가능
- **예상 작업시간**: 10분

### 6. ❌ Rate Limiting 부재
- **파일**: 전체 시스템
- **문제**: DoS 공격 방어 메커니즘 없음
- **수정 방안**: 
  - express-rate-limit 또는 자체 구현
  - IP별, 요청별 제한
  - 이미지 생성 큐 구현
- **영향도**: 서비스 거부 공격 가능
- **예상 작업시간**: 2시간

### 7. ❌ DNS Rebinding 방어 미흡
- **파일**: `src/utils/secure-agent.ts`
- **문제**: Time-of-check-time-of-use (TOCTOU) 취약점
- **수정 방안**: 
  - DNS 조회 결과 캐싱
  - 연결 시점 재검증
- **영향도**: SSRF 우회 가능
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

### Phase 1: 긴급 보안 수정 (1일 내)
- [ ] 정규식 버그 수정
- [ ] 옵션 검증 추가
- [ ] foreignObject 제거
- [ ] Sharp 보안 래퍼 적용
- [ ] 색상 값 검증 추가
- [ ] 테스트 실행 및 검증

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

### 2025-08-12 (초기 분석)
- 전체 코드베이스 보안/성능/품질 분석 완료
- 18개 개선사항 식별 (P0: 7개, P1: 6개, P2: 5개)
- 우선순위 및 구현 계획 수립

### 다음 단계
1. P0 보안 이슈 즉시 수정 (정규식, 옵션 검증, foreignObject, Sharp 래퍼, 색상 검증)
2. 수정 후 전체 테스트 수행
3. PR 생성 및 보안 리뷰

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