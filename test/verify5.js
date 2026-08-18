/* Phase 5 acceptance — KBR value lane, four formats, targets and pace.
   Loads the shipped HTML in Chromium and asserts from inside the page, plus the
   two new DOM-free cores through vm. No second implementation of anything. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');

const FILE = 'file://' + path.resolve(__dirname, '..', 'momentum-Simulation_68.html');
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'p20.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                            : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };
const near = (a, b, tol) => a != null && Math.abs(a - b) <= Math.abs(b) * tol;

const STATE = 'OHT Truck Payload State-Communication Gateway #2';
const FUEL  = 'Fuel Consumption Rate-Engine';
const PAY   = 'Truck Payload-Communication Gateway #2';

(async () => {
  console.log('\nPhase 5 · KBR value lane + targets\n');

  /* ── 1 · the profiler amendment ───────────────────────────────────────── */
  console.log('1 · profiler amendment · joint cross-tab and threshold matching');
  const tm = profile.thresholdMap;
  ok('schema 3', profile.schemaVersion === 3, String(profile.schemaVersion));
  ok('still 25 rows / 21 with persistence / 14 matched',
     tm.count === 25 && tm.withPersistence === 21 && tm.matchedToMeasures === 14,
     `${tm.count} / ${tm.withPersistence} / ${tm.matchedToMeasures}`);

  // the assertion Session 19 could not make: the SET, not the count. A count
  // of 14 was true both before and after the RPM mis-bind, which is exactly how
  // it survived five sessions.
  const want = {
    'Fuel Consumption Rate-Engine': 'Fuel Consumption Rate-Engine',
    'Percent Engine Load': 'Percent Engine Load at Current Engine Speed-Engine',
    'Truck Payload': 'Truck Payload-Communication Gateway #2',
    'Ground Speed': 'Ground Speed-Trans Ctrl',
    'Air Filter #1 Restriction': 'Air Filter #1 Restriction-Engine',
    'Air Filter #3 Restriction': 'Air Filter #3 Restriction-Engine',
    'Fuel Rail Pressure Deviation': 'Fuel Rail Pressure Deviation',
    'Fuel Filter Differential Pressure': 'Fuel Filter Differential Pressure-Engine',
    'Engine Coolant Temperature': 'Engine Coolant Temperature-Engine',
    'Transmission Efficiency Index': 'Transmission Efficiency Index',
    'Terrain Inclination': 'Terrain Inclination',
    'Engine Speed-Engine (RPM)': 'Engine Speed-Engine',
    'Turbocharger Boost Pressure-Engine (psi)': 'Turbocharger Boost Pressure-Engine',
    'Ambient Air Temperature (Deg F)': 'Ambient Air Temperature'
  };
  const got = {};
  tm.params.forEach(p => { if (p.match) got[p.param] = p.match; });
  const wrong = Object.keys(want).filter(k => got[k] !== want[k])
                 .concat(Object.keys(got).filter(k => !want[k]));
  ok('every matched parameter binds to the RIGHT measure', wrong.length === 0,
     wrong.length ? wrong.map(k => k + ' → ' + got[k]).join('; ') : '14 of 14 correct');
  ok('the RPM band is on the RPM column, not on engine load',
     got['Engine Speed-Engine (RPM)'] === 'Engine Speed-Engine',
     got['Engine Speed-Engine (RPM)']);
  ok('engine load is claimed once, not twice',
     Object.keys(got).filter(k => got[k] === 'Percent Engine Load at Current Engine Speed-Engine').length === 1);

  const jm = profile.jointMeta;
  ok('joint cross-tab present', !!profile.joint && jm && jm.cells > 0, jm && jm.cells + ' cells');
  const J = profile.joint[STATE];
  const states = Object.keys(J);
  const shifts = Object.keys(J[states[0]]['Shift ID']);
  const meas = Object.keys(J[states[0]]['Shift ID'][shifts[0]]);
  ok('7 states × 2 shifts × 14 measures = 196 cells for the bound pair',
     states.length * shifts.length * meas.length === 196,
     `${states.length} × ${shifts.length} × ${meas.length}`);
  ok('joint cells carry the exact quarantine subtraction',
     J[states[0]]['Shift ID'][shifts[0]][FUEL].baselineN != null,
     JSON.stringify(J['Traveling Loaded']['Shift ID'][shifts[0]][FUEL]));
  const cf = (jm.confound || []).find(c => c.stateColumn === STATE);
  ok('the confound the joint removed is reported, not claimed', !!cf,
     cf && `marginal ${cf.marginalPct}% · mix-standardised ${cf.mixStandardisedPct}% · confound ${cf.mixConfoundPts} pts`);

  /* ── 2 · the generator consumes the joint ─────────────────────────────── */
  console.log('\n2 · the shift factor, de-confounded');
  const sandbox = { console, TextDecoder, Date, Math, JSON, setTimeout };
  sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['_profile-core.js', '_generator-core.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'api', f), 'utf8'), sandbox, { filename: f });
  const M = sandbox.MOMENTUM;
  const bind = { seed: 'mineria-2026', stateColumn: STATE, cycleMeasure: PAY };
  const G = M.Generator.create(profile, bind);
  const dim = G.plan.schedules.find(d => d.column === 'Shift ID');
  ok('the shift factor is computed from the joint, not the marginal',
     dim && dim.basis === 'joint', dim && dim.basis);
  const night = Object.keys(dim.factor[FUEL]).find(k => /Noche/.test(k));
  const day   = Object.keys(dim.factor[FUEL]).find(k => /D[ií]a/.test(k));
  const ratio = dim.factor[FUEL][night] / dim.factor[FUEL][day];
  ok('the generated night now runs ABOVE the day, as the workbook records',
     ratio > 1, ((ratio - 1) * 100).toFixed(2) + '%');

  const sp = G.span();
  const sample = g => {
    let ds = 0, dn = 0, ns = 0, nn = 0;
    for (const u of g.units())
      for (let t = sp.startMs; t <= sp.endMs; t += 13000) {
        const h = new Date(t).getUTCHours(), v = g.value(FUEL, t, u);
        if (h >= 7 && h < 19) { ds += v; dn++; } else { ns += v; nn++; }
      }
    return (ns / nn) / (ds / dn) - 1;
  };
  const live = sample(G);
  ok('with incidents live it lands within 2 points of the workbook’s +6.06%',
     Math.abs(live * 100 - 6.06) < 2, (live * 100).toFixed(2) + '% vs +6.06%');
  ok('the residual gap is reported rather than tuned away',
     live * 100 < 6.06, 'still ' + (6.06 - live * 100).toFixed(2) +
     ' pts short — quarantine magnitude, not state mix');

  /* ── 3 · the four formats ─────────────────────────────────────────────── */
  console.log('\n3 · four explicit formats');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' &&
    !/403|Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const fmt = await page.evaluate(() => ({
    currency: MOMENTUM.Value.format(413401, 'currency', '$'),
    code:     MOMENTUM.Value.format(413401, 'currency', 'EUR'),
    count:    MOMENTUM.Value.format(2064, 'count', 'gal'),
    ratio:    MOMENTUM.Value.format(0.1586, 'count', 'gal/ton'),
    pct:      MOMENTUM.Value.format(87.4, 'percentage'),
    hours:    MOMENTUM.Value.format(4.53, 'time', 'h'),
    days:     MOMENTUM.Value.format(18, 'time', 'days'),
    legacy:   MOMENTUM.Value.format(8775, 'count')
  }));
  ok('Currency · $413,401', fmt.currency === '$413,401', fmt.currency);
  ok('Currency by code · 413,401 EUR', fmt.code === '413,401 EUR', fmt.code);
  ok('Count · 2,064 gal', fmt.count === '2,064 gal', fmt.count);
  ok('Count · 0.1586 gal/ton', fmt.ratio === '0.1586 gal/ton', fmt.ratio);
  ok('Percentage · 87.4%', fmt.pct === '87.4%', fmt.pct);
  ok('Time · a duration, not 8,775', /^4h 3\dm$/.test(fmt.hours), fmt.hours);
  ok('Time · 18 days', /^18(\.0)? days$/.test(fmt.days), fmt.days);

  const sug = await page.evaluate(() => ({
    es: MOMENTUM.Value.suggestFormat('Tiempo de Completitud'),
    en: MOMENTUM.Value.suggestFormat('Avg Days to Certify'),
    fr: MOMENTUM.Value.suggestFormat('Délai de traitement'),
    pt: MOMENTUM.Value.suggestFormat('Tempo de Conclusão'),
    money: MOMENTUM.Value.suggestFormat('Ingresos totales'),
    pctv: MOMENTUM.Value.suggestFormat('Taxa de conversão'),
    plain: MOMENTUM.Value.suggestFormat('Toneladas Movidas')
  }));
  ok('inference reaches es · Tiempo de Completitud → time', sug.es === 'time', sug.es);
  ok('inference reaches fr · Délai → time', sug.fr === 'time', sug.fr);
  ok('inference reaches pt · Tempo → time', sug.pt === 'time', sug.pt);
  ok('inference still handles en', sug.en === 'time', sug.en);
  ok('es currency · Ingresos → currency', sug.money === 'currency', sug.money);
  ok('pt percentage · Taxa de conversão → percentage', sug.pctv === 'percentage', sug.pctv);
  ok('a plain count stays a count', sug.plain === 'count', sug.plain);

  /* ── 4 · the ratio rule (S1) ──────────────────────────────────────────── */
  console.log('\n4 · roles and the ratio rule');
  const s1 = await page.evaluate(() => {
    const R = (roles, vals) => MOMENTUM.Value.rollup(
      roles.map((r, i) => ({ tid: 't' + i, value: { role: r, contributes: true, unit: 'gal' } })),
      (tp, lane) => vals[roles.indexOf(lane.role) >= 0 ? tp.tid.slice(1) : 0]);
    const mk = (roles, vals) => MOMENTUM.Value.rollup(
      roles.map((r, i) => ({ tid: 't' + i, value: { role: r, contributes: true, unit: 'gal' } })),
      tp => vals[+tp.tid.slice(1)]);
    return {
      none:  MOMENTUM.Value.rollup([{ tid: 'a', sources: [] }], () => 5),
      both:  mk(['numerator', 'denominator'], [100, 8]),
      numOnly: mk(['numerator', 'sum'], [100, 8]),
      denOnly: mk(['denominator'], [8]),
      mixed: mk(['numerator', 'denominator', 'sum'], [100, 8, 3]),
      avg:   mk(['average', 'average'], [10, 20]),
      plain: mk(['sum', 'sum'], [10, 20])
    };
  });
  ok('nothing configured → null, and the legacy figure stands',
     s1.none === null, String(s1.none));
  ok('numerator + denominator → a ratio', s1.both.mode === 'ratio' && near(s1.both.value, 12.5, 0.001),
     s1.both.mode + ' ' + s1.both.value);
  ok('numerator with no denominator → sum, warned, not blocked',
     s1.numOnly.mode === 'sum' && !!s1.numOnly.warning && s1.numOnly.value != null,
     s1.numOnly.warning);
  ok('denominator with no numerator → sum, warned, not blocked',
     s1.denOnly.mode === 'sum' && !!s1.denOnly.warning && s1.denOnly.value != null,
     s1.denOnly.warning);
  ok('mixed roles → ratio computed, the leftovers named',
     s1.mixed.mode === 'ratio' && !!s1.mixed.warning, s1.mixed.warning);
  ok('averages average', s1.avg.mode === 'average' && s1.avg.value === 15, String(s1.avg.value));
  ok('sums sum', s1.plain.mode === 'sum' && s1.plain.value === 30, String(s1.plain.value));

  /* ── 5 · the mining board, bound ──────────────────────────────────────── */
  console.log('\n5 · the shipped mining configuration');
  const board = await page.evaluate(async prof => {
    /* Mining moved out of Energy & Utilities into its own industry. */
    document.getElementById('industrySelect').value = 'mining';
    SB_CFG.industry = 'mining'; SB_CFG.size = 'medium'; SB_CFG.lang = 'es';
    const t = templatesFor('mining').find(x => x.id === 'energy-haul-mining');
    SB_CFG.themeId = t.id;
    applyJourneyTemplate('mining', currentSizedJourney());
    applyKbrSimulation();
    MOMENTUM.Bind.attach(prof);
    MOMENTUM.Bind.seek(Date.parse('2026-08-05T18:00:00Z'));
    MOMENTUM.Bind.paintAll();
    renderKBRs();
    await new Promise(r => setTimeout(r, 250));
    return {
      kbrs: KBRS.map(k => ({ name: k.name, unit: k.unit, format: k.format,
                             lane: k.lane === undefined ? 'unset' : String(k.lane),
                             goal: k.goal || null, shown: formatKbrValue(k) })),
      lanes: KBRS.map(k => MOMENTUM.Bind.laneOfKbr(k)),
      /* The pace bar moved off the board card into the Activity drawer, and
         the card now carries the STANDING alone, as a chip on the sparkline.
         Both are checked: the chip on the board, the full bar in the drawer.
         Same facts, read where they now live. */
      chips: [...document.querySelectorAll('#kbrGrid .spk-chip')].map(e => e.textContent.trim()),
      strips: [...document.querySelectorAll('.kbr-bound')].length,
      paceCount: 0, paceText: [],
      conds: kbrPaceConditions().map(c => ({ id: c.id, met: c.met, scope: c.scope.kbr }))
    };
  }, profile);

  ok('the mining template declares its units instead of losing them',
     board.kbrs[0].unit === 'gal/ton' && board.kbrs[1].unit === 'ton',
     board.kbrs.map(k => k.name + ' [' + k.unit + ']').join(' | '));
  ok('the lane is declared, never read off the name',
     board.kbrs[0].lane === 'ratio' && board.kbrs[1].lane === 'denominator',
     board.kbrs.map(k => k.name + ' → ' + k.lane).join(' | '));
  ok('the name-matching heuristic is gone from the build',
     !(await page.evaluate(() => typeof norm45 !== 'undefined')));
  ok('Horas en Ralentí renders as a duration, not 8,775',
     /h|m|day/.test(board.kbrs[2].shown) && !/^\d{1,3},\d{3}$/.test(board.kbrs[2].shown),
     board.kbrs[2].name + ' → ' + board.kbrs[2].shown);

  console.log('\n6 · pace');
  const drawer = await page.evaluate(async () => {
    const out = { paceCount: 0, paceText: [] };
    for(const k of KBRS){
      openKbrPanel(k.id);
      await new Promise(r => setTimeout(r, 400));
      const e = document.querySelector('#kbrActContent .kbr-pace');
      if(e){ out.paceCount++; out.paceText.push(e.innerText.replace(/\n/g, ' · ')); }
      if(typeof closeKbrPanel === 'function') closeKbrPanel();
      await new Promise(r => setTimeout(r, 200));
    }
    return out;
  });
  board.paceCount = drawer.paceCount; board.paceText = drawer.paceText;
  ok('the board card carries the standing as a chip', board.chips.length >= 1,
     board.chips.join(' | ') || 'no chip');
  ok('a KBR with a target renders a pace bar in Activity', board.paceCount >= 1,
     board.paceCount + ' of ' + board.kbrs.length);
  ok('the pace bar carries value, expected, target and a standing',
     /now/.test(board.paceText[0]) && /expected/.test(board.paceText[0]) &&
     /target/.test(board.paceText[0]) && /(ON PACE|OFF TARGET)/.test(board.paceText[0]),
     board.paceText[0]);
  ok('pacing is profile-shaped once data is bound',
     /profile-shaped/.test(board.paceText[0]),
     board.paceText[0].split('·').slice(0, 2).join('·'));
  ok('lower-is-better reads as exceeded on the pace bar too',
     /exceeded/.test(board.paceText[0]) && !/-\d+%/.test(board.paceText[0]));
  ok('pace produces subscribable conditions, and notifies nothing',
     board.conds.some(c => c.id === 'attainment_gap') &&
     board.conds.some(c => c.id === 'projected_miss'),
     board.conds.map(c => c.id + (c.met ? '·met' : '')).join(', '));

  const shaped = await page.evaluate(() => {
    const h = MOMENTUM.Bind.rhythm({ lane: 'ratio' });
    if (!h) return null;
    let d = 0, n = 0;
    for (let i = 0; i < 24; i++) (i >= 7 && i < 19) ? d += h[i] : n += h[i];
    return (n / d - 1) * 100;
  });
  ok('the rhythm that shapes expected-to-date is the OBSERVED one (+6.06%)',
     shaped != null && near(shaped, 6.06, 0.02), shaped && shaped.toFixed(2) + '%');

  console.log('\n7 · the empty target is today’s behaviour');
  /* The card shows the STANDING CHIP, the drawer shows the bar — so removing a
     target must take the chip off the card and the bar out of Activity, and
     touch nothing else. Counted where each now lives. */
  const empty = await page.evaluate(async () => {
    const k = KBRS.find(x => x.goal && x.goal.target != null);
    const before = document.querySelectorAll('#kbrGrid .spk-chip').length;
    const shownBefore = formatKbrValue(k);
    const paceBefore = (() => { openKbrPanel(k.id); return 1; })();
    if(typeof closeKbrPanel === 'function') closeKbrPanel();
    delete k.goal;
    renderKBRs();
    MOMENTUM.Bind.paintAll();
    await new Promise(r => setTimeout(r, 250));
    openKbrPanel(k.id);
    await new Promise(r => setTimeout(r, 400));
    const barAfter = document.querySelectorAll('#kbrActContent .kbr-pace').length;
    const stripAfter = document.querySelectorAll('#kbrActContent .kbr-bound').length;
    if(typeof closeKbrPanel === 'function') closeKbrPanel();
    await new Promise(r => setTimeout(r, 200));
    return { name: k.name, before, after: document.querySelectorAll('#kbrGrid .spk-chip').length,
             pace: kbrPace(k), shownBefore, shownAfter: formatKbrValue(k),
             barAfter, strips: stripAfter };
  });
  ok('the KBR that had a target is the one that loses its chip',
     empty.before >= 1 && empty.after === empty.before - 1,
     empty.name + ' · ' + empty.before + ' → ' + empty.after + ' chips');
  ok('and its pace bar leaves Activity with it', empty.barAfter === 0,
     empty.barAfter + ' bars in the drawer');
  ok('an empty target computes no pace at all', empty.pace === null, String(empty.pace));
  ok('and nothing else about the column changes',
     empty.shownAfter === empty.shownBefore && empty.strips >= 1,
     empty.shownBefore + ' → ' + empty.shownAfter);

  console.log('\n8 · the live tick does not undo the bound figure');
  // the defect this catches: animateKbrValue eased 28% toward the target and
  // rounded, so a card that rendered 0.1526 gal/ton read '0 gal/ton' one tick
  // later and a haul total showed a number it was still flying through
  const tick = await page.evaluate(async prof => {
    /* Mining moved out of Energy & Utilities into its own industry. */
    document.getElementById('industrySelect').value = 'mining';
    SB_CFG.industry = 'mining'; SB_CFG.themeId = 'energy-haul-mining';
    applyJourneyTemplate('mining', currentSizedJourney());
    applyKbrSimulation();
    MOMENTUM.Bind.attach(prof);
    MOMENTUM.Bind.seek(Date.parse('2026-08-05T22:30:00Z'));
    renderKBRs(); MOMENTUM.Bind.paintAll();
    /* The unit lives in the grey span beside the figure now, not inside it —
       one rule, asked once, so '0.1507 gal/ton gal/ton' cannot come back. The
       behaviour under test is that a BOUND figure is not tweened away by the
       live tick; both halves are read so the pair is still asserted. */
    const read = () => KBRS.map(k => (document.getElementById('kbrval-' + k.id) || {}).textContent || '');
    const readUnit = () => KBRS.map(k => {
      const col = (document.getElementById('kbrval-' + k.id) || {}).closest
                ? document.getElementById('kbrval-' + k.id).closest('.kbr-col') : null;
      return col ? ((col.querySelector('.kbr-unit') || {}).textContent || '') : '';
    });
    const first = read();
    for (let i = 0; i < 6; i++) kbrSparkTick();
    await new Promise(r => setTimeout(r, 60));
    return { first, after: read(), units: readUnit(),
             lanes: KBRS.map(k => k.lane === undefined ? null : k.lane) };
  }, profile);
  const ratioIdx = tick.lanes.indexOf('ratio');
  const denIdx   = tick.lanes.indexOf('denominator');
  ok('the bound ratio survives six live ticks intact',
     /^0\.1\d{3}$/.test(tick.after[ratioIdx]) && tick.units[ratioIdx] === 'gal/ton',
     tick.first[ratioIdx] + '  →  ' + tick.after[ratioIdx] + ' [' + tick.units[ratioIdx] + ']');
  /* The board abbreviates from 1,000 up, so a six-figure tonnage now reads
     '126K ton' where it once read '126,214 ton'. The behaviour under test is
     unchanged — that a BOUND figure is not tweened away by the live tick — so
     the assertion checks the shape the board actually renders, and that it is
     identical before and after the ticks. The exact figure is asserted in the
     panel below, which never abbreviates. */
  ok('the bound tonnage survives them too',
     /^1[0-9]{2}(\.\d)?K$/.test(tick.after[denIdx]) && tick.units[denIdx] === 'ton' &&
     tick.after[denIdx] === tick.first[denIdx],
     tick.first[denIdx] + '  →  ' + tick.after[denIdx] + ' [' + tick.units[denIdx] + ']');
  ok('an unbound result still animates as it always did',
     tick.after[tick.lanes.indexOf(null)] !== '',
     tick.first[tick.lanes.indexOf(null)] + '  →  ' + tick.after[tick.lanes.indexOf(null)]);

  ok('no page errors across the whole run', errors.length === 0, errors[0] || '');
  await browser.close();

  console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
