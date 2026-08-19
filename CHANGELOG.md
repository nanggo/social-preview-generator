# Changelog

## 0.5.0

### Security

- Pin every GitHub Action to an immutable commit and enforce the policy in CI.
- Reject URL userinfo, control characters, oversized canonical URLs, unsafe redirects, and
  private/reserved IP literals before socket creation.
- Replace raw metadata/in-flight URL keys with process-local opaque identifiers and remove raw
  URLs and transport errors from diagnostics.
- Validate caller metadata and custom templates before render admission, while preserving
  arbitrary trusted `overlayGenerator` callbacks behind a 1 MiB SVG output limit.
- Add 64 MiB preview-cache and 16 MiB SVG-cache retained-byte budgets.
- Resolve DOMPurify and Undici advisories; release verification requires a clean production audit.

### Observable changes

- URLs containing `username:password@host` now fail with `VALIDATION_ERROR`.
- Malformed or excessive metadata/template values now fail with `VALIDATION_ERROR`.
- `getInflightRequestStats().keys` now returns opaque process-local request IDs.
- Preview buffers larger than 16 MiB are returned but not retained in memory cache.
