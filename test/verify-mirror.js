/* ═══════════════════════════════════════════════════════════════════════════
   verify-mirror — the gate that was missing.

   Session 68 shipped with five of fifteen modules out of sync with api/, one
   of them by 582 lines and two profile schema versions, and 407 assertions did
   not see it. They could not: every suite loads its profile from p20.json, a
   file derived in an earlier session, so nothing ever asserted on what the
   IN-PAGE profiler produces.

   This closes both halves of that hole:

     1 · structural — every <script id="mom-*"> block is byte-identical to the
         api/ file it carries. With a generated build this is a tautology, and
         that is the point: it fails loudly the day someone hand-edits output.

     2 · functional — the cores the BROWSER runs, driven with a small synthetic
         dataset, produce a schema-3 profile with the rollups, schedules and
         transitions the generator depends on. No 84 MB workbook, no network.
   ═══════════════════════════════════════════════════════════════════════════ */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.resolve(ROOT, 'momentum-Simulation_68.html');
const html = fs.readFileSync(path.resolve(ROOT, 'momentum-Simulation_68.html'), 'utf8');

const MAP = {
  '_profile-core.js': 'mom-core-profile',
  '_ingest-core.js': 'mom-core-ingest',
  '_generator-core.js': 'mom-core-generator',
  '_risk-core.js': 'mom-core-risk',
  '_answer-core.js': 'mom-answer-core',
  '_channels-core.js': 'mom-channels-core',
  '_risklog-core.js': 'mom-risklog-core',
  '_configdoc-core.js': 'mom-configdoc-core',
  '_configapply-core.js': 'mom-configapply-core',
  '_configtemplate-core.js': 'mom-configtemplate-core',
  '_officedoc-core.js': 'mom-officedoc-core',
  '_phase16-anomalies-ui.js': 'mom-anomalies-ui',
  '_phase17-header.js': 'mom-header-global',
  '_phase7-answer-ui.js': 'mom-phase7-ui',
  '_phase9-channels-ui.js': 'mom-channels-ui',
};

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                            : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };
const sha = s => crypto.createHash('sha1').update(s.replace(/\r\n/g, '\n').trim()).digest('hex');

/* A tiny haul cycle, written as the workbook writes one: a payload that rises
   on load and falls on dump, a state column that walks the cycle, and a fuel
   rate to integrate. Three trucks, two shifts, enough to exercise the model
   without a single megabyte. */
function syntheticCsv() {
  const head = ['Timestamp', 'Unit ID', 'Shift ID', 'Road Condition',
                'OHT Truck Payload State', 'Truck Payload', 'Fuel Consumption Rate'];
  const rows = [head.join(',')];
  const states = ['Traveling Empty', 'Loading', 'Traveling Loaded', 'Stopped Loaded', 'Dumping'];
  const loads = [0, 0, 200, 200, 0];
  let t = Date.parse('2026-08-05T00:00:00Z');
  ['HT-001', 'HT-002', 'HT-003'].forEach((unit, u) => {
    for (let cyc = 0; cyc < 6; cyc++) {
      const shift = cyc < 3 ? 'Dia' : 'Noche';
      states.forEach((st, i) => {
        for (let k = 0; k < 4; k++) {
          t += 60000;
          rows.push([new Date(t).toISOString(), unit, shift, 'Buena', st,
                     loads[i], (30 + u * 5 + i * 3)].join(','));
        }
      });
    }
  });
  return rows.join('\n');
}

(async () => {
  console.log('\nverify-mirror · api/ and the build cannot disagree\n');
  console.log('1 · structural — every module block matches its api/ file');

  let drift = [];
  Object.keys(MAP).forEach(file => {
    const id = MAP[file];
    const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>'));
    const apiPath = path.join(ROOT, 'api', file);
    if (!m) { drift.push(id + ' (no block)'); return; }
    if (!fs.existsSync(apiPath)) { drift.push(file + ' (no api file)'); return; }
    const a = fs.readFileSync(apiPath, 'utf8');
    if (sha(a) !== sha(m[1])) {
      const al = a.replace(/\r\n/g, '\n').trim().split('\n').length;
      const bl = m[1].replace(/\r\n/g, '\n').trim().split('\n').length;
      drift.push(file + ' (api ' + al + ' / build ' + bl + ')');
    }
  });
  ok('all ' + Object.keys(MAP).length + ' modules are mirrored verbatim',
     drift.length === 0, drift.join(', '));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/403|Failed to load resource|net::ERR/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  console.log('\n2 · the profiler the browser actually runs');
  const schema = await page.evaluate(() => MOMENTUM.Profile && MOMENTUM.Profile.SCHEMA);
  ok('the in-page profile core declares SCHEMA 3', schema === 3, 'SCHEMA ' + schema);

  console.log('\n3 · a profile built by the in-page cores, from synthetic rows');
  const p = await page.evaluate((csv) => {
    const M = window.MOMENTUM;
    const acc = M.Profile.create({ datasetId: 'ds_mirror', sourceName: 'synthetic.csv',
                                   sizeBytes: csv.length, path: 'light', sourceType: 'csv' });
    const sc = M.Ingest.createCsvScanner({ onRow: cells => acc.feed('synthetic', cells) });
    sc.push(csv); sc.end();
    acc.endSheet('synthetic');
    const prof = acc.finalize();
    return {
      schemaVersion: prof.schemaVersion,
      hasRollups: !!prof.rollups,
      hasCycleModel: !!(prof.rollups && prof.rollups.cycleModel),
      hasTransitions: !!(prof.rollups && prof.rollups.transitions),
      hasPerUnit: !!(prof.rollups && prof.rollups.perUnit),
      hasSchedules: !!prof.schedules,
      dims: (prof.context || []).length,
      measures: (prof.measures || []).length,
      rows: prof.coverage && prof.coverage.rowsProfiled
    };
  }, syntheticCsv());

  console.log('       ' + JSON.stringify(p));
  ok('the profile it writes is schema 3', p.schemaVersion === 3, 'schema ' + p.schemaVersion);
  ok('it carries rollups', p.hasRollups);
  ok('it carries a cycle model', p.hasCycleModel);
  ok('it carries transitions', p.hasTransitions);
  ok('it carries per-unit integration', p.hasPerUnit);
  ok('it carries schedules', p.hasSchedules);
  ok('it found the context columns', p.dims >= 3, p.dims + ' dimensions');
  ok('it found the measures', p.measures >= 2, p.measures + ' measures');
  ok('it profiled every row', p.rows === 360, String(p.rows));

  console.log('\n4 · the page');
  ok('no page errors across the whole run', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
