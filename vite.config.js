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

function danserApiPlugin() {
  const manifestPath = path.resolve('__autoload.json');

  function getManifest() {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {
      return null;
    }
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

      // Serve skin files: /api/skin/<filename>
      server.middlewares.use('/api/skin', (req, res) => {
        const m = getManifest();
        if (!m?.skinPath) {
          res.statusCode = 404;
          return res.end('No skin loaded');
        }
        // req.url is like "/cursor.png" or "/hitcircle.png"
        const filename = decodeURIComponent(req.url.replace(/^\//, ''));
        const filePath = path.join(m.skinPath, filename);

        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          return res.end(`Skin file not found: ${filename}`);
        }

        const ext  = path.extname(filePath).toLowerCase();
        const mime = {
          '.png':  'image/png',
          '.jpg':  'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif':  'image/gif',
          '.wav':  'audio/wav',
          '.mp3':  'audio/mpeg',
          '.ogg':  'audio/ogg',
          '.ini':  'text/plain',
        }[ext] ?? 'application/octet-stream';

        res.setHeader('Content-Type', mime);
        res.setHeader('Access-Control-Allow-Origin', '*');
        fs.createReadStream(filePath).pipe(res);
      });

      // List available skin files
      server.middlewares.use('/api/skin-list', (_req, res) => {
        const m = getManifest();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (!m?.skinPath || !fs.existsSync(m.skinPath)) {
          return res.end(JSON.stringify([]));
        }
        try {
          const files = fs.readdirSync(m.skinPath);
          res.end(JSON.stringify(files));
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
