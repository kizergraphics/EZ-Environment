# Unity import

1. Use a Unity project supported by the Unity glTFast package selected in Package Manager. Install **`com.unity.cloud.gltfast`** by package name. The importer uses its native Editor `.glb` asset import, so no compile-time package reference or scripting symbol is needed.
2. Copy this entire `unity` directory to `Assets/EZEnvironment`. Keep `Editor` and `Runtime` as subdirectories.
3. Export an asset or environment ZIP from EZ Environment and extract it completely.
4. In Unity choose **Tools → EZ Environment → Import Extracted Pack...**, then select the extracted `manifest.json`.
5. The importer creates a unique `Assets/EZEnvironmentImports/Environment` folder, persistent imported GLB assets, an `Environment.prefab`, and an instance in the active scene. Save that scene.

Each chunk contains layer parents and instances with shared meshes/materials, three-level `LODGroup`s, reproducible transforms, and persistent per-instance tint. Pebbles and plants have no colliders by default. Rock collider metadata creates boxes, spheres or bounded convex proxies. The terrain and any authored central tree exported as static objects are restored from their GLBs.

Scene packs include the hero tree and the scenic forest as referenced tree assets with explicit LOD files, deduplicated by their saved definitions. Trees outside the terrain radius receive their own placement chunks. Trunk box colliders are optional. Legacy static tree exports remain readable.

Environment and scene packs cap embedded textures at 1024 pixels by default; the export texture-quality control can raise this. Standalone asset exports retain the 4096-pixel default. Self-contained GLBs repeat their required textures in each LOD file, so high-resolution forest exports can be large.

Opaque color and normal textures originally loaded from JPEG files stay JPEG-encoded through export-only copies. Transparent/alpha-tested foliage and newly packed material channels remain PNG. The browser may re-encode the original JPEG; the live scene's textures and materials are not modified. The verified 25-tree-definition fixture was approximately 210 MB at the 1024-pixel cap.

Optional `scene.instanced.glb` needs an importer supporting `EXT_mesh_gpu_instancing` and its `_COLOR_0` tint attribute. Optional `baked/chunk_*.glb` files have transforms and per-instance tint baked into ordinary merged geometry. These are alternative render formats: the Unity importer uses the manifest's regular assets and placement data, so it does not instantiate additional GLB exports on top of the reconstructed scene.

Coordinates are meters, right handed, Y up. The importer applies the same X reflection as glTFast: positions become `(-x,y,z)` and rotations become `(x,-y,-z,w)`. It also reflects collision vertices and reverses triangle winding. Chunk parent transforms stay at identity because the placement positions are relative to the environment root.

Wind metadata identifies vegetation, including trees and loaded flowers. `wind.attribute` is `_WINDWEIGHT` only when that vertex attribute exists; it is null for trees and loaded flowers, whose receiving shaders must derive their own bending weights. glTFast's standard PBR shaders do not reproduce the browser's procedural wind shader; `EZEnvironmentInstance.wind` and `windAttribute` identify vegetation for a game's own animation shader. Preview quality caps and distance density reduction are rendering settings; exports retain every authored placement, so game projects should set their own draw budgets. Instanced meshes in Unity share mesh/material assets; the importer creates GameObjects for authoring and does not supply a GPU-driven runtime scatter renderer.

Export snapshots preserve definitions, placements, hierarchy transforms, material values and texture settings at the start of the operation. Subsequent editor changes do not mix appearances between the files or LODs in that pack. Export-owned appearance copies are released on completion, cancellation or failure without disposing the live scene's geometry or materials.

The importer validates the manifest, relative paths, file sizes, references, transforms and convex collider face limits before scene reconstruction. Existing imported folders are never overwritten. On cancellation, the partially reconstructed scene root is removed and the copied import folder remains available for retry. Editor asset creation is not part of scene Undo.

Verified locally with **Unity 6000.3.18f1 and Unity glTFast 6.20.0**: clean project compilation; six-species collider fixture; a browser export with 94 placements, eight species, textured tree and loaded flower model; a full-scene export with 119 placements, 25 tree definitions, 53 colliders and 190 shared meshes; exact coordinate conversion; LOD groups; scene save/reopen; and an RTX 3080 rendered preview. Logs and reports are generated under the repository's ignored `unity-validation` directory.

Verification procedure: import a small scene containing an asymmetric boulder on a slope, colored shrubs, pebbles and terrain. Compare positions and LOD counts, inspect collision wireframes, save/reopen the scene, and test in Play mode. Run the same test in a clean Unity project before shipping an environment pack. JavaScript export tests do not establish that a Unity Editor import has passed.

Primary references: [Unity glTFast Editor import](https://github.com/Unity-Technologies/com.unity.cloud.gltfast/blob/main/Packages/com.unity.cloud.gltfast/Documentation~/ImportEditor.md), [package installation](https://github.com/atteneder/glTFast#installing), [glTFast coordinate conversion](https://github.com/Unity-Technologies/com.unity.cloud.gltfast/blob/main/Packages/com.unity.cloud.gltfast/Runtime/Scripts/NodeExtension.cs).
