/* test/verify-stages.js — Phase 3D · the board's account of a stage the data
   cannot describe.

   The defect this suite exists to prevent: a journey declaring more stages
   than the data has states used to leave the surplus hexagons carrying
   whatever ring they held before the profile bound. On the mining reference
   those were 59%, 87% and 74% — the three LARGEST arcs on the board, on the
   three stages that represent nothing — while the seven real ones summed to
   exactly 100. A reader totalling the row got 320%.

   `mapStages` recorded {mapped:7, stages:10, states:7} throughout, and its own
   comment said the surplus was reported. Nothing read the record. That is the
   same species as a refusal carrying a false reason, so this suite follows the
   same rule: ASSERT THE REASON, NOT THE REJECTION. It is not enough that three
   stages are marked; the marks must name the right three, the sentence must
   quote the right counts, and both must come from the one record. A suite that
   checked only `unmapped === 3` would pass on a board that marked the wrong
   three stages. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'momentum-Simulation_68.html');
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'p20.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                            : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' &&
    !/403|Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  console.log('\nPhase 3D · stages the data has no state for\n');

  const ring = `(id) => {
    const c = document.querySelector('.hex-cell[data-id="' + id + '"]');
    const a = c && c.querySelector('.hex-arc');
    if(!a) return null;
    const d = (a.style.strokeDasharray || '').split(/[, ]+/).filter(Boolean).map(parseFloat);
    const L = a.getTotalLength() || 0;
    return (d.length >= 2 && L) ? Math.round(d[0] / L * 100) : 0;
  }`;

  console.log('1 · a mining journey declaring more stages than the data has states');
  const built = await page.evaluate(() => {
    document.getElementById('industrySelect').value = 'mining';
    SB_CFG.industry = 'mining'; SB_CFG.size = 'large'; SB_CFG.lang = 'en';
    const list = templatesFor('mining');
    const haul = list.find(t => /haul|acarreo|ciclo|fleet|mining|miner/i.test(t.name)) || list[0];
    SB_CFG.themeId = haul.id;
    applyJourneyTemplate('mining', currentSizedJourney());
    applyKbrSimulation(); applyExampleConfig('mining'); applyLanguage();
    return { primes: journeyStages.filter(s => s.kind === 'prime' && s.name).map(s => s.name) };
  });
  ok('the journey declares ten prime stages', built.primes.length === 10,
     built.primes.length + ' stages');

  console.log('\n2 · nothing bound — the board is untouched');
  const unbound = await page.evaluate(() => ({
    marks: document.querySelectorAll('.hex-cell.unmapped').length,
    panel: !!document.getElementById('bindPanel'),
    map: MOMENTUM.Bind.stageMap()
  }));
  ok('no stage is drawn dormant before a profile binds', unbound.marks === 0,
     unbound.marks + ' marks');
  ok('no binding panel, so no shortfall sentence', !unbound.panel);
  ok('nothing bound → no stage map at all', unbound.map === null);

  console.log('\n3 · bound — the surplus is named, not merely counted');
  await page.evaluate(p => { MOMENTUM.Data.profile = p; MOMENTUM.Data.renderCoverage(p);
    MOMENTUM.Bind.seek(Date.parse('2026-08-05T12:00:00Z')); }, profile);
  await page.waitForTimeout(1600);

  const sm = await page.evaluate(() => MOMENTUM.Bind.stageMap());
  /* Read through absent fields rather than off them. Run against the build
     this suite was written to condemn, `surplus` is undefined — and a suite
     that throws there reports the defect as a crash and abandons every check
     after it. The defect must come out as FAIL lines, in place, with the rest
     of the run intact. */
  sm.surplus = sm.surplus || [];
  sm.surplusIds = sm.surplusIds || [];
  ok('the record counts seven states against ten stages',
     sm.stages === 10 && sm.states === 7 && sm.mapped === 7,
     sm.mapped + ' of ' + sm.stages + ' mapped to ' + sm.states + ' states');
  ok('the record NAMES the three surplus stages',
     JSON.stringify(sm.surplus) ===
       JSON.stringify(['Relevo de Turno', 'Abastecimiento', 'Refrigerio']),
     sm.surplus.length ? sm.surplus.join(', ') : 'the record names none');
  ok('the surplus is the TAIL of the cycle order, not an arbitrary three',
     JSON.stringify(sm.surplusIds) === JSON.stringify(['p8', 'p9', 'p10']),
     sm.surplusIds.length ? sm.surplusIds.join(' ') : 'the record identifies none');

  console.log('\n4 · the ring no longer states a share that does not exist');
  const rings = await page.evaluate(`(${ring})`).then(() => page.evaluate(fn => {
    const read = eval('(' + fn + ')');
    const sm = MOMENTUM.Bind.stageMap();
    return journeyStages.filter(s => s.kind === 'prime' && s.name).map(s => ({
      name: s.name, id: s.id, mapped: sm.map[s.id] || null, pct: read(s.id),
      dormant: document.querySelector('.hex-cell[data-id="' + s.id + '"]')
                 .classList.contains('unmapped')
    }));
  }, ring));

  const surplusRings = rings.filter(r => !r.mapped);
  const mappedRings = rings.filter(r => r.mapped);
  ok('every surplus stage draws no arc at all',
     surplusRings.every(r => r.pct === 0),
     surplusRings.map(r => r.name + ' ' + r.pct + '%').join(' · '));
  ok('every surplus stage carries the dormant mark',
     surplusRings.every(r => r.dormant) && surplusRings.length === 3);
  ok('no MAPPED stage is ever marked dormant — including those at a true 0%',
     mappedRings.every(r => !r.dormant),
     mappedRings.filter(r => r.pct === 0).map(r => r.name + ' 0%').join(' · ') + ' left solid');
  ok('the mapped stages still account for the whole fleet, and only them',
     Math.abs(mappedRings.reduce((a, r) => a + r.pct, 0) - 100) <= 4,
     mappedRings.reduce((a, r) => a + r.pct, 0) + '% across ' + mappedRings.length);
  ok('the board no longer totals past 100 — the old defect read 320%',
     Math.abs(rings.reduce((a, r) => a + r.pct, 0) - 100) <= 4,
     rings.reduce((a, r) => a + r.pct, 0) + '% across all ten');

  console.log('\n5 · a dormant stage is distinguishable from an empty one');
  const zeroMapped = mappedRings.filter(r => r.pct === 0);
  ok('mining shows both cases at this instant, so the distinction is load-bearing',
     zeroMapped.length > 0 && surplusRings.length > 0,
     zeroMapped.length + ' stage(s) genuinely empty · ' +
     surplusRings.length + ' with no state');
  const distinct = await page.evaluate(() => {
    const g = document.querySelector('.hex-cell[data-id="p6"] .hex-shell'); // Descarga, true 0%
    const d = document.querySelector('.hex-cell[data-id="p8"] .hex-shell'); // Relevo, no state
    const cs = e => e ? getComputedStyle(e) : null;
    const a = cs(g), b = cs(d);
    return { emptyStroke: a && a.stroke, emptyDash: a && a.strokeDasharray,
             dormantStroke: b && b.stroke, dormantDash: b && b.strokeDasharray };
  });
  ok('their rings do not render identically',
     distinct.emptyDash !== distinct.dormantDash ||
     distinct.emptyStroke !== distinct.dormantStroke,
     'empty ' + distinct.emptyStroke + ' / ' + distinct.emptyDash +
     '  vs  dormant ' + distinct.dormantStroke + ' / ' + distinct.dormantDash);

  console.log('\n6 · a substage is never called unmapped');
  const subs = await page.evaluate(() =>
    journeyStages.filter(s => s.kind === 'sub' && s.name).map(s => ({
      name: s.name,
      dormant: (document.querySelector('.hex-cell[data-id="' + s.id + '"]') || { classList: { contains: () => false } })
                 .classList.contains('unmapped') })));
  ok('no substage is marked dormant — it was never a candidate for occupancy',
     subs.length > 0 && subs.every(s => !s.dormant),
     subs.length + ' substages, none marked');

  console.log('\n7 · the sentence and the hexagons are one fact, not two');
  const panel = await page.evaluate(() => {
    const p = document.getElementById('bindPanel');
    return p ? p.innerText : '';
  });
  ok('the binding panel states the shortfall', /no state in this data/i.test(panel));
  ok('it quotes the RIGHT counts, not just some counts',
     /\b3\b[\s\S]{0,12}\bof\b[\s\S]{0,6}\b10\b/.test(panel) && /\b7\b\s+states/.test(panel),
     (panel.match(/Stages with no state[^\n]*/) || [''])[0]);
  ok('it names all three stages, so the reader can find them on the board',
     surplusRings.length > 0 && surplusRings.every(r => panel.indexOf(r.name) !== -1),
     surplusRings.map(r => r.name).join(', '));
  ok('the sentence agrees with the marks it describes',
     (panel.match(/Stages with no state in this data: (\d+)/) || [])[1] ===
       String(surplusRings.length));

  console.log('\n8 · detaching puts the board back');
  await page.evaluate(() => {
    if (MOMENTUM.Bind.detach) MOMENTUM.Bind.detach();
    else { MOMENTUM.Data.profile = null; MOMENTUM.Bind.paintAll && MOMENTUM.Bind.paintAll(); }
  });
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => ({
    marks: document.querySelectorAll('.hex-cell.unmapped').length,
    active: MOMENTUM.Bind.active(),
    panel: !!document.getElementById('bindPanel')
  }));
  ok('no dormant mark survives the detach', after.marks === 0, after.marks + ' marks');
  ok('the binding is genuinely gone, so the check above means something', !after.active);
  ok('the shortfall sentence goes with it', !after.panel);

  console.log('\n9 · the page');
  ok('no page errors across the whole run', errors.length === 0, errors.join(' | ') || 'clean');

  console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
