# Local development and verification

The source checkout is `ez-tree` on its original `main` branch at base commit `dcf309bd86bd521083d9c70f01f2de45fdc7c457`. Changes are local and uncommitted. No branch was created and nothing was pushed. The reusable source under `src/lib/` has not been edited.

## Rebuild

Use a current Node.js installation, then `npm ci`. Run `npm run app` for the browser editor or `npm run desktop:dev` for the desktop development shell. `npm run desktop:pack` rebuilds both library and app, prepares bundled offline assets, and creates the Windows x64 portable executable. Dependency installation needs the Internet; using the built executable does not.

## Validation commands

```powershell
npm run build:lib
node --test tests/*.test.js desktop/security.test.cjs
npm run build:app
node scripts/runtime-test.mjs
$env:EZ_ALLOW_GPU_TEST = '1'
node scripts/runtime-tree-workflow.mjs
node tests/export-release-smoke.mjs --expected-bundle=index-CfELhqSe.js
npm run test:desktop:smoke
node scripts/desktop-benchmark.mjs
node scripts/desktop-benchmark.mjs --draws
node scripts/desktop-benchmark.mjs --gpu-batch
node scripts/desktop-benchmark.mjs --lifecycle
node scripts/desktop-benchmark.mjs --determinism
node scripts/desktop-benchmark.mjs --soak --minutes=30
node scripts/runtime-environment-gpu.mjs
npm run desktop:pack
npm run test:desktop:portable
```

The browser workflow harness starts a loopback Vite server automatically unless `EZ_TEST_URL` is supplied, and uses an available Edge/Chrome installation. Run GPU/browser/Unity checks **sequentially**, with no competing project rendering or build stress during timing/soak runs. Targeted release scripts have an explicit GPU-run guard. The export smoke checks the exact bundle named in the command; after intentional source changes, substitute the new built entry filename rather than attributing old evidence to it. Unity verification requires an installed Editor and glTFast. See `unity/README.md` for importer setup and retained clean-project evidence. These tools are not prerequisites for running the EXE.

`runtime-environment-gpu.mjs` is a separate counterbalanced Medium/High/High/Medium diagnostic of placed vegetation/stones and their shadows. It excludes tree, terrain and sky meshes while retaining lights, records raw timings/camera positions, drains every GPU query, and fails for invalid sampling or a missed 4 ms p95 target. It preserves each run in a unique folder. This is distinct from the older broader component result and is not marginal GPU cost within the full scene.

Test artifacts, native camera/soak reports, baseline images, exported fixtures and the clean Unity validation project are intentionally ignored by Git. Reports identify bundle hashes so a benchmark is not silently attributed to a later build. Keep source edits paused during a Vite workflow test or use a built immutable snapshot.

## Architecture

Serializable generator definitions are separate from generated geometry. Plant/rock preview generation and placement sampling run in workers. Placement records are deterministic independently of rendering quality. The environment builds replacement chunk batches off-scene and retains the old world until successful completion. Static matrices are uploaded when a chunk is built, not every frame. Wind and dither materials are cached, with matching shadow-depth variants and explicit disposal.

Grass/flowers/plants and stones are app-local. Mapless plants bake linear material colors into vertices and merge by compatible material to reduce repeated draw calls. Loaded textured flowers retain their material parts. Source assets, export-only geometry and render instance buffers have separate ownership. Exports use original static geometry; shader animation is not baked.

## Known build warnings

The pinned upstream Vite/declaration toolchain emits a large-bundle warning and warnings about unused Three.js addon dependencies containing `eval`. The app's production CSP does not enable unsafe evaluation. Type declaration generation can report its upstream TypeScript/API-extractor version mismatch while still completing successfully.

At the recorded September 4 integration audit, development/build dependencies had 20 advisories (9 moderate, 11 high); `npm audit --omit=dev` reported zero. This is not a comprehensive security certification. Major build-tool upgrades were kept separate from feature integration to preserve a reproducible baseline. The desktop renderer is sandboxed and denies remote requests; the final runtime still needs ordinary security maintenance.
