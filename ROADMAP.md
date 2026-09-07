# EZ Environment — delivery roadmap

This local extension of EZ-Tree is an asset-authoring studio and environment composer. The original tree library remains unchanged. The work is kept on the cloned `main` checkout without a new branch or a push.

## Milestones and acceptance gates

| Milestone | Usable outcome | Completion gate |
| --- | --- | --- |
| M0 · Baseline | Reproducible original app, source checkout, regression fixtures | Original app/library build; screenshots and hardware baseline retained |
| M1 · Rendering foundation | Shared loading, explicit lifecycle, instanced flowers, shared wind, offline assets | Concurrent loads deduplicate; errors recover; disposal and original tree exports pass |
| M2 · Deterministic environments | Seeded, terrain-aware grass/flower/plant/stone layers in spatial chunks | Same options reproduce records; spacing/exclusions hold across chunk borders; local painting preserves other chunks |
| M3 · Complete scene preview | Grass variants, vegetation/stone LODs, quality presets, coherent wind and shadows | Camera replay, draw-call/CPU/GPU checks, transition inspection and stable instance buffers |
| **M4 · Shrub and plant creation** | Create shrubs, bushes, saplings, ferns, weeds, ground cover and flowers from original procedural geometry | Seeded controls and presets; three progressively simpler LODs; GLB/PNG/preset export; authored plants reused in the environment |
| **M5 · Rock, boulder and pebble creation** | Create individual stones and mixed clusters with flat PBR color/roughness and vertex variation | Reproducible shape controls; three LODs; sensible pivots/spacing; optional bounded colliders; export and environment reuse |
| M6 · Game-engine handoff | Reusable assets plus versioned chunk placements, complete tree LODs, optional instanced/baked outputs | Real GLB round-trip; schema/inventory validation; a clean Unity import preserves transforms, materials, LODs and colliders through save/reopen |
| M7 · Authoring and release quality | Biomes, weighted species, painted/grayscale density masks, terrain preferences, projects and documentation | End-to-end browser workflows, invalid-input recovery, lifecycle tests, 30-minute hardware soak, recorded limitations |
| M8 · Local portable desktop | One Windows x64 executable with bundled assets and an adjacent persistent profile | Final EXE copied by itself to another folder, works offline without source/Node/dev server, all four modes open and workspace survives restart |

## Execution order

Build M0–M2 first. Plant authoring (M4), rock authoring (M5), and desktop packaging can proceed independently while scene rendering (M3) is integrated. M6 consumes the stable generators and placement schema. M7 and M8 are final gates, not assumptions based on a successful build.

Each milestone should leave a usable capability. Test failures take priority over additional scope. Measurements must identify the exact build, hardware, seed, quality, camera and scene configuration. Changes such as scenic tree count or chunk size must be disclosed.

## Current checkpoint

The scene, plant studio, rock studio, export formats, Unity importer and desktop shell are delivered locally. **M4 (shrubs/plants) and M5 (rocks/boulders/pebbles) have passed their generator and end-to-end authoring/export checks.** The final build also passed tree-editing recovery, a real Unity import/save/reopen test (99 placements, 49 colliders, 190 shared meshes), and actual single-file portable relocation with offline use and profile persistence. A verified EXE is in the parent project folder, with an EZ Environment Desktop shortcut.

At the user's request, the final stability rerun was stopped after 25.58 minutes/68 completed cycles, and the additional GPU timing run was skipped. Captured placement/option checks agreed and no app errors were reported, but this is **not** a completed 30-minute acceptance pass. M7's long-run gate is explicitly waived for this local delivery, not silently marked passed.

The 60 FPS reference camera replay and CPU-update targets passed. The provisional environment GPU target of 4 ms p95 has **not** passed the direct component replay; do not treat M3's performance work as unconditionally complete. See [release evidence and remaining limitations](docs/RELEASE_NOTES.md), `.agent/CURRENT_STATE.md` for the live checkpoint, and [the user guide](docs/USER_GUIDE.md) for usage.

## Boundaries

No procedural rock textures, botanical growth simulation, infinite terrain, cloud service, publishing, or changes to `src/lib/`. Unity receives static portable PBR assets and wind metadata; engine-specific animated foliage shaders and GPU-driven runtime scattering are integration work for a consuming game. Final aesthetic approval belongs to the user.
