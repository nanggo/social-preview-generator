# Changelog

## 0.5.3

### Security

- Retain only validated image dimensions, format, and density in the image-analysis cache;
  discard expanded XMP, EXIF, ICC, comments, and other embedded metadata after validation.
- Do not cache images rejected by dimension or density validation, and preserve cache-hit
  diagnostics for accepted images.

### Fixes

- Apply background `imageProcessing.contrast` and `imageProcessing.blur` options, including
  consistent middle gray for 16-bit inputs and explicit zero-blur overrides.
- Materialize contrast-adjusted backgrounds before SVG composition so text and logos retain
  their original colours. Propagate native processing timeouts without retrying.
- Reject blur radii between zero and 0.3 before fetching; supported values are zero or 0.3–100.
- Document that the legacy `fonts` option is not applied by built-in or default overlays.

### Examples

- Keep queued Redis concurrency permits until handlers finish; handle promotion, timeout,
  duplicate release, and promoted-permit expiry atomically.
- Link examples to the current package, use native UUID generation and current width/height
  options, and report actual generated dimensions and format.
- Add a locked example dependency set with patched `qs`, HTTP regression tests, and actual
  Redis Lua lifecycle tests in CI. Redis is opt-in and configured failures reject requests.

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
