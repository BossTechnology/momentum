# MOMENTUM — Business Journey Observability Simulation

Live demo deployed on **Vercel** (static frontend + serverless Claude proxy).
Every Claude call routes through `/api/bobby`, which holds the API key
server-side — the key is **never** shipped to the browser.

- **Live:** https://momentum-demo-ten.vercel.app
- **Project:** https://vercel.com/bosstechnology/momentum-demo

## Layout
```
momentum/
├─ index.html      ← the simulation (production API base injected in <head>)
├─ api/bobby.js    ← Claude proxy — holds ANTHROPIC_API_KEY server-side
├─ vercel.json     ← root rewrite + 60s function timeout + no-cache on HTML
├─ .env.example    ← env var template (never commit real secrets)
└─ .gitignore
```

## How the proxy wiring works
A small script at the top of `<head>` sets `window.MOMENTUM_API_BASE = '/api'`
on any non-local host, so production Claude calls resolve to **`/api/bobby`**.
On `localhost` / `file://` it stays unset and the app falls back to the keyless
sandbox path (offline preview only — never used in production).

## Required environment variable
Set in **Vercel → Project → Settings → Environment Variables**:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Used by `api/bobby.js`. Required for BOBee + the document analyzer. |

> Supabase persistence (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) is a future gated
> step — the in-HTML save/load layer is not yet wired.

## Deploy
- **Automatic:** push to `main` → Vercel builds and deploys to production.
- **Manual (CLI):** `vercel --prod` from the project root.

## Notes
- The proxy forwards only allowlisted models (see `api/bobby.js`). The app
  currently sends `claude-sonnet-4-20250514`.
- The simulation content is the canonical `momentum-Simulation` build; only the
  production `<head>` wiring script is added on top.
