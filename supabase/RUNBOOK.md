# Runbook: MOMENTUM Part B — Supabase enablement

**Owner:** Henry Garzón · **Frequency:** Once per environment (Preview, then Production)
**Applies to:** `bosstechnology/momentum-demo` · **Supabase project:** `brbgixwewstgsljkycsl`
**Status:** Steps 1–8 complete on Preview · rows 10, 12, 15, 16 green · rows 11, 13, 14 blocked on the workbook

---

## Purpose

Stand up the Supabase layer the simulator has never used: five base tables, a
private storage bucket, the `data_profiles` table, and the four environment
variables that let `api/profile.js` reach them.

First run completed 2026-08-19 against Preview. Two defects surfaced on that
first execution and are fixed; see the History table.
Part A is already live in production and is unaffected by every step below —
until Step 5, which is the one that changes behaviour.

---

## Prerequisites

- [ ] Supabase account with a **Pro** plan (Free cannot raise the file size limit past 50 MB)
- [ ] Access to the Vercel project `bosstechnology/momentum-demo`
- [ ] A decision on Step 0 (below)
- [ ] **BLOCKED — the 84 MB mining workbook.** Not in the repo and not on this
      machine. `config/mining-config.xlsx` is the *Config Doc* (7 KB), a
      different artifact. Without the workbook, checklist rows 11–14 cannot run.
      Ask Federico for it alongside `momentum-Simulation_19.html`.

### What can be done without the workbook

| Row | Test | Runnable now |
|---|---|---|
| 10 | SQL runs clean | ✅ |
| 11 | Bucket accepts 84 MB | ❌ needs the workbook |
| 12 | Signed upload | ✅ the handshake runs with any file; only the 84 MB case needs the workbook |
| 13 | Server profiling | ❌ needs the workbook |
| 14 | Heavy equals light | ❌ needs the workbook |
| 15 | Persistence (store / load) | ✅ using `config/data-profile-mineria-schema3.json` |
| 16 | Service key stays server-side | ✅ |

---

## Step 0: Decide where the environment variables go

**Read this before anything else — it is the only irreversible decision here.**

`/api/profile` is already deployed and publicly reachable. It has **no
authentication**: it validates the HTTP method, checks that Supabase is
configured, and dispatches on `action`. It holds the **service role key**, which
bypasses RLS entirely.

Today it is inert:

```bash
curl -s -X POST https://momentum-demo-ten.vercel.app/api/profile \
  -H "Content-Type: application/json" -d '{"action":"load","datasetId":"x"}'
# → {"error":"Supabase is not configured for this deployment."}
```

Setting the variables in **Production** is what activates it. Once active, any
anonymous caller can:

- `sign` — mint a 1-hour signed upload URL into the private bucket, at any path,
  repeatedly (unbounded storage fill on a paid plan)
- `store` — write arbitrary rows into `data_profiles`, and **overwrite** existing
  ones (the request sends `Prefer: resolution=merge-duplicates`)
- `load` — read any stored profile whose `datasetId` they can guess
- `profile` — make the function work for up to 300 s

Tightening RLS does not help: the service role ignores it. An `Origin` allowlist
does not help either — the client controls that header.

**Recommendation: set the variables on Preview only.** Everything in this runbook
can be verified against the preview URL while the public demo stays inert. Decide
the authentication story with Federico before Production. Real options are the
Vercel Firewall for a rate cap, or Supabase Auth on the front end with JWT
verification in the function — the second is a change of real size.

---

## Procedure

### Step 1: Create the Supabase project

In the Supabase dashboard: **New project**, on the **Pro** plan.

**Expected result:** project reaches "Active". Note the project ref.
**If it fails:** a project stuck provisioning past ~5 minutes is a Supabase-side
issue; do not proceed, the later steps will fail confusingly.

### Step 2: Raise the global file size limit — BY HAND

**Storage → Settings → Global file size limit.** Set it above 84 MB (512 MB
matches what the SQL asks of the bucket).

This does **not** follow the plan automatically. It is the single most commonly
missed step in this procedure.

**Expected result:** the setting shows your new value after saving.
**If it fails:** if the field is capped at 50 MB, the project is not on Pro.

> **Do this before Step 3, not after.** The global limit must be greater than or
> equal to every individual bucket limit. `phase3-data-profiles.sql` sets
> `momentum-data` to 512 MB, so running the SQL first makes Supabase reject any
> global value below 512 MB:
>
> ```
> Global limit must be greater than that of individual buckets.
> Remove or decrease the limit on momentum-data (512 MB).
> ```
>
> If you hit it, clear the bucket limit, set the global to 512 MB, then put the
> bucket limit back. The Storage settings page caches the bucket value — reload
> it before believing the error. Confirm the real state in SQL:
>
> ```sql
> select id, file_size_limit from storage.buckets where id = 'momentum-data';
> ```

> The global limit **overrides** any per-bucket limit. `phase3-data-profiles.sql`
> sets the bucket to 512 MB; on a default global limit that is silently ceilinged
> and the 84 MB upload fails with a **413 that looks like a bug in the app**.

### Step 3: Run the SQL, in this order

**Order is mandatory.** The second file alters a table the first one creates.

```
1.  supabase/session8-schema.sql        → configs · journeys · kbrs · snapshots · touchpoint_library
2.  supabase/phase3-data-profiles.sql   → bucket · data_profiles · RLS · the configs link
```

Paste each into **SQL Editor** and run. Run the first to completion before
starting the second.

**Expected result:** both complete with no error. The last statement of file 2 is
`alter table public.configs add column if not exists data_profile_id …`.

**If it fails on that last statement** with *relation "public.configs" does not
exist*: file 1 did not run, or did not finish. Run it and retry file 2.

> The line used to read `alter table public.configurations`. That table never
> existed — session 8 named it `configs` — and it blocked this work for two
> sessions. It is corrected in the file. **Do not revert it.**

### Step 4: Verify the schema before wiring anything

```sql
-- six tables expected: the five from session 8, plus data_profiles
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;

-- the link column must exist
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='configs' and column_name='data_profile_id';

-- the bucket must show the raised limit, not a ceilinged one
select id, public, file_size_limit from storage.buckets where id = 'momentum-data';
```

**Expected result:** six tables; `data_profile_id` is `text`; the bucket is
`public = false` with `file_size_limit = 536870912`.

**If the bucket limit is wrong:** the insert uses `on conflict (id) do nothing`,
so a pre-existing bucket keeps its old limit. Update it directly:

```sql
update storage.buckets set file_size_limit = 536870912 where id = 'momentum-data';
```

### Step 5: Set the four environment variables — Preview scope

**Vercel → Project → Settings → Environment Variables.** Set the scope to
**Preview** (per Step 0).

| Variable | Value | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | already set | leave alone |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Project URL |
| `SUPABASE_ANON_KEY` | the anon/publishable key | public by design |
| `SUPABASE_SERVICE_ROLE_KEY` | the **secret** key | **never** in the browser |

Use **separate values for Preview and Production** when Production is eventually
enabled, so testing against a scratch project cannot write into the one holding
real client configurations.

> **Copy the secret key, not the publishable one.** Newer projects issue opaque
> keys — `sb_secret_...` and `sb_publishable_...` — instead of the legacy `eyJ...`
> JWTs that the spec and `.env.example` used to describe. The publishable key is
> accepted everywhere but fails on write:
>
> ```
> store → 500  new row violates row-level security policy for table "data_profiles"
> ```
>
> because it resolves to `anon`, which has no INSERT policy. Confirm which key a
> request actually used from the logs, without exposing it:
>
> ```sql
> select log_attributes['request.sb.apikey.apikey.prefix'] as prefix,
>        log_attributes['response.status_code'] as status
> from logs where source = 'edge_logs' order by timestamp desc limit 5
> ```

**Expected result:** two new variables listed under Preview.
**If it fails:** `api/profile.js` returns 500 *"Supabase is not configured"* when
either `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing. The anon key is
read by the front end, not the function.

### Step 6: Redeploy the preview

Environment variables are read at deploy time. Push any commit to the branch, or
redeploy the latest preview from the Vercel dashboard.

**Expected result:** a new preview deployment reaching Ready.

### Step 7: Exercise persistence — checklist row 15

Replace `PREVIEW` with your preview URL.

```bash
PREVIEW=https://momentum-demo-git-<branch>-bosstechnology.vercel.app

# a) load a dataset that does not exist → null, not an error
curl -s -X POST "$PREVIEW/api/profile" -H "Content-Type: application/json" \
  -d '{"action":"load","datasetId":"runbook-check"}'
# expected: {"profile":null}

# b) build the request body from the reference mining profile, then post it.
#    Measured: 1,053,958 bytes — well inside Vercel's 4.5 MB request cap.
python3 -c "
import json
p = json.load(open('config/data-profile-mineria-schema3.json'))
json.dump({'action':'store','datasetId':'runbook-check','profile':p},
          open('/tmp/momentum-store.json','w'))
"
curl -s -X POST "$PREVIEW/api/profile" -H "Content-Type: application/json" \
  --data-binary @/tmp/momentum-store.json
# expected: {"stored":true,"datasetId":"runbook-check"}

# c) load it back
curl -s -X POST "$PREVIEW/api/profile" -H "Content-Type: application/json" \
  -d '{"action":"load","datasetId":"runbook-check"}' | head -c 200
# expected: JSON beginning with the profile, not null
```

**If (b) returns 500 with a Postgres error:** read the message — it is passed
through verbatim from PostgREST. A missing `data_profiles` table means Step 3
file 2 did not complete.

**If (c) returns null after (b) said stored:** check `schema_version` is an
integer in the stored row; the column is `int not null default 1`.

Clean up when done:

```sql
delete from public.data_profiles where dataset_id = 'runbook-check';
```

### Step 8: Verify the service key never reaches the browser — row 16

```bash
# the built page must not contain the key or its role name
curl -s "$PREVIEW/" | grep -c "service_role"      # expected: 0
curl -s "$PREVIEW/" | grep -c "SUPABASE_SERVICE"  # expected: 0
```

Then open the deployed page, DevTools → Network, exercise the UI, and confirm no
request carries the service role key. The only credential the browser may hold is
the anon key.

### Step 9: The rows that need the workbook — 11 to 14

Blocked until Federico supplies the 84 MB mining workbook. When it arrives:

1. Attach it in the browser on the preview URL → `sign` returns a URL, the PUT succeeds (rows 11, 12)
2. `action: profile` → 864,180 rows, schema 3, well under 300 s (row 13)
3. Compare against the in-page profile → 299 cycles, 123,867.3 t (row 14)

Note that `action: profile` **also stores** — `profileObject()` ends by calling
`storeProfile()` — so row 13 does part of row 15's work.

---

## Verification

- [x] Row 10 — both SQL files ran with no error on the final `ALTER` *(2026-08-19)*
- [ ] Row 11 — bucket accepts 84 MB, no 413 *(blocked)*
- [x] Row 12 — signed upload: `sign` returns a URL, the PUT succeeds *(2026-08-19, 64 KB test file; the 84 MB case still needs the workbook)*
- [ ] Row 13 — server profiling: 864,180 rows, schema 3, under 300 s *(blocked)*
- [ ] Row 14 — server profile matches the in-page one *(blocked)*
- [x] Row 15 — store → reload → load returns the board without re-profiling *(2026-08-19)*
- [ ] Row 16 — the service role key appears nowhere in the browser

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Upload fails with **413** | Global file size limit still at the default | Step 2 — raise it by hand in Storage → Settings. Not a bug in the app. |
| `relation "public.configs" does not exist` | `session8-schema.sql` was not run first | Run file 1 to completion, then file 2. |
| 500 *"Supabase is not configured"* | `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` missing for that environment | Step 5, then redeploy — variables are read at deploy time. |
| Profile request fails with file-not-found in the logs | `includeFiles` missing from `vercel.json` | It is present. If it were removed, the function deploys without its cores and the logs blame something else. |
| Front-end read of a data profile returns empty | `data_profiles` grants SELECT to `authenticated` only; the front end is anon | Expected (TD-33). Reads go through the function, which uses the service role. |
| `profile` response truncated or 413 from Vercel | Response body exceeds Vercel's 4.5 MB cap | The reference profile is 956 KB — about 4.7× headroom, less than the spec's "50–700 KB" suggests. Watch it as workbooks grow. |
| Anyone can write to the bucket or the table | `/api/profile` has no authentication and holds the service role | Step 0. Keep Production unconfigured until this is decided. |

---

## Rollback

Nothing in Steps 1–4 affects any running deployment; the app does not reach
Supabase until Step 5.

**To undo Step 5 (the only step that changes behaviour):** delete the four
variables in Vercel and redeploy. `/api/profile` returns to its inert 500 and the
simulator behaves exactly as it does today.

**To undo the schema:** drop the objects in reverse dependency order.

```sql
alter table public.configs drop column if exists data_profile_id;
drop table if exists public.data_profiles cascade;
delete from storage.buckets where id = 'momentum-data';  -- empty the bucket first
drop table if exists public.snapshots, public.kbrs, public.journeys,
                     public.touchpoint_library, public.configs cascade;
```

**Part A rollback**, unrelated to this runbook but worth having at hand:

```bash
vercel rollback https://momentum-demo-1g884c0p5-bosstechnology.vercel.app
```

---

## Open decisions

| # | Decision | Recommendation |
|---|---|---|
| Step 0 | Where the env vars go | Preview only, until authentication on `/api/profile` is decided |
| TD-32 | Demo RLS grants anon full read/write on all five tables, and the anon key ships to the browser | Acceptable for placeholder data. Before any real client configuration is stored, restrict writes to the service role — the front end does not need direct writes. |
| TD-33 | The two SQL files disagree on read access | Leave as-is. Nothing breaks today because reads go through the function. |

---

## Escalation

| Situation | Contact | Notes |
|---|---|---|
| Missing 84 MB workbook (blocks rows 11–14) | Federico Lara | Ask together with `momentum-Simulation_19.html` |
| A "Law" appears to be violated (page 3 of the spec) | Federico Lara | Do not "fix" it first — each was learned from a defect |
| Schema questions against BOb's live model | Federico Lara | `session8-schema.sql` header says to confirm before production use |

---

## History

| Date | Run by | Notes |
|---|---|---|
| 2026-08-19 | Henry Garzón | Rows 12 and 15 green. Two defects found on first execution and fixed: the Storage calls sent no `apikey` header, which the newer opaque keys require (`403 Invalid Compact JWS`), and `sign` posted `expiresIn` to an endpoint that does not accept it. `sign` also reported only a status code, so the first failure carried no cause; it now includes the body like `store` does. |
| 2026-08-19 | Henry Garzón | Project `brbgixwewstgsljkycsl` created. Steps 3 and 4 run against it: both SQL files applied in order, six tables present, `configs.data_profile_id` links to `data_profiles`, bucket `momentum-data` private at 512 MB, trigger and both policies in place. **Row 10 green** — the final `ALTER` succeeded. Steps 1–4 done; Step 2 (global file size limit) still pending in the dashboard. Step 5 not started: env vars are unset, so `/api/profile` remains inert. |
