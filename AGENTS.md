# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the TypeScript library code (entrypoint `src/index.ts`):
- `src/core/` metadata extraction + image generation pipeline
- `src/templates/` OG image templates (`modern.ts`, `classic.ts`, `minimal.ts`) and shared helpers (`shared.ts`, `registry.ts`)
- `src/utils/` shared helpers (including `src/utils/validators/`)
- `src/constants/`, `src/types/` shared limits and public types
- `src/assets/` static assets (fallback images/fonts when present)

Tests live in `test/` (`unit/`, `integration/`, `performance/`) with fixtures in `test/fixtures/`; Vitest is configured in `vitest.config.ts`. `examples/` contains runnable demos/middleware. Generated artifacts like `dist/`, `coverage/`, and `examples/output/` are gitignored.

## Build, Test, and Development Commands
- `pnpm install` install dependencies (requires Node `>=20`)
- `pnpm run build` compile to `dist/` with `tsc`
- `pnpm run dev` run `tsc --watch`
- `pnpm test` run Vitest
- `pnpm run lint` lint `src/**/*.ts` with ESLint (`eslint.config.mjs`)
- `pnpm run format` format `src/**/*.ts` with Prettier
- `cd examples && pnpm install && pnpm start` run the example server (optional)

## Coding Style & Naming Conventions
- TypeScript is `strict`; avoid `any` where practical (`@typescript-eslint/no-explicit-any` is a warning in source, off in tests).
- Prettier settings: 2 spaces, single quotes, semicolons, `printWidth: 100` (see `.prettierrc`).
- Naming: files in `kebab-case.ts`; functions/vars `camelCase`; types/classes `PascalCase`; constants `SCREAMING_SNAKE_CASE`.

## Testing Guidelines
- Place tests as `*.test.ts` / `*.spec.ts` under `test/**` (or `src/**/__tests__/**`).
- Some integration tests may hit the network; use `SKIP_NETWORK_TESTS=true pnpm test` where supported (see `test/integration/real-urls.test.ts`).
- For visual/template changes, include a before/after sample image in the PR description (do not commit large binaries).

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat(security): …`, `fix(validation): …`, `perf(optimization): …`).
- PRs should include: what/why, linked issue (if any), test + lint status, and any relevant sample outputs.
