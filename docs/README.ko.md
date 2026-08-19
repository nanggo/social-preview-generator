# Social Preview Generator

[English](../README.md) | **한국어**

공개 HTTP(S) URL 하나를 안전하고 일관된 소셜 미리보기 JPEG로 변환합니다. JSX나 Next.js
route가 필요하지 않습니다.

`generatePreview(url)`가 Open Graph 및 Twitter Card 메타데이터를 가져오고 private 및
reserved network target을 차단한 뒤, 내장 템플릿을 적용해 JPEG `Buffer`를 반환합니다.

[![npm version](https://img.shields.io/npm/v/@nanggo/social-preview.svg)](https://www.npmjs.com/package/@nanggo/social-preview)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/nanggo/social-preview-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/nanggo/social-preview-generator/actions/workflows/ci.yml)

## 주요 특징

- 공개 URL을 한 번의 호출로 JPEG `Buffer`로 변환
- Open Graph 및 Twitter Card 메타데이터 자동 추출
- private, loopback, reserved 및 mixed-DNS target으로 향하는 요청 차단
- React, JSX, 브라우저 또는 이미지 API route 없이 서버용 Node.js에서 실행
- URL 요청이 필요 없을 때 전달받은 메타데이터를 직접 렌더링
- `modern`, `classic`, `minimal`, `article` 내장 템플릿 제공
- CommonJS, ESM, TypeScript 지원
- 서버 글꼴 fallback을 사용한 한국어 텍스트 렌더링

## 이런 경우에 적합합니다

| 적합한 경우                                                       | 다른 도구가 더 적합한 경우                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| URL에서 시작하는 링크 디렉터리, 북마크, 큐레이션 서비스           | 데이터가 이미 있고 React/JSX로 자유롭게 디자인하려는 경우      |
| 미리보기 파일을 미리 생성하는 CMS, 정적 사이트 및 batch 작업      | 브라우저 또는 Edge runtime이 필요한 경우                       |
| 공개 URL을 입력받고 안전한 network 기본값이 필요한 Node.js 서비스 | headless browser로 JavaScript 렌더링 페이지를 읽어야 하는 경우 |
| HTTP 이미지 응답 대신 `Buffer` 또는 파일이 필요한 작업            | 사용자 지정 이미지 route를 직접 만들고 운영하려는 경우         |

## 요구사항

- Node.js 22.13 이상인 22.x 버전 또는 Node.js 24 이상
- Sharp를 사용하는 서버용 Node.js 패키지이며 브라우저 라이브러리가 아닙니다

## 설치

```bash
npm install @nanggo/social-preview
```

## URL 하나로 JPEG 생성

```javascript
const { writeFile } = require('node:fs/promises');
const { generatePreview } = require('@nanggo/social-preview');

async function main() {
  const image = await generatePreview('https://github.com');
  await writeFile('preview.jpg', image);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

ESM named import도 지원합니다.

```javascript
import { generatePreview } from '@nanggo/social-preview';
```

## 보조 기능: 알고 있는 메타데이터로 생성

게시 또는 빌드 파이프라인에서 제목, canonical URL, 설명과 선택적 이미지 정보를 이미 알고
있다면 `generatePreviewFromMetadata`를 사용합니다.

```javascript
const { mkdir, writeFile } = require('node:fs/promises');
const { generatePreviewFromMetadata } = require('@nanggo/social-preview');

async function main() {
  const image = await generatePreviewFromMetadata(
    {
      title: 'Open Graph 이미지 생성하기',
      description: '블로그 글을 발행하면서 소셜 미리보기를 생성합니다.',
      siteName: 'My Blog',
      url: 'https://example.com/posts/open-graph-images',
      image: 'https://example.com/images/open-graph-cover.jpg',
    },
    {
      template: 'modern',
      colors: { accent: '#2563EB' },
    }
  );

  await mkdir('public/og', { recursive: true });
  await writeFile('public/og/open-graph-images.jpg', image);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

이 모드에서는 페이지 URL을 요청하지 않습니다. 선택한 템플릿이 원격 `image`를 사용한다면
해당 이미지는 요청할 수 있습니다.

## 템플릿

| 템플릿    | 적합한 용도                | 특징                                                 |
| --------- | -------------------------- | ---------------------------------------------------- |
| `modern`  | 제품 및 일반적인 카드      | 중앙 정렬된 현대적인 오버레이                        |
| `classic` | 뉴스 및 블로그 링크        | 이미지와 텍스트를 나눈 전통적인 카드                 |
| `minimal` | 문서 및 텍스트 중심 페이지 | 절제된 텍스트 중심 레이아웃                          |
| `article` | 아티클 및 편집 콘텐츠      | 선택적 모바일 요약; 원격 커버 이미지는 사용하지 않음 |

`article` 템플릿은 설명이 있으면 모바일 요약을 기본으로 표시합니다. 텍스트만 있는
아티클 카드에는 `mobilePreview: false`를 사용하세요.

## API

| Export                                                       | 반환값                      | 용도                                                    |
| ------------------------------------------------------------ | --------------------------- | ------------------------------------------------------- |
| `generatePreview(url, options?)`                             | `Promise<Buffer>`           | URL에서 메타데이터를 가져와 JPEG 반환                   |
| `generatePreviewFromMetadata(metadata, options?)`            | `Promise<Buffer>`           | 전달받은 메타데이터 렌더링                              |
| `generatePreviewWithDetails(url, options?)`                  | `Promise<GeneratedPreview>` | 메타데이터, 크기, 템플릿, 캐시 상태를 포함한 URL 렌더링 |
| `generatePreviewFromMetadataWithDetails(metadata, options?)` | `Promise<GeneratedPreview>` | 전체 결과 정보를 포함한 메타데이터 렌더링               |
| `generateImageWithTemplate(metadata, template, options)`     | `Promise<Buffer>`           | 전달받은 `TemplateConfig`로 렌더링                      |

`PreviewMetadataInput`에는 `title`과 `url`이 필요합니다. 선택적 필드는
`description`, `image`, `siteName`, `favicon`, `author`, `publishedDate`,
`domain`, `locale`입니다.

현재 모든 이미지 생성 메서드는 JPEG 데이터를 반환합니다. 런타임의
`GeneratedPreview.format`은 항상 `'jpeg'`이며, 더 넓은 TypeScript union은 호환성을 위해
유지합니다.

상세 결과 메서드는 다음 값을 반환합니다.

```typescript
interface GeneratedPreview {
  buffer: Buffer;
  format: 'png' | 'jpeg' | 'webp'; // 현재는 항상 'jpeg'
  dimensions: { width: number; height: number };
  metadata: ExtractedMetadata;
  template: string;
  cached: boolean;
}
```

### 사용자 지정 템플릿

패키지의 기본 텍스트 오버레이와 함께 사용자 지정 템플릿을 사용할 수 있습니다.

```javascript
const { writeFile } = require('node:fs/promises');
const { generateImageWithTemplate } = require('@nanggo/social-preview');

async function main() {
  const image = await generateImageWithTemplate(
    {
      title: '사용자 지정 소셜 카드',
      description: '전달받은 레이아웃과 타이포그래피로 렌더링합니다.',
      url: 'https://example.com/custom-card',
    },
    {
      name: 'brand-card',
      layout: { padding: 64, imagePosition: 'none' },
      typography: {
        title: { fontSize: 64, fontWeight: '700', lineHeight: 1.1, maxLines: 2 },
        description: { fontSize: 28, lineHeight: 1.3, maxLines: 2 },
      },
    },
    {
      width: 1200,
      height: 630,
      colors: {
        background: '#0F172A',
        accent: '#2563EB',
        text: '#FFFFFF',
      },
    }
  );

  await writeFile('custom-preview.jpg', image);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

사용자 지정 `overlayGenerator`는 신뢰할 수 있는 호출자가 제공하는 동기 코드입니다.
신뢰할 수 없는 JSON에서 구성하지 마세요. 반환 SVG는 문자열이며 UTF-8 기준 1MiB 이하여야
합니다.

### 고급 유틸리티

| Export                           | 용도                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `getInflightRequestStats()`      | URL을 노출하지 않고 요청 병합 상태 확인              |
| `clearInflightRequests()`        | 요청 병합 상태 삭제; 진행 중인 작업이 중복될 수 있음 |
| `startCacheCleanup(intervalMs?)` | 메타데이터 및 미리보기 캐시 정리 시작                |
| `stopCacheCleanup()`             | 캐시 정리 interval 중지                              |
| `isCacheCleanupRunning()`        | 캐시 정리 상태 확인                                  |
| `getCacheStats()`                | 내부 Sharp 캐시 통계 확인                            |
| `clearAllCaches()`               | 내부 Sharp 캐시 삭제                                 |
| `shutdownSharpCaches()`          | 내부 Sharp 캐시 중지 및 삭제                         |

## 주요 옵션

```typescript
interface PreviewOptions {
  template?: 'modern' | 'classic' | 'minimal' | 'article'; // 기본값: 'modern'
  mobilePreview?: boolean; // article 전용. 설명이 있으면 기본값 true
  width?: number; // 100-4096, 기본값: 1200
  height?: number; // 100-4096, 기본값: 630
  quality?: number; // 정수 1-100, 기본값: 90
  cache?: boolean; // 기본값: false
  fallback?: {
    strategy?: 'auto' | 'generate';
    text?: string;
  };
  colors?: {
    primary?: string;
    secondary?: string;
    background?: string;
    text?: string;
    accent?: string;
    overlay?: string;
  };
  security?: {
    httpsOnly?: boolean; // HTTP URL 거부. 기본값: false
    allowSvg?: boolean; // 정제된 원격 SVG 이미지 허용. 기본값: false
    maxRedirects?: number; // 정수 0-10, 기본값: 3
    timeout?: number; // 전체 요청 제한 시간(ms), 1-30000
  };
}
```

전체 옵션과 템플릿 구조는 패키지가 export하는 TypeScript 정의를 기준으로 합니다.

## 오류 처리

검증, 요청, 메타데이터, 렌더링, 템플릿 및 캐시 오류는 `ErrorType`을 포함한
`PreviewGeneratorError`를 사용합니다.

```javascript
const { ErrorType, PreviewGeneratorError, generatePreview } = require('@nanggo/social-preview');

async function main() {
  try {
    await generatePreview('https://example.com');
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      console.error(error.type, error.message);
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## 보안 및 리소스 제한

- HTTP(S) URL만 허용합니다. 앞뒤 공백을 제거하고 URL credential을 거부하며 fragment는
  무시합니다. C0/C1 제어 문자를 차단하고, 공백 제거 후 입력 URL과 canonical URL을 모두
  2,048자로 제한합니다.
- socket을 만들기 전에 private, loopback, link-local 및 기타 reserved IP 목적지를
  차단합니다. private 결과나 public/private가 섞인 DNS 결과를 가진 hostname도 거부합니다.
- `security.httpsOnly`를 사용하면 HTTPS에서 HTTP로 향하는 redirect를 거부합니다.
- 원격 SVG 이미지는 기본으로 비활성화되며, 명시적으로 허용해도 정제 후 처리합니다.
- 메타데이터 text 필드는 10,000자로 제한합니다. Sharp 작업 전에 템플릿 숫자 필드, CSS
  font weight 및 gradient 크기를 검증합니다.
- 생성된 SVG는 항목당 1MiB, SVG 캐시에 보관되는 전체 크기는 16MiB로 제한합니다.
- 16MiB를 넘는 미리보기는 정상적으로 렌더링하지만 캐시하지 않습니다. 미리보기 캐시는
  이미지 buffer를 최대 64MiB까지 보관합니다.
- `getInflightRequestStats().keys`에는 URL 대신 복원할 수 없는 process-local request ID가
  들어갑니다. ID는 process가 다시 시작되면 변경됩니다.

이 보호 장치는 위험을 줄이지만, 임의 사용자가 렌더링을 요청할 수 있는 서비스에서는
애플리케이션 수준의 인증, 권한 확인, rate limiting 및 workload 격리를 별도로 적용해야
합니다.

## 기여

기여를 환영합니다. 저장소를 fork하고 범위가 명확한 branch를 만든 다음, 관련 검사를
실행하고 pull request를 열어 주세요.

## 라이선스

MIT — 자세한 내용은 [LICENSE](../LICENSE)를 확인하세요.
