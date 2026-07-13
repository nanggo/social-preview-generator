# Social Preview Generator

[English](../README.md) | **한국어**

URL 또는 이미 알고 있는 페이지 메타데이터로 Open Graph 및 소셜 미리보기 이미지를 생성합니다.

[![npm version](https://img.shields.io/npm/v/@nanggo/social-preview.svg)](https://www.npmjs.com/package/@nanggo/social-preview)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/nanggo/social-preview-generator/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/nanggo/social-preview-generator/actions/workflows/npm-publish.yml)

## 주요 기능

- URL에서 Open Graph 및 Twitter Card 메타데이터 추출
- 정적 게시 흐름에서 전달받은 메타데이터로 이미지 직접 생성
- 내장된 `modern`, `classic`, `minimal`, `article` 템플릿으로 렌더링
- Sharp를 사용한 이미지 처리 및 최적화
- 메타데이터가 불완전할 때 생성형 미리보기로 대체
- TypeScript 타입 정의 제공
- 한국어 텍스트 렌더링 지원

## 설치

Node.js 22.13 이상(22.x) 또는 24 이상이 필요합니다.

```bash
npm install @nanggo/social-preview
```

## 빠른 시작

```javascript
const { generatePreview } = require('@nanggo/social-preview');

const imageBuffer = await generatePreview('https://github.com');

const fs = require('fs').promises;
await fs.writeFile('preview.jpg', imageBuffer);
```

## API

### `generatePreview(url, options?)`

URL로 소셜 미리보기 이미지를 생성합니다.

#### 매개변수

- `url` (string): 미리보기를 생성할 URL
- `options` (PreviewOptions): 선택적 설정

#### 반환값

- `Promise<Buffer>`: JPEG 형식의 이미지 버퍼

### `generatePreviewFromMetadata(metadata, options?)`

이미 가지고 있는 메타데이터로 소셜 미리보기 이미지를 생성합니다. 페이지 URL을 가져오거나
스크래핑하지 않으므로 제목, 설명, 정규 URL, 커버 이미지를 게시 또는 빌드 시점에 알고 있는
정적 블로그 게시 파이프라인에 유용합니다.

#### 매개변수

- `metadata` (PreviewMetadataInput): 렌더링할 페이지 또는 게시물 메타데이터
- `options` (PreviewOptions): 선택적 설정

#### 반환값

- `Promise<Buffer>`: JPEG 형식의 이미지 버퍼

### 옵션

```typescript
interface PreviewOptions {
  template?: 'modern' | 'classic' | 'minimal' | 'article'; // 사용할 템플릿(기본값: 'modern')
  width?: number; // 이미지 너비(기본값: 1200)
  height?: number; // 이미지 높이(기본값: 630)
  quality?: number; // JPEG 품질 1-100(기본값: 90)
  cache?: boolean; // 생성 결과를 메모리에 캐시(기본값: false)
  mobilePreview?: boolean; // article 전용. 설명이 있으면 기본값은 true
  fallback?: {
    strategy?: 'auto' | 'generate'; // 대체 전략
    text?: string; // 사용자 지정 대체 텍스트
  };
  colors?: {
    primary?: string; // article 주 색상(기본값: '#3182F6')
    background?: string; // 배경색
    text?: string; // 텍스트 색상
    accent?: string; // 강조색
  };
}
```

### 정적 블로그 게시

게시물을 발행할 때 이미지를 한 번 생성한 다음, 저장한 파일을 `og:image`로 지정합니다.

```javascript
const { generatePreviewFromMetadata } = require('@nanggo/social-preview');
const fs = require('fs').promises;

const buffer = await generatePreviewFromMetadata(
  {
    title: 'How to Generate Open Graph Images',
    description: 'Create a social preview image while publishing a blog post.',
    siteName: 'My Blog',
    url: 'https://example.com/posts/open-graph-images',
    image: 'https://example.com/images/open-graph-cover.jpg',
  },
  {
    template: 'modern',
    width: 1200,
    height: 630,
    quality: 90,
  }
);

await fs.writeFile('public/og/open-graph-images.jpg', buffer);
```

## 예제

### 기본 사용법

```javascript
const { generatePreview } = require('@nanggo/social-preview');

async function createPreview() {
  const buffer = await generatePreview('https://www.npmjs.com');
  await fs.writeFile('npm-preview.jpg', buffer);
}
```

### 스타일 사용자 지정

```javascript
const buffer = await generatePreview('https://example.com', {
  template: 'modern',
  colors: {
    background: '#2c3e50',
    accent: '#3498db',
    text: '#ffffff',
  },
  quality: 95,
});
```

### 대체 처리

```javascript
const buffer = await generatePreview('https://example.com', {
  fallback: {
    strategy: 'generate',
    text: 'My Custom Preview',
  },
});
```

### 아티클 미리보기

텍스트만 있는 아티클 카드에는 `mobilePreview: false`를 사용합니다. 옵션을 생략하면 메타데이터에
설명이 있을 때 `article` 템플릿이 모바일 미리보기를 표시합니다. 정사각형에 가까운 비율과
세로형 출력에서는 모바일 화면이 제목 아래에 자동으로 배치됩니다. 일반적인 소셜 미리보기
비율을 기준으로 하며, 극단적인 화면 비율은 가능한 범위에서만 대응합니다.

```javascript
const buffer = await generatePreviewFromMetadata(metadata, {
  template: 'article',
  mobilePreview: true,
  colors: {
    primary: '#7C3AED',
  },
});
```

## 템플릿

### Modern (기본값)

- 깔끔하고 현대적인 디자인
- 그라디언트 오버레이
- 중앙 정렬 텍스트 레이아웃
- 기술 및 현대적인 웹사이트에 적합

### Classic

- 전통적인 카드 레이아웃
- 위쪽에 이미지, 아래쪽에 텍스트 배치
- 뉴스 및 블로그 사이트에 적합

### Minimal

- 단순하고 텍스트 중심적인 디자인
- 최소한의 장식
- 문서 사이트에 적합

### Article

- 아티클 및 블로그 메타데이터를 위한 편집 디자인 레이아웃
- 설명이 있으면 기본으로 활성화되는 선택적 모바일 미리보기
- 정사각형에 가까운 비율과 세로형 출력에 대응하는 반응형 스택 레이아웃
- `colors.primary`로 주 색상 사용자 지정 가능(기본값: `#3182F6`)
- 메타데이터만 사용해 렌더링하며, 원격 커버 이미지는 의도적으로 사용하지 않음

## 아키텍처

```
social-preview-generator/
├── src/
│   ├── core/
│   │   ├── metadata-extractor.ts        # URL 메타데이터 추출
│   │   ├── image-generator.ts           # 이미지 생성 엔진
│   │   ├── overlay-generator.ts         # SVG 텍스트 오버레이 생성
│   │   └── template-image-processing.ts # 템플릿별 이미지 처리
│   ├── templates/
│   │   ├── modern.ts                    # Modern 템플릿
│   │   ├── classic.ts                   # Classic 템플릿
│   │   ├── minimal.ts                   # Minimal 템플릿
│   │   ├── article.ts                   # Article 템플릿
│   │   ├── shared.ts                    # 공유 레이아웃 도우미
│   │   └── registry.ts                  # 템플릿 레지스트리
│   ├── utils/                           # 공유 유틸리티 및 보안
│   ├── constants/                       # 보안 제한 및 글꼴 설정
│   ├── types/
│   │   └── index.ts                     # TypeScript 타입 정의
│   └── index.ts                         # 메인 진입점
```

## 기여하기

기여를 환영합니다! 언제든지 Pull Request를 보내 주세요.

1. 저장소를 포크합니다.
2. 기능 브랜치를 생성합니다(`git checkout -b feature/amazing-feature`).
3. 변경 사항을 커밋합니다(`git commit -m 'Add some amazing feature'`).
4. 브랜치에 푸시합니다(`git push origin feature/amazing-feature`).
5. Pull Request를 엽니다.

## 라이선스

이 프로젝트는 MIT 라이선스를 따릅니다. 자세한 내용은 [LICENSE](../LICENSE) 파일을 참고하세요.

## 감사의 말

- [Sharp](https://sharp.pixelplumbing.com/) - 고성능 이미지 처리
- [Open Graph Scraper](https://github.com/jshemas/openGraphScraper) - 메타데이터 추출
- [Axios](https://axios-http.com/) - HTTP 클라이언트

## 링크

- [npm 패키지](https://www.npmjs.com/package/@nanggo/social-preview)
- [GitHub 저장소](https://github.com/nanggo/social-preview-generator)
- [이슈 제보](https://github.com/nanggo/social-preview-generator/issues)

---

[nanggo](https://github.com/nanggo)가 만들었습니다.
