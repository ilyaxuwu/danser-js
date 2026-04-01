// ─────────────────────────────────────────────
//  vite.config.js
//
//  Adds a danser-api plugin that reads
//  __autoload.json (written by cli.js) and
//  serves the beatmap / audio / skin files
//  via HTTP so the browser can fetch them.
// ─────────────────────────────────────────────

import { defineConfig } from 'vite';
import fs               from 'node:fs';
import path             from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function danserApiPlugin() {
  const manifestPath = path.resolve('__autoload.json');
  const configPath   = path.resolve('config.json');
  let manualSkinPath = null;
  /** @type {Map<string, Map<string, string>>} dirPath → (lowerName → real file name on disk) */
  const caseMapCache = new Map();

  function getDirCaseMap(dirPath) {
    let m = caseMapCache.get(dirPath);
    if (m) return m;
    m = new Map();
    try {
      if (fs.existsSync(dirPath)) {
        for (const name of fs.readdirSync(dirPath)) {
          m.set(name.toLowerCase(), name);
        }
      }
    } catch (_) {}
    caseMapCache.set(dirPath, m);
    return m;
  }

  function realNameInDir(dirPath, filenameLower) {
    const map = getDirCaseMap(dirPath);
    return map.get(filenameLower) ?? filenameLower;
  }

  function getManifest() {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  function getWorkspaceConfig() {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  function norm(s) {
    return String(s ?? '').toLowerCase().trim();
  }

  function deepMerge(base, override) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
      return override;
    }
    const out = Array.isArray(base) ? [...base] : { ...(base ?? {}) };
    for (const [k, v] of Object.entries(override)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = deepMerge(out[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function readReqBody(req, maxBytes = 1_000_000) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > maxBytes) reject(new Error('Request body too large'));
      });
      req.on('end', () => resolve(raw));
      req.on('error', reject);
    });
  }

  function resolveSkinPath(skinsPath, skinName) {
    if (!skinsPath || !fs.existsSync(skinsPath)) return null;
    const desiredSkin = String(skinName ?? '').trim();
    if (!desiredSkin || desiredSkin.toLowerCase() === 'default') return null;

    const candidate = path.join(skinsPath, desiredSkin);
    if (fs.existsSync(candidate)) return candidate;

    try {
      const entries = fs.readdirSync(skinsPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      const hit = entries.find((e) => norm(e).includes(norm(desiredSkin)));
      return hit ? path.join(skinsPath, hit) : null;
    } catch (_) {
      return null;
    }
  }

  function getDefaultSkinRoot() {
    return path.join(__dirname, 'public', 'skin-default');
  }

  /** Active skin directory (CLI override > manifest > config). */
  function getPrimarySkinDirectory(cfg) {
    if (manualSkinPath && fs.existsSync(manualSkinPath)) return manualSkinPath;
    const m = getManifest();
    if (m?.skinPath && fs.existsSync(m.skinPath)) return m.skinPath;
    const active = String(cfg?.osu?.activeSkin ?? 'Default').trim();
    if (!active || active.toLowerCase() === 'default') return null;
    return resolveSkinPath(cfg?.osu?.skinsPath, active);
  }

  /**
   * Resolution order: current skin → fallback skin → built-in default.
   * If activeSkin is Default, only the built-in folder is used.
   */
  function getSkinLayers(cfg) {
    /** @type {{ source: 'SKIN' | 'FALLBACK' | 'LOCAL', path: string }[]} */
    const layers = [];
    const defaultRoot = getDefaultSkinRoot();
    const active = String(cfg?.osu?.activeSkin ?? 'Default').trim();
    const fallback = String(cfg?.osu?.fallbackSkin ?? '').trim();

    if (!active || active.toLowerCase() === 'default') {
      if (fs.existsSync(defaultRoot)) layers.push({ source: 'LOCAL', path: defaultRoot });
      return layers;
    }

    const primary = getPrimarySkinDirectory(cfg);
    if (primary) layers.push({ source: 'SKIN', path: primary });

    const fbSkip = !fallback || fallback.toLowerCase() === 'default' ||
      norm(fallback) === norm(active);
    if (!fbSkip) {
      const fp = resolveSkinPath(cfg?.osu?.skinsPath, fallback);
      const pn = primary ? norm(path.resolve(primary)) : '';
      if (fp && norm(path.resolve(fp)) !== pn) {
        layers.push({ source: 'FALLBACK', path: fp });
      }
    }

    if (fs.existsSync(defaultRoot)) layers.push({ source: 'LOCAL', path: defaultRoot });
    return layers;
  }

  function findFileInLayers(filenameLower, layers, preferSource) {
    const trySubset = (subset) => {
      for (const layer of subset) {
        const real = realNameInDir(layer.path, filenameLower);
        const p = path.join(layer.path, real);
        if (fs.existsSync(p)) {
          return { fullPath: p, source: layer.source, servedAs: path.basename(p) };
        }
      }
      return null;
    };
    if (preferSource) {
      const sub = layers.filter((l) => l.source === preferSource);
      const hit = trySubset(sub);
      if (hit) return hit;
    }
    return trySubset(layers);
  }

  /** Logical PNG: try `@2x` then `1×` across layers (danser-go order). */
  function findSkinTexturePng(logicalName, layers, preferSource) {
    const ln = logicalName.toLowerCase();
    if (!ln.endsWith('.png')) return findFileInLayers(ln, layers, preferSource);
    const base = ln.replace(/\.png$/i, '');
    const candidates = [`${base}@2x.png`, `${base}.png`];
    const trySubset = (subset) => {
      for (const cand of candidates) {
        const cl = cand.toLowerCase();
        for (const layer of subset) {
          const real = realNameInDir(layer.path, cl);
          const p = path.join(layer.path, real);
          if (fs.existsSync(p)) return { fullPath: p, source: layer.source, servedAs: path.basename(p) };
        }
      }
      return null;
    };
    if (preferSource) {
      const sub = layers.filter((l) => l.source === preferSource);
      const hit = trySubset(sub);
      if (hit) return hit;
    }
    return trySubset(layers);
  }

  return {
    name: 'danser-api',

    configureServer(server) {
      server.middlewares.use('/api/autoload', (_req, res) => {
        const m = getManifest();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify(m ?? null));
      });

      server.middlewares.use('/api/config', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method === 'GET') {
          res.end(JSON.stringify(getWorkspaceConfig() ?? {}));
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
          return;
        }

        try {
          const raw = await readReqBody(req);
          const incoming = raw ? JSON.parse(raw) : {};
          const current = getWorkspaceConfig() ?? {};
          const nextCfg = deepMerge(current, incoming ?? {});
          fs.writeFileSync(configPath, JSON.stringify(nextCfg, null, 2), 'utf8');
          caseMapCache.clear();

          // Keep runtime-selected skin aligned after config writes.
          {
            const sp = String(nextCfg?.osu?.skinsPath ?? '').trim();
            const sn = String(nextCfg?.osu?.activeSkin ?? 'Default').trim();
            manualSkinPath = sp && sn && sn.toLowerCase() !== 'default'
              ? resolveSkinPath(sp, sn)
              : null;
          }

          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
        }
      });

      // Serve beatmap .osu file
      server.middlewares.use('/api/beatmap', (_req, res) => {
        const m = getManifest();
        if (!m?.beatmapPath || !fs.existsSync(m.beatmapPath)) {
          res.statusCode = 404;
          return res.end('Beatmap not found');
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(fs.readFileSync(m.beatmapPath, 'utf8'));
      });

      // Stream audio file
      server.middlewares.use('/api/audio', (req, res) => {
        const m = getManifest();
        if (!m?.audioPath || !fs.existsSync(m.audioPath)) {
          res.statusCode = 404;
          return res.end('Audio not found');
        }
        const stat = fs.statSync(m.audioPath);
        const ext  = path.extname(m.audioPath).toLowerCase();
        const mime = {
          '.mp3':  'audio/mpeg',
          '.ogg':  'audio/ogg',
          '.wav':  'audio/wav',
          '.flac': 'audio/flac',
          '.m4a':  'audio/mp4',
        }[ext] ?? 'application/octet-stream';

        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Access-Control-Allow-Origin', '*');
        // Support range requests so Web Audio API can stream
        const range = req.headers.range;
        if (range) {
          const [startStr, endStr] = range.replace('bytes=', '').split('-');
          const start = parseInt(startStr, 10);
          const end   = endStr ? parseInt(endStr, 10) : stat.size - 1;
          res.statusCode = 206;
          res.setHeader('Content-Range',  `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', end - start + 1);
          res.setHeader('Accept-Ranges',  'bytes');
          fs.createReadStream(m.audioPath, { start, end }).pipe(res);
        } else {
          res.setHeader('Accept-Ranges', 'bytes');
          fs.createReadStream(m.audioPath).pipe(res);
        }
      });

      // Select active skin at runtime from UI settings.
      // Example:
      // /api/skin-select?skinsPath=C:\...\Skins&skin=Whitecat
      server.middlewares.use('/api/skin-select', (req, res) => {
        const reqUrl = new URL(req.url, 'http://localhost');
        const cfg = getWorkspaceConfig();
        const skinsPath = String(reqUrl.searchParams.get('skinsPath') ?? cfg?.osu?.skinsPath ?? '').trim();
        const skinName  = String(reqUrl.searchParams.get('skin') ?? cfg?.osu?.activeSkin ?? 'Default').trim();
        const directPath = String(reqUrl.searchParams.get('path') ?? '').trim();

        const selected = directPath && fs.existsSync(directPath)
          ? directPath
          : resolveSkinPath(skinsPath, skinName);
        manualSkinPath = selected;
        caseMapCache.clear();

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({
          ok: !!selected || !skinName || skinName.toLowerCase() === 'default',
          skinPath: selected ?? null,
          skin: skinName ?? null,
        }));
      });

      // Serve skin files: /api/skin/<filename> (layered: current → fallback → default)
      server.middlewares.use('/api/skin', (req, res) => {
        const cfg = getWorkspaceConfig();
        const layers = getSkinLayers(cfg);
        if (!layers.length) {
          res.statusCode = 404;
          return res.end('No skin loaded');
        }

        const reqUrl = new URL(req.url, 'http://localhost');
        const raw = decodeURIComponent(reqUrl.pathname.replace(/^\//, ''));
        const preferSource = reqUrl.searchParams.get('preferSource') || null;

        const lower = raw.toLowerCase();
        const ext = path.extname(lower);

        let found = null;
        if (ext === '.png') {
          found = findSkinTexturePng(raw, layers, preferSource);
        } else {
          found = findFileInLayers(lower, layers, preferSource);
        }

        if (!found) {
          res.statusCode = 404;
          return res.end(`Skin file not found: ${raw}`);
        }

        const ext2 = path.extname(found.fullPath).toLowerCase();
        const mime = {
          '.png':  'image/png',
          '.jpg':  'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif':  'image/gif',
          '.wav':  'audio/wav',
          '.mp3':  'audio/mpeg',
          '.ogg':  'audio/ogg',
          '.ini':  'text/plain',
        }[ext2] ?? 'application/octet-stream';

        res.setHeader('Content-Type', mime);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Skin-Source', found.source);
        res.setHeader('X-Skin-Resolved-Name', path.basename(found.servedAs));
        fs.createReadStream(found.fullPath).pipe(res);
      });

      // List available skin files (union + per-layer for dependent lookups)
      server.middlewares.use('/api/skin-list', (_req, res) => {
        const cfg = getWorkspaceConfig();
        const layers = getSkinLayers(cfg);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (!layers.length) {
          return res.end(JSON.stringify([]));
        }
        try {
          const union = new Set();
          const layerFiles = [];
          for (const layer of layers) {
            const files = fs.readdirSync(layer.path);
            const lower = files.map((f) => f.toLowerCase());
            layerFiles.push({ source: layer.source, files: lower });
            for (const f of lower) union.add(f);
          }
          res.end(JSON.stringify({ files: [...union], layers: layerFiles }));
        } catch (_) {
          res.end(JSON.stringify([]));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [danserApiPlugin()],
  server: {
    port: 5173,
  },
});
