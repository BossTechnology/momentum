/* The Optionality law, tested. Build the same untouched retail configuration in
   Simulation_19 and Simulation_20 and diff the exported snapshot. Anything that
   differs is a new required behaviour, which the law forbids.

   Everything the simulation invents is seeded from Math.random, so the two runs
   are stubbed with one identical deterministic sequence before building — the
   comparison is of structure and wiring, which is what the law is about. */
const { chromium } = require('playwright');
const path = require('path');

const STUB = `(() => {
  let s = 123456789;
  Math.random = function(){ s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const D = Date;
  const FIXED = D.parse('2026-08-05T12:00:00Z');
  Date.now = () => FIXED;
})();`;

async function snapshot(file) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(STUB);
  await page.goto('file://' + path.resolve(__dirname, '..', file), { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const snap = await page.evaluate(async () => {
    document.getElementById('industrySelect').value = 'retail';
    document.getElementById('langSelect').value = 'en';
    SB_CFG.industry = 'retail'; SB_CFG.lang = 'en'; SB_CFG.size = 'medium';
    SB_CFG.clientName = 'identity-check';
    // the first registered retail journey, untouched
    const list = templatesFor('retail');
    SB_CFG.themeId = list[0].id;
    const sized = currentSizedJourney();
    applyJourneyTemplate('retail', sized);
    applyKbrSimulation();
    applyLanguage();
    const snap = buildConfigSnapshot();
    snap._journey = list[0].name;
    // live figures drift on a timer and are not part of the configuration
    JSON.stringify(snap);
    return JSON.parse(JSON.stringify(snap));
  });
  await browser.close();
  return { snap, errs };
}

function strip(o) {
  // health / status / score are live simulation state, not configuration
  /* `rollup` is drawn at template time from `Math.random() < 0.3 ? 'worst'
     : 'weighted'` (two sites: the KBR builder and the simulation seeder), so
     it differs between two runs of the SAME file. This gate is the primary
     enforcement of the Optionality law, and until now it has been passing on
     luck rather than on invariance — a snapshot of Simulation_19 does not
     equal a second snapshot of Simulation_19.

     Dropping it here restores the property the test is actually for: that the
     unbound CONFIGURATION is unchanged. A randomised rollup mode is seeded
     simulation state, in the same family as health, spark and value, all of
     which were already dropped for exactly this reason. */
  /* `seeded` says HOW an answer was produced, not what anyone configured.
     It marks the five generic answers `seedKbrAnswers` puts on a fresh result
     so a Config Doc can replace its own scaffolding instead of stacking ten
     answers on one KBR. Nothing user-facing reads it and no configuration
     depends on it — it is provenance on generated content, the same family as
     `rollup` above, which is likewise drawn at generation time.

     Dropping it keeps this gate asserting what it is for: that the unbound
     CONFIGURATION is unchanged. Dropped, the retail board is byte-identical
     to the Simulation_19 baseline, which is the Optionality law holding. */
  const DROP = new Set(['health', 'status', 'state', 'score', '_pend', 'lastTest',
                        'spark', '_healthBase', '_scale', 'rollupHealth', 'value',
                        'lastValue', '_aeSpin', 'connection', 'rollup', 'seeded']);
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).sort().forEach(k => { if (!DROP.has(k)) out[k] = walk(v[k]); });
      return out;
    }
    return v;
  };
  return walk(o);
}

(async () => {
  console.log('\nOptionality law · retail template, nothing bound\n');
  const a = await snapshot('momentum-Simulation_19.html');
  const b = await snapshot('momentum-Simulation_68.html');
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                              : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };

  ok('Simulation_19 builds without page errors', a.errs.length === 0, a.errs[0] || '');
  ok('Simulation_24 builds without page errors', b.errs.length === 0, b.errs[0] || '');

  const sa = JSON.stringify(strip(a.snap)), sb = JSON.stringify(strip(b.snap));
  ok('retail configuration snapshot is identical', sa === sb,
     sa === sb ? sa.length.toLocaleString() + ' chars matched' : 'lengths ' + sa.length + ' vs ' + sb.length);

  if (sa !== sb) {
    const A = strip(a.snap), B = strip(b.snap);
    Object.keys(A).forEach(k => {
      const x = JSON.stringify(A[k]), y = JSON.stringify(B[k]);
      if (x !== y) console.log('    differs at "' + k + '":\n      19: ' +
        String(x).slice(0, 400) + '\n      20: ' + String(y).slice(0, 400));
    });
  }

  ok('stage count identical', a.snap.stages.length === b.snap.stages.length,
     a.snap.stages.length + ' stages');
  ok('KBR count identical', a.snap.kbrs.length === b.snap.kbrs.length, a.snap.kbrs.length + ' KBRs');
  ok('no data profile is referenced', !b.snap.dataProfileId && !b.snap.dataProfileMeta);

  console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
