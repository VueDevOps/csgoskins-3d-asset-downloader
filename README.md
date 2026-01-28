# karambit.gg csgoskins fetcher

Tampermonkey userscript that adds a floating **Download 3D ZIP** button on CSGoSkins.gg item pages and downloads:

- `mesh.glb` (model)
- original texture PNGs (decoded from the site’s proxy URLs)
- `mesh.obj` (exported from the GLB)
- `manifest.json` (what was captured + any failed downloads)

Environment maps are intentionally ignored.

## Install

1. Install a userscript manager:
   - Tampermonkey (Chrome/Edge)
   - Violentmonkey (Firefox)

2. Install the script:
   - **Install (Raw)**: https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/src/csgoskins-3d-downloader.user.js

## Usage

1. Visit any item page: `https://csgoskins.gg/items/...`
2. Click the floating **Download 3D ZIP** button
3. Wait for the ZIP download

If a texture fails, the script continues and lists failures in `manifest.json`.

## Notes

- Console logs are enabled by default (prefix: `[CSGOSKINS-3D]`).
- OBJ export uses Three.js modules inside the page context.

## Disclaimer

This project is not affiliated with CSGoSkins.gg.
