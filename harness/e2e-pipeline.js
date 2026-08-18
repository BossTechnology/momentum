/* ═══════════════════════════════════════════════════════════════════════════
   harness/e2e-pipeline.js — the three-document pipeline, end to end, locally

   Journey Doc  → handleContextDoc      (.docx manual)
   Data Doc     → handleDataFile        (84 MB xlsx, light path, no API base)
   Config Doc   → ConfigTemplate.generate → re-attach → ConfigApply
   Board        → the locked mining figures

   Nothing here is a workaround: every step calls the shipped code the browser
   already carries. Where a step has no wiring, this says so instead of
   substituting its own.
   ═══════════════════════════════════════════════════════════════════════════ */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'momentum-Simulation_68.html');
const UP = '/mnt/user-data/uploads';
const JOURNEY = path.join(UP, 'Manual_tecnico_training_simulador_consumo_combustible__1_.docx');
const DATA = path.join(UP, 'Simulacion_flota_10_camiones_24h_por_segundo.xlsx');
const OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0, broke = [];
const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                            : (fail++, broke.push(n), console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/403|Failed to load resource|net::ERR/.test(t)) return;
    errors.push('console: ' + t);
  });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  /* ── 1 · Journey Doc ──────────────────────────────────────────────────── */
  console.log('\n1 · Journey Doc — the business narrative');
  await page.setInputFiles('#contextDocFile', JOURNEY);
  await page.waitForTimeout(2500);
  const j = await page.evaluate(() => ({
    name: SB_CFG.contextDoc && SB_CFG.contextDoc.name,
    len: (SB_CFG.contextDoc && SB_CFG.contextDoc.text || '').length,
    head: (SB_CFG.contextDoc && SB_CFG.contextDoc.text || '').slice(0, 90),
    status: (document.getElementById('docAttachStatus') || {}).textContent
  }));
  ok('the .docx is accepted by the slot', !!j.name, j.name);
  ok('readable text is extracted', j.len > 500, j.len + ' chars captured');
  ok('the text is the manual, not markup', /combustible|simulador|flota/i.test(j.head), j.head.slice(0, 60));
  console.log('       status: ' + (j.status || '').slice(0, 90));

  /* ── 2 · Data Doc ─────────────────────────────────────────────────────── */
  console.log('\n2 · Data Doc — the 84 MB telemetry workbook, no infrastructure');
  const t0 = Date.now();
  await page.setInputFiles('#dataDocFile', DATA);
  let profiled = false;
  for (let i = 0; i < 180; i++) {
    await page.waitForTimeout(5000);
    const st = await page.evaluate(() => (document.getElementById('dataAttachStatus') || {}).textContent || '');
    if (/^Profiled/.test(st)) { profiled = true; break; }
    if (/Could not profile/.test(st)) { console.log('       ' + st); break; }
    if (i % 6 === 0) console.log('       … ' + st.slice(0, 80));
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  ok('the workbook profiles in the page', profiled, secs + ' s');

  const p = await page.evaluate(() => {
    const P = MOMENTUM.Bind && MOMENTUM.Bind.active() ? MOMENTUM.Bind.profile() : null;
    return P ? { rows: P.coverage.rowsProfiled, sheets: P.sheets.length,
                 schema: P.schemaVersion, path: P.meta.path,
                 dims: (P.context || []).length, meas: (P.measures || []).length,
                 cycles: P.cycles ? P.cycles.completed : null } : null;
  });
  if (p) {
    ok('864,180 rows across 16 sheets', p.rows === 864180 && p.sheets === 16,
       p.rows.toLocaleString() + ' rows · ' + p.sheets + ' sheets');
    ok('the profile is schema 3', p.schema === 3, 'schema ' + p.schema + ' · ' + p.path + ' path');
    ok('299 completed cycles', p.cycles === 299, String(p.cycles));
    console.log('       ' + p.dims + ' dimensions · ' + p.meas + ' measures');
  } else ok('a profile is bound', false, 'nothing bound');

  /* ── 3 · Config Doc, generated ────────────────────────────────────────── */
  console.log('\n3 · Config Doc — generated from the other two');
  const csv = await page.evaluate(() => {
    const T = MOMENTUM.ConfigTemplate;
    const prof = MOMENTUM.Bind.active() ? MOMENTUM.Bind.profile() : null;
    try { return T.generate(KBRS, prof); } catch (e) { return 'ERROR: ' + e.message; }
  });
  ok('ConfigTemplate.generate() produces a document', !/^ERROR/.test(csv), csv.slice(0, 60));
  if (!/^ERROR/.test(csv)) {
    fs.writeFileSync(path.join(OUT, 'momentum-config-generated.csv'), csv);
    const lines = csv.split('\n');
    const kinds = {};
    lines.slice(1).forEach(l => { const k = l.split(',')[0]; if (k && k[0] !== '#') kinds[k] = (kinds[k] || 0) + 1; });
    ok('it proposes answers pre-filled from the real columns', (kinds.answer || 0) > 0,
       JSON.stringify(kinds));
    ok('the reference block lists the profiled columns',
       /^# dimension: /m.test(csv), lines.filter(l => /^# (dimension|measure)/.test(l)).length + ' reference lines');
  }

  /* ── 4 · Config Doc, re-attached ──────────────────────────────────────── */
  console.log('\n4 · Config Doc — attached back through the slot');
  const shipped = fs.readFileSync(path.join(ROOT, 'config', 'mining-config.csv'), 'utf8');
  fs.writeFileSync(path.join(OUT, 'mining-config.csv'), shipped);
  await page.setInputFiles('#cfgDocFile', path.join(OUT, 'mining-config.csv'));
  await page.waitForTimeout(800);
  const attached = await page.evaluate(() => ({
    status: (document.getElementById('cfgAttachStatus') || {}).textContent || '',
    stored: !!(window.SB_CFG && SB_CFG.configDoc),
    handler: String(window.handleConfigDoc).slice(0, 400)
  }));
  const wired = attached.stored || /ConfigDoc|ConfigApply|OfficeDoc/.test(attached.handler);
  ok('attaching a Config Doc parses and holds it', wired,
     wired ? '' : 'handler is the stub: "' + attached.status.slice(0, 70) + '"');

  /* Does the rest of the chain work if the document reaches it? Call the same
     modules the handler would, so the break is located precisely. */
  console.log('\n5 · the chain downstream of the slot');
  const applied = await page.evaluate((text) => {
    const CD = MOMENTUM.ConfigDoc, CA = MOMENTUM.ConfigApply;
    if (!CD || !CA) return { err: 'parser or applier missing' };
    const parsed = CD.parse(text, 'mining-config.csv');
    if (!parsed || !parsed.ok) return { err: 'parse failed: ' + (parsed && parsed.reason) };
    try {
      const r = CA.apply(parsed.doc, KBRS);
      return { ok: true, report: r };
    } catch (e) { return { err: 'apply threw: ' + e.message }; }
  }, shipped);
  ok('ConfigDoc.parse() reads the real mining document', !applied.err, applied.err || '');
  if (applied.ok) {
    const r = applied.report;
    console.log('       ' + JSON.stringify(r).slice(0, 220));
    ok('it applies channels, answers, risk and conditions',
       (r.channels || 0) > 0 && (r.conditions || 0) > 0,
       [r.channels + ' channels', r.risk + ' risk', r.conditions + ' conditions',
        (r.answers != null ? r.answers + ' answers' : '')].join(' · '));
    if (r.unbound && r.unbound.length)
      console.log('       unbound: ' + JSON.stringify(r.unbound).slice(0, 200));
  }

  /* ── 6 · the board reproducing the locked figures ─────────────────────── */
  console.log('\n6 · the locked mining figures');
  const fig = await page.evaluate(() => {
    const B = MOMENTUM.Bind;
    if (!B || !B.active()) return null;
    const P = B.profile();
    const G = MOMENTUM.Generator;
    const out = { cycles: P.cycles && P.cycles.completed,
                  gallons: P.cycles && P.cycles.gallons,
                  tons: P.cycles && P.cycles.tons };
    try { out.kpi = B.kpi(); } catch (e) { out.kpiErr = e.message; }
    return out;
  });
  if (fig) {
    console.log('       ' + JSON.stringify(fig).slice(0, 300));
    if (fig.gallons != null && fig.tons != null) {
      const ratio = fig.gallons / fig.tons;
      ok('the denominator law holds: gal ÷ ton = 0.1586',
         Math.abs(ratio - 0.1586) < 0.0005,
         fig.gallons.toFixed(1) + ' gal ÷ ' + fig.tons.toFixed(1) + ' t = ' + ratio.toFixed(4));
    }
  } else ok('the board reads from the bound profile', false, 'nothing bound');

  ok('no page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: path.join(OUT, 'e2e-board.png'), fullPage: false });
  console.log('\n──────────────────────────────────────────────');
  console.log(pass + ' passed · ' + fail + ' failed');
  if (broke.length) console.log('broken links: ' + broke.join(' | '));
  await browser.close();
  process.exit(0);
})();
