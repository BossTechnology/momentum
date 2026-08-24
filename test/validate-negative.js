/* THE TEST THAT MATTERS.
 *
 * A validator that reports nothing is indistinguishable from a validator that
 * checks nothing. So this takes a clean bundle, injects each defect this
 * project has actually shipped, and asserts the corresponding check fires.
 *
 * Every case below is a real defect with a date, not a hypothetical.
 */
const V = require('../api/_validate-core.js');

let pass = 0, fail = 0;
function ok(what, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + what + (detail ? '  \u00b7 ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + what + (detail ? '  \u00b7 ' + detail : '')); }
}
function has(res, code) { return res.items.some(i => i.code === code); }
function level(res, code) {
  const i = res.items.filter(x => x.code === code)[0];
  return i ? i.level : null;
}

/* a minimal, clean three-document bundle */
function clean() {
  return {
    journey: { rows: [
      { kind: 'result', name: 'Daily Revenue', unit: 'USD', direction: 'up' },
      { kind: 'result', name: 'Service Time', unit: 'min', direction: 'down' },
      { kind: 'stage', name: 'Order', order: '1', result: 'Daily Revenue' },
      { kind: 'substage', name: 'Counter', parent: 'Order', order: '1' },
      { kind: 'touchpoint', name: 'Ticket Value', parent: 'Counter', observes: 'value of the order placed' },
    ] },
    data: { rows: [
      { kind: 'dataset', name: 'cafe', mode: 'seeded', span: '1 month', grain: 'per transaction' },
      { kind: 'measure', name: 'Ticket Value', unit: 'USD', type: 'number', mean: '8.4' },
      { kind: 'field', name: 'Ticket Value', unit: 'USD', type: 'number', role: 'target' },
      { kind: 'field', name: 'Prep Duration', unit: 'min', type: 'number', role: 'explanatory' },
      { kind: 'limit', field: 'Ticket Value', context: 'Any', correct_low: '2', correct_high: '30' },
      { kind: 'window', name: 'Ordinary Tuesday' },
    ] },
    config: { rows: [
      { kind: 'channel', name: 'Shift Lead', channels: 'lead@example.com' },
      { kind: 'kbr', kbr: 'Daily Revenue', unit: 'USD', format: 'currency', direction: 'up', target: '1800' },
      { kind: 'baseline', kbr: 'Daily Revenue', name: 'observed', op: 'eq', value: '1764' },
      { kind: 'answer', kbr: 'Daily Revenue', name: 'Best Day', unit: 'USD', measure: 'Ticket Value', aggregation: 'sum' },
      { kind: 'risk', kbr: 'Daily Revenue', name: 'Seat Occupancy', dna: 'Analog', weight: 'MED' },
      { kind: 'condition', kbr: 'Daily Revenue', name: 'Takings low', op: 'lt', value: '1400', channels: 'Shift Lead' },
      { kind: 'kbr', kbr: 'Service Time', unit: 'min', format: 'count', direction: 'down', target: '4' },
      { kind: 'baseline', kbr: 'Service Time', name: 'observed', op: 'eq', value: '4.3' },
      { kind: 'answer', kbr: 'Service Time', name: 'Slowest Window', unit: 'min', measure: 'Prep Duration', aggregation: 'mean' },
      { kind: 'risk', kbr: 'Service Time', name: 'Prep Duration', dna: 'Digital', weight: 'HVY' },
      { kind: 'condition', kbr: 'Service Time', name: 'Prep slow', op: 'gt', value: '4', channels: 'Shift Lead' },
    ] },
  };
}

console.log('\n1 \u00b7 the clean bundle is clean');
{
  const r = V.validate(clean());
  ok('no rejects, no warnings', r.counts.total === 0,
     r.items.map(i => i.code).join(' ') || 'silent');
}

console.log('\n2 \u00b7 mining, Aug 2026 \u2014 target 3x the observed baseline');
{
  const b = clean();
  b.config.rows[1].target = '0.478';
  b.config.rows[2].value = '0.1586';
  const r = V.validate(b);
  ok('X-TARGET fires', has(r, 'X-TARGET'));
  ok('and it warns rather than rejects', level(r, 'X-TARGET') === 'warn');
}

console.log('\n3 \u00b7 mining \u2014 an alarm threshold the data can never reach');
{
  const b = clean();
  b.config.rows[1].target = '';
  b.config.rows[2].value = '0.1586';
  b.config.rows[5].op = 'gt';
  b.config.rows[5].value = '0.52';
  b.config.rows[1].target = '0.16';
  const r = V.validate(b);
  ok('X-UNREACHABLE fires', has(r, 'X-UNREACHABLE'));
}

console.log('\n4 \u00b7 mining \u2014 a condition with nothing able to detect it');
{
  const b = clean();
  b.config.rows = b.config.rows.filter(r => !(r.kind === 'risk' && r.kbr === 'Service Time'));
  const r = V.validate(b);
  ok('C-HALFRISK fires', has(r, 'C-HALFRISK'));
  ok('names the right result', r.items.some(i => i.code === 'C-HALFRISK' && i.subject === 'Service Time'));
}

console.log('\n5 \u00b7 mining \u2014 an hours result answered in mph');
{
  const b = clean();
  b.config.rows[8].unit = 'mph';
  const r = V.validate(b);
  ok('X-ANSUNIT fires', has(r, 'X-ANSUNIT'));
}

console.log('\n6 \u00b7 logistics, Aug 2026 \u2014 lower-is-better declared as up');
{
  const b = clean();
  b.config.rows[6].direction = 'up';
  const r = V.validate(b);
  ok('X-DIR fires', has(r, 'X-DIR'));
  ok('and it REJECTS \u2014 this inverts the health reading',
     level(r, 'X-DIR') === 'reject');
}

console.log('\n7 \u00b7 sixteen of seventeen industries \u2014 no answers declared');
{
  const b = clean();
  b.config.rows = b.config.rows.filter(r => r.kind !== 'answer');
  const r = V.validate(b);
  ok('C-NOANSWERS fires for both results',
     r.items.filter(i => i.code === 'C-NOANSWERS').length === 2);
}

console.log('\n8 \u00b7 binding drift \u2014 config names a field the data does not have');
{
  const b = clean();
  b.config.rows[3].measure = 'Truck Payload-Communication Gateway #2';
  const r = V.validate(b);
  ok('X-NOFIELD fires', has(r, 'X-NOFIELD'));
  ok('and it REJECTS \u2014 the binding resolves to nothing',
     level(r, 'X-NOFIELD') === 'reject');
}

console.log('\n9 \u00b7 the journey doc and the config doc disagree about what exists');
{
  const b = clean();
  b.config.rows[1].kbr = 'Revenue';
  const r = V.validate(b);
  ok('X-NOJRESULT fires', has(r, 'X-NOJRESULT'));
  ok('and it REJECTS', level(r, 'X-NOJRESULT') === 'reject');
}

console.log('\n10 \u00b7 journey doc structure');
{
  let b = clean();
  b.journey.rows.push({ kind: 'touchpoint', name: 'Orphan', parent: 'Nowhere', observes: 'x' });
  ok('J-NOPARENT fires', has(V.validate(b), 'J-NOPARENT'));

  b = clean();
  b.journey.rows[4].observes = 'Truck Payload-Communication Gateway #2';
  ok('J-COLUMNISH fires \u2014 a journey welded to one dataset',
     has(V.validate(b), 'J-COLUMNISH'));

  b = clean();
  b.journey.rows = b.journey.rows.filter(r => r.kind !== 'stage');
  ok('J-NOSTAGES rejects an empty journey', level(V.validate(b), 'J-NOSTAGES') === 'reject');
}

console.log('\n11 \u00b7 data doc contract');
{
  let b = clean();
  b.data.rows = b.data.rows.filter(r => r.kind !== 'dataset');
  ok('D-NODATASET rejects \u2014 the clock cannot run', level(V.validate(b), 'D-NODATASET') === 'reject');

  b = clean();
  b.data.rows[0].mode = 'replay';
  b.data.rows = b.data.rows.filter(r => r.kind !== 'field');
  ok('D-NOFIELDS rejects replay with nothing to play',
     level(V.validate(b), 'D-NOFIELDS') === 'reject');

  b = clean();
  b.data.rows = b.data.rows.filter(r => r.kind !== 'limit');
  ok('D-NOLIMITS warns \u2014 thresholds would have to be inferred',
     level(V.validate(b), 'D-NOLIMITS') === 'warn');
}

console.log('\n12 \u00b7 optionality \u2014 an empty section is legal, a half-filled one is not');
{
  const b = clean();
  b.config.rows = b.config.rows.filter(r =>
    !(r.kbr === 'Service Time' && (r.kind === 'risk' || r.kind === 'condition')));
  const r = V.validate(b);
  ok('no C-HALFRISK when BOTH are absent',
     !r.items.some(i => i.code === 'C-HALFRISK' && i.subject === 'Service Time'));
  ok('and no rejects \u2014 unconfigured is legal', r.counts.rejects === 0);
}

console.log('\n' + pass + ' passed \u00b7 ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
