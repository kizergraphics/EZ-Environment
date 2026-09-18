# EZ Environment

## Project origin

> **EZ Environment is based on [EZ-Tree](https://github.com/dgreenheck/ez-tree) by [Daniel Greenheck](https://github.com/dgreenheck).**
>
> EZ-Tree is the MIT-licensed procedural tree generator at the heart of this project. EZ Environment keeps that foundation and expands it into a standalone authoring studio for trees, plants, rocks, terrain, and complete environments. The original copyright and license notice are preserved in [LICENSE](LICENSE). Thank you to Daniel for making the original project available.

[![Release v1.2.0](https://img.shields.io/badge/release-v1.2.0-b8d89f)](https://github.com/kizergraphics/EZ-Environment/releases/latest)
[![Windows](https://img.shields.io/badge/platform-Windows%20x64-4b7447)](https://github.com/kizergraphics/EZ-Environment/releases/latest)
[![CI](https://github.com/kizergraphics/EZ-Environment/actions/workflows/ci.yml/badge.svg)](https://github.com/kizergraphics/EZ-Environment/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-b8d89f)](LICENSE)

Create game-ready natural assets without leaving your desktop. EZ Environment is a local, offline-first procedural authoring studio for shaping individual assets, composing seeded biomes, and exporting reusable PBR content for real-time projects.

<p align="center">
  <a href="https://github.com/kizergraphics/EZ-Environment/releases/latest"><strong>Download the latest portable Windows build</strong></a>
  ·
  <a href="docs/USER_GUIDE.md">Read the user guide</a>
  ·
  <a href="unity/README.md">Unity import guide</a>
</p>

<p align="center">
  <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-forest-ground.png" alt="EZ Environment forest biome viewed from ground level" width="100%">
</p>

## What you can make

- **Procedural trees** — start from ash, aspen, oak, pine, bush, and trellis presets, then shape the trunk, branches, leaves, bark, wind, and level of detail.
- **Plants and ground cover** — author shrubs, saplings, ferns, weeds, flowers, grasses, cacti, succulents, cushions, young conifers, and deadwood from a 30-preset catalog.
- **Rocks and formations** — create pebbles, fieldstones, boulders, slabs, clusters, and connected outcrops from 22 presets with editable silhouettes and surface treatments.
- **Complete biomes** — compose forest, desert, meadow, and rocky worlds with deterministic terrain, vegetation, stones, lighting, fog, wind, and density controls.

Everything is seed-driven, so a useful result can be reproduced, adjusted, saved as a project, or regenerated as a variation.

## Highlights

- Four focused workspaces: **Tree**, **Plant**, **Rock**, and **Environment**.
- Naturalistic and Photorealistic appearance modes with Low, Medium, and High preview quality.
- Real PBR bark across every stem-bearing plant archetype, with 11 selectable bark designs and tint controls.
- Color, normal, and roughness textures applied consistently across every exported LOD.
- Biome-aware placement with slope, elevation, moisture, canopy, spacing, patchiness, tilt, and burial controls.
- Paintable density and exclusion masks, plus grayscale density-map import.
- Full project save/load, local workspace recovery, camera bookmarks, undo/redo, clean view, and PNG capture up to 4K.
- Portable Windows packaging with no installer, account, cloud service, or Internet connection required.

## A studio for assets and worlds

| Tree editor | Plant Studio | Rock Studio |
|---|---|---|
| <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-tree-editor.png" alt="Procedural tree editor" width="100%"> | <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-plant-studio.png" alt="Plant Studio showing a generated shrub" width="100%"> | <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-rock-studio.png" alt="Rock Studio showing a generated fieldstone" width="100%"> |

The individual studios share the same live 3D workspace. Move between asset design and environment composition without exporting intermediate files, and preview the latest authored asset directly in a biome before committing to an export.

## Four seeded biomes

| Forest | Desert |
|---|---|
| <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-forest.png" alt="Generated forest biome" width="100%"> | <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-desert.png" alt="Generated desert biome" width="100%"> |
| **Meadow** | **Rocky** |
| <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-meadow.png" alt="Generated meadow biome" width="100%"> | <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-rocky.png" alt="Generated rocky biome" width="100%"> |

Each biome is a starting point rather than a fixed scene. The world seed, terrain profile, scatter layers, authored species, lighting, fog, and wind remain editable.

## Materials and detail

| Photorealistic meadow preview | Fern authoring | Bark close-up |
|---|---|---|
| <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-meadow-photorealistic.png" alt="Photorealistic meadow preview with authored tree" width="100%"> | <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-fern-studio.png" alt="Fern being authored in Plant Studio" width="100%"> | <img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-bark-closeup.png" alt="Close-up of textured plant stems and leaves" width="100%"> |

Surface choices are part of the regenerable asset definition. The same material intent is carried into the full-detail mesh and each lower-detail export.

## Download and run

1. Download `EZ-Environment-1.2.0-Portable.exe` from the **[latest release](https://github.com/kizergraphics/EZ-Environment/releases/latest)**.
2. Place it in a writable folder and open it. There is no installer.
3. Keep the generated `EZ Environment Data` folder beside the executable if you move the app; it contains the local workspace and preferences.
4. Use **Save project** to create portable JSON backups wherever you choose.

The executable is currently unsigned, so Windows may display an unknown-publisher warning. EZ Environment does not add an updater, startup service, or remote connection, and it does not require Node.js, Unity, or an Internet connection to run.

## Authoring workflow

1. Choose a preset or form in the Tree, Plant, or Rock studio.
2. Set a seed and tune shape, structure, surface, and LOD controls while orbiting the live preview.
3. Add authored assets to Environment and compose a biome with procedural or painted placement.
4. Save the project, capture a PNG, export an individual GLB, or build an asset/environment pack.

Projects preserve authoring definitions, placement, painted masks, appearance, lighting, and per-mode cameras. Older project files are migrated when opened.

## Export options

| Output | Best for | Includes |
|---|---|---|
| Preset JSON | Recreating or sharing an authored asset | Seed and editable generator settings |
| Standalone GLB | A single tree, plant, or rock | Geometry plus embedded PBR textures |
| Asset + LOD pack | Engine-ready individual assets | Three GLBs, preset, manifest, reusable textures, and material catalog |
| Environment pack | Reconstructing a full authored scene | Terrain, species assets, explicit LODs, placements, materials, and manifest |
| PNG capture | Review and presentation | Viewport, 1080p, or 4K render |

Environment packs retain authored placements even when preview quality or camera culling hides instances in the editor. Optional instanced and baked-chunk GLBs are available for pipelines that support them.

## Unity workflow

The repository includes a Unity importer that rebuilds an exported pack with shared meshes, editable materials, `LODGroup`s, transforms, tint, and supported collider metadata.

1. Install Unity's `com.unity.cloud.gltfast` package.
2. Copy the [`unity`](unity) directory into `Assets/EZEnvironment` in your project.
3. Extract an EZ Environment pack.
4. Choose **Tools → EZ Environment → Import Extracted Pack...** and select its `manifest.json`.

See the [complete Unity import guide](unity/README.md) for render-pipeline notes, coordinate conversion, wind metadata, collider behavior, and validation details.

## Run from source

Requirements: a current Node.js release supported by the pinned dependencies and npm.

```bash
git clone https://github.com/kizergraphics/EZ-Environment.git
cd EZ-Environment
npm install
npm run app
```

Useful commands:

| Command | Purpose |
|---|---|
| `npm run dev` | Start the browser app with Vite |
| `npm run app` | Build the reusable tree library and start the app |
| `npm run build:app` | Build the production web application |
| `npm run build:lib` | Build the reusable EZ-Tree-compatible library |
| `npm run desktop:dev` | Run the Electron desktop shell in development |
| `npm run desktop:pack` | Create the portable Windows x64 executable |
| `node --test tests/*.test.js` | Run the core test suite |
| `npm run test:desktop` | Run desktop security tests |

Generated builds, release artifacts, local profiles, screenshots, prompts, logs, and test evidence are intentionally excluded from source control. Packaged executables are distributed only through GitHub Releases.

## Documentation

- [User guide](docs/USER_GUIDE.md) — navigation, authoring, environments, saves, exports, portability, and practical limits.
- [Release notes](docs/RELEASE_NOTES.md) — delivered features and verification history.
- [Desktop build and security](docs/desktop.md) — packaging, offline resources, and runtime boundaries.
- [Unity importer](unity/README.md) — importing exported packs into Unity.
- [Material sources](src/app/materials/README.md) — texture provenance and material notes.
- [Roadmap](ROADMAP.md) and [changelog](CHANGELOG.md) — project direction and version history.
- [Security policy](SECURITY.md) — private vulnerability reporting.

## Scope and practical limits

EZ Environment is a bounded scene authoring tool, not an infinite terrain engine. Authoring radius is 16–256 meters, and dense worlds with steep terrain or many detailed custom species can exceed a machine's comfortable preview budget. Start at Medium quality and increase complexity incrementally.

Exports contain static geometry and standard material fallbacks. A receiving engine is responsible for its own lighting, sky, fog, shadows, ambient occlusion, and compatible vegetation wind shader. Botanical detail maps are artistically authored rather than measured scans.

## Credits and license

EZ Environment is released under the [MIT License](LICENSE). Its tree-generation core originates from [Daniel Greenheck's EZ-Tree](https://github.com/dgreenheck/ez-tree), also released under MIT. Bundled third-party code and asset notices are included with the desktop application and in the relevant source directories.

If your goal is the original focused Three.js tree generator, presets, examples, or upstream package documentation, visit **[dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree)**.
