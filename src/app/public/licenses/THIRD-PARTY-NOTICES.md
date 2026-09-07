# Bundled components and asset provenance

This desktop application is a local derivative of [EZ-Tree](https://github.com/dgreenheck/ez-tree), based on commit `dcf309bd86bd521083d9c70f01f2de45fdc7c457`. Original copyright and license notices are retained.

| Component | Source and notice |
| --- | --- |
| EZ-Tree source, original UI, leaf textures, bundled demo assets | Daniel Greenheck; repository MIT license in `EZ-TREE-LICENSE.txt`. The repository carries no separate per-file notices for the original GLB models, ground textures, audio, font, or UI images. Those files are retained from the upstream source, without asserting independently verified third-party provenance. |
| Bark textures | ambientCG; CC0 attribution and individual source links remain in `textures/LICENSE.md`. |
| Three.js | three.js authors; MIT license in `THREE-LICENSE.txt`. License comments for bundled addon code remain in their source distribution. |
| Draco glTF decoder | Google Draco project; Apache License 2.0 in `DRACO-LICENSE.txt`. Binaries copied unchanged from the installed Three.js version's `examples/jsm/libs/draco/gltf/`; documentation retained under `draco/README.md`. |
| Electron | Electron contributors and GitHub; MIT license in `ELECTRON-LICENSE.txt`. The portable runtime includes Electron's Chromium third-party licenses as `LICENSES.chromium.html`. |
| New procedural geometry | Generated locally from application definitions and seeds; source models are not downloaded at runtime. |

The desktop shell never fetches remote assets, telemetry, fonts, analytics, or updates. Hyperlinks in these notices identify sources and are not runtime dependencies.
