/* Release 4, phase 3C — the elapsed reading.
 *
 * The Answer Engine read whole-file rollups whatever the clock said. Measured
 * before the fix: 86,400 samples returned at sim-time 02:00, where 7,200 had
 * elapsed, and byte-identical cell arrays at every playhead. "Which truck
 * burned most fuel today" asked at 09:00 saw 15:00.
 *
 * The fix accumulates each measure at full grain as sim time passes. So this
 * suite has two jobs, and the second is the harder one: the leak is closed,
 * AND the thing that closed it is arithmetically the same as walking the
 * history in one go. An accumulator that drifts from a single walk is a slower
 * way of being wrong.
 *
 * Two defects were found here by running it rather than by reading it: a first
 * reading that began at the playhead instead of the origin, and one grain step
 * dropped at every resume boundary. Neither showed up as a failure anywhere
 * else, and the second would have been invisible forever. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'public', 'index.html');
const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'p20.json'), 'utf8'));

let pass = 0, fail = 0;
const ok  = (m, d) => { pass++; console.log('  ok   ' + m + (d ? '  · ' + d : '')); };
const bad = (m, d) => { fail++; console.log('  FAIL ' + m + (d ? '  · ' + d : '')); };
const is  = (c, m, d) => c ? ok(m, d) : bad(m, d);
const head = t => console.log('\n' + t);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(1200);

  /* ── 0 · Optionality, before anything is bound ─────────────────────────── */
  const unbound = await page.evaluate(() => ({
    reader: !!MOMENTUM.Answer.reader(),
    acc: !!MOMENTUM.Bind.accumulator(),
    elapsed: MOMENTUM.Bind.elapsed('anything', 'HT-001')
  }));
  head('0 · nothing bound, nothing read');
  is(unbound.reader === false, 'no reader is registered on an unbound board');
  is(unbound.acc === false, 'and no accumulator exists');
  is(unbound.elapsed === null, 'and asking for a reading returns null, not zero',
     'zero is a measurement; null is the absence of one');

  const R = await page.evaluate(async (prof) => {
    document.getElementById('langSelect').value = 'en';
    const sel = document.getElementById('industrySelect');
    sel.value = 'mineria'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const th = document.getElementById('journeyThemeSelect');
    if (!th.value) for (const o of th.options) if (o.value) { th.value = o.value; break; }
    MOMENTUM.Bind.attach(prof);
    await new Promise(r => setTimeout(r, 300));
    applyConfig();
    await new Promise(r => setTimeout(r, 2600));

    const clock = MOMENTUM.Bind.clock();
    const origin = clock.origin(), end = clock.end();
    const gen = MOMENTUM.Bind.generator();
    const grain = gen.plan.grainSec || 1;
    const metric = gen.metrics().filter(m => /Fuel Consumption/i.test(m))[0];
    const at = h => origin + h * 3600000;

    const out = { registered: !!MOMENTUM.Answer.reader(), grain, metric };

    /* one walk, straight to +4h */
    MOMENTUM.Bind.seek(at(4));
    const oneGo = MOMENTUM.Bind.elapsed(metric, 'HT-001');

    /* rebuild, then creep to the same instant in ragged, non-grain-aligned
       jumps — the shape a tick actually has */
    MOMENTUM.Bind.seek(origin);
    MOMENTUM.Bind.elapsed(metric, 'HT-001');
    [1237, 2500, 3600, 5000, 7200, 9000, 11000, 14400].forEach(s => {
      MOMENTUM.Bind.seek(origin + s * 1000);
      MOMENTUM.Bind.elapsed(metric, 'HT-001');
    });
    MOMENTUM.Bind.seek(at(4));
    const creeping = MOMENTUM.Bind.elapsed(metric, 'HT-001');

    /* the independent answer: the generator, walked at full grain in one call */
    const straight = gen.aggregate(metric, origin, at(4), { stepSec: grain });

    /* laziness: only the measure asked for is accumulated */
    const acc = MOMENTUM.Bind.accumulator();
    const seriesBuilt = Object.keys(acc.series).length;
    const metricsAvailable = gen.metrics().length;

    /* the leak itself, through the public engine */
    const dims = MOMENTUM.Answer.dimensions(prof);
    const unitDim = dims.filter(d => d.source === 'unit')[0];
    const ask = h => {
      MOMENTUM.Bind.seek(at(h));
      const c = MOMENTUM.Answer.cells(prof, unitDim, metric, {});
      const top = c.slice().sort((a, b) => b.value - a.value)[0];
      return { n: top.n, member: top.member, value: top.value,
               elapsed: !!top.elapsed, members: c.length };
    };
    const early = ask(2), late = ask(20);

    /* a ratio may not mix two clocks */
    MOMENTUM.Bind.seek(at(9));
    const ratio = MOMENTUM.Answer.resolve(prof, {
      dimension: unitDim.id, aggregation: 'mean', rank: 'max',
      measure: { numerator: metric, denominator: '__tons' } });

    /* backward seek must rebuild rather than keep counting */
    MOMENTUM.Bind.seek(at(20));
    MOMENTUM.Bind.elapsed(metric, 'HT-001');
    MOMENTUM.Bind.seek(at(3));
    const rewound = MOMENTUM.Bind.elapsed(metric, 'HT-001');

    MOMENTUM.Bind.detach();
    const afterDetach = { reader: !!MOMENTUM.Answer.reader(),
                          acc: !!MOMENTUM.Bind.accumulator() };

    return Object.assign(out, {
      oneGo, creeping, straight: { n: straight.n, perUnit: straight.perUnit['HT-001'] },
      seriesBuilt, metricsAvailable, early, late, afterDetach, rewound,
      ratioOk: ratio.ok, ratioElapsed: ratio.evidence && ratio.evidence.n,
      /* INCLUSIVE OF THE ORIGIN. The first instant of the data is a real
         sample and is counted, so N sim-hours at one-second grain is
         N x 3600 + 1 samples, not N x 3600. Asserting the round number would
         have been asserting that the day starts one second late. */
      hours4: 4 * 3600 + 1, hours2: 2 * 3600 + 1, hours3: 3 * 3600 + 1
    });
  }, profile);

  head('1 · the reading is registered when data is bound');
  is(R.registered, 'attaching a profile registers the reader');

  head('2 · the reading counts elapsed sim time, from the origin');
  is(R.oneGo.n === R.hours4, 'four sim-hours at one-second grain is 14,401 samples, origin included',
     R.oneGo.n + ' samples');
  is(R.oneGo.upToMs != null, 'and it records how far it has read');

  head('3 · creeping equals walking — the accumulator does not drift');
  /* Eight ragged, non-grain-aligned jumps to the same instant. This is the
     assertion that caught the dropped step at the resume boundary: the counts
     differed by exactly one per resume, which no other test could see. */
  is(R.creeping.n === R.oneGo.n,
     'reaching an instant in eight ragged jumps counts the same samples as one walk',
     R.creeping.n + ' vs ' + R.oneGo.n);
  is(R.creeping.sum === R.oneGo.sum,
     'and sums them to the same total, exactly — not nearly',
     R.creeping.sum === R.oneGo.sum ? 'identical' :
       (R.creeping.sum + ' vs ' + R.oneGo.sum));

  head('4 · full grain, checked against an independent walk');
  is(R.straight.perUnit.n === R.oneGo.n,
     'the generator walking the same span at full grain counts the same samples',
     R.straight.perUnit.n + ' vs ' + R.oneGo.n);
  is(Math.abs(R.straight.perUnit.mean - R.oneGo.mean) < 1e-9,
     'and agrees on the mean to floating point, so nothing was strided',
     'delta ' + Math.abs(R.straight.perUnit.mean - R.oneGo.mean).toExponential(2));

  head('5 · only what is asked for is accumulated');
  is(R.seriesBuilt < R.metricsAvailable,
     'one measure read, not all ' + R.metricsAvailable + ' the generator declares',
     R.seriesBuilt + ' series built');

  head('6 · the leak, through the public engine');
  is(R.early.n === R.hours2,
     'a question asked two hours in sees two hours of samples',
     R.early.n + ' samples');
  is(R.early.elapsed === true, 'and says so — the cell is marked as elapsed');
  is(R.late.n > R.early.n,
     'the same question later sees more', R.early.n + ' → ' + R.late.n);
  is(R.early.value !== R.late.value,
     'so the answer is no longer constant across the whole day');
  is(R.early.members === R.late.members,
     'every member is bounded together — a ranking never races two clocks',
     R.early.members + ' members at both instants');

  head('7 · a ratio may not mix two clocks');
  /* __tons is counted once per completed cycle at the dump, so the accumulator
     declines it. A bounded numerator over an unbounded denominator would bend
     the denominator law without anyone choosing to bend it. */
  is(R.ratioOk, 'a ratio against a measure the accumulator declines still resolves');
  is(R.ratioElapsed !== R.hours2 && R.ratioElapsed !== R.hours3,
     'and BOTH sides fall back together rather than one side being bounded',
     'n = ' + R.ratioElapsed);

  head('8 · a playhead dragged backwards rebuilds');
  is(R.rewound.n === R.hours3,
     'seeking back to three hours reports three hours, not twenty',
     R.rewound.n + ' samples');

  head('9 · the reading goes when the data goes');
  is(R.afterDetach.reader === false, 'detaching clears the reader');
  is(R.afterDetach.acc === false, 'and drops the accumulator');

  head('10 · no page errors');
  is(errors.length === 0, 'no page errors across the run', errors.join(' | '));

  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
