# Jawbts Gateway

Static Vue 3 + TypeScript SPA for the `jawbts-api` service. It provides GitHub login, the terminal account/email/session UI, and the `/authorize` consent flow that issues scoped delegated access and refresh tokens.

## Deploy

The build is static (`dist/`). The API is deployed separately.

### Vercel

1. Import this repository into Vercel. The included `vercel.json` sets the Vite framework, `npm ci`, the `npm run build` build command, and the `dist` output directory.
2. Configure these environment variables for Production and Preview:

   | Variable | Value |
   | --- | --- |
   | `VITE_API_BASE_URL` | `https://api.jawbts.org` — must be HTTPS in production; localhost is allowed only in development. |
   | `VITE_SITE_NAME` | `Jawbts` (optional). |
   | `VITE_LICENSE_NOTICE` | Optional terminal-banner copyright/license line; defaults to the GPL notice. |
   | `VITE_BUILD_HASH` | Optional build hash; otherwise the Vercel/GitHub commit is used. |

3. Deploy at the domain root. The router uses `createWebHistory()`, and `vercel.json` rewrites unknown paths to `/index.html`.
4. Token destinations are a code allowlist in `src/config/allowlist.ts`; add a destination there and rebuild.
5. Add a Content-Security-Policy header in Vercel for production. `vercel.json` already includes the SPA rewrite and baseline security headers.

`vercel.json` caches hashed `/assets/*` for one year as immutable and marks HTML as `private, no-cache, must-revalidate`, so repeat visits reuse bundles while a new deployment is picked up immediately.

Vite bakes `VITE_*` values into the static bundle at build time, so redeploy after changing them.

Vercel's GitHub integration can deploy pushes and pull-request previews automatically. For production deploys from GitHub Actions instead, use the workflow below.

### GitHub Actions → Vercel

`.github/workflows/deploy.yml` runs on every push to `main` and on manual dispatch. It installs, lints, tests, builds, then deploys the source to Vercel production with the pinned Vercel CLI (`65.1.0`). Add these repository secrets:

| Secret | Value |
| --- | --- |
| `VERCEL_TOKEN` | A Vercel account token. |
| `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` after running `vercel link`. |
| `VERCEL_PROJECT_ID` | `projectId` from the same file. |

The Vercel project's Production environment supplies the `VITE_*` values; the workflow passes `BUILD_HASH` to the remote build. Use either Vercel's Git integration or this workflow, not both, or the project will deploy twice.

### Other static hosts

Publish `dist/` with an SPA fallback to `/index.html`. `public/404.html` and `public/_redirects` cover hosts that use those files.