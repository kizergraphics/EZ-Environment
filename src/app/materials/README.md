# Material sources

The app loads bundled color, OpenGL normal, and roughness files. Base color is sRGB, and normal and roughness are linear. Texture templates are shared in memory. Generated assets own and release their texture instances, and failed loads can retry.

- Bark uses the numbered ambientCG sets and the species-specific artwork under `textures/trees/`. Legacy tree foliage uses the matching bundled card images and PBR companions under `textures/leaves/`.
- Plant leaves and grass cards retain their source atlases and UV layouts. Their normal and roughness companions are prepared from the artwork offline and bundled alongside the color files. The four classic leaf interiors also have tint-compatible albedos.
- Stem, petal, pollen, and cut wood use new ImageGen artwork from [botanical-and-endgrain-v1.png](../../../assets/material-sources/botanical-and-endgrain-v1.png). Their PBR files are under `textures/plants/details/` and `textures/wood/`. The weathered-wood material keeps its existing longitudinal grain artwork.
- Rock materials use contrast-adjusted versions of the existing stone and sandstone artwork, stored under `textures/rocks/`. Meadow uses its bundled terrain PBR set directly with repeating world-space UVs. Vertex colors carry broad shading and biome tint into GLB exports.

See [texture attribution](../public/textures/LICENSE.md) and the provenance records under `textures/plants/`, `textures/wood/` and `textures/biomes/`. The companion maps are artistic interpretations of the source imagery.
