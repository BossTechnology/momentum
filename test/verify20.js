/* Phase 4 render-and-verify. Loads the shipped HTML in Chromium, binds the real
   profiled workbook, and asserts the binding from inside the page. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const FILE = 'file://' + path.resolve(__dirname, '..', 'momentum-Simulation_68.html');
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'p20.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                            : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // CDN fetches are blocked in the sandbox and 403 by design — not page errors
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/403|Failed to load resource|net::ERR/.test(t)) return;
    errors.push('console: ' + t);
  });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  console.log('\nPhase 4 · render-and-verify\n');
  console.log('1 · unbound page (the Optionality law)');
  const pre = await page.evaluate(() => ({
    cores: ['mom-core-profile','mom-core-ingest','mom-core-generator','mom-bind']
             .map(id => !!document.getElementById(id)),
    gen: typeof MOMENTUM.Generator,
    bind: typeof MOMENTUM.Bind,
    active: MOMENTUM.Bind.active(),
    now: MOMENTUM.Bind.now(),
    kpi: MOMENTUM.Bind.kpi(),
    share: MOMENTUM.Bind.stateShare(),
    incidents: MOMENTUM.Bind.incidentsIn().length,
    types: SOURCE_TYPE_ORDER.slice(),
    legacyTypes: SOURCE_TYPE_ORDER.slice(0, 6).join(','),
    rangeKeys: Object.keys(RANGE_MODE),
    mult: Object.values(RANGE_MODE).some(r => 'mult' in r),
    hours: RANGE_MODE.week.hours,
  }));
  ok('all four cores are addressable in the document', pre.cores.every(Boolean), pre.cores.join(','));
  ok('MOMENTUM.Generator present', pre.gen === 'object');
  ok('MOMENTUM.Bind present', pre.bind === 'object');
  ok('nothing bound → Bind.active() is false', pre.active === false);
  ok('nothing bound → now/kpi/stateShare all null', pre.now === null && pre.kpi === null && pre.share === null);
  ok('nothing bound → no incidents', pre.incidents === 0);
  ok('legacy source types unchanged and still first',
     pre.legacyTypes === 'observability,rest,sql,graphql,synthetic,historian', pre.legacyTypes);
  ok('the bound-profile type is appended, not inserted',
     pre.types[6] === 'profile' && pre.types.length === 7);
  ok('the mult constants are retired', pre.mult === false);
  ok('ranges carry real hours instead', pre.hours === 168, pre.hours + ' h for a week');
  ok('no page errors on load', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n2 · applying an untouched template with nothing bound');
  const legacy = await page.evaluate(() => {
    const before = [];
    for (const k of Object.keys(RANGE_MODE)) { onTimeChange(k); before.push(currentTimeRange); }
    onTimeChange('now');
    return { ranges: before, err: null };
  }).catch(e => ({ err: String(e) }));
  ok('every header range still applies without a profile', !legacy.err, legacy.err || legacy.ranges.join(','));
  ok('still no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n3 · binding the real profiled workbook');
  await page.evaluate(p => { window.__p = p; MOMENTUM.Data.profile = p; }, profile);
  await page.waitForTimeout(300);
  const post = await page.evaluate(() => {
    const g = MOMENTUM.Bind.generator();
    return {
      active: MOMENTUM.Bind.active(),
      stateColumn: g.plan.stateColumn,
      source: g.plan.stateColumnSource,
      reason: MOMENTUM.Bind.binding().stateColumnReason,
      ranked: g.plan.stateColumnRanked,
      states: g.stateNames(),
      units: g.units().length,
      cycleMeasure: g.plan.cycleMeasure,
      terminal: g.plan.terminalState,
      scheduled: g.plan.scheduledCases,
      context: g.plan.contextCases,
      metrics: g.metrics().length,
      platforms: SOURCE_TYPES.profile.platforms.slice(0, 2),
      panel: !!document.getElementById('bindPanel'),
      panelText: (document.getElementById('bindPanel') || {}).textContent || '',
    };
  });
  ok('binding is active', post.active);
  ok('journey partition bound to the truck-state column',
     post.stateColumn === 'OHT Truck Payload State-Communication Gateway #2', post.stateColumn);
  ok('recorded as an explicit binding, not re-derived each build',
     post.source === 'bound', post.source);
  ok('and the reason is recorded: cycle-terminal evidence beat the variance ranking',
     post.reason === 'cycle-terminal' && post.ranked !== post.stateColumn,
     'ranking said ' + post.ranked);
  ok('the haul cycle is in the order the data recorded',
     post.states.join(' → ').startsWith('Stopped Empty → Loading → Fully Loaded → Traveling Loaded'),
     post.states.join(' → '));
  ok('10 units bound', post.units === 10);
  ok('cycle carrier and terminal event bound',
     post.cycleMeasure === 'Truck Payload-Communication Gateway #2' && post.terminal === 'Dumping',
     post.cycleMeasure + ' @ ' + post.terminal);
  ok('10 control cases carried', post.scheduled + post.context === 10,
     post.scheduled + ' scheduled · ' + post.context + ' context-conditional');
  ok('profile measures become the source-type metric list',
     post.platforms[0] === 'Fuel Consumption Rate-Engine', post.platforms.join(' | '));
  ok('binding panel rendered and states the decision', post.panel &&
     /Journey partition/.test(post.panelText) && /cycle-terminal/.test(post.panelText));
  ok('no page errors after binding', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n4 · a bound source grades itself from the generator');
  const srcTest = await page.evaluate(() => {
    const src = { sid: 'srcX', type: 'profile', platform: 'Fuel Consumption Rate-Engine',
      binding: { unit: 'HT-001' }, status: 'green',
      thresholds: { green: '90', yellow: '140', red: '200', unit: 'gal/h', dir: 'lte', persistSec: 0 } };
    MOMENTUM.Bind.seek(Date.parse('2026-08-05T09:00:00Z'));
    const a = MOMENTUM.Bind.sourceValue(src);
    const s1 = MOMENTUM.Bind.driftSource(src, 900);
    const a2 = MOMENTUM.Bind.sourceValue(src);
    MOMENTUM.Bind.seek(Date.parse('2026-08-05T09:00:00Z'));
    const a3 = MOMENTUM.Bind.sourceValue(src);
    MOMENTUM.Bind.resume();
    return { v: a.value, unit: a.unit, metric: a.metric, status: s1,
             repeat: a3.value, same: Object.is(a.value, a3.value),
             state: a.detail && a.detail.state };
  });
  ok('a bound source produces a number from the generator',
     typeof srcTest.v === 'number' && isFinite(srcTest.v),
     srcTest.v.toFixed(2) + ' ' + srcTest.unit + ' in state ' + srcTest.state);
  ok('the source is graded by its own thresholds', ['green','yellow','red'].includes(srcTest.status),
     srcTest.status);
  ok('the same instant always gives the same value', srcTest.same);

  console.log('\n5 · real header ranges, and time travel');
  const ranges = await page.evaluate(() => {
    MOMENTUM.Bind.seek(Date.parse('2026-08-06T06:00:00Z'));
    const out = {};
    ['today','week','month'].forEach(k => {
      window.currentTimeRange = k;
      const w = MOMENTUM.Bind.windowFor(k);
      const kp = MOMENTUM.Bind.kpi(w.fromMs, w.toMs);
      out[k] = { hours: (w.toMs - w.fromMs) / 3600000, gal: kp.numerator,
                 cycles: kp.cycles, ratio: kp.value, beforeSpan: w.fromMs < Date.parse('2026-08-05T07:00:00Z') };
    });
    out.toast = MOMENTUM.Bind.applyRange('week');
    out.att = MOMENTUM.Bind.attainment(out.today.ratio, 0.420, true);
    MOMENTUM.Bind.resume();
    return out;
  });
  ok('a week window is 168 real hours', ranges.week.hours === 168);
  ok('a week reaches back before the profiled span and still computes',
     ranges.week.beforeSpan && ranges.week.gal > 0);
  ok('a week carries ≈7× a day of fuel, not 54×',
     Math.abs(ranges.week.gal / ranges.today.gal - 7) < 1.2,
     (ranges.week.gal / ranges.today.gal).toFixed(2) + '×');
  ok('a month carries ≈30× a day',
     Math.abs(ranges.month.gal / ranges.today.gal - 30) < 4,
     (ranges.month.gal / ranges.today.gal).toFixed(2) + '×');
  ok('the day window reproduces the workbook day',
     Math.abs(ranges.today.gal - 19644.7) / 19644.7 < 0.08,
     Math.round(ranges.today.gal) + ' gal vs 19,645 · ' + ranges.today.cycles + ' cycles');
  ok('gal/ton lands on the locked figure',
     Math.abs(ranges.today.ratio - 0.1586) / 0.1586 < 0.08, ranges.today.ratio.toFixed(4));
  ok('lower-is-better renders as exceeded, never as a negative gap',
     ranges.att.exceeded && ranges.att.gapPct > 0, ranges.att.label);
  ok('the range toast reports real hours and real cycles',
     /generated hours/.test(ranges.toast) && /completed cycles/.test(ranges.toast), ranges.toast);

  console.log('\n6 · scrubbing backward finds a scripted incident');
  const scrub = await page.evaluate(() => {
    const g = MOMENTUM.Bind.generator();
    const c = g.plan.cases.find(x => x.unit === 'HT-001' && x.placement === 'scheduled');
    const before = MOMENTUM.Bind.incidentsAt(c.startMs - 3600000, 'HT-001').length;
    const during = MOMENTUM.Bind.incidentsAt(c.startMs + 3600000, 'HT-001');
    const back = MOMENTUM.Bind.incidentsIn(c.startMs - 7200000, c.startMs + 7200000, 'HT-001');
    return { label: c.label, onset: new Date(c.startMs).toISOString(), before,
             during: during.length, factor: during[0] && during[0].factor, found: back.length };
  });
  ok('nothing before the onset', scrub.before === 0, 'onset ' + scrub.onset);
  ok('the incident is live after the onset', scrub.during >= 1, scrub.label);
  ok('scrubbing back across the onset finds it', scrub.found >= 1,
     'factor ×' + scrub.factor.toFixed(4));

  console.log('\n7 · journey partition');
  const part = await page.evaluate(() => {
    MOMENTUM.Bind.seek(Date.parse('2026-08-05T12:00:00Z'));
    const s = MOMENTUM.Bind.stateShare();
    MOMENTUM.Bind.resume();
    const tot = Object.values(s).reduce((a, b) => a + b, 0);
    return { s, tot, order: MOMENTUM.Bind.stateOrder() };
  });
  ok('stage shares sum to the whole fleet', Math.abs(part.tot - 1) < 1e-9,
     Object.entries(part.s).filter(([, v]) => v > 0).map(([k, v]) => k + ' ' + Math.round(v * 100) + '%').join(' · '));
  ok('the partition is the bound cycle order', part.order.length === 7);

  console.log('\n8 · detaching restores the unbound page');
  const off = await page.evaluate(() => {
    MOMENTUM.Data.profile = null;
    return { active: MOMENTUM.Bind.active(), now: MOMENTUM.Bind.now(),
             kpi: MOMENTUM.Bind.kpi(), panel: !!document.getElementById('bindPanel'),
             platforms: SOURCE_TYPES.profile.platforms[0],
             types: SOURCE_TYPE_ORDER.join(',') };
  });
  ok('detached → inert again', !off.active && off.now === null && off.kpi === null);
  ok('the binding panel is removed', !off.panel);
  ok('the source type list is unchanged by the round trip',
     off.types === 'observability,rest,sql,graphql,synthetic,historian,profile');
  ok('no page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: path.join(__dirname, '..', 'shot-unbound.png'), fullPage: false });
  await page.evaluate(p => { MOMENTUM.Data.profile = p; }, profile);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, '..', 'shot-bound.png'), fullPage: false });

  console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
