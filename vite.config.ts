import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

/**
 * The build hash shown in the terminal banner. Prefer an explicit
 * VITE_BUILD_HASH, then the commit hash the hosting/CI provider exposes, then
 * "dev" for local builds without git metadata.
 */
function resolveBuildHash(mode: string): string {
  const env = loadEnv(mode, process.cwd(), '')
  const configured = (env.VITE_BUILD_HASH || process.env.VITE_BUILD_HASH || '').trim()
  if (configured) {
    return configured
  }
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.CI_COMMIT_SHA ||
    process.env.BUILD_HASH ||
    ''
  return commit.trim() ? commit.trim().slice(0, 7) : 'dev'
}

// The dev server intentionally uses port 3001 to match the default
// `GITHUB_REDIRECT_URI` used by the local jawbts-api checkout.
export default defineConfig(({ mode }) => {
  const buildHash = resolveBuildHash(mode)
  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    define: {
      __BUILD_HASH__: JSON.stringify(buildHash),
    },
    server: {
      port: 3001,
      strictPort: true,
    },
    preview: {
      port: 3001,
      strictPort: true,
    },
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  }
})
