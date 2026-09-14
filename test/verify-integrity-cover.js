/* ═══════════════════════════════════════════════════════════════════════════
   test/verify-integrity-cover.js — the exclusion list cannot fall behind

   THE SHAPE THIS EXISTS TO STOP. Three times a list of what to INCLUDE went
   stale and hid a real file from the register:
     api/bobby.mjs      the extension whitelist listed .js, the file is .mjs
     .github/           the directory list did not name it
     pnpm-lock.yaml     the root-file list named package-lock.json instead

   Session 9 inverted the rule: every root file is covered unless deliberately
   excluded. That was right. What was still wrong is that the EXCLUDE list was
   written BY HAND, which is a whitelist wearing different clothes — and it
   promptly went stale. The developer found .DS_Store on a working copy, and it
   could only be found there: .DS_Store is gitignored, so it can never appear in
   a `git archive` tree, which is exactly how the merge was verified here.
   Reconstruction structurally could not see it.

   Cross-checking .gitignore afterwards turned up two more of the same gap —
   .env.local and .env*.local — neither of which had bitten yet. out/ was
   listed alongside them in the first version of this package and was NOT a
   gap: the root scan is `-maxdepth 1 -type f`, so a directory can never match
   it. That claim sat in integrity.sh, a file the register covers, which makes
   it a false reason in a registered file rather than a harmless slip.

   So the list is no longer allowed to drift on its own. .gitignore is where the
   project already declares what is generated; this suite asserts that every
   root-level file pattern there IS EXCLUDED by integrity.sh — unconditionally,
   not "or absent from the tree". The first draft had the "or absent" clause
   and this header still described it one revision after the code was tightened;
   a comment claiming behaviour the code does not have is the same defect as a
   refusal with a false reason, and it is the third time in this project that a
   comment has outlived the line it described.

   When someone adds the next generated artifact, this FAILS rather than raising
   a false incident on a colleague's machine.

   What is NOT asserted: that .gitignore and EXCLUDE are identical. They should
   not be. A stray package-lock.json is gitignored in spirit but deliberately
   NOT excluded — its presence means npm was run in a pnpm repo and the
   register should say so. Directory patterns are irrelevant because the root
   scan is `-type f`. Patterns containing a slash name files inside scanned
   directories, which are covered on purpose.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  · ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  · ' + detail : '')); }
};

console.log('\nIntegrity coverage · the exclusion list cannot fall behind\n');

/* ── read the live EXCLUDE patterns out of integrity.sh, not a copy ──────── */
const shSrc = fs.readFileSync(path.join(ROOT, 'integrity.sh'), 'utf8');
const mRoot = shSrc.match(/^EXCLUDE_ROOT='([^']+)'/m);
const mAny  = shSrc.match(/^EXCLUDE_ANY='([^']+)'/m);
ok('integrity.sh declares a root exclusion pattern', !!mRoot);
ok('integrity.sh declares a depth-independent exclusion pattern', !!mAny);
if (!mRoot || !mAny) { console.log('\n' + pass + ' passed · ' + fail + ' failed\n'); process.exit(1); }
const EXCLUDE_ROOT = new RegExp(mRoot[1]);
const EXCLUDE_ANY  = new RegExp(mAny[1]);
/* A path is excluded if either pattern covers it, which is how integrity.sh
   composes them. */
const EXCLUDE = { test: p => EXCLUDE_ROOT.test(p) || EXCLUDE_ANY.test(p) };

/* ── the root-level FILE patterns .gitignore declares ────────────────────── */
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  .split('\n').map(s => s.trim())
  .filter(s => s && s[0] !== '#' && s[0] !== '!');

/* A LEADING slash is how .gitignore says "root only" — it does not mean the
   pattern names a file inside a scanned directory. The first version of this
   filter dropped anything containing a slash, so "/debug.log" was skipped
   entirely and a root debug.log was hashed with the suite reporting a clean
   pass. That is precisely the drift this suite exists to catch, walking past
   it. Strip a leading slash first, then apply the slash test. */
const rootFilePatterns = gi
  .map(p => (p[0] === '/' ? p.slice(1) : p))
  .filter(p =>
    p.slice(-1) !== '/' &&          // a directory: the root scan is -type f
    p.indexOf('/') === -1);         // a real path: names a file in a scanned dir

ok('.gitignore declares root-level file patterns to check',
   rootFilePatterns.length > 0, rootFilePatterns.join(', '));

/* Turn a glob into one concrete filename it would match, so the pattern can be
   tested against the EXCLUDE regex the way a real file would be. */
const sample = p => p.replace(/\*/g, 'x');

/* Asserted UNCONDITIONALLY, not "excluded or absent". An "or absent" clause
   would only fail on the machine that happens to have the file — which is the
   same weakness that let the spring-forward defect through a suite listing
   Europe/Madrid while testing only August dates. A pattern .gitignore declares
   as generated must be excluded whether or not anyone has produced one yet.
   Nothing in .gitignore's root-level file list should ever be hashed; a stray
   package-lock.json is the case that must still be reported, and it is
   deliberately NOT in .gitignore. */
for (const p of rootFilePatterns) {
  const f = sample(p);
  const excluded = EXCLUDE.test('./' + f);
  const present = fs.existsSync(path.join(ROOT, f));
  ok('"' + p + '" is excluded from the register',
     excluded,
     excluded ? (present ? 'excluded, and present in this tree' : 'excluded')
              : 'NOT excluded — a tree containing one raises a false incident');
}

/* ── the exclusions must actually work on the live tree ──────────────────── */
console.log('\nexclusions hold against the tree as it stands');
const rootFiles = fs.readdirSync(ROOT)
  .filter(f => { try { return fs.statSync(path.join(ROOT, f)).isFile(); } catch (e) { return false; } });

const baseline = fs.readFileSync(path.join(ROOT, '.integrity-baseline'), 'utf8')
  .split('\n').filter(Boolean).map(l => l.replace(/^\S+\s+/, ''));

/* ONE assertion, not one per file that happens to exist. The first version
   looped and emitted an assertion per excluded root file present, which made
   the suite total depend on the machine: 26 standalone, 33 inside the gate
   because the visual suites write seven screenshots first, 34 on a Mac with a
   real .DS_Store. The gate total is the number a merge is checked against —
   after the verify-mining indentation incident it is the number the developer
   was told to rely on — so a total that varies by machine destroys the check
   it was supposed to support. Found by the developer. The names still appear
   in the detail line, so nothing is lost diagnostically. */
const leaked = rootFiles.filter(f => EXCLUDE.test('./' + f) && baseline.indexOf(f) > -1);
ok('every excluded root file is absent from the baseline',
   leaked.length === 0,
   leaked.length ? 'LEAKED: ' + leaked.join(', ')
                 : rootFiles.filter(f => EXCLUDE.test('./' + f)).length +
                   ' excluded file(s) present, none hashed');

/* ── and the things that must NOT be excluded, are not ───────────────────── */
console.log('\nsource files are still covered');
for (const f of ['integrity.sh', 'package.json', 'vercel.json', 'README.md',
                 'CLAUDE.md', '.gitignore', '.env.example'])
  ok('"' + f + '" is covered, not excluded', !EXCLUDE.test('./' + f));

ok('pnpm-lock.yaml is covered', !EXCLUDE.test('./pnpm-lock.yaml') &&
   baseline.indexOf('pnpm-lock.yaml') > -1,
   'the miss that prompted the inversion');
ok('api/bobby.mjs is covered', baseline.indexOf('api/bobby.mjs') > -1,
   'the miss that prompted dropping the extension filter');
ok('.github/dependabot.yml is covered', baseline.indexOf('.github/dependabot.yml') > -1,
   'the miss that prompted adding the directory');

/* A stray package-lock.json is gitignored in spirit but must NOT be excluded:
   it means npm was run in a pnpm repo, and the register should say so. */
ok('a stray package-lock.json would still be reported',
   !EXCLUDE.test('./package-lock.json'),
   'npm run in a pnpm repo is worth an alarm, not an exclusion');

/* ── the specific file the developer found ───────────────────────────────── */
console.log('\nthe .DS_Store case');
ok('a root .DS_Store is excluded', EXCLUDE.test('./.DS_Store'),
   'gitignored, so it can never appear in a git archive reconstruction');
ok('.DS_Store is declared in .gitignore', gi.indexOf('.DS_Store') > -1);
/* This assertion is INVERTED from its first version, which asserted that a
   .DS_Store inside a scanned directory stays covered — and called that
   correct. It is not. A .gitignore pattern with no slash matches at every
   depth (`git check-ignore` confirms src/.DS_Store is ignored by the bare
   line), and Finder writes one into every folder it opens, so root-anchoring
   only moved the false incident one level down. The first version encoded the
   defect as a feature and asserted it. */
for (const p of ['./src/.DS_Store', './api/.DS_Store', './test/fixtures/.DS_Store'])
  ok('"' + p + '" is excluded at depth, not only at the root', EXCLUDE.test(p),
     'Finder writes one per folder it opens');
/* But depth-independence is for .DS_Store ALONE. A secret or a build artifact
   appearing inside a scanned directory should raise an alarm, not be waved
   through, so everything else stays anchored to the root. */
for (const p of ['./api/.env', './src/p20.json', './test/shot-x.png'])
  ok('"' + p + '" is still covered at depth', !EXCLUDE.test(p),
     'only .DS_Store is depth-independent');

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
