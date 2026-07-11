# social-preview-generator Working Agreements

This repository is a TypeScript library that generates social-preview images from URLs or caller-provided metadata.

## Runtime and Public Surface

- Use `pnpm`; `package.json#packageManager` and `package.json#engines` are the current pnpm and Node source of truth.
- Library code lives under `src/`; `pnpm run build` compiles it to the ignored `dist/` directory.
- The public surface includes `src/index.ts`, `src/exports.ts`, `src/types/`, and `package.json#exports`. Preserve compatibility across these boundaries unless the current request explicitly authorizes an API change.

## Verification

- Start with the closest Vitest file, then run `pnpm test`. The default suite excludes the real-URL HTTP test, but some `enhanced-secure-agent` unit cases still exercise system DNS, so do not assume it is fully network-free.
- `test/integration/real-urls.test.ts` is excluded by `vitest.config.ts` and performs real network requests. Do not include it in ordinary validation; run it only when the request explicitly calls for real-URL behavior.
- Add `pnpm run lint` for source changes and `pnpm run build` for public exports, types, or packaging changes.
- For template or rendering changes, generate representative images under ignored `examples/output/` or a temporary directory and inspect the actual pixels and dimensions. Do not treat a passing unit test alone as visual verification, and do not commit generated `dist/`, coverage, or sample-image artifacts.
