# MOMENTUM — deployable repo

Business-journey observability simulation · Boss.Technology

## The one structural change

`index.html` is **generated**, not edited. It does not exist in the repo.

    src/shell.html   everything that is not a mirrored module, with <!--mom:inject id--> slots
    api/*.js         the modules, single source of truth
    build/build.js   shell + modules -> public/index.html

The mirroring law used to be a discipline: edit `api/`, remember to paste the
same text into the `<script id="mom-*">` block. Session 68 shipped with five of
fifteen modules out of sync, one of them by 582 lines and two schema versions,
and 407 assertions did not see it. Making the browser file a build artifact
turns that class of bug into an impossibility — there is nothing to forget,
because the file the browser loads is produced from the modules every time.

    node build/build.js              # -> public/index.html
    node build/check.js <ref.html>   # CI: rebuild must equal reference
    node build/extract.js <in.html>  # one-time reconciliation, already run

## Layout

    api/
      bobby.mjs                 Claude proxy (ESM — .mjs so it can coexist with CJS)
      profile.js                heavy ingest: sign / profile / store / load (CJS)
      _*.js                     11 cores, shared verbatim by the build AND profile.js
      phase*.js                 4 UI modules, build only
    src/
      shell.html                the page, minus the modules
      boot.js                   sets MOMENTUM_API_BASE — see below
    build/                      build.js, check.js, extract.js, modules.json
    config/                     mining + demo Config Docs, derived profile (schema 3)
    supabase/                   phase3-data-profiles.sql
    test/                       the eight suites
    harness/                    profile-local.js, mirror-check.js, e2e-pipeline.js
    public/                     GENERATED — gitignored

## Why boot.js matters

`window.MOMENTUM_API_BASE` is the single switch between the offline demo and
the deployed app: it gates the heavy ingest path, profile persistence and
BOBee. `src/boot.js` sets it to `/api` only when the page is served over
http(s). Opened from disk it stays undefined, so every suite keeps running
exactly as written and `identity45` still holds byte-identity against
Simulation_19.

Verified: the generated build passes `identity45` (6) and `verify7` (99).

## Deploy

    vercel link
    vercel env add ANTHROPIC_API_KEY
    vercel env add SUPABASE_URL
    vercel env add SUPABASE_ANON_KEY
    vercel env add SUPABASE_SERVICE_ROLE_KEY
    vercel --prod

`vercel.json` sets `buildCommand` to the build script and `outputDirectory` to
`public/`, so the deployed `index.html` is always freshly generated from `api/`.

`includeFiles: "api/_*.js"` is required. `api/profile.js` loads its cores with
`fs.readFileSync(path.join(__dirname, f))` from an array, which Vercel's
dependency tracer cannot follow — without it the function deploys without the
cores and every profile request fails at runtime.

## Plan requirements

**Vercel Pro.** Not for the timeout — with Fluid Compute even Hobby now allows
300 s — but because Hobby is non-commercial only.

**Supabase Pro.** Free projects cap the global file size limit at 50 MB and the
global limit overrides the bucket limit, so `phase3-data-profiles.sql`'s 512 MB
bucket cap is silently ceilinged and the 84 MB workbook 413s on upload. After
upgrading, raise Storage Settings -> Global file size limit by hand.

`phase3-data-profiles.sql` ends with `alter table public.configurations`, which
is NOT created in that file. Apply the session-8 scaffold first or that
statement errors.

## Standing rules

- Run the eight suites and report before writing code (`npm run gate`)
- Playwright render-and-verify with screenshot inspection before visual sign-off
- Surface blocking issues with options rather than working around them
- The denominator law: gal/ton is gallons / tons, never bent to meet a target
- The one-notifier law: only the Risk Meter escalates
- The Optionality law: nothing bound means nothing changes
- No UI state inside configuration objects
- Never redraw from a text field's own handler
