# Vegetation and rock catalog expansion

The catalog now contains **30 Plant presets and 22 Rock presets**. Bush 1, Bush 2, and Bush 3 have Plant-native replacements; their legacy Tree definitions remain loadable for compatibility but no longer appear in the Tree editor.

## Using the additions

In Plant or Rock, open Preset and choose a starting point under Forest, Meadow, Arid, Rocky, or General. The selected preset stays visible until its definition is edited. New variation changes its recorded seed. New forms show only relevant structure controls; grass adds blade width and seed heads, cactus adds arms, and ground cover adds three-leaflet foliage.

Add to environment sends grasses to Grass, flowers to Flowers, other vegetation to Plants, slabs and clusters to Rocks, outcrops/boulders to Boulders, and individual pebbles to Pebbles. Every bundled preset is also available directly in its environment layer's Species selector and weighted mixes.

Select or reset a biome to use its expanded mixture. Opening an existing project preserves its saved mixture, dimensions, painted masks, and authored assets. Plant definitions remain version 1. Legacy version-1 rock definitions remain loadable and keep their original geometry, while new rock definitions use version 2 for macro shape profiles. Projects remain version 2 with version 1 project support. New biome compositions use biomeRevision 2. Older app builds cannot load the new forms or version-2 rock presets.

## Added presets

| Family | Vegetation |
| --- | --- |
| Forest | Bush 1, Bush 2, Bush 3, Berry Thicket, Wood Sorrel Carpet, Moss Cushion, Young Pine, Fallen Log |
| Meadow | Short Meadow Grass, Tall Seed Grass, Clover Groundcover |
| Arid | Sagebrush, Dry Bunchgrass, Saguaro Cactus, Agave Rosette |
| Rocky | Alpine Grass Tuft, Heather Cushion |

| Family | Rocks |
| --- | --- |
| Pebbles | Wet River Stone, Desert Gravel |
| Individual stones | Low Fieldstone, Basalt Chunk, Standing Stone |
| Slabs | Limestone Slab, Red Sandstone Slab |
| Boulders | Glacial Erratic, Volcanic Boulder, Mossy Forest Boulder |
| Formations | Talus Scree, River Stone Bed, Granite Outcrop, Sandstone Outcrop |

## Geometry and materials

Six additional plant forms provide grass blades/seed heads, conifer branch tiers and needles, cactus arms, succulent rosettes, low cushions, and fallen wood. Bush 1-3 now have Plant-native Forest presets with distinct leaves and bark; their original Tree definitions remain public for saved-data and library compatibility. Rock adds closed slabs, connected overlapping outcrop members, scree clusters, and version-2 macro shape profiles. Every form has three decreasing LODs and a ground-level pivot. Existing preset IDs and version-1 generation paths are retained.

Strata controls horizontal color bands and slab ledges. Moss / lichen coverage adds deterministic color on upward-facing surfaces. These are vertex colors in standard PBR materials, not texture sets. Biome placements reuse the existing bundled stone textures. New vegetation uses procedural meshes in both appearances; existing photographic foliage variants remain available. Cactus, agave, and deadwood have zero wind weights and disabled wind metadata.

The preset arrays expose group, layer, and biome metadata. Plant and Rock share that catalog with environment species selectors. Explicit custom grass/cactus definitions take precedence over fixed legacy scatter assets. Built-in IDs are reserved against custom replacement.

## Verification

Delivered September 5, 2026 to `../EZ Environment.exe`, with the previous app retained as `../EZ Environment - before preset expansion 2026-09-05.exe`. The delivered binary matches the tested portable EXE; identity is recorded in `artifacts/catalog/delivery.json`. The user's adjacent profile was not modified.

Passing results: 106 CPU/security tests, 16 catalog browser checks, nine authored-preview checks, six recovery checks, all 28 new asset packs, and Unity 6000.3.18f1 import/save/reopen (56 instances/LOD groups and 20 colliders). The relocated portable EXE loaded the expanded catalog and all four biomes in both appearances, blocked remote access, and restored its workspace after restart with two clean exits.

- `node --test tests/*.test.js desktop/security.test.cjs`: generator, catalog, serialization, placement, material, export, resource, and security checks.
- `node scripts/runtime-catalog.mjs`: all 52 preset selectors, new authored-asset round trips, real browser GLBs, LOD galleries, and four biomes in both appearances. Requires a Vite server at `EZ_TEST_URL` (default port 5184).
- `node scripts/export-catalog.mjs`: all 28 additions exported as independent LOD ZIPs plus an environment fixture with 56 instances; JSON and GLB round trips are validated.
- `artifacts/catalog/`: visual galleries, biome screenshots, browser report, export report, and Unity import evidence.

The existing unresolved 4 ms GPU target and previously waived long soak are not reclassified as passing by this expansion. Richer mixtures create more species batches; scene cost depends on density, quality, view, and world size.
