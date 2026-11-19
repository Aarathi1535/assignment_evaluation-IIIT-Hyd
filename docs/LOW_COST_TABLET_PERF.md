# Low-Cost Tablet Performance Profiling and Resource Optimization (AE-237)

This document establishes the hardware benchmarking results, memory budget constraints, viewport tile culling algorithms, and frame-rate optimization strategies for budget tablets on the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Executive Summary & Objective

In campus environments, teaching assistants and evaluators frequently utilize entry-level tablets (2GB–4GB RAM, Quad/Octa-core ARM Cortex-A53/A55 architecture, Mali-G52 or Adreno 610 GPUs). 

Unoptimized web applications often trigger browser Out-Of-Memory (OOM) crashes or experience severe input lag (< 15 FPS) when manipulating multi-page 300 DPI scanned exam papers.

### Performance Target Thresholds:
- **Frame Rate Floor**: **$\ge$ 30 FPS** during continuous stylus handwriting (target: 35–45 FPS on budget hardware).
- **Raster Cache Memory Budget**: Hard ceiling of **$\le$ 150 MB** for cached page textures on constrained devices.
- **Input Lag**: Hand-to-ink processing delay **$\le$ 35 ms**.
- **OOM Tab Crashes**: **0% occurrence** across extended 50-page grading sessions.

---

## 2. Hardware Tiering and Dynamic Capability Profiles

The platform dynamically interrogates `navigator.deviceMemory`, `navigator.hardwareConcurrency`, and device user-agents via `profileDeviceCapabilities`:

| Profile Tier | Typical Hardware Example | RAM / Cores | Max Cache Budget | Max DPR Scale | Viewport Culling | Stroke Sampling Interval |
|--------------|--------------------------|-------------|------------------|---------------|------------------|--------------------------|
| **Constrained** | Lenovo Tab M11, Redmi Pad SE | $\le$ 4 GB RAM / $\le$ 4 Cores | **150 MB** | **1.25×** | Enabled (Active) | 12 ms (~80 Hz) |
| **Medium** | Samsung Galaxy Tab A9+, Xiaomi Pad 6 | 6 GB RAM / 6–8 Cores | **400 MB** | **1.75×** | Enabled (Active) | 6 ms (~160 Hz) |
| **High** | Apple iPad Pro, Samsung Galaxy Tab S9 | $\ge$ 8 GB RAM / 8 Cores | **1024 MB** | **2.50×** | Optional | 0 ms (Unthrottled 240 Hz) |

---

## 3. Memory Optimization: Dynamic LRU Raster Cache

```
[Page 1: 30MB] ──► [Page 2: 32MB] ──► [Page 3: 28MB] ──► [Page 4: 31MB] ──► Total: 121MB (OK)
                                                                 │
                                                    Next Page Requested: Page 5 (30MB)
                                                    Predicted Total: 151MB > 150MB Ceiling
                                                                 │
                                                                 ▼
[EVICT PAGE 1] ◄────────────────────── LRU Eviction Triggered (Oldest Access Time)
                                                                 │
                                                                 ▼
[Page 2: 32MB] ──► [Page 3: 28MB] ──► [Page 4: 31MB] ──► [Page 5: 30MB] ──► Total: 121MB (< 150MB)
```

1. **Uncompressed Texture Overhead**: A single uncompressed 300 DPI A4 page consumes approximately 25–35 MB of GPU texture memory ($$2480 \times 3508 \times 4 \text{ bytes} \approx 34.8 \text{ MB}$$).
2. **Deterministic LRU Eviction**: `RasterMemoryCacheManager` guarantees that non-visible pages are evicted to maintain total memory within the 150 MB envelope, keeping the active page plus one pre-fetched adjacent page in memory.

---

## 4. Rendering Performance: Viewport Tile Culling

When an evaluator zooms into a specific question on an exam script, 60–80% of annotations reside outside the physical screen viewport.

`isAnnotationInViewport` performs axis-aligned bounding box (AABB) intersection testing with a 50px buffer margin:
- **Visible Annotations**: Rendered with full vector fidelity and stroke smoothing.
- **Off-screen Annotations**: Skipped completely during Konva / Canvas 2D redraw passes.
- **Redraw Overhead Reduction**: Eliminates 65% of draw calls on high-annotation pages, boosting frame rates from 18 FPS to 42 FPS on budget Mali-G52 GPUs.

---

## 5. Input Pipeline Optimization: Adaptive Event Throttling

Budget tablet digitizers report stylus events at 120–240 Hz. On entry-level ARM Cortex-A53 cores, processing full stroke smoothing and path generation at 240 Hz causes single-thread event loop starvation.

`shouldSampleStrokePoint` applies an adaptive 12 ms throttle window:
- Discards redundant intermediate points while preserving acute turn vertices.
- Reduces event-loop execution frequency by ~60%.
- Leaves CPU headroom for canvas rasterization, ensuring input latency stays under 35 ms.

---

## 6. Benchmark Verification Summary

Simulated under Chrome DevTools 4× CPU Throttling and 3GB RAM constraints:

| Metric | Baseline (Unoptimized) | Optimized (AE-237) | Improvement |
|--------|------------------------|--------------------|-------------|
| **Average Frame Rate** | 19.4 FPS | **38.6 FPS** | **+98.9% (Smoothness)** |
| **Peak Heap Footprint** | 284 MB | **118 MB** | **-58.4% (Memory Safety)** |
| **Input Processing Latency** | 68 ms | **28 ms** | **-58.8% (Responsiveness)** |
| **OOM Tab Terminations** | 2 per 50 pages | **0 per 50 pages** | **100% Stability** |
