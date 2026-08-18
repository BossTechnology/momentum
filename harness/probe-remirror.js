/* harness/probe-remirror.js — an experiment, not a delivery.
   Attaches the real 84 MB workbook to a scratch build whose mom-core-profile
   block has been re-mirrored from api/_profile-core.js, and asks whether the
   in-page light path then produces the same schema-3 profile the server path
   does. Also applies the mining Config Doc in the correct order (industry
   first) to separate an ordering fact from a wiring fault. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TARGET = process.argv[2] || path.join(ROOT, 'out', 'momentum-S68-remirrored.html');
const DATA = '/mnt/user-data/uploads/Simulacion_flota_10_camiones_24h_por_segundo.xlsx';

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                            : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/403|Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto('file://' + TARGET, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  console.log('\ntarget: ' + path.basename(TARGET));
  ok('the re-mirrored core loads without page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  const s = await page.evaluate(() => MOMENTUM.Profile && MOMENTUM.Profile.SCHEMA);
  ok('the page now declares SCHEMA 3', s === 3, 'SCHEMA ' + s);

  console.log('\nattaching the 84 MB workbook through the light path');
  const t0 = Date.now();
  await page.setInputFiles('#dataDocFile', DATA);
  let done = false;
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(5000);
    const st = await page.evaluate(() => (document.getElementById('dataAttachStatus') || {}).textContent || '');
    if (/^Profiled/.test(st)) { done = true; break; }
    if (/Could not profile/.test(st)) { console.log('  ' + st); break; }
    if (i % 8 === 0) console.log('       … ' + st.slice(0, 70));
  }
  ok('the workbook profiles in the page', done, ((Date.now() - t0) / 1000).toFixed(0) + ' s');

  const p = await page.evaluate(() => {
    const P = MOMENTUM.Bind.active() ? MOMENTUM.Bind.profile() : null;
    if (!P) return null;
    return { schema: P.schemaVersion, rows: P.coverage.rowsProfiled, sheets: P.sheets.length,
             cycles: P.cycles && P.cycles.completed,
             gal: P.cycles && P.cycles.gallons, ton: P.cycles && P.cycles.tons,
             dims: (P.context || []).length, meas: (P.measures || []).length,
             transitions: !!P.transitions, schedules: !!P.schedules };
  });
  console.log('  profile: ' + JSON.stringify(p));
  if (p) {
    ok('the light path now writes schema 3', p.schema === 3, 'schema ' + p.schema);
    ok('the cycle model is present', p.cycles != null, String(p.cycles) + ' completed cycles');
    if (p.gal != null && p.ton != null) {
      const r = p.gal / p.ton;
      ok('the denominator law: 19,644.7 gal ÷ 123,867.3 t = 0.1586',
         Math.abs(r - 0.1586) < 0.0005,
         p.gal.toFixed(1) + ' gal ÷ ' + p.ton.toFixed(1) + ' t = ' + r.toFixed(4));
    }
  }

  /* Compare against the profile already derived from this workbook. */
  const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'p20.json'), 'utf8'));
  console.log('\n  reference p20.json: schema ' + ref.schemaVersion +
    ' · ' + (ref.coverage && ref.coverage.rowsProfiled) + ' rows' +
    ' · cycles ' + (ref.cycles && ref.cycles.completed) +
    ' · ' + (ref.cycles && ref.cycles.gallons) + ' gal / ' + (ref.cycles && ref.cycles.tons) + ' t');

  /* Config Doc in the correct order: industry applied first, then the doc. */
  console.log('\nConfig Doc, applied after the mining industry is built');
  const csv = fs.readFileSync(path.join(ROOT, 'config', 'mining-config.csv'), 'utf8');
  const rep = await page.evaluate(async (text) => {
    document.getElementById('industrySelect').value = 'mining';
    const th = document.getElementById('journeyThemeSelect');
    if (th && !th.value && th.options.length > 1) th.value = th.options[1].value;
    applyConfig();
    await new Promise(r => setTimeout(r, 2000));
    const names = (typeof KBRS !== 'undefined') ? KBRS.map(k => k.name) : [];
    const parsed = MOMENTUM.ConfigDoc.parse(text, 'mining-config.csv');
    if (!parsed.ok) return { err: parsed.reason };
    const r = MOMENTUM.ConfigApply.apply(parsed.doc, KBRS);
    return { names: names, report: r };
  }, csv);
  if (rep.err) ok('the mining document parses', false, rep.err);
  else {
    console.log('  KBRs on the board: ' + JSON.stringify(rep.names));
    console.log('  apply report: ' + JSON.stringify(rep.report).slice(0, 260));
    const r = rep.report;
    ok('the document binds to the mining results',
       (r.unmatched || []).length === 0, 'unmatched: ' + JSON.stringify(r.unmatched || []));
    ok('answers, risk touchpoints and conditions all land',
       (r.answers || 0) > 0 && (r.risk || 0) > 0 && (r.conditions || 0) > 0,
       [r.channels + ' channels', r.answers + ' answers', r.risk + ' risk',
        r.conditions + ' conditions', r.anomRules + ' rules'].join(' · '));
  }

  await page.screenshot({ path: path.join(ROOT, 'out', 'probe-board.png') });
  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  if (errors.length) console.log('page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
  process.exit(0);
})();
