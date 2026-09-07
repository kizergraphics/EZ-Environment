# Biome and viewport upgrade

Forest, Desert, Meadow, and Rocky now apply a complete composition: terrain shape, surface materials, tree placement, understory, stones, lighting, atmosphere, and wind. Select a biome card in Environment mode to apply its preset. The reset action restores preset-controlled settings; seed, world size, authored assets, painted strokes, and density maps remain. The former automatic central tree is optional in Environment mode and remains available in Tree mode.

The toolbar separates **Appearance** from **Quality**. Naturalistic uses the efficient material path; Photorealistic adds photographic foliage variants and finer surface detail, with contact shading at Medium/High. Both appearances keep identical placements and tree transforms. Quality adjusts visible detail and budgets. Photorealistic is an interactive rendering mode, not a path-traced or measured-material guarantee.

## Workspace and output

- Resize the right inspector by dragging its divider or using the divider's left/right arrow keys. Clean view hides the inspector; the camera and render canvas resize with the available space.
- Use Overview, Ground-level, and Top cameras, or save and recall three camera bookmarks. Tree, Plant, Rock, and Environment remember independent camera positions.
- Painting shows a terrain-following brush outline. Hold Shift and click the terrain to apply a stroke. Undo/redo supports biome changes, environment parameters, and paint.
- Export PNG at viewport size, 1920 × 1080, or 3840 × 2160. Capture uses the same lighting and rendering path as the viewport and restores its camera/render state afterward.
- New project files use version 2 and preserve appearance, lighting, camera positions, bookmarks, masks, and authored assets. Version 1 files retain their legacy composition and layer values until a complete biome preset is explicitly applied.

## Materials and engine transfer

Eight bundled surface sets provide leaf litter, mossy soil, meadow soil, dry earth, dune sand, desert gravel, sandstone, and weathered rock, with 1K and 2K variants. Four foliage atlases provide fern, dry shrub, meadow foliage, and broadleaf imagery. Source-image provenance is recorded in `assets/biome-texture-sources.json` and `assets/biome-foliage-sources.json`. Derived normal and roughness maps are authored approximations; they are not measured PBR scans. All production assets load locally.

GLB and environment-pack exports preserve standard material fallbacks, procedural cactus/fallen-wood LODs, and highest-detail static biome grove instances. Photographic foliage variants use the procedural source assets in packs. Exports do not reproduce viewport-specific terrain blending, contact shading, sky, fog, exposure, shadows, or animated wind automatically. Environment manifests include detached appearance/lighting metadata and explicit limitations under `presentation`; their README repeats these limitations. Existing pack format version 1 and asset interfaces remain compatible. Unity appearance parity is outside this delivery.

## Verification

Run focused CPU tests with:

```powershell
node --test tests/biomes.test.js tests/viewport.test.js tests/export.test.js
```

The tests cover preset resets and preserved user data; deterministic grove spacing, masks, and terrain alignment; all biome/appearance/quality placement invariance; analytic/rendered terrain agreement; camera validation; and standard-material/static-grove exports.

Run the browser integration suite after starting the development server and closing other GPU benchmarks:

```powershell
$env:EZ_TEST_URL='http://127.0.0.1:5173'
node scripts/runtime-biomes.mjs
```

Set `EZ_BIOME_BENCH=0` to skip timing. Each run creates a separate timestamped `artifacts/biomes/` report and captures every biome in both appearances from overview and ground-level cameras. The suite also writes the biome-card thumbnails from the actual renderer. It checks inspector/canvas sizing, brush alignment, per-mode cameras, real texture-load rollback, PNG state restoration, undo/redo, project compatibility, rapid requests, and bounded resources after repeated switching.

Performance measurements use the full scene at a 1920 × 1080 drawing buffer and DPR 1, with a 5-second warmup and 10-second fixed camera replay per biome/appearance. The measured p95 is the animation-frame interval, including CPU and display scheduling; it is not GPU-only timing. Targets are 16.7 ms for Naturalistic Medium and 33.3 ms for Photorealistic Medium. Each report records the actual GPU identity and separates functional results from target attainment. This short protocol does not establish long-duration stability or performance on other hardware. Historical performance reports are preserved separately.

## September 5 final source validation

The green meadow surface is integrated at 1.5 meters per tile. Desert outcrops use size 2 with scale-aware burial, and smaller sandstone rocks are buried more deeply. Biome thumbnails were refreshed from the final renderer. Ground and overview captures were visually reviewed for all four compositions.

The source passed 87 CPU tests, 5 desktop security tests, 22 biome browser checks, 6 failure-recovery checks, and 10 legacy Tree workflow checks. Library and app production builds passed. Existing Three addon eval, bundle-size, and declaration-tool version warnings remain.

Measured on Windows 11 Pro 10.0.26200, Ryzen 7 5800X, 32 GB RAM, RTX 3080/D3D11, Edge 152, Medium quality:

| Biome | Naturalistic p95 | Photorealistic p95 |
| --- | ---: | ---: |
| Forest | 14.3 ms | 15.1 ms |
| Desert | 14.6 ms | 14.0 ms |
| Meadow | 15.5 ms | 15.7 ms |
| Rocky | 13.7 ms | 13.8 ms |

All eight met their respective frame-interval targets. Evidence: `artifacts/biomes/2026-09-05T14-44-06.063Z/report.json`, with 16 overview/ground PNGs, a workspace screenshot, and a 4K capture. This does not establish High-quality performance, a GPU-only budget, or a long soak. No further benchmark was run during the final portable smoke, following the user's request to avoid unnecessary tests.

The relocated EXE passed offline loading, all editor modes and biome appearances, renderer isolation, and adjacent-profile persistence across restart. Current delivery details and file-output evidence are in `RELEASE_NOTES.md`.
