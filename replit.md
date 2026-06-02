# Swing Clinic

AI-powered golf swing analysis app — upload a swing video/image, get an AI breakdown with scores, handicap estimate, drill recommendations, and coaching feedback.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_ANTHROPIC_API_KEY`, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: plain Vite (HTML/JS — no React), dark theme, Bebas Neue headings, DM Sans body
- API: Express 5, port 8080, proxied to `/api` via shared proxy at localhost:80
- Auth: Clerk v6 (headless — custom email/OTP form, no `mountSignIn`)
- AI: Anthropic Claude via Express proxy at `/api/analyse`
- Persistence: localStorage (no DB for user data)
- Build: Vite (frontend), esbuild (API server)

## Where things live

- `artifacts/swing-clinic/` — Vite frontend (plain JS, HTML, CSS)
  - `src/main.js` — all app logic (screens, state, Clerk auth, AI analysis)
  - `src/style.css` — all styles
  - `index.html` — app shell with all screen HTML
  - `public/clerk.browser.js` — Clerk v6 browser bundle (copied from node_modules)
  - `public/*_clerk.browser_*.js` — Clerk UI chunks (served for lazy loading)
- `artifacts/api-server/` — Express API server
  - `src/routes/index.ts` — route registration
  - `src/routes/analyse.ts` — `/api/analyse` — Anthropic proxy
  - `src/routes/config.ts` — `/api/config` — returns Clerk publishable key
  - `src/app.ts` — Express app with Clerk middleware

## Architecture decisions

- **No React** — plain HTML/JS for simplicity; screens toggled via `.active` CSS class on `.screen` divs
- **Clerk headless auth** — custom email/OTP 2-step form using `client.signIn.create` / `client.signUp.create` instead of `mountSignIn` (avoids UI component chunk loading issues with local bundle)
- **Express AI proxy** — `VITE_ANTHROPIC_API_KEY` kept server-side only, never exposed to browser
- **localStorage-only persistence** — no database for user data; analyses stored in `swingclinic_analyses`, subscription in `swingclinic_sub`
- **Subscription gating** — Compare tab and full 11-variable breakdown locked for free users; upgrade via Whop CTAs

## Product

Multi-screen flow: Splash → Goal selection → Golfer profile → Upload swing → AI analysing → Results (animated score ring, handicap range, top performance killer, 11-variable breakdown, drills, coach message). Bottom nav: Home / Progress (history charts) / Compare (locked for free). Auth required before entering the app.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `window.Clerk` in Clerk v6 is a singleton **instance**, NOT a constructor. Never `new window.Clerk()`. Call `.load()` on it directly.
- Do NOT use `clerk.mountSignIn()` — requires UI component chunks that fail to lazy-load from a local bundle. Use the headless API instead.
- Clerk `clerk.browser.js` must be in `public/` (not imported via ESM). Load via `<script>` tag with `data-clerk-publishable-key` attribute.
- API server runs on `$PORT` (workflow-assigned). Always access via `localhost:80/api/...` (shared proxy), not port directly.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `.agents/memory/clerk-vanilla-auth.md` for Clerk headless auth patterns
