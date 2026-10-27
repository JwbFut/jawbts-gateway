/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of jawbts-api, without a trailing slash. Baked in at build time. */
  readonly VITE_API_BASE_URL?: string
  /** Optional display name for the site. */
  readonly VITE_SITE_NAME?: string
  /** Explicit build hash for the terminal banner (otherwise injected from CI). */
  readonly VITE_BUILD_HASH?: string
  /** Copyright/license line shown in the terminal banner. */
  readonly VITE_LICENSE_NOTICE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Injected by vite.config.ts from the commit/CI environment or VITE_BUILD_HASH. */
declare const __BUILD_HASH__: string
