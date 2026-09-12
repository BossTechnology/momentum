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

   Cross-checking .gitignore afterwards turned up three more of the same gap —
   .env.local, .env*.local, out/ — none of which had bitten yet.

   So the list is no longer allowed to drift on its own. .gitignore is where the
   project already declares what is generated; this suite asserts that every
   ROOT-LEVEL file pattern there is either excluded by integrity.sh or absent
   from the tree. When someone adds the next generated artifact, this FAILS
   rather than raising a false incident on a colleague's machine.

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

/* ── read the live EXCLUDE out of integrity.sh, not a copy of it ─────────── */
const shSrc = fs.readFileSync(path.join(ROOT, 'integrity.sh'), 'utf8');
const m = shSrc.match(/^EXCLUDE='([^']+)'/m);
ok('integrity.sh declares an EXCLUDE pattern', !!m);
if (!m) { console.log('\n' + pass + ' passed · ' + fail + ' failed\n'); process.exit(1); }
const EXCLUDE = new RegExp(m[1]);

/* ── the root-level FILE patterns .gitignore declares ────────────────────── */
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  .split('\n').map(s => s.trim())
  .filter(s => s && s[0] !== '#' && s[0] !== '!');

const rootFilePatterns = gi.filter(p =>
  p.slice(-1) !== '/' &&          // a directory: the root scan is -type f
  p.indexOf('/') === -1);         // contains a slash: names a file in a scanned dir

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

for (const f of rootFiles) {
  if (!EXCLUDE.test('./' + f)) continue;
  ok('excluded "' + f + '" is absent from the baseline',
     baseline.indexOf(f) === -1);
}

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
ok('a .DS_Store inside a scanned directory is still covered',
   !EXCLUDE.test('./src/.DS_Store'),
   'the exclusion is anchored to the root only');

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
