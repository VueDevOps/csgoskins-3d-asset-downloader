// ==UserScript==
// @name         CSGoSkins.gg 3D Asset Downloader (ZIP: GLB + PNG + OBJ)
// @namespace    https://github.com/VueDevOps/csgoskins-3d-asset-downloader
// @version      1.0.0
// @description  Adds a button on CSGoSkins.gg item pages to download 3D viewer assets as a ZIP (GLB model, original PNG textures, exported OBJ, manifest).
// @author       VueDevOps
// @match        https://csgoskins.gg/items/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      cdn.csgoskins.gg
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @updateURL    https://raw.githubusercontent.com/VueDevOps/csgoskins-3d-asset-downloader/main/src/csgoskins-3d-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/VueDevOps/csgoskins-3d-asset-downloader/main/src/csgoskins-3d-downloader.user.js
// @homepageURL  https://github.com/VueDevOps/csgoskins-3d-asset-downloader
// @supportURL   https://github.com/VueDevOps/csgoskins-3d-asset-downloader/issues
// ==/UserScript==


(() => {
  'use strict';

  // =============================
  // Settings
  // =============================
  const SETTINGS = {
    debug: true,               // console logging
    continueOnFail: true,      // if a texture fails (404 etc), continue and still build the ZIP
    quietMs: 1000,             // stop sniffing after N ms with no new assets
    maxSniffMs: 15000,         // absolute cap on sniffing
    baselineBackMs: 5000,      // capture resources that started up to N ms before “start” (cache/instant loads)
    threeVersion: '0.160.0',   // used only inside the page-context exporter module
  };

  // Capture ANY .glb from the CDN + texture proxy URLs (uih/.../csgoskins.webp)
  const CAPTURE_PATTERNS = [
    /https:\/\/cdn\.csgoskins\.gg\/.+\.glb(\?|#|$)/i,
    /https:\/\/cdn\.csgoskins\.gg\/public\/uih\/objects\/.+\/csgoskins\.webp(\?|#|$)/i,
  ];

  const TAG = '[KARAMBIT.GG CSGOSKINS FETHER -3D]';
  const log  = (...a) => SETTINGS.debug && console.log(TAG, ...a);
  const warn = (...a) => SETTINGS.debug && console.warn(TAG, ...a);
  const error = (...a) => SETTINGS.debug && console.error(TAG, ...a);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // =============================
  // State
  // =============================
  const seen = new Set();
  const captured = [];
  let sniffing = false;
  let lastNewTs = 0;

  // =============================
  // URL helpers
  // =============================
  function stripControlChars(s) {
    return s.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  }

  function cleanUrl(u) {
    if (!u) return u;
    let s = String(u);
    s = stripControlChars(s).trim();
    s = s.replace(/[>\)\]\}"'`]+$/g, '');
    s = stripControlChars(s).trim();
    return s;
  }

  function extractFirstHttpUrl(text) {
    if (!text) return null;
    const s = stripControlChars(String(text));
    const m = s.match(/https?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+/);
    return m ? cleanUrl(m[0]) : null;
  }

  function shouldRecord(url) {
    if (!url) return false;
    if (url.startsWith('blob:') || url.startsWith('data:')) return false;
    if (!url.startsWith('https://cdn.csgoskins.gg/')) return false;
    return CAPTURE_PATTERNS.some(re => re.test(url));
  }

  function kind(url) {
    if (/\.glb(\?|#|$)/i.test(url)) return 'GLB';
    if (/\/public\/uih\/objects\//i.test(url)) return 'UIH';
    return 'OTHER';
  }

  // =============================
  // Capture hook (page context)
  // =============================
  function injectResourceHook() {
    const code = `
      (() => {
        let enabled = false;
        let baseline = 0;

        function emit(url, startTime) {
          if (!enabled) return;
          if (!url) return;
          if (typeof startTime === 'number' && startTime < baseline) return;
          window.postMessage({ __VU_3D_ASSET__: true, url }, '*');
        }

        try {
          const po = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) emit(e.name, e.startTime);
          });
          po.observe({ type: 'resource', buffered: true });
        } catch {}

        window.addEventListener('message', (ev) => {
          const d = ev.data;
          if (!d || !d.__VU_3D_CMD__) return;
          if (d.cmd === 'start') { baseline = performance.now() - ${SETTINGS.baselineBackMs}; enabled = true; }
          if (d.cmd === 'stop')  { enabled = false; }
        });
      })();
    `;
    const s = document.createElement('script');
    s.textContent = code;
    document.documentElement.appendChild(s);
    s.remove();
    log('Injected resource hook');
  }

  function record(url) {
    try {
      const abs = new URL(url, location.href).href;
      if (!sniffing) return;
      if (!shouldRecord(abs)) return;
      if (seen.has(abs)) return;

      seen.add(abs);
      captured.push(abs);
      lastNewTs = Date.now();

      log('Captured', kind(abs), abs);
      updateButtonText();
    } catch (e) {
      warn('Record failed', e);
    }
  }

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.__VU_3D_ASSET__ !== true) return;
    if (d.url) record(d.url);
  });

  function startCapture() {
    lastNewTs = Date.now();
    sniffing = true;
    captured.length = 0;
    seen.clear();
    log('Capture START');
    window.postMessage({ __VU_3D_CMD__: true, cmd: 'start' }, '*');
  }

  function stopCapture() {
    sniffing = false;
    log('Capture STOP. Total captured:', captured.length);
    window.postMessage({ __VU_3D_CMD__: true, cmd: 'stop' }, '*');
  }

  // =============================
  // OBJ exporter (page context, ESM with importmap)
  // =============================
  function injectImportMapOnce() {
    if (document.querySelector('script[data-vu-importmap="three"]')) return;

    const importmap = document.createElement('script');
    importmap.type = 'importmap';
    importmap.setAttribute('data-vu-importmap', 'three');
    importmap.textContent = JSON.stringify({
      imports: {
        three: `https://cdn.jsdelivr.net/npm/three@${SETTINGS.threeVersion}/build/three.module.js`,
      },
    });

    (document.head || document.documentElement).appendChild(importmap);
    log('Injected importmap for "three"');
  }

  function injectObjExporterModule() {
    if (window.__VU_OBJ_EXPORTER_READY__) return;
    injectImportMapOnce();

    const mod = document.createElement('script');
    mod.type = 'module';
    mod.textContent = `
      (() => {
        if (window.__VU_OBJ_EXPORTER_READY__) return;
        window.__VU_OBJ_EXPORTER_READY__ = true;

        window.addEventListener('message', async (ev) => {
          const d = ev.data;
          if (!d || d.__VU_EXPORT_OBJ__ !== true) return;

          const id = d.id;
          const buf = d.buffer;

          try {
            const { GLTFLoader } = await import('https://cdn.jsdelivr.net/npm/three@${SETTINGS.threeVersion}/examples/jsm/loaders/GLTFLoader.js');
            const { OBJExporter } = await import('https://cdn.jsdelivr.net/npm/three@${SETTINGS.threeVersion}/examples/jsm/exporters/OBJExporter.js');

            const loader = new GLTFLoader();
            const exporter = new OBJExporter();

            const gltf = await new Promise((resolve, reject) => {
              loader.parse(buf, '', resolve, reject);
            });

            const objText = exporter.parse(gltf.scene);
            window.postMessage({ __VU_EXPORT_OBJ_RESULT__: true, id, ok: true, objText }, '*');
          } catch (e) {
            window.postMessage({ __VU_EXPORT_OBJ_RESULT__: true, id, ok: false, error: (e && e.message) ? e.message : String(e) }, '*');
          }
        });
      })();
    `;
    document.documentElement.appendChild(mod);
    log('Injected OBJ exporter module');
  }

  function exportObjFromGlbArrayBuffer(glbAb) {
    return new Promise((resolve, reject) => {
      const id = `exp_${Math.random().toString(16).slice(2)}`;

      const handler = (ev) => {
        const d = ev.data;
        if (!d || d.__VU_EXPORT_OBJ_RESULT__ !== true) return;
        if (d.id !== id) return;

        window.removeEventListener('message', handler);
        if (d.ok) resolve(d.objText);
        else reject(new Error(d.error || 'OBJ export failed'));
      };

      window.addEventListener('message', handler);

      log('OBJ export request', id, 'bytes:', glbAb.byteLength);
      // transfer buffer into page context
      window.postMessage({ __VU_EXPORT_OBJ__: true, id, buffer: glbAb }, '*', [glbAb]);
    });
  }

  // =============================
  // Decode UIH -> original texture URL
  // =============================
  function base64UrlDecodeToString(b64url) {
    let s = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return atob(s);
  }

  function decodeOriginalUrlFromUih(uihUrlRaw) {
    const uihUrl = cleanUrl(uihUrlRaw);
    const u = new URL(uihUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('objects');
    if (idx < 0 || !parts[idx + 1]) return null;

    const encoded = parts[idx + 1];
    try {
      const decoded = base64UrlDecodeToString(encoded);
      const extracted = extractFirstHttpUrl(decoded);
      return extracted ? cleanUrl(extracted) : null;
    } catch (e) {
      warn('UIH decode failed:', encoded, e);
      return null;
    }
  }

  function filenameFromUrl(urlRaw, fallback) {
    try {
      const url = cleanUrl(urlRaw);
      const u = new URL(url);
      const name = u.pathname.split('/').filter(Boolean).pop();
      return name || fallback;
    } catch {
      return fallback;
    }
  }

  // =============================
  // HTTP + download
  // =============================
  function gmGetArrayBuffer(urlRaw) {
    const url = cleanUrl(urlRaw);
    return new Promise((resolve, reject) => {
      log('HTTP GET', url);

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        anonymous: false,
        headers: {
          Accept: '*/*',
          Referer: location.href,
          Origin: location.origin,
        },
        onload: (res) => {
          log('HTTP', res.status, url, 'len:', res.response?.byteLength ?? null);
          if (res.status >= 200 && res.status < 300 && res.response) resolve(res.response);
          else reject(new Error(`HTTP ${res.status} for ${url}`));
        },
        onerror: () => reject(new Error(`Network error for ${url}`)),
        ontimeout: () => reject(new Error(`Timeout for ${url}`)),
      });
    });
  }

  function downloadBlob(blob, filename) {
    log('Downloading ZIP', filename, 'size:', blob.size);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  }

  function sanitizeFileBase(name) {
    return (name || 'csgoskins-3d')
      .replace(/[\/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function pageTitle() {
    const h1 = document.querySelector('h1')?.textContent?.trim();
    if (h1) return h1;
    const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
    if (og) return og;
    const t = document.title?.trim();
    if (t) return t.replace(' - csgoskins.gg', '').trim();
    return location.pathname.split('/').filter(Boolean).pop() || 'csgoskins-3d';
  }

  // =============================
  // ZIP pipeline
  // =============================
  async function buildZipAndDownload(glbUrl, uihUrls) {
    const files = {};
    const failedTextures = [];
    let totalBytes = 0;

    // Dedup originals
    const originalSet = new Set();
    for (const uih of uihUrls) {
      const orig = decodeOriginalUrlFromUih(uih);
      if (orig) originalSet.add(orig);
      else warn('Decode failed for UIH:', uih);
    }
    const originals = Array.from(originalSet);

    log('--- Summary ---');
    log('GLB:', glbUrl);
    log('UIH captured:', uihUrls.length);
    log('Original textures decoded:', originals.length);
    originals.forEach(u => log('  ->', u));

    const manifest = {
      page: location.href,
      capturedAt: new Date().toISOString(),
      model_glb: glbUrl,
      textures_original: originals,
      textures_uih: uihUrls,
      textures_failed: failedTextures,
      note: 'Environment assets intentionally excluded',
    };

    // 1) Download GLB
    setStatus(`Downloading model (.glb)\n${glbUrl}`);
    const glbAb = await gmGetArrayBuffer(glbUrl);

    // Copy for ZIP; transfer original for OBJ export
    const glbCopyForZip = glbAb.slice(0);
    const glbU8 = new Uint8Array(glbCopyForZip);
    files['model/mesh.glb'] = glbU8;
    totalBytes += glbU8.byteLength;
    log('Added model/mesh.glb bytes:', glbU8.byteLength);

    // 2) Export OBJ
    setStatus('Exporting mesh.obj…');
    const objText = await exportObjFromGlbArrayBuffer(glbAb);
    const objU8 = new TextEncoder().encode(objText);
    files['model/mesh.obj'] = objU8;
    totalBytes += objU8.byteLength;
    log('Added model/mesh.obj bytes:', objU8.byteLength);

    // 3) Download textures
    for (let i = 0; i < originals.length; i++) {
      const texUrl = originals[i];
      setStatus(`Downloading texture ${i + 1}/${originals.length}\n${texUrl}`);

      try {
        const ab = await gmGetArrayBuffer(texUrl);
        const u8 = new Uint8Array(ab);
        const fname = filenameFromUrl(texUrl, `texture_${i}.bin`);
        files[`textures/${fname}`] = u8;
        totalBytes += u8.byteLength;
        log(`Added textures/${fname} bytes:`, u8.byteLength);
      } catch (e) {
        warn('Texture download failed:', texUrl, e?.message || e);
        failedTextures.push({ url: texUrl, error: String(e?.message || e) });
        if (!SETTINGS.continueOnFail) throw e;
      }
    }

    // Manifest
    manifest.textures_failed = failedTextures;
    const manifestU8 = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    files['manifest.json'] = manifestU8;
    totalBytes += manifestU8.byteLength;

    // ZIP
    setStatus(`Building ZIP…\nTotal ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
    await sleep(0);

    if (SETTINGS.debug) {
      log('ZIP contents:');
      Object.keys(files).sort().forEach(k => log(' -', k, 'bytes:', files[k].byteLength));
    }

    const zipped = fflate.zipSync(files, { level: 0 });
    const blob = new Blob([zipped], { type: 'application/zip' });

    const zipName = `${sanitizeFileBase(pageTitle())}.zip`;
    downloadBlob(blob, zipName);

    if (failedTextures.length) {
      warn('Some textures failed. Check manifest.json -> textures_failed', failedTextures);
    }
  }

  // =============================
  // UI
  // =============================
  let btn, statusEl;

  function setStatus(text) {
    statusEl.textContent = text;
    statusEl.style.display = 'block';
  }

  function clearStatusSoon() {
    setTimeout(() => { statusEl.style.display = 'none'; }, 2500);
  }

  function updateButtonText(extra) {
    if (!btn) return;
    btn.textContent = extra || `Download 3D ZIP • ${captured.length}`;
  }

  function setBusy(b) {
    btn.disabled = b;
    btn.style.opacity = b ? '0.75' : '1';
    btn.style.cursor = b ? 'wait' : 'pointer';
  }

  async function waitFor(sel, ms = 15000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const el = document.querySelector(sel);
      if (el) return el;
      await sleep(100);
    }
    return null;
  }

  async function click3DTab() {
    const tab = await waitFor('#inspect-3d-tab', 15000);
    if (!tab) throw new Error('3D tab not found (#inspect-3d-tab)');
    log('Clicking 3D tab');
    tab.click();
  }

  async function sniffUntilQuiet() {
    const start = Date.now();
    while (true) {
      await sleep(200);
      const quietFor = Date.now() - lastNewTs;
      const elapsed = Date.now() - start;
      if (captured.length > 0 && quietFor >= SETTINGS.quietMs) break;
      if (elapsed >= SETTINGS.maxSniffMs) break;
    }
    log('Sniff complete. captured:', captured.length);
  }

  async function onDownloadClick() {
    setBusy(true);
    setStatus('Starting…');

    try {
      startCapture();
      await click3DTab();

      updateButtonText('Capturing…');
      setStatus('Capturing model + textures…');

      await sniffUntilQuiet();
      stopCapture();

      const final = Array.from(new Set(captured)).filter(shouldRecord);
      const glbs = final.filter(u => /\.glb(\?|#|$)/i.test(u));
      const uih  = final.filter(u => /\/public\/uih\/objects\/.+\/csgoskins\.webp(\?|#|$)/i.test(u));

      log('Final filtered:', final.length);
      log('GLBs found:', glbs.length, glbs);
      log('UIH found:', uih.length);

      const glb = glbs[0];
      if (!glb) throw new Error('No .glb captured. Click again after the model is visible.');
      if (!uih.length) throw new Error('No textures captured. Rotate the model once, then click again.');

      // Clipboard bonus (useful for debugging)
      try {
        const originals = uih.map(decodeOriginalUrlFromUih).filter(Boolean);
        GM_setClipboard([glb, ...originals].join('\n'));
      } catch {}

      updateButtonText('Downloading…');
      await buildZipAndDownload(glb, uih);

      updateButtonText('Done');
      setStatus('Done! ZIP saved.');
      clearStatusSoon();
    } catch (e) {
      error('FAILED:', e);
      updateButtonText('Error');
      setStatus(`Error: ${e?.message || e}`);
    } finally {
      stopCapture();
      setBusy(false);
      updateButtonText();
    }
  }

  function mountUI() {
    btn = document.createElement('button');
    btn.textContent = 'Download 3D ZIP • 0';
    btn.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 999999;
      padding: 10px 14px; border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(20, 24, 32, 0.92);
      color: #fff; cursor: pointer;
      font: 600 13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
      backdrop-filter: blur(8px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    `;

    statusEl = document.createElement('div');
    statusEl.style.cssText = `
      position: fixed; right: 16px; bottom: 58px; z-index: 999999;
      width: min(560px, calc(100vw - 32px));
      padding: 8px 10px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(20, 24, 32, 0.85);
      color: rgba(255,255,255,0.85);
      font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      display: none;
      backdrop-filter: blur(8px);
      white-space: pre-wrap;
    `;

    btn.addEventListener('click', onDownloadClick);

    document.documentElement.appendChild(btn);
    document.documentElement.appendChild(statusEl);

    updateButtonText();
    log('UI mounted');
  }

  // =============================
  // Init
  // =============================
  injectResourceHook();
  injectObjExporterModule();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUI, { once: true });
  } else {
    mountUI();
  }
})();
