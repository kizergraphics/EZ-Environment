# EZ Environment — local 1.1.0 delivery

This is a local extension of EZ-Tree, not a published upstream release. The source remains on the original cloned `main` checkout at base `dcf309bd86bd521083d9c70f01f2de45fdc7c457`, with local uncommitted changes. No new branch or push was made; `src/lib/` remains unchanged.

Open the **EZ Environment** Desktop shortcut, or `EZ Environment.exe` in the parent project folder. Its bytes match the tested package below. The user requested delivery without the remainder of the long test; skipped and unmet checks remain explicit below.

## Delivered capabilities

- Tree editing and original presets, with safe project/preset loading, autosave, PNG and GLB export.
- Plant creation: shrubs, bushes, saplings, ferns, weeds, ground cover and flowers; seeded controls, curated presets and three LODs.
- Stone creation: pebbles, rocks, boulders and mixed clusters; shape/surface controls, three LODs and optional collision proxies.
- Environment composition: six scatter layers, four grass forms, weighted species, quality/biome settings, terrain rules, canopy/trunk exclusions, density images and painted masks.
- Saved projects and reusable authored species; individual assets, LOD packs, chunked environment packs, optional instanced GLBs and baked chunks.
- Unity Editor importer with shared meshes, transforms, materials, LOD groups and configured colliders.
- Offline Windows x64 portable desktop shell with an adjacent persistent profile.

## Verification

All paths below are relative to the repository. Large generated evidence and packages are deliberately Git-ignored.

| Check | Result and evidence |
| --- | --- |
| Automated code/security tests | 80 passed; `node --test tests/*.test.js desktop/security.test.cjs` |
| Browser authoring/export workflows | 61 checks and 19 screenshots; `artifacts/runtime/report.json` |
| Failure recovery and resource cleanup | 6 targeted checks; `artifacts/runtime/recovery-report.json` |
| Final tree editing/project/preset regression | 10 checks, zero browser errors; `artifacts/runtime/tree-workflow-report.json` |
| Final export appearance and wind metadata | Passed; 33 assets, 25 tree definitions, 29 chunks, 99 placements, 209,769,798-byte ZIP; `artifacts/export-release-smoke/report.json` |
| Final Unity import/save/reopen | Passed in Unity 6000.3.18f1: 99 instances/LOD groups, 49 colliders, 190 shared meshes; `artifacts/export-release-smoke/unity-validation-report.json` and rendered preview |
| Native repeated-seed diagnostics | 50 cycles passed, including raw-record hashes and worker/controller option comparisons; `artifacts/performance/native-determinism-report.json` |
| Final portable relocation and High replay | Passed on the final binary: all four modes, offline decoder/network isolation, profile persistence across two launches, High frame-time p95 13.8 ms and environment-update p95 0.1 ms; `artifacts/desktop/portable-report.json` |
| Final portable file output | Actual moved EXE saved a valid 16,297-byte project JSON and 1,364,432-byte shrub GLB; native output paths and read-back contents verified, zero errors; `artifacts/desktop/download-report.json` |
| Final instrumented stability run | Stopped at the user's request after 25.58 minutes/68 completed cycles; captured raw hashes/options/repeated seeds agree and no app errors were reported. **Not a completed 30-minute pass**; `artifacts/performance/soak-report.json` |
| Additional placed-content-only GPU replay | Prepared but **not run**, following the request to move on; `scripts/runtime-environment-gpu.mjs` remains available for later profiling |

Delivered renderer: `index-CfELhqSe.js`, SHA-256 `EF9BC47172BFBBDAE4AD89A7C56FBD9CA8C5DF1658ABA069236FA67FFA6A7480`.

Portable package: `release/EZ-Environment-1.1.0-Portable.exe`, 151,645,627 bytes, SHA-256 `AEDCB55216A4BF0A6E24052C0E4C6B577ADD8A3EDD9AA987EA6B2690B5BAE44C`. The actual moved EXE was verified against this hash and bundled renderer, without source or a development server.

## Performance evidence and open targets

Reference hardware: Windows 11, Ryzen 7 5800X, RTX 3080/D3D11, 1920 × 1080 at DPR 1, Electron 44.2/Chromium 152. These results are not a promise of the same performance on other PCs or arbitrarily dense scenes.

The isolated `index-DgctAMMF.js` full-camera replay measured Low/Medium/High frame-time p95 of 14.0/14.1/13.9 ms and environment-update p95 of 0.1 ms. The current renderer differs only in subsequent save/export/tree-editing fixes. Separately, the final relocated EXE passed its High replay after 10 seconds of warm-up and 30 seconds of measurement: frame-time p95 13.8 ms (average 13.428 ms), environment-update p95 0.1 ms, zero reported errors.

Environment draw-call p95 was 77/94/94, with peaks of 82/103/103. Thus the reference/p95 target passed, but a strict maximum of 100 at every camera position is not claimed. Chunk size was explicitly tuned from 48 to 64 m; the placement subset changes with that partition. The scenic backdrop was reduced from the upstream 100 trees to 24, and the sky sphere was simplified. These content changes are disclosed, not presented as an asset-only speedup.

The final candidate's direct component GPU replay measured Medium/High p95 of **4.562/14.402 ms**, missing the provisional **4 ms p95** target, despite frame-time p95 of 13.6 ms for both. This measurement hides the hero/scenic trees but includes terrain, sky, lighting and shadows; it is not foliage-only timing. Fixed-camera alternating-batch incremental timings were lower, but they do not establish a passing worst-camera GPU budget. The discrepancy needs further profiling; its cause is unproven. Do not label all performance targets passed.

An earlier 30.094-minute run completed 80 cycles with stable renderer resources and no application errors, but its strict repeated-seed assertion failed once. One initial seed-18430 hash differed from three later repetitions. The old harness lacked per-cycle raw records/options, so the cause remains unproven. A total of 130 isolated worker checks and the final native 50-cycle diagnostic did not reproduce it. The failed report is preserved in `artifacts/performance/history/2026-09-04T23-37-11.221Z-soak-report.json`; context is in `artifacts/performance/soak-context.md`.

The final instrumented rerun was stopped at the user's request after 25.5833 minutes and 68 completed cycles. All captured raw-record/worker/controller-option checks agreed; repeated seeds matched and no app errors were reported. It did not complete the 30-minute assertion suite. Resource counts ranged from 96–99 geometries, 14–15 textures and 20–23 programs; cycle 63 reports Plant mode before subsequent Environment cycles. Interaction events were not recovered before shutdown, so the cause of the mode change is unproven and the entire partial run is not presented as a flat-resource, unchanged-view proof. The extra precise GPU replay was also skipped. These are disclosed validation limitations of this local delivery.

## Practical limitations

- The EXE is unsigned; Windows may show an unknown-publisher warning. It needs a writable folder and extracts its runtime into the Windows temporary directory on launch.
- Keep `EZ Environment Data` beside the executable when moving autosaves, or explicitly save a project JSON backup.
- This is a bounded authoring tool, not infinite terrain or a game runtime. Extreme density, terrain frequency and high-detail custom plants can exceed reference budgets.
- Plant/rock shapes are procedural stylized geometry. Rocks have flat PBR/vertex-color materials, not generated texture sets. Final aesthetic approval remains the user's decision.
- Each self-contained tree LOD GLB embeds textures; full forest packs can be large. The 1024-pixel default preserves the current source size; choose 512 to reduce it further.
- GLBs contain static geometry. Wind settings/attributes are metadata for engine integration, not automatically animated Unity foliage. The Unity importer uses shared assets and authoring GameObjects, not a GPU-driven scattering renderer.
- After importing a custom tree JSON, the legacy preset dropdown can retain its previous preset name; the actual tree parameters and saved geometry are updated and editable.
- The recorded dependency audit found zero non-development advisories and 20 development/build advisories. Toolchain upgrades are deferred; this is not a security certification. See `DEVELOPMENT.md` for build warnings and maintenance notes.
