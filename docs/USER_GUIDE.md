# EZ Environment

Open the portable EXE to enter the local studio. The application bundles its renderer and assets, and saves its local profile in `EZ Environment Data` next to the executable. Keep that folder when moving your workspace. Use Save project to create a separate portable JSON backup.

## Navigation

Drag to orbit, wheel to zoom, right-drag to pan. Press F or Frame view to fit the current asset or environment. The toolbar switches between Tree, Plant, Rock, and Environment. Save/Open project preserve your authoring definitions and placement settings; Ctrl+S saves a project. Version 2 projects also preserve per-mode cameras, three camera bookmarks, appearance, and environment lighting. Preview LOD and undo history are not saved. See [the biome and viewport guide](BIOME_UPGRADE.md) for the resizable inspector, painting, PNG sizes, and compatibility.

Use Camera up / Camera down at the bottom left, or Page Up / Page Down, to move vertically through a tree while keeping the same zoom and viewing angle. Movement becomes finer as you zoom in. Hold either shortcut to keep moving; shortcuts are inactive while editing a field. Frame view recenters the asset when you finish inspecting.

Tree retains the original EZ-Tree parameters and export panel. Plant and Rock begin with curated presets or a Form selector. Set a seed to recreate an asset later. New variation chooses and records a new seed. Edit dimensions, structure, and surface values. Under **Triangle targets & LODs**, enter triangle targets for LOD 0, 1, and 2, then select **Generate LODs**. Leave any field blank for automatic detail. Select an LOD to preview it and check its actual triangle count. Targets are saved with projects and asset presets.

The Tree preset menu includes 12 species with distinct bark and foliage. Ash, Aspen, Oak, and Pine have three sizes each. The other species are Paper Birch, Weeping Willow, Sugar Maple, Ginkgo, Blue Spruce, Coast Redwood, Lebanon Cedar, and Fan Palm. Bark and foliage can also be selected independently in the Tree editor.

Use **Tree size → Height · m** to set the height from the tree base to the top of LOD 0. Drag the slider or enter a height in meters. The tree regrows from its seed when you release the slider or confirm the number, with branches and leaves generated for the new size. **Reset height** regrows the original tree. Projects, presets, and exports use the rebuilt tree.

The grouped catalog has 30 Plant presets and 22 Rock presets. Plant forms include shrubs, bushes, saplings, ferns, weeds, ground cover, flowers, grasses, young conifers, cactus, succulents, cushions, and deadwood. Foliage-bearing forms have editable leaf designs, and woody forms can select among the bundled bark patterns; presets start with deliberately varied botanical choices. Rock forms include pebbles, individual rocks, boulders, spaced clusters, slabs, and connected outcrops, with editable macro shape profiles and deterministic silhouette variants in scattered environments. Generated surfaces automatically receive color, normal, and roughness textures. Every LOD uses the same surface treatment. See [the complete preset catalog](PRESET_EXPANSION.md).

## Saving and using assets

Save preset JSON stores a regenerable definition. In Plant and Rock, **Export GLB** writes the selected detail level, while **Export asset + LOD pack** writes all three GLBs, a preset, and a manifest. **Add to environment** registers the asset with its targets in the appropriate scatter layer. In Tree, export LOD 0, the selected preview LOD, or all three levels as a ZIP. Use the environment pack to include the tree's LODs in a manifest for the Unity importer.

Save project includes the current tree definition, plant and rock definitions, environment options, custom species and painted strokes. Paint effects persist, but their undo ordering does not survive reopening. The last workspace is also stored locally; Restore last workspace offers recovery when opening the program again.

## Environment

Meadow is the environment preset. Choose the world seed, quality, world radius, chunk size and terrain height or wavelength. Use **Reset preset** to restore the Meadow settings. Older projects retain authored assets, terrain height and wavelength, and lighting. Saved dunes and ridges open as rolling hills, and retired scatter species use Meadow defaults. Wind controls share direction and gust timing between trees and vegetation. Layer sections adjust species, density per square meter, scale, patchiness, and minimum spacing. Counts report accepted placements; very restrictive spacing or masks can prevent the requested density from fitting. Quality presets limit preview detail and visible instances; they do not erase saved placement records.

Grass has medium, short, tall and clump silhouettes, with independent height, width, color and dryness. Advanced placement can mix weighted species, limit slope/elevation/moisture/canopy coverage, reduce under-canopy density, and control stone tilt/burial. The scene's actual tree bounds provide canopy fields and separate trunk exclusions.

Load grayscale density map accepts a local PNG/JPEG, downsamples to at most 128 pixels per side, and maps it across the current world bounds. Black suppresses placement; white permits it. Image top-left maps to negative X/Z. Masks are embedded as numeric samples in project JSON and remain fixed in world coordinates if the world radius later changes. Moisture is a seeded design field, not a physical water simulation.

Enable the paint brush and Shift-click the terrain to reduce/increase layer density or exclude every layer. Brush strokes persist with the project. Undo last paint stroke removes the last density stroke; Clear painted masks resets authored strokes and exclusions.

Export environment pack writes trees with explicit LODs, reusable species GLBs, terrain, chunked placements and a versioned manifest. It retains all authored placement records, including instances currently hidden by camera culling or preview quality. Select embedded texture resolution before export. The default cap is 2048 pixels without upscaling; 512 is useful for compact packs. Packs also include reusable textures and materials.json. The updated Unity importer assigns editable shared .mat assets automatically. Each self-contained GLB carries its own textures, so densely populated scene packs can be large. Cancel export stops between export steps; a currently encoding GLB must finish first.

Optional instanced GLB requires extension-aware software. Optional baked chunk GLBs combine geometry per chunk and can be significantly larger. The normal asset-and-placement files remain in either pack. Extract the archive before using the Unity importer; see `unity/README.md`. Colliders are simplified proxies, not branch-accurate tree collision or separate collision for every cluster member. GLBs contain static geometry; browser shader wind requires a compatible wind material in another engine.

## Portable use

Copy the executable to a writable folder. It does not require Node, npm, Unity, a development server, or an Internet connection to run. Keep exported presets/projects/assets in your chosen folders. A source build and local validation artifacts remain alongside the repository for development, but are not needed to open the executable.

The executable is unsigned. Windows may show its normal unknown-publisher warning. No installer, updater or startup service is added. Keep the EXE and its `EZ Environment Data` folder together to carry local autosaves, or use explicit project JSON files for backups. The first launch extracts the bundled runtime into the Windows temporary directory.

## Practical limits

This is a bounded scene editor (16–256 meter authoring radius), not an infinite terrain engine. Extreme world density, steep small-wavelength terrain, many weighted species and high-detail custom plants can exceed the reference performance budget. Start with Medium and increase complexity incrementally. Terrain uses Meadow’s repeating color, normal and roughness textures. Vertex colors add broad variations in tone across the world. See [material sources](../src/app/materials/README.md) for texture provenance. Unity imports shared assets and authoring GameObjects; a game must choose its own runtime rendering and foliage animation policy.
