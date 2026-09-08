# Offline PBR material sources

Exposed wood uses `../public/textures/wood/weathered-grain-v1.png`, an ImageGen albedo of longitudinal weathered fibers. `wood-surface.js` derives normal/roughness maps and authors separate endgrain rings/checks for cut faces. These are artistic maps, not measured scans. The source record is bundled in exported packs. Tree leaf materials are unaffected.

Generated plant foliage now uses the bundled ImageGen leaf-interior source `../public/textures/plants/leaf-surface-v1.png`. It supplies visible midrib, secondary veins, fine vein networks and chlorophyll variation mapped across each generated blade. `plant-surface.js` derives tint-compatible color, normal and roughness maps at 1024px; this is generated photographic-style artwork, not a botanical scan. Plant stem and petal surfaces receive stronger authored detail. Existing tree texture templates are unchanged. Provenance travels with exported texture packs.

`rock-surface.js` retains mineral/fissure contrast from the bundled 2K stone sources and derives stronger relief/roughness. Physical UV scale accounts for the rock's size; sandstone presets select the sandstone source. These refinements remain portable standard PBR maps.

Botanical stem, foliage, petal, and pollen microstructure is original analytic code in `pbr.js`, distributed under this repository's MIT license. These are generated 512-pixel detail maps, not photographs or physically measured scans. The normal maps are gradients of authored height functions; roughness is an artistic response. Mesh silhouettes provide opacity for generated leaves and petals; photographed foliage retains its alpha albedo.

Bark reuses bundled ambientCG Bark004 color, OpenGL normal, and roughness maps; see `../public/textures/LICENSE.md` for the existing CC0 source attribution. Stone and sandstone reuse the existing biome map sets and their `../public/textures/biomes/provenance.json` records. Those maps include derived artistic normal/roughness data, not measured scans. All are bundled and require no network service at runtime.

Generated plant/rock albedo detail is neutralized to avoid multiplying the existing authored surface color by an already dark photographic albedo. Normal/roughness textures are linear data; albedo is sRGB. Templates are shared, immutable caches; asset preparation clones textures and releases those clones when the owning material is disposed. Generation stays synchronous and DOM-free; preparing bark and stone images is an asynchronous browser step. Failed loads are evicted for retry.
