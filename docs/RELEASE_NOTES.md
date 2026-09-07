# EZ Environment — September 5 biome upgrade

The subsequent [vegetation and rock catalog expansion](PRESET_EXPANSION.md) adds 28 presets and eight authorable forms. Its delivery evidence is recorded in `artifacts/catalog/`; the release records below remain historical.

The later authored-preview fix supersedes the package identity below. Plant and
Rock share the environment, and Environment previews the latest authored item.
See [AUTHORED_PREVIEW_FIX.md](AUTHORED_PREVIEW_FIX.md) and
`artifacts/desktop/authored-preview-delivery.json` for the current delivery and
verification. The original biome release record below is retained as history.

The approved biome and viewport upgrade is delivered in `../EZ Environment.exe`. The delivered file matches the tested portable package byte for byte. The previous executable is preserved as `../EZ Environment - before biome upgrade 2026-09-05.exe`. Existing saved projects and the adjacent `EZ Environment Data` profile were left intact.

This is a local, unpublished build on the existing checkout with its uncommitted changes preserved. No branch, commit, push, or changes to `src/lib/` were made. Earlier release notes are retained in `RELEASE_NOTES_PRE_BIOMES.md`; their performance results describe the earlier build.

## What changed

- Complete Forest, Desert, Meadow, and Rocky compositions, with deterministic placement, locally bundled ground and foliage textures, biome trees, dunes, and rock formations.
- Separate Naturalistic/Photorealistic appearance and Low/Medium/High quality settings. Appearance preserves the scene seed and placement.
- Resizable inspector, clean view, camera presets/bookmarks, independent editor cameras, terrain-aligned paint preview, and undo/redo.
- Viewport, 1080p, and 4K PNG output; version 2 project saves with version 1 compatibility.
- Final tuning integrates green meadow ground at 1.5 meters per tile, smaller and more deeply buried Desert formations, and refreshed biome thumbnails from rendered scenes.

## Verification

| Check | Result |
| --- | --- |
| CPU and desktop security | 92 passed (87 CPU + 5 security) |
| Biome/browser workflows | 22 passed, including PNG state restoration, resizing/painting, project transactions, exports, and resource cycles |
| Failure recovery | 6 passed |
| Legacy Tree editing, preset/project loading, Plant/Rock regression | 10 passed |
| Library, app, and portable builds | Passed; existing addon eval, chunk-size, and declaration-tool version warnings remain |
| Relocated portable | All four editor modes and eight biome/appearance combinations passed; offline assets and isolation verified; profile persisted across restart; both launches exited 0 |
| Native saved-file output | Valid version 2 project JSON (15,377 bytes), shrub GLB (1,364,432 bytes), and Photorealistic 1920 × 1080 PNG (2,893,036 bytes); no page errors; exit 0 |

Evidence: `artifacts/biomes/2026-09-05T14-44-06.063Z/report.json`, `artifacts/runtime/recovery-report.json`, `artifacts/runtime/tree-workflow-report.json`, and `artifacts/desktop/{portable-report,download-report,delivery}.json`. Prior desktop evidence was copied to `artifacts/desktop/history/pre-biome-2026-09-05/` before the final smoke runs.

All eight Medium-quality 1080p camera replays met the approved frame-interval targets on Windows 11 Pro, Ryzen 7 5800X, 32 GB RAM, RTX 3080/D3D11, Edge 152, DPR 1. Naturalistic p95: Forest 14.3 ms, Desert 14.6 ms, Meadow 15.5 ms, Rocky 13.7 ms (target <=16.7 ms). Photorealistic p95: 15.1, 14.0, 15.7, and 13.8 ms respectively (target <=33.3 ms). Each replay used 5 seconds warmup and 10 seconds measurement. These are full-scene frame intervals, not GPU-only timings. The final EXE smoke deliberately skipped another benchmark in response to the user's request to avoid unnecessary further testing.

## Package identity

- Portable: `release/EZ-Environment-1.1.0-Portable.exe`, 315,361,001 bytes.
- Portable and delivered EXE SHA-256: `DC33FF580D8F9328B2E8AD50A5F18CA45FFFC949D8FF263A5D677EFA5C000F27`.
- Renderer: `index-DFaa3fGs.js`, SHA-256 `DF87B4DBE19DCDD58E83574330B63EB0F695272133B40ABB1F04352E8F120FE8`.

## Limits

Photorealistic is the interactive appearance option, not a path tracer or a claim of photographic accuracy. Generated normal/roughness maps are artistic approximations, and the 2K surfaces resample smaller sources. Procedural geometry remains visible, especially in grass, logs, and rock formations.

Exports preserve standard material fallbacks and geometry. Viewport terrain blending, AO, sky, fog, exposure, shadows, and wind need receiving-engine setup; photographic foliage packs use procedural source LODs. Full Unity appearance parity was deferred and was not revalidated for this upgrade. High-quality performance, a GPU-only budget, and a fresh long-duration soak are not claimed.

The app remains unsigned, offline, and locally packaged. Keep `EZ Environment Data` alongside it when moving saved settings. Detailed controls and material limitations are in `BIOME_UPGRADE.md`.
