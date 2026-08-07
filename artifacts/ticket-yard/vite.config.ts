import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

// Resolved once at config-load time (top-level await), so the config
// function handed to defineConfig below can stay synchronous.
const replitDevPlugins =
  process.env.NODE_ENV !== 'production' && process.env.REPL_ID !== undefined
    ? [
        await import('@replit/vite-plugin-cartographer').then((m) =>
          m.cartographer({
            root: path.resolve(import.meta.dirname, '..'),
          }),
        ),
        await import('@replit/vite-plugin-dev-banner').then((m) =>
          m.devBanner(),
        ),
      ]
    : [];

// PORT/BASE_PATH are only meaningful for the dev/preview server (Replit's
// artifact.toml injects them there); `vite build` never binds a port, so it
// must not require them.
export default defineConfig(({ command }) => {
  const isServe = command === 'serve';
  const rawPort = process.env.PORT;

  if (isServe && !rawPort) {
    throw new Error(
      'PORT environment variable is required but was not provided.',
    );
  }

  const port = rawPort ? Number(rawPort) : undefined;

  if (port !== undefined && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH ?? '/';

  // Local dev of this SPA calls the API through relative `/api/*` paths.
  // Inside Replit those are stitched together by its own router; for
  // standalone local dev (this SPA's Vite server + the API server running
  // separately) proxy `/api` to wherever the API server is actually
  // listening.
  const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080';

  return {
    base: basePath,
    plugins: [react(), tailwindcss(), runtimeErrorOverlay(), ...replitDevPlugins],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
      proxy: {
        '/api': { target: apiProxyTarget, changeOrigin: true },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
      proxy: {
        '/api': { target: apiProxyTarget, changeOrigin: true },
      },
    },
  };
});
