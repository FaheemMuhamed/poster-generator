import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// Dev-only: lets capture.html save preview clips and example posters into public/.
// Only active under `npm run dev`; it is never part of the built site.
function captureEndpoint() {
  const ALLOWED = new Set(['previews', 'examples', 'samples']);
  return {
    name: 'capture-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        const url = new URL(req.url, 'http://x');
        const dir = url.searchParams.get('dir');
        const name = path.basename(url.searchParams.get('name') || '');
        // Only capture.html on this dev server may write: other sites can reach localhost too.
        const sameOrigin = req.headers.origin === `http://${req.headers.host}` && req.headers['sec-fetch-site'] !== 'cross-site';
        if (req.method !== 'POST' || !sameOrigin || !ALLOWED.has(dir) || !/^[\w-][\w.-]*\.(webp|jpe?g|png|mp4|webm|json)$/i.test(name)) {
          res.statusCode = 400;
          return res.end('bad request');
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const out = path.resolve(import.meta.dirname, 'public', dir);
          fs.mkdirSync(out, { recursive: true });
          fs.writeFileSync(path.join(out, name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

// Build-only: adds a Content-Security-Policy to the published page. (Dev is left alone:
// Vite's hot reload needs inline scripts.) Inline scripts are allowed by hash, so the
// theme script in index.html can change without editing this.
function contentSecurityPolicy() {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
        .map(([, body]) => `'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`);
      const csp = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(' ')}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://cdn.jsdelivr.net", // three.js typefaces for Type in Space
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "frame-src 'self' https://tally.so", // the About hero embed and the feedback form
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; ');
      return html.replace('<meta name="viewport"', `<meta http-equiv="Content-Security-Policy" content="${csp}" />\n  <meta name="viewport"`);
    },
  };
}

export default defineConfig({
  // Relative paths so the site works at https://morva-studio.com/ and at https://<user>.github.io/<repo>/
  base: './',
  plugins: [react(), tailwindcss(), captureEndpoint(), contentSecurityPolicy()],
  // p5 and three are big libraries; their size is expected.
  build: { chunkSizeWarningLimit: 1200 },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
});
