---
name: Analysis history DB architecture
description: How swing analysis history is persisted (PostgreSQL) and served to the frontend via in-memory cache
---

# Analysis History — Hybrid In-Memory + PostgreSQL

## The rule
`state.analyses` is the single source of truth at runtime (oldest-first array). It is populated from the DB on every login and cleared on sign-out. All rendering code calls `getAnalyses()` which returns `state.analyses` synchronously.

**Why:** Converting every localStorage read to async would have required restructuring all rendering functions. Hybrid approach keeps rendering synchronous while gaining cross-device persistence.

**How to apply:**
- `loadAnalysesFromServer()` — called after `await clerkInstance.load()` detects a logged-in user, and after OTP verification succeeds. Uses `authFetch` (Bearer token) to GET `/api/analyses`.
- `saveAnalysis(data)` — pushes entry to `state.analyses` immediately (UI instant), then fire-and-forget POST to `/api/analyses`.
- `getAnalyses()` — returns `state.analyses` (synchronous, no DB call).
- Sign-out handlers must set `state.analyses = []` to avoid leaking history between users.

## DB schema
Table: `analyses` in `lib/db/src/schema/analyses.ts` — stores all fields from the AI response (overallScore, variables JSONB, biggestKiller, biggestKillerDesc, drills JSONB, coachMessage, handicapEstimate JSONB, goal, coachStyle). Keyed on `clerk_user_id`.

## API routes
- `GET /api/analyses` → returns array newest-first; frontend reverses to oldest-first for chart
- `POST /api/analyses` → inserts one row, returns `{ id, timestamp }`
- `DELETE /api/analyses/:id` → ownership enforced via `AND clerk_user_id = $userId`
All routes require Clerk session JWT as `Authorization: Bearer <token>`.

## Auth on API calls
`authFetch(url, options)` helper calls `clerkInstance?.session?.getToken()` and attaches `Authorization: Bearer <token>`. Defined as a hoisted function declaration (works even though textually after `initClerk()` call).

## Subscription tier
Tier is NOT stored in the DB. It lives in Clerk `publicMetadata.tier` (set by Whop webhook) and is synced to `window._swingClinicTier` on login via `syncTierFromClerk(user)`. `getTier()` reads from `window._swingClinicTier` only (localStorage fallback removed).
