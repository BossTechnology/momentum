# CLAUDE.md

Guidance for Claude when working in this repository.

> **Repo root is `momentum-demo/`.** The parent `Momentum/` directory also holds `MOMENTUM Simulation - Prod Files/` (the current handoff: spec, repo zip, reference build), `Backup/` (superseded exports), and loose `.zip` / `.docx` files. Those are **not** part of this git repo — do not read, edit, or stage them from here. They are handoff material; this repo is the deployed artifact.

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
- **`ANTHROPIC_API_KEY`** — the entire point of `api/bobby.mjs` is that the key stays server-side. It must never appear in `src/shell.html`, in a module, in a commit, or in a doc. Set it only in Vercel → Project → Settings → Environment Variables.
- **`SUPABASE_SERVICE_ROLE_KEY`** — same rule, and it is the only credential that can write to the `momentum-data` bucket and the `data_profiles` table. Server-side only; use separate values for Preview and Production.
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
src/shell.html     # the page, minus the modules, with <!--mom:inject id--> slots
src/boot.js        # sets MOMENTUM_API_BASE on non-local hosts
api/_*.js          # the 15 browser modules — single source of truth
api/bobby.mjs      # Claude proxy — holds ANTHROPIC_API_KEY server-side
api/profile.js     # heavy ingest: sign / profile / store / load (Supabase)
build/build.js     # shell + modules → public/index.html
build/check.js     # CI drift gate: a rebuild must equal the reference
build/fixtures.js  # places test fixtures; runs from the pregate hook
build/modules.json # module → script-id map
build/configs.json # industry → Config Doc map; the build generates DEMO_CONFIG from these
config/            # seven industry Config Docs + the derived mining profile
supabase/          # session8-schema.sql, THEN phase3-data-profiles.sql
test/              # the ten suites
public/            # GENERATED — gitignored, never committed, never hand-edited
icon/              # PNG assets — see the note below
vercel.json        # install/build commands, function config, no-cache on HTML
.env.example
```

### index.html is generated

`index.html` does not exist in this repo. `build/build.js` inlines the 15 modules in `api/` into `src/shell.html` and writes `public/index.html`.

**Editing `public/index.html` does nothing.** The next build overwrites it, with no error and no warning. Edit `src/shell.html` or the module in `api/` instead. Session 68 shipped with five of fifteen modules out of sync — one by 582 lines — and 407 assertions did not catch it. `verify-mirror` exists so that cannot recur.

### How the proxy wiring works

`src/boot.js` sets `window.MOMENTUM_API_BASE = '/api'` on any non-local host, so production Claude calls resolve to `/api/bobby`. On `localhost` / `file://` it stays unset and the app falls back to the keyless sandbox path — offline preview only, never used in production. The test suites rely on this: they load the build over `file://` and must never touch the network.

### Conventions

- **Run `npm run gate` before and after any change.** Ten suites. The suites need Playwright with Chromium and nothing else — no keys, no network, no Supabase — so a failure is a real failure.
- **A file under `api/` becomes a public serverless function unless its name starts with `_`.** That is why the cores and the UI modules are `_`-prefixed: they are build inputs, not endpoints.
- Never move a Claude call to the client to simplify something. The server-side key boundary is the one invariant here.
- `vercel.json` is deliberate throughout: `installCommand` omits devDependencies so a deploy never downloads Chromium; `includeFiles` on `api/profile.js` is required because Vercel's tracer cannot follow its dynamic `readFileSync` path; the 60s and 300s timeouts and the no-cache on HTML are all intentional.
- `icon/` is orphaned by this build — BOBee's imagery is inlined as data URIs and the page requests nothing from that folder. It is still required by the `index.html` currently in production, so it stays until this work is promoted.
