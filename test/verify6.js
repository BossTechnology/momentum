/* verify6.js — Phase 6 acceptance · the Risk Meter (Build Spec §5, §8 row 6)
   Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/verify6.js       */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const FILE = 'file://' + path.resolve(__dirname, '..', 'momentum-Simulation_68.html');
const PROFILE = path.resolve(__dirname, '..', 'p20.json');
const profile = require(PROFILE);

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++;
  console.log((c ? '  ok   ' : '  FAIL ') + n + (d ? '  \u00b7 ' + d : '')); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error'
    && !/403|Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  /* ── 1 · BOb's constants, asserted rather than trusted ─────────────────── */
  console.log('\n1 \u00b7 escalation, ported from BOb');
  const K = await page.evaluate(() => {
    const R = window.MOMENTUM.Risk;
    return { spd: R.SPD_MS, cd: R.cooldownMs(3), ct: R.COOLDOWN_TICKS,
             st: R.SUSTAINED_TICKS, cp: R.CRITICAL_PCT,
             pu: R.PROX_URGENT, pw: R.PROX_WARNING,
             sustained: R.deriveSeverity(101, 100, 'upper', 21),
             notYet:    R.deriveSeverity(101, 100, 'upper', 20),
             bySize:    R.deriveSeverity(120, 100, 'upper', 1),
             fast: (R.proximity(91, 100, null) || {}).pulse,
             slow: (R.proximity(85, 100, null) || {}).pulse,
             breach: (R.proximity(101, 100, null) || {}).state };
  });
  ok('SPD_MS is BOb\u2019s array verbatim', JSON.stringify(K.spd) === '[4000,2500,1500,800,280]', K.spd.join(','));
  ok('cooldown is SPD_MS \u00d7 15', K.ct === 15 && K.cd === 1500 * 15, K.cd + 'ms at normal speed');
  ok('a breach held past 20 ticks is critical', K.st === 20 && K.sustained === 'critical');
  ok('20 ticks alone is not enough', K.notYet === 'warning');
  ok('20% past the threshold is critical on size', K.cp === 0.2 && K.bySize === 'critical');
  ok('within 10% pulses fast', K.pu === 0.1 && K.fast === 'fast');
  ok('within 20% pulses slow', K.pw === 0.2 && K.slow === 'slow');
  ok('a breach clears both pulses', K.breach === 'breach');

  /* ── 2 · §5.2 · eight tabs, and one glyph never means two things ───────── */
  console.log('\n2 \u00b7 the panel has eight tabs');
  const id = await page.evaluate(() => {
    const KB = (typeof KBRS !== 'undefined') ? KBRS : [];
    if (!KB.length) return null;
    window.openRiskPanel(KB[0].id, 'activity');
    return KB[0].id;
  });
  ok('the Risk Meter opens', !!id, id || '');
  await page.waitForTimeout(700);
  const tabs = await page.$$eval('.rm-tabs .kbr-tab', els => els.map(e => e.id));
  ok('eight tabs, not four', tabs.length === 8, tabs.length + ' tabs');
  ['rmTabActivity','rmTabTouchpoints','rmTabAlerts','rmTabAnomalies',
   'rmTabAlarms','rmTabActions','rmTabConfig','rmTabBobby'].forEach(t => {
    ok('tab present: ' + t.replace('rmTab',''), tabs.indexOf(t) >= 0);
  });
  ok('Touchpoints sits immediately after Activity',
     tabs.indexOf('rmTabTouchpoints') === tabs.indexOf('rmTabActivity') + 1);
  const panes = await page.evaluate(() => ['touchpoints','alarms','actions','config']
    .map(t => { window.switchRiskTab(t);
      const el = document.getElementById('rmPane' + t.charAt(0).toUpperCase() + t.slice(1));
      return el && el.classList.contains('active'); }));
  ok('every new tab activates its own pane', panes.every(Boolean));
  const subs = await page.$$eval('.rm-subtabs .kbr-tab', els => els.map(e => e.textContent.trim()));
  ok('Configuration has its three sub-tabs',
     subs.length === 3 && subs.join('|') === 'Thresholds|Anomalies|Response Options', subs.join(' \u00b7 '));

  console.log('\n   icon semantics reconciled');
  const glyphs = await page.evaluate(() => {
    const T = window.MOMENTUM.Risk.TAXONOMY;
    /* The tab icons were colour emoji and are now monochrome stroke SVGs that
       inherit currentColor, so nothing in the bar competes on colour. The
       SEMANTICS are what this section is about and they are unchanged: the
       bell tab is Alarms, the bolt tab is Actions. The taxonomy still carries
       the emoji for use in text, which is why T.alarm.glyph is still checked. */
    const bellTab = document.getElementById('rmTabAlarms');
    const boltTab = document.getElementById('rmTabActions');
    const mono = el => !!el && !!el.querySelector('svg') &&
                       !/[\uD800-\uDBFF]/.test(el.textContent || '');
    /* The taxonomy's `glyph` is now the monochrome mark the product DRAWS;
       `emoji` retains the original for prose. The yellow bell that survived
       the tab-bar fix came from this table, not from the tabs. */
    return { alert: T.alert.emoji, alarm: T.alarm.emoji, action: T.action.emoji,
             alarmDrawn: T.alarm.glyph, actionDrawn: T.action.glyph,
             marksMono: [T.alert, T.alarm, T.action].every(t =>
               !/[\uD800-\uDBFF]/.test(t.glyph)),
             bellIsAlarms: !!bellTab && /alarms/.test(bellTab.getAttribute('onclick') || ''),
             boltIsActions: !!boltTab && /actions/.test(boltTab.getAttribute('onclick') || ''),
             bellMono: mono(bellTab), boltMono: mono(boltTab),
             anomHasBell: !!(document.querySelector('#rmTabAnomalies')||{}).textContent
                            && /\uD83D\uDD14/.test(document.getElementById('rmTabAnomalies').innerHTML) };
  });
  ok('the bell means Alarm, as it does in BOb',
     glyphs.alarm === '\uD83D\uDD14' && glyphs.bellIsAlarms);
  ok('and the tab draws it monochrome, not as a colour emoji', glyphs.bellMono);
  ok('the bolt means Action', glyphs.action === '\u26A1' && glyphs.boltIsActions);
  ok('and it too is monochrome', glyphs.boltMono);
  ok('every taxonomy mark the product draws is monochrome too',
     glyphs.marksMono, 'drawn: ' + glyphs.alarmDrawn + ' ' + glyphs.actionDrawn);
  ok('the bell does NOT also mean Anomalies', !glyphs.anomHasBell);
  ok('all three glyphs are distinct',
     new Set([glyphs.alert, glyphs.alarm, glyphs.action]).size === 3);

  /* ── 3 · §5.4 · HT-010, suppressed AND explained ──────────────────────── */
  console.log('\n3 \u00b7 HT-010 \u00b7 the decoy is defeated without a special case');
  const decoy = await page.evaluate(p => {
    const R = window.MOMENTUM.Risk;
    const exc = R.observedException(p);
    const w = exc.windows[0] || {};
    const hit = R.exceptionFor(exc, { zone: 'Rampa B-11 Oeste' });
    const cases = (p.incidentScript && p.incidentScript.cases) || [];
    const road = cases.find(c => /V.a en mal estado/.test(c.label || ''));
    const over = cases.find(c => /Sobrecarga/.test(c.label || ''));
    return { n: exc.windows.length, mode: exc.mode, dim: w.dimension,
             entity: w.entity, wt: w.windowType, excess: w.expectedExcess,
             suppressed: !!hit, why: hit && hit.note,
             roadFires: !R.exceptionFor(exc, { zone: road && road.zone }),
             overFires: !R.exceptionFor(exc, { zone: over && over.zone }),
             roadPct: road && road.expectedExcess, overPct: over && over.expectedExcess,
             clockStillWorks: R.inWindow({ dimension: '__hour', values: [{ start: 9, end: 11 }] }, { __hour: 10 }),
             allZeroExcess: exc.windows.every(x => Number(x.expectedExcess) === 0) };
  }, profile);
  ok('Observed learns exactly one context window', decoy.n === 1 && decoy.mode === 'observed', decoy.n + ' window(s)');
  ok('it is HT-010\u2019s ramp', decoy.entity === 'HT-010');
  ok('it is not a clock window', decoy.dim === 'zone' && decoy.wt === 'Recurrente por segmento', decoy.wt);
  ok('HT-010 is suppressed', decoy.suppressed);
  ok('and the reason travels with it', !!decoy.why, decoy.why);
  ok('reached by the rule, not by naming HT-010', decoy.excess === 0 && decoy.allZeroExcess);
  ok('V\u00eda en mal estado still fires', decoy.roadFires, (decoy.roadPct * 100).toFixed(2) + '% excess');
  ok('Sobrecarga recurrente still fires', decoy.overFires, (decoy.overPct * 100).toFixed(2) + '% excess');
  ok('BOb\u2019s peak-time survives as configuration', decoy.clockStillWorks);

  console.log('\n   the Activity tab says why');
  const said = await page.evaluate(() => {
    const KB = (typeof KBRS !== 'undefined') ? KBRS : [];
    const kbr = KB[0];
    kbr.riskException = window.MOMENTUM.Risk.observedException(
      { incidentScript: { cases: [{ entity: 'HT-010', zone: 'Rampa B-11 Oeste',
        startISO: null, windowType: 'Recurrente por segmento', expectedExcess: 0,
        effect: 'Mayor demanda por geometr\u00eda de ruta' }] } });
    window.switchRiskTab('activity');
    window.renderRiskActivity(kbr);
    const el = document.getElementById('rmActException');
    return el ? el.textContent : null;
  });
  ok('Activity carries the exception block', !!said);
  ok('it names the window', !!said && said.indexOf('Rampa B-11 Oeste') >= 0);
  ok('it gives the reason', !!said && /geometr/.test(said));
  ok('it says this is context, not a clock', !!said && /not a clock window/.test(said));

  /* ── 4 · OP-02 via a baseline-relative comparator ─────────────────────── */
  console.log('\n4 \u00b7 OP-02 \u00b7 mechanically clean, and still detected');
  const op = await page.evaluate(p => {
    const R = window.MOMENTUM.Risk;
    const night = p.roster.filter(r => /Noche/.test(r.shift));
    const op2 = night.find(r => r.who === 'OP-02');
    const peers = { ref: 'fleet_median', values: night.map(r => r.value) };
    const b = R.evaluateBaseline(op2.value, peers, 5, 'down');
    const absolute = night.every(r => r.value < 1200);   /* every reading inside a plausible limit */
    return { pct: b.pct, breached: b.breached, ref: b.ref, base: b.base,
             absoluteWouldMiss: absolute, refs: R.referenceIds() };
  }, profile);
  ok('OP-02 breaches against the fleet median', op.breached, op.pct.toFixed(2) + '% over ' + op.base);
  ok('an absolute threshold would have missed it', op.absoluteWouldMiss);
  ok('all four references are offered', op.refs.length === 4, op.refs.join(', '));
  ok('the comparator names its reference', op.ref === 'fleet_median');

  /* ── 5 · the simple path stays four fields ────────────────────────────── */
  console.log('\n5 \u00b7 the simple path is unchanged');
  const simple = await page.evaluate(() => {
    const R = window.MOMENTUM.Risk;
    window.switchRiskTab('config'); window.switchRiskCfgTab('thresholds');
    const ids = ['rcOp','rcVal','rcResp','rcChan'].map(i => !!document.getElementById(i));
    const adv = document.getElementById('rcAdvanced');
    const c = R.newCondition({ value: '40' });
    return { fields: R.simpleFields(), allPresent: ids.every(Boolean),
             advHidden: adv && adv.style.display === 'none',
             defaultsToKbr: c.scope.kind === 'kbr', isSimple: R.isSimple(c),
             refOpens: !R.isSimple(R.newCondition({ mode: 'baseline_pct', reference: 'fleet_median' })) };
  });
  ok('four fields, named', simple.fields.join(',') === 'condition,value,response,channel');
  ok('and all four are on screen', simple.allPresent);
  ok('nothing else is opened', simple.advHidden);
  ok('a condition defaults to the KBR', simple.defaultsToKbr && simple.isSimple);
  ok('a reference is what opens the rest', simple.refOpens);

  /* ── 6 · migration without loss ───────────────────────────────────────── */
  console.log('\n6 \u00b7 legacy conditions migrate without loss');
  const mig = await page.evaluate(() => {
    const KB = (typeof KBRS !== 'undefined') ? KBRS : [];
    const kbr = KB[0];
    /* BLANK SLATE: the board no longer arrives carrying generated alerts, so
       this suite makes its own legacy record instead of borrowing the
       scaffolding's. That is what it was always testing — that an OLD
       kbr.alerts array survives migration into riskConditions without loss —
       and it now says so instead of depending on load order. Migration runs
       once, on first read, so the cached array is dropped first. */
    generateKbrAlerts(kbr);
    delete kbr.riskConditions;
    const legacy = (kbr.alerts || []).slice();
    const conds = window.riskConditionsOf(kbr);
    const migrated = conds.filter(c => c.origin === 'migrated');
    return { legacyN: legacy.length, migratedN: migrated.length,
             idsKept: legacy.every(a => migrated.some(c => c.cid === a.aid)),
             namesKept: legacy.every(a => migrated.some(c => c.label === a.name)),
             scoped: migrated.every(c => !!c.scope && !!c.scope.kind),
             legacyRecord: migrated.every(c => !!c.legacy),
             idempotent: window.riskConditionsOf(kbr).length === conds.length };
  });
  ok('every legacy alert migrates', mig.legacyN > 0 && mig.migratedN === mig.legacyN,
     mig.migratedN + '/' + mig.legacyN);
  ok('ids are preserved', mig.idsKept);
  ok('names are preserved', mig.namesKept);
  ok('each one lands in a scope', mig.scoped);
  ok('the legacy record is kept for reference', mig.legacyRecord);
  ok('migration runs once, not per render', mig.idempotent);

  /* ── 7 · the two pace conditions are subscribed, not redeclared ────────── */
  console.log('\n7 \u00b7 pace hands its facts over \u00b7 one notifier');
  const pace = await page.evaluate(() => {
    const KB = (typeof KBRS !== 'undefined') ? KBRS : [];
    const kbr = KB[0];
    /* No target means no pace facts — that is Optionality, not a defect, so
       assert it before setting one. */
    const before = (typeof kbrPace !== 'undefined') ? kbrPace(kbr) : null;
    const noTargetNoConds = !before;
    kbr.goal = { target: kbr.value * 1.15, unit: kbr.unit || '',
                 timeframe: 'month', progress: 'accumulate', lowerIsBetter: false };
    const p = kbrPace(kbr);
    const exposed = window.MOMENTUM.Pace.conditions(p, { kind: 'kbr', ref: kbr.id });
    delete kbr.riskConditions;                    /* re-subscribe with a target */
    const conds = window.riskConditionsOf(kbr);
    const subscribed = conds.filter(c => c.origin === 'pace');
    return { noTargetNoConds: noTargetNoConds,
             exposed: exposed.map(c => c.id),
             scoped: exposed.every(c => c.scope && c.scope.kind === 'kbr'),
             subscribed: subscribed.map(c => c.pace),
             asFacts: subscribed.every(c => c.response === 'alert'),
             gap: p.gapPct };
  });
  ok('no target \u2192 no pace conditions (Optionality)', pace.noTargetNoConds);
  ok('Pace.conditions() exposes attainment_gap',
     pace.exposed.indexOf('attainment_gap') >= 0, pace.exposed.join(', '));
  ok('Pace.conditions() exposes projected_miss', pace.exposed.indexOf('projected_miss') >= 0);
  ok('they carry the scope they were asked for', pace.scoped);
  ok('and the Risk Meter subscribed to both',
     ['attainment_gap','projected_miss'].every(n => pace.subscribed.indexOf(n) >= 0),
     pace.subscribed.join(', '));
  ok('pace produces facts \u2014 it never escalates on its own', pace.asFacts);

  /* ── 8 · §5.3 risk touchpoints · leading, and empty by default ────────── */
  console.log('\n8 \u00b7 risk touchpoints');
  const tp = await page.evaluate(() => {
    const KB = (typeof KBRS !== 'undefined') ? KBRS : [];
    const kbr = KB[1] || KB[0];
    const before = (kbr.riskTouchpoints || []).length;
    const R = window.MOMENTUM.Risk;
    const absent = R.touchpointRisk([]);
    /* MINING_RISK_TPS is gone from the product — this suite used to assert
       the hardcoded preset, which meant the test ENFORCED the precooking it
       was supposed to outlive. The five indicators are declared in a Config
       Doc now, so the assertion reads them from there. */
    return { before: before, absentNotZero: absent === null,
             tableGone: !window.MOMENTUM.RiskUI.MINING_RISK_TPS,
             weighted: Math.round(R.touchpointRisk(
               [{ status: 'red', weight: 'HVY' }, { status: 'green', weight: 'LGT' }])) };
  });
  const docTps = await page.evaluate(csv => {
    const parsed = MOMENTUM.ConfigDoc.parse(csv, 'mining-config.csv');
    const k = parsed.ok && parsed.doc.kbrs.filter(x => /Combustible/.test(x.name))[0];
    return k ? k.riskTouchpoints : [];
  }, fs.readFileSync(path.join(__dirname, 'mining-config.csv'), 'utf8'));
  ok('empty by default', tp.before === 0);
  ok('no risk touchpoints means ABSENT, not zero', tp.absentNotZero);
  ok('the hardcoded preset is gone from the product', tp.tableGone);
  ok('the five mining ones are DECLARED in the Config Doc', docTps.length === 5,
     docTps.map(t => t.name).join(' \u00b7 '));
  ok('Restricci\u00f3n de Filtro is a signature touchpoint',
     (docTps.filter(t => /Filtro/.test(t.name))[0] || {}).rollup === 'signature');
  ok('weight expresses threat importance', tp.weighted === 77, tp.weighted + '%');

  /* ── 9 · composite worst-of (S2), and Optionality ─────────────────────── */
  console.log('\n9 \u00b7 composite worst-of, and the Optionality law');
  const comp = await page.evaluate(() => {
    const R = window.MOMENTUM.Risk;
    const KB = (typeof KBRS !== 'undefined') ? KBRS : [];
    const kbr = KB[0];
    const bare = window.riskComposite({ rollupHealth: kbr.rollupHealth, riskTouchpoints: [] });
    const withTps = R.composite({ performance: 31, attainment: 64, touchpoints: 12 });
    return { none: R.composite({}).pct,
             onlyPerf: R.composite({ performance: 31 }).pct,
             onlyPerfComponents: R.composite({ performance: 31 }).components.length,
             worst: withTps.pct, driver: withTps.driver,
             bareComponents: bare.components.length,
             bareEqualsPerf: bare.pct === Math.max(2, Math.min(98, Math.round(100 - kbr.rollupHealth))) };
  });
  ok('nothing configured \u2192 no meter at all', comp.none === null);
  ok('performance alone \u2192 the performance number', comp.onlyPerf === 31);
  ok('unconfigured components are absent, not zero', comp.onlyPerfComponents === 1);
  ok('the worst component wins', comp.worst === 64 && comp.driver === 'attainment');
  ok('no risk touchpoints \u2192 one component only', comp.bareComponents === 1);
  ok('and the meter is what it was before Phase 6', comp.bareEqualsPerf);

  /* ── 10 · the tolerance dial filters LAST ─────────────────────────────── */
  console.log('\n10 \u00b7 tolerance is the final surface filter');
  const tol = await page.evaluate(() => {
    const R = window.MOMENTUM.Risk;
    /* The dial lives on a rendered result. On a blank-slate board nothing is
       rendered until something is declared, so declare it the way a user would:
       apply a journey, then attach the document. */
    SB_CFG.industry = 'mining'; SB_CFG.size = 'medium';
    SB_CFG.themeId = templatesFor('mining')[0].id;
    applyJourneyTemplate('mining', currentSizedJourney());
    applyKbrSimulation();
    applyExampleConfig('mining');
    renderKBRs();
    const items = [{ severity: 'warning' }, { severity: 'critical' },
                   { severity: 'critical', suppressed: true }];
    return { high: R.surface(items, 70).length, low: R.surface(items, 10).length,
             neverRevives: R.surface(items, 0).every(i => !i.suppressed),
             dialPresent: !!document.querySelector('input[type=range][id^="rmtol-"]') };
  });
  ok('a high dial shows critical only', tol.high === 1);
  ok('a low dial shows everything unsuppressed', tol.low === 2);
  ok('tolerance never revives a suppression', tol.neverRevives);
  ok('the 0-100 dial is still on top', tol.dialPresent);

  console.log('\n11 \u00b7 the page');
  ok('no page errors across the whole run', errs.length === 0, errs[0] || '');

  await browser.close();
  console.log('\n' + pass + ' passed \u00b7 ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
