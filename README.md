# CSGoSkins.gg 3D Asset Downloader

Userscript for Tampermonkey/Violentmonkey that adds a floating **Download 3D ZIP** button on CSGoSkins.gg item pages.

It downloads:
- `model/mesh.glb` (model)
- `model/mesh.obj` (OBJ exported from the GLB)
- `textures/*.png` (original texture URLs decoded from the site’s proxy)
- `manifest.json` (captured URLs + any failures)

Environment maps are intentionally ignored.

## Install

1. Install a userscript manager:

- **Tampermonkey (Chrome / Edge)**  
  https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en

- **Violentmonkey (Firefox)**  
  https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/

2. Install the userscript:

- **Install / Update (Raw)**  
  https://raw.githubusercontent.com/VueDevOps/csgoskins-3d-asset-downloader/main/src/csgoskins-3d-downloader.user.js


## Usage

1. Visit an item page: `https://csgoskins.gg/items/...`
2. Click the floating **Download 3D ZIP** button
3. Wait for the ZIP to download

If a texture fails, the script continues and lists failures in `manifest.json` under `textures_failed`.

## Notes

- Console logging is enabled by default (prefix: `[CSGOSKINS-3D]`).
- OBJ export runs via Three.js modules in the page context.
- Not affiliated with CSGoSkins.gg.

## License

MIT
