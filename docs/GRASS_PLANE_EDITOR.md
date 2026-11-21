# Grass plane editor

In Plant Studio, choose **Grass → Alpha texture cards**, then choose a **Grass
type**. Meadow Grass and eight additional types each have 12 distinct blade
images and a seed-head image. The default **12-plane clump** uses each foliage
image once and retains six planes at LOD 1 and three at LOD 2.

Open **Grass plane editor → Edit grass planes** to adjust the individual cards.
Smaller layouts are available in **Clump layout**.

Select a numbered plane. Its yellow outline identifies the PNG card in the
viewport. Use **Move** arrows or **Rotate** rings, or enter exact offsets and
angles. Width/height multipliers resize just that plane. **Plane PNG** chooses a
different cutout of the selected grass type. The preview shows the selected
artwork. Automatic assignments avoid reusing manually selected images. Horizontal flip
mirrors the artwork without changing the plane's position. Wind pauses while
editing. The editor operates on Full detail; LOD previews hide the gizmo.

**Save clump layout** saves only the selected layout's arrangement. **Save &
finish editing** does the same and closes the editor. Other clump layouts keep
their own arrangements. Saved layouts are applied when creating grass or choosing
a grass preset, and load automatically after restarting the portable application.
They live in its existing local data folder; keep `EZ Environment Data` with the
portable EXE when moving it.

Offsets are relative to clump width/height, so changing overall dimensions scales
the arrangement. The seed, Card variation and Card lean controls still affect the
underlying clump. Reset plane/layout restores built-in transforms for the current
asset; save again to make that reset the remembered arrangement. Undo/redo works
on edits, including one history step for a completed viewport drag. Closing the
editor without saving keeps current project edits but does not replace the saved
layout used for future presets.

Project and preset JSON carry `grassCardEdits`, keyed by layout. Project JSON also
carries the saved layout library as `grassLayouts`. GLB, LOD packs and **Add to
environment** use the edited geometry; editing helpers are not exported. Existing
definitions without these optional fields keep their built-in arrangement.

Verification:

- `node --test tests/grass-card-editor.test.js`
- With the dev server at port 5197: `node scripts/qa-grass-editor.mjs`
- Portable smoke: set `EZ_PORTABLE_GRASS_EDITOR=1`, `EZ_PORTABLE_GRASS_ONLY=1`,
  `EZ_PORTABLE_SURFACE_ONLY=1`, `EZ_PORTABLE_BENCH=0`, then run
  `node scripts/desktop-portable-smoke.mjs release/EZ-Environment-1.2.0-Portable.exe`.
