/* Test fixtures — places the files the ten suites open at the paths they expect.
   Runs automatically before `npm run gate` via the pregate hook.

   The suites read four fixtures by hardcoded path. Three of them ship in the
   repo under a different name or directory, so they are copied rather than
   committed twice; all three are gitignored. The fourth, Simulation_19, is a
   prior-build baseline that is not in the repo and cannot be derived from it. */
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const r = p => path.join(ROOT, p);

// [ source in repo, path the suites open ]
const COPIES = [
  ['config/data-profile-mineria-schema3.json', 'p20.json'],
  ['config/mining-config.csv', 'test/mining-config.csv'],
  ['public/index.html', 'momentum-Simulation_68.html'],
];

// Read by verify7 (1 assertion) and identity45 (1 assertion) as the previous
// build to diff the unbound configuration against. Must be supplied.
const BASELINE = 'momentum-Simulation_19.html';

for (const [from, to] of COPIES) {
  if (!fs.existsSync(r(from))) {
    console.error(`fixtures: missing ${from}` +
      (from.startsWith('public/') ? ' — run `node build/build.js` first' : ''));
    process.exit(1);
  }
  fs.copyFileSync(r(from), r(to));
  console.log(`  ${to.padEnd(30)} ← ${from}`);
}

if (!fs.existsSync(r(BASELINE))) {
  console.log(`\n  ${BASELINE} is absent — verify7 and identity45 will not run.`);
  console.log('  It is the previous build the unbound configuration is diffed');
  console.log('  against; it is not in the repo and cannot be built from it.\n');
}
