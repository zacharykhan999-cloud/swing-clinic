---
name: Swing Clinic — stack and key decisions
description: Architecture decisions for the Swing Clinic AI golf swing analysis app
---

## Stack
- pnpm workspace, Vite (plain HTML/JS — no React framework), Express 5, Node 24
- API server: port 8080, proxied at `/api` via shared proxy at localhost:80
- Auth: Clerk (headless, see clerk-vanilla-auth.md)
- AI: Anthropic Claude via Express proxy at `/api/analyse`
- Persistence: localStorage (`swingclinic_analyses` for history, `swingclinic_sub` for subscription status)

## Key Decisions
- **No React**: plain HTML/JS with Vite for simplicity; screens toggled via CSS `.active` class
- **Clerk headless**: custom email/OTP form instead of `mountSignIn` (avoids UI chunk issue — see clerk-vanilla-auth.md)
- **Express proxy for AI**: VITE_ANTHROPIC_API_KEY kept server-side only, never exposed to browser
- **Subscription gating**: `swingclinic_sub` in localStorage; Compare tab + full variable breakdown locked for free users
- **Bottom nav**: Home / Progress / Compare tabs with smooth transitions
- **Clerk publishable key**: `pk_test_c3Rhci1zd2lmdC01Ni5jbGVyay5hY2NvdW50cy5kZXYk` (FAPI: star-swift-56.clerk.accounts.dev)

## Env vars
- `VITE_CLERK_PUBLISHABLE_KEY` — frontend Clerk key (also readable via `/api/config` fallback)
- `CLERK_SECRET_KEY` — backend Clerk key
- `VITE_ANTHROPIC_API_KEY` — Anthropic key (server-side only via Express)
- `SESSION_SECRET` — Express session secret
