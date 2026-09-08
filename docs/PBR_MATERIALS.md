# Automatic PBR materials

Wood update: deadwood and fallen logs use a dedicated weathered-grain source, with separate growth-ring maps and circular UVs on exposed ends. Trellis rails use lengthwise wood grain and separate endcaps. Bark on generated woody stems retains more source color and stronger relief. Wood source/derivation records are included as `textures/wood-provenance.json`. Verified log LODs, trellis, project serialization and 48 reloaded GLB meshes in `artifacts/wood-surfaces/report.json`.

Visible surface update: generated foliage uses a dedicated 1K leaf-interior texture with readable veins and tissue variation, rather than relying on near-uniform microdetail. Bark, plant skin and petals retain stronger color detail. Rocks preserve source fissures/minerals, use stronger relief and scale texture detail to their physical dimensions. Sandstone presets now select sandstone maps. Tree textures remain unchanged.

The current catalog export audit (`artifacts/surface-detail/export-report.json`) covers all 49 presets, 24 default species and terrain: 220 GLBs, 419 materials and 830 reloaded meshes retained their color/normal/roughness maps and UVs. Companion images matched the embedded bytes. Rendered plant and rock checks are in `artifacts/surface-detail/` and `artifacts/rock-surface-six-forms.png`.

Asset, environment, scene, and tree LOD ZIP exports include `materials.json` and a `textures/` folder by default. Each GLB still embeds everything it needs. Companion PNG/JPEG images are copied from those exact embedded bytes and deduplicated across the pack; grayscale roughness is also extracted from the packed green channel. The catalog records original material names, factors, sampler/UV settings, alpha modes and bindings to every GLB. Texture source records and licenses travel with the ZIP.

The Unity Built-in importer creates assigned, editable `.mat` files in `UnityMaterials/`, shared across matching LODs and instances. `UnityMaterials/Textures/` holds native texture copies preserving glTFast's format, mipmaps and settings. Companion PNG/JPEG files are provided separately for reuse; editing a companion does not automatically change the native texture copy. Existing packs remain importable.

The default export cap is 2K without upscaling. Stone families now use their bundled 2K sources; botanical detail is 512 pixels with irregular veins, broad mottling and finer roughness variation. Existing 1K bark and lower-resolution foliage retain their native detail.

Trees, generated plants, rocks, and terrain now receive portable color, normal, and roughness maps. Material families and texture scale persist in asset definitions; older definitions receive defaults. All generated LODs retain their material slots and maps. Botanical detail is original authored microstructure; source provenance and measured-versus-artistic limitations are documented in [material sources](../src/app/materials/README.md).

The viewport and exported GLBs use the same standard materials. Terrain uses four bounded color/roughness tiles plus repeating detailed normals. Photographic foliage exports the LOD set selected in the viewport. Texture preparation must finish before generation/export completes; a missing texture produces an error instead of silently disappearing from export. All export controls default to a 2048-pixel cap. Raising the cap does not add detail beyond the source maps.

Tree's full-detail and legacy LOD ZIP buttons use isolated appearance snapshots and leave the active preview unchanged. Saved custom species prepare their materials again when restored. Texture resources belong to their materials, with shared source images kept in bounded caches.

Use the updated [Unity importer and runtime components](../unity/README.md). They include a glTFast Built-in shader compatibility fix for cutout foliage shadows. Lighting, fog, postprocessing, and wind remain receiving-renderer settings.

Validation evidence:

- `artifacts/pbr-unit-tests.txt`: 119 passing JavaScript/security tests.
- `artifacts/pbr-authoring/report.json`: material coverage across authored LODs, independent bark scaling, texture-free project serialization, and restored custom-species maps.
- `artifacts/tree-pbr-exports/report.json`: actual Tree export buttons, embedded maps in full-detail and three LOD GLBs, unchanged preview geometry.
- `artifacts/export-pbr-fixture/report.json` and `unity-validation/validation-report.json`: 35 mapped materials, 12 cutout materials, actual Unity import/save/reopen, and corrected shadows.
- `artifacts/desktop/portable-report.json` and `pbr-delivery.json`: final portable build verification and executable identity.

No new frame-time benchmark or long-duration soak is claimed.
