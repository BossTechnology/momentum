/* THE OPTIONALITY LAW, TESTED.

   The law is unchanged: nothing bound means nothing changes. What changed is
   what "nothing" looks like.

   This gate used to build the same untouched retail configuration in
   Simulation_19 and in the current build and require the two snapshots to be
   byte-identical. That comparison only worked while both files arrived
   furnished — three seeded results, five invented answers each, eight invented
   stage touchpoints — because the furniture was what it was comparing. A build
   that loads with nothing has nothing to match against a baseline that loads
   with something, and pinning the old snapshot would have meant keeping the
   scaffolding alive purely to satisfy a test.

   So the law is asserted directly on the build in hand, in three steps that
   follow a user's actual sequence:

     1 · loaded, untouched      — empty, and still empty once the timers run
     2 · industry + journey     — the journey and the names it declares, and
                                  NOTHING else: no touchpoints, no answers, no
                                  indicators, no conditions, no channels
     3 · document attached      — exactly what the document declares, and
                                  attaching it twice declares it once

   Step 2 is the load-bearing one. It is where the seventeen industry KBR sets
   and the bundled Config Doc used to be adopted silently, and it is the step
   the blank slate exists to make honest.

   Everything the simulation invents is seeded from Math.random, so the page is
   stubbed with a deterministic sequence: the comparison is of structure and
   wiring, which is what the law is about. */
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, '..', 'momentum-Simulation_68.html');

const STUB = `(() => {
  let s = 123456789;
  Math.random = function(){ s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const D = Date;
  const FIXED = D.parse('2026-08-05T12:00:00Z');
  Date.now = () => FIXED;
})();`;

/* What is on the board, counted. Live figures drift on a timer and are not
   configuration, so nothing here reads a value, a health or a status.

   Injected into the page as CENSUS_FN so every step counts the same way. */
const CENSUS = () => ({
  slots:    KBRS.length,
  named:    KBRS.filter(k => k.name).length,
  names:    KBRS.map(k => k.name || ''),
  tps:      KBRS.reduce((a, k) => a + (k.touchpoints || []).length, 0),
  answers:  KBRS.reduce((a, k) => a + (k.answers || []).length, 0),
  risk:     KBRS.reduce((a, k) => a + (k.riskTouchpoints || []).length, 0),
  conds:    KBRS.reduce((a, k) => a + (k.riskConditions || []).length, 0),
  channels: (window.MOMENTUM && MOMENTUM.Channels && MOMENTUM.Channels.list)
              ? MOMENTUM.Channels.list().length : 0,
  stages:   journeyStages.filter(s => s.name).length,
  stageTps: journeyStages.reduce((a, s) => a + (s.touchpoints || []).length, 0),
  active:   journeyStages.filter(s => s.state && s.state !== 'inactive').length,
});

(async () => {
  console.log('\nOptionality law · a blank slate stays blank until something is declared\n');
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                              : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(STUB);
  await page.addInitScript('window.CENSUS_FN = ' + CENSUS.toString() + ';');
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(900);

  /* ── 1 · loaded, untouched ────────────────────────────────────────────── */
  console.log('1 · loaded, untouched');
  const load = await page.evaluate(() => CENSUS_FN());
  ok('the build loads without page errors', errs.length === 0, errs[0] || '');
  ok('three result slots, none of them declared',
     load.slots === 3 && load.named === 0, load.named + ' named of ' + load.slots);
  ok('no touchpoints, answers, indicators or conditions',
     load.tps === 0 && load.answers === 0 && load.risk === 0 && load.conds === 0,
     JSON.stringify({ tps: load.tps, answers: load.answers, risk: load.risk, conds: load.conds }));
  ok('no channels registered', load.channels === 0, String(load.channels));
  ok('no journey: no named stage, no stage touchpoint, nothing active',
     load.stages === 0 && load.stageTps === 0 && load.active === 0,
     JSON.stringify({ stages: load.stages, stageTps: load.stageTps, active: load.active }));

  await page.waitForTimeout(2600);        // every timer on the page gets a turn
  const settled = await page.evaluate(() => CENSUS_FN());
  ok('and it is unchanged once the timers have run — nothing creeps in',
     JSON.stringify(load) === JSON.stringify(settled));

  /* ── 2 · an industry and a journey, and nothing else ──────────────────── */
  console.log('\n2 · an industry and a journey — the declaration, and only it');
  const applied = await page.evaluate(() => {
    document.getElementById('industrySelect').value = 'retail';
    document.getElementById('langSelect').value = 'en';
    SB_CFG.industry = 'retail'; SB_CFG.lang = 'en'; SB_CFG.size = 'medium';
    SB_CFG.clientName = 'identity-check';
    const list = templatesFor('retail');          // the first retail journey, untouched
    SB_CFG.themeId = list[0].id;
    applyJourneyTemplate('retail', currentSizedJourney());
    SIM_APPLYING = true;
    try { applyKbrSimulation(); } finally { SIM_APPLYING = false; }
    applyLanguage();
    return { journey: list[0].name, census: CENSUS_FN() };
  });
  ok('a retail journey is on the board', !!applied && applied.census.stages > 0,
     applied ? applied.journey + ' · ' + applied.census.stages + ' stages' : 'not applied');
  /* The retail journey declares stages and no results — most journeys do. So
     the slots stay undeclared, which is the point: an industry and a journey
     are not an opinion about what this business measures. */
  ok('the journey declares no results, so none are named',
     applied.census.named === 0, applied.census.named + ' named of 3');
  ok('and NOTHING else was adopted — no touchpoints, answers or indicators',
     applied.census.tps === 0 && applied.census.answers === 0 && applied.census.risk === 0,
     JSON.stringify({ tps: applied.census.tps, answers: applied.census.answers,
                      risk: applied.census.risk }));
  ok('no conditions and no channels arrived with the industry',
     applied.census.conds === 0 && applied.census.channels === 0,
     JSON.stringify({ conds: applied.census.conds, channels: applied.census.channels }));

  /* ── 3 · the document is the thing that changes it ────────────────────── */
  console.log('\n3 · attaching the document, and attaching it twice');
  const doc = await page.evaluate(() => {
    const first = applyExampleConfig('retail');
    const once = CENSUS_FN();
    const second = applyExampleConfig('retail');
    const twice = CENSUS_FN();
    return { first: first, once: once, second: second, twice: twice };
  });
  ok('the document declares its channels', doc.once.channels === 4, String(doc.once.channels));
  ok('and its risk indicators', doc.once.risk === 6, String(doc.once.risk));
  ok('and its conditions', doc.once.conds >= 7, String(doc.once.conds));
  ok('retail declares no answers, and none are invented for it',
     doc.once.answers === 0, String(doc.once.answers));
  /* The document is where retail's three results are actually declared. It
     binds to the empty slots by position, reports that it did, and names them
     — a result left as 'KBR' with six indicators hanging off it was the state
     this step exists to catch. */
  ok('and it names the results the journey left undeclared',
     doc.once.named === 3, doc.once.names.filter(Boolean).join(' | '));
  ok('the positional binding is reported rather than assumed',
     (doc.first.boundByPosition || []).length === 3,
     (doc.first.boundByPosition || []).join(' · '));
  ok('attaching the same document twice declares it once, not twice',
     JSON.stringify(doc.once) === JSON.stringify(doc.twice),
     doc.once.risk + '/' + doc.twice.risk + ' indicators · ' +
     doc.once.channels + '/' + doc.twice.channels + ' channels');

  ok('no page errors across the whole run', errs.length === 0, errs[0] || '');
  await browser.close();
  console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
