# CLAUDE.md

Guidance for Claude when working in this repository.

> **Repo root is `momentum-demo/`.** The parent `Momentum/` directory also holds `MOMENTUM Simulation - Prod Files/`, `old/`, loose `momentum-Simulation(N).html` exports, a `.zip`, and a `.docx` deployment guide. Those are **not** part of this git repo — do not read, edit, or stage them from here. They are historical exports; this repo is the deployed artifact.

## Commit and PR rules

**No AI attribution anywhere.** Applies to every artifact that leaves this machine:

- Never add `Co-Authored-By: Claude <noreply@anthropic.com>` or any `Co-Authored-By` trailer naming an AI tool.
- Never add "Generated with Claude Code", "Made with AI", or any similar footer, badge, or sign-off.
- Never mention Claude, Anthropic, ChatGPT, Copilot, "AI-generated", "LLM", or "assistant" as the *author* of a change — in commit messages, branch names, PR titles or descriptions, issue comments, or code comments.
- Write every commit as the repo author would. Short imperative subject, no emoji, no filler.
- **Commit language: English**, matching existing history (`Replace BOBee SVG icons with bob-bee.png`).

Exception: Claude is the product dependency here — `/api/bobby` proxies the Anthropic API. Naming the model, the SDK, or the proxy in code, README, or a commit like `Fix model ID: ...` is correct and expected. The ban is on attribution, not on the API.

## Sensitive data — never commit

Treat this repo as if it were public — the frontend genuinely is.

**Never stage:**
- `.env`, `.env.local` or any variant except `.env.example`.
- **`ANTHROPIC_API_KEY`** — the entire point of `api/bobby.js` is that the key stays server-side. It must never appear in `index.html`, in a client script, in a commit, or in a doc. Set it only in Vercel → Project → Settings → Environment Variables.
- Real customer names, logos, or data in the simulation content. This is a demo shown to prospects — every figure, name and scenario must be synthetic.
- Production dumps or exports, screenshots showing real records, or logs with real payloads.
- Internal pricing, contract terms, or prospect names in `README.md` or committed docs.

**`schema.sql` and any SQL:** schema is fine; never seed with real people or hardcode credentials.

**Rules of thumb:**
- Every example value must be obviously fake: `cliente@example.com`, `sk-ant-xxx`, `Empresa Demo`.
- Never run `git add -A` or `git add .`. Stage explicit paths so nothing rides along.
- If unsure whether a file is sensitive, do not stage it — ask first.

## Architecture

**MOMENTUM** is a business-journey observability simulation: a static frontend plus one serverless proxy, deployed on Vercel.

```
index.html        # the whole simulation (production API base injected in <head>)
api/bobby.js      # Claude proxy — holds ANTHROPIC_API_KEY server-side
vercel.json       # root rewrite + 60s function timeout + no-cache on HTML
icon/             # PNG assets
.env.example
```

### How the proxy wiring works

A script at the top of `<head>` sets `window.MOMENTUM_API_BASE = '/api'` on any non-local host, so production Claude calls resolve to `/api/bobby`. On `localhost` / `file://` it stays unset and the app falls back to the keyless sandbox path — offline preview only, never used in production.

### Conventions

- There is no build step and no framework. `index.html` is edited directly; keep it self-contained.
- Never move a Claude call to the client to simplify something. The server-side key boundary is the one invariant here.
- `vercel.json` sets a 60s function timeout and no-cache on HTML — both are deliberate.
