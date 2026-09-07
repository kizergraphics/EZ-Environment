# Authored asset environment previews

Plant and Rock now use the selected environment's terrain, sky, lighting, haze,
appearance, and quality, as the Tree editor does. Environment automatically shows
the last tree, plant, or rock opened for editing and carries its camera framing
across the tab switch. Its **Frame latest asset** action returns to the item after
exploring the surrounding scene; **Edit** returns to its authoring tab.

Plant/rock previews follow changes in terrain height, with the close camera moving
by the same amount. Nearby instanced scenery is hidden within a small preview
clearing in both color and shadow passes. This clearing does not change seeded
placement records. The existing **Add to environment** action still assigns an
asset to a scattered environment layer.

Projects save `lastAuthoredMode` alongside the existing version 2 workspace data.
Older projects without this field remain supported. A saved Environment workspace
regenerates its remembered plant or rock on restore. Switching immediately after
editing flushes the latest definition; canceled or superseded generation cannot
replace the current preview.

Validation: 93 CPU/security checks passed. Nine browser workflow checks cover all
three authoring tabs, immediate edits, rapid switching, all four biomes, terrain
and camera movement, both appearances, PNG capture, project restore, and older
workspace compatibility, with no page or console errors. Evidence and screenshots:
`artifacts/authored-preview/report.json` and its adjacent PNG files.

Portable delivery evidence is recorded in `artifacts/desktop/authored-preview-delivery.json`.
No new performance benchmark or Unity import validation is claimed for this fix.
