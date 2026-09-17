# EZ Environment

> **This project is built on [EZ-Tree](https://github.com/dgreenheck/ez-tree) by [Daniel Greenheck](https://github.com/dgreenheck).**
> EZ-Tree is the MIT-licensed procedural tree generator that powers all tree generation in this app. EZ Environment extends it into a full standalone authoring studio for plants, rocks, and whole environments. The original copyright and license notice are preserved in [LICENSE](LICENSE) — huge thanks to Daniel for the foundation.

EZ Environment is a local, offline-first procedural authoring studio for Windows: shape trees, plants, and rocks, scatter them across biome-driven terrain, and export textured game-ready assets — all in a portable desktop app.

## Download

Grab the latest portable build from the **[Releases](https://github.com/kizergraphics/EZ-Environment/releases)** page — a single `.exe`, no install required.

## Screenshots

<p align="center">
<img src="https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-forest.png" alt="Forest biome overview">
</p>

| | |
|---|---|
| ![Plant Studio](https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-plant-studio.png) | ![Bark closeup](https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-bark-closeup.png) |
| ![Desert biome](https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-desert.png) | ![Rocky biome](https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-rocky.png) |
| ![Tree editor](https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-tree-editor.png) | ![Rock studio](https://github.com/kizergraphics/EZ-Environment/releases/download/v1.2.0/ez-environment-rock-studio.png) |

## Features

- **Four authoring modes** — dedicated studios for trees, plants, rocks, and full environments, each with live preview and preset libraries.
- **Biome environments** — meadow, forest, desert, and rocky biomes scatter authored species over procedural terrain with ground-level and overview camera bookmarks.
- **Photographed bark everywhere** — every stem-bearing plant archetype (shrubs, ferns, weeds, ground cover, flowers, cacti, saplings, and more) renders with real PBR bark textures, selectable per-plant from 11 bark designs with tint control.
- **Automatic PBR exports** — generated assets receive color, normal, and roughness textures on every LOD, including saved custom species. GLBs embed their textures; ZIP packs also include reusable texture files, source records, and a material catalog.
- **Unity handoff** — the included importer creates assigned, editable materials shared across LODs and instances. See [Unity import](unity/README.md).
- **PNG capture** — export viewport, 1080p, or 4K renders straight from the app.
- **Projects** — save and reload full studio projects; older saves migrate automatically.

See [the user guide](docs/USER_GUIDE.md), [milestones](ROADMAP.md), [release notes](docs/RELEASE_NOTES.md), [desktop build instructions](docs/desktop.md), and [material sources](src/app/materials/README.md) for texture provenance.

## Run from source

```bash
npm install
npm run app        # build the library + launch the dev server
```

Portable desktop build:

```bash
npm run desktop:pack   # outputs release/EZ-Environment-<version>-Portable.exe
```

Tests:

```bash
node --test tests/*.test.js
npm run test:desktop
```

---

# The EZ-Tree library

Underneath the studio sits the standalone EZ-Tree generation library, usable in your own Three.js app:

```bash
npm i @dgreenheck/ez-tree
```

```js
// Create new instance
const tree = new Tree();

// Set parameters
tree.options.seed = 12345;
tree.options.trunk.length = 20;
tree.options.branch.levels = 3;

// Generate tree and add to your Three.js scene
tree.generate();
scene.add(tree);
```

Any time the tree parameters are changed, you must call `generate()` to regenerate the geometry.

## Levels of Detail (LODs)

For scenes with many trees, `generateLODs()` builds the tree at multiple levels of detail hosted in a `THREE.LOD` object inside the tree group. The renderer automatically switches levels based on camera distance. All levels are meshed from the same skeleton, so the tree's silhouette stays consistent across switches — distant levels just use fewer ring segments and fewer (but larger) leaves.

```js
const tree = new Tree();
tree.loadPreset('Ash Medium');
tree.generateLODs(); // instead of generate()
scene.add(tree);
```

The default levels (`Tree.defaultLODLevels`) switch at 100 and 250 units, reducing to roughly 40% and 20% of the full triangle count. You can pass custom levels:

```js
tree.generateLODs([
  { distance: 0, detail: {} }, // full detail
  {
    distance: 80,
    hysteresis: 0.05,
    detail: {
      sectionStride: 3,    // sample every 3rd ring along each branch
      segmentFactor: 0.75, // reduce radial segments to 75% (min 3)
      leafStride: 2,       // keep every 2nd leaf...
      leafScale: 1.4,      // ...enlarged to preserve canopy coverage
      billboard: 'single', // drop the second crossed leaf quad
    },
  },
]);
```

All LOD levels share one bark material and one leaf material, so `tree.update(time)` animates wind at every level. Calling `generate()` afterwards tears the LOD down and restores the single full-detail mesh pair (note that exporting a tree generated with `generateLODs()` to GLB will include every level).

If you have your own LOD or instancing system, `tree.createGeometry(detail)` returns raw `{ branches, leaves }` `BufferGeometry` pairs at any detail level without touching the tree's own meshes.

## Tree Parameters

The `TreeOptions` class defines an options object that controls various parameters of a procedurally generated tree. Each property of this object allows for customization of the tree's appearance, including bark, branches, and leaves. Below is a detailed explanation of each property of the `TreeOptions` object.

### General Properties

- **`seed`**: Sets the initial value for random generation, ensuring consistent tree generation when using the same seed.
- **`type`**: Defines the type of the tree, which can be set to one of the options from the `TreeType` enumeration (e.g., `TreeType.Deciduous`).

### Bark Parameters

The `bark` object controls the appearance and properties of the tree trunk.

- **`type`**: Specifies the type of bark texture to use, selected from the `BarkType` enumeration (e.g., `BarkType.Oak`).
- **`tint`**: Determines the color tint applied to the bark, defined as a hexadecimal color value (e.g., `0xffffff` for white).
- **`flatShading`**: Boolean property indicating whether to use flat shading (`true`) or smooth shading (`false`) for the bark.
- **`textured`**: Boolean value that indicates if a texture is applied to the bark (`true` or `false`).
- **`textureScale`**: Controls the scale of the bark texture in both the `x` and `y` axes. It is an object with properties `x` and `y` to define the scaling factors.

### Branch Parameters

The `branch` object defines parameters for the trunk and branch levels of the tree.

- **`levels`**: Number of recursive branch levels. Setting this to `0` creates only the trunk, while higher values add more branches.
- **`angle`**: Defines the angle, in degrees, at which child branches grow relative to their parent branch. This is specified separately for each level.
- **`children`**: Specifies the number of child branches at each level, with the index (`0`, `1`, `2`, etc.) representing the level.
- **`force`**: Represents an external directional force encouraging tree growth, defined by `direction` (a vector object `{ x, y, z }`) and `strength` (a numeric value).
- **`gnarliness`**: Defines how twisted or curled each branch level should be, specified for each level.
- **`length`**: Length of the branches at each level. This is an object with keys representing each level.
- **`radius`**: Radius (or thickness) of the branches at each level.
- **`sections`**: Number of segments along the length of each branch level, controlling the resolution of the branch mesh.
- **`segments`**: Number of radial segments that make up each branch, with a higher value resulting in a smoother cylinder.
- **`start`**: Specifies where along the parent branch (as a fraction from `0` to `1`) the child branches should start forming.
- **`taper`**: Controls the tapering of the branches at each level. A value between `0` and `1` defines the reduction in radius from base to tip.
- **`twist`**: Defines the amount of twisting applied to each branch level.

### Leaf Parameters

The `leaves` object defines properties that control the appearance and placement of leaves.

- **`type`**: Specifies the type of leaf texture, selected from the `LeafType` enumeration (e.g., `LeafType.Oak`).
- **`billboard`**: Defines how leaves are rendered. The `Billboard` enumeration can be set to `Single` or `Double` to indicate single or perpendicular double-sided leaves.
- **`angle`**: Defines the angle of the leaves relative to the parent branch, in degrees.
- **`count`**: Number of leaves to generate.
- **`start`**: Specifies where along the length of the branch (as a value between `0` and `1`) leaves should start growing.
- **`size`**: Size of the leaves, represented as a numeric value.
- **`sizeVariance`**: Specifies how much variance in size each leaf instance should have, making the leaves look more natural.
- **`tint`**: Tint color applied to the leaves, defined as a hexadecimal color value (e.g., `0xffffff` for white).
- **`alphaTest`**: Sets the alpha threshold for leaf transparency, controlling the transparency of the leaf textures.
