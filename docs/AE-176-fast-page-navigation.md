# AE-176 Fast Page Navigation

## Architecture & Final Decisions

### Cache-Control & Prefetch Decision
- **Cache-Control Policy:** `private, no-store` is intentionally retained on the image and thumbnail routes. This policy is essential to avoid leaking protected exam assets into intermediate proxies or browser caches across shared devices, ensuring strict authorization enforcement on every request.
- **N±1 Prefetch Removal:** Because the API responses mandate `no-store`, prefetching adjacent pages into the browser cache is ineffective and causes duplicate downloads when the user navigates. Therefore, the adjacent-page prefetching logic (`N±1`) in the Canvas has been fully removed.

### ETag & Cache Invalidation
- **Issue:** The ETag was previously derived directly from `storageKey` or `thumbnailKey`, which remains static even if the underlying asset bytes are rewritten (e.g., during an image repair or re-ingest).
- **Resolution:** The API now generates ETags by hashing the `updatedAt` timestamp of the `IngestionPage`. This provides correct cache invalidation when the underlying asset changes while keeping the internal storage path hidden.
- **Security:** ETags are validated strictly *after* authorization. An unallocated TA presenting a valid ETag will receive a 404/403, never a 304.

### TA Thumbnail Authorization
- The thumbnail route previously enforced the `EDIT_EXAM` permission, which TAs do not hold.
- The route was updated to use the same security model as the high-resolution image route: requiring `GradingOrAnnotationAccess` and explicitly verifying the TA's allocation using `AllocationService.verifyTaAllocation`.

### Tiling Decision
- Tiling (breaking the image into smaller chunks for lazy loading) was explored but ultimately dropped for this iteration.
- **Why it was dropped:** The added complexity of tile coordinates, rendering gaps, and backend processing overhead outweighed the benefits for typical A4 scan resolutions. Tiling adds network request overhead that degrades performance on high-latency connections.
- **What was chosen instead:** A "thumbnail-first" loading approach was implemented. A low-resolution thumbnail is served quickly while the full-resolution image loads in parallel, providing immediate visual feedback during navigation.

### Thumbnail Fallback
- If the thumbnail fails to load (e.g., network error or missing thumbnail), the `onerror` fallback gracefully waits for the high-resolution image to finish loading in parallel. This avoids infinite error loops and ensures the full image remains accessible.

## Performance Measurements

**Real browser measurements on a script with >= 40 pages:**

*The environment does not currently have a >=40-page browser dataset/environment available to run real user-facing performance measurements within the scope of this automated execution. As instructed, no values have been invented.*

### What Remains to be Measured:
1. **Placeholder p95:** Time to render the low-resolution thumbnail or placeholder on page navigation.
2. **Next-page full-resolution p95:** Time to render the high-resolution image after navigating to the next page.
3. **Bytes per page:** The total payload size per page.
4. **Revisited page transfer size:** Ensuring 0 bytes transferred (served via 304 Not Modified) when the ETag is valid.
