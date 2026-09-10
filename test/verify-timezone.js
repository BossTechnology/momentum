/* ═══════════════════════════════════════════════════════════════════════════
   test/verify-timezone.js — an instant means the same thing everywhere

   The defect this condemns, measured on the pre-fix build before a line was
   written. One document, "2026-08-05 15:00:00" on a 07:00Z span:

     UTC      accepted  -> 0.3333
     Bogota   accepted  -> 0.5417   five hours out, silently
     Tokyo    REFUSED   -> "that instant falls outside the declared span"

   Three behaviours for one string. The Tokyo case is the worst of them: the
   instant is INSIDE the span, and the locally-guessed offset pushed it out —
   so the refusal's stated reason was false. That is the fourth law failing in
   the product rather than in a comment.

   Two further things the measurement turned up:

     - _clock-core.js documented the opposite of what it did. Its comment said
       the honest answer was "to say so rather than to guess an offset"; the
       next line called Date.parse on an unqualified string, which guesses
       exactly one.
     - _datadoc-core.js had already diagnosed this correctly and fixed the
       HH:MM branch with setUTCHours, then left the absolute-datetime fallback
       on the local parse. The right diagnosis, applied to half the problem.

   What is asserted here is not "the numbers are right" — they were right in
   UTC before the fix. It is that the SAME input yields the SAME instant
   regardless of where the reader sits, that an explicit offset is never
   overridden, and that an assumed reading is DISCLOSED rather than silently
   chosen.

   This suite sets process.env.TZ and re-requires the cores per zone, so it
   fails on a UTC machine too. A test that only catches this when the CI box
   happens to sit outside UTC is the wrong way round: it makes the defect
   invisible exactly where the code is written.

   Negative control against the pre-fix build: the cross-zone assertions FAIL
   (and the Tokyo case fails on a false refusal), rather than crashing.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  · ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  · ' + detail : '')); }
};

/* Load the cores fresh under a given zone. TZ is read by the engine when a
   Date is constructed, so a fresh context per zone is enough — the sources are
   the SHIPPED files, required verbatim. */
function underTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  const sandbox = { console, TextDecoder, Date, Math, JSON, setTimeout, RegExp, Error,
    isFinite, isNaN, parseFloat, parseInt, String, Number, Boolean, Array, Object,
    Map, Set, Uint8Array, ArrayBuffer, DataView, Buffer, Promise };
  sandbox.self = sandbox; sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['_configdoc-core.js', '_datadoc-core.js', '_clock-core.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'api', f), 'utf8'),
                    sandbox, { filename: f });
  let out;
  try { out = fn(sandbox.MOMENTUM); }
  finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
  return out;
}

const ZONES = ['UTC', 'America/Bogota', 'Asia/Tokyo', 'Europe/Madrid', 'Pacific/Kiritimati'];
const ORIGIN = Date.parse('2026-08-05T07:00:00Z');
const SPAN   = 86399000;
const ctx = () => ({ originMs: ORIGIN, spanMs: SPAN, windows: [] });

const resolve = (M, s) => M.Clock.parseOpening(s, ctx());

console.log('\nTimezone · an instant means the same thing everywhere\n');
console.log('zones under test: ' + ZONES.join(', ') + '\n');

/* ── 1 · an unqualified date-time is offset-independent ──────────────────── */
console.log('1 · the same string resolves to the same instant in every zone');
const SUBJECT = '2026-08-05 15:00:00';
const results = ZONES.map(tz => ({ tz, r: underTZ(tz, M => resolve(M, SUBJECT)) }));

ok('it is accepted in every zone',
   results.every(x => x.r && x.r.ok),
   results.filter(x => !(x.r && x.r.ok)).map(x => x.tz).join(', ') || 'all accepted');

const insts = results.filter(x => x.r && x.r.ok).map(x => x.r.atMs);
ok('every zone resolves it to the same instant',
   insts.length === ZONES.length && new Set(insts).size === 1,
   new Set(insts).size + ' distinct instant(s) across ' + ZONES.length + ' zones');

ok('that instant is the UTC reading, matching the caption',
   insts.length > 0 && insts[0] === Date.parse('2026-08-05T15:00:00Z'),
   insts.length ? new Date(insts[0]).toISOString() : 'n/a');

const fracs = results.filter(x => x.r && x.r.ok).map(x => x.r.fraction);
ok('the resolved position is identical in every zone',
   new Set(fracs.map(f => f.toFixed(9))).size === 1,
   fracs.length ? fracs[0].toFixed(6) : 'n/a');

/* This is the assertion that would have caught the original defect. */
const bogota = results.filter(x => x.tz === 'America/Bogota')[0];
const utc    = results.filter(x => x.tz === 'UTC')[0];
ok('a reader five hours from UTC sees what a reader in UTC sees',
   bogota.r.ok && utc.r.ok && bogota.r.atMs === utc.r.atMs,
   'pre-fix these differed by exactly 5 h');

const tokyo = results.filter(x => x.tz === 'Asia/Tokyo')[0];
ok('a reader nine hours from UTC is not refused a valid instant',
   tokyo.r.ok === true,
   'pre-fix this was REFUSED with a reason that was false');

/* ── 2 · an explicit offset is honoured, never overridden ────────────────── */
console.log('\n2 · an explicit offset is authoritative');
for (const spec of [['2026-08-05T15:00:00Z', '2026-08-05T15:00:00.000Z', true],
                    ['2026-08-05T15:00:00-05:00', '2026-08-05T20:00:00.000Z', true],
                    /* +09:00 is 06:00Z, genuinely before the 07:00Z origin. It
                       must be refused — and refused the SAME way everywhere.
                       Agreement is the property under test, not acceptance. */
                    ['2026-08-05T15:00:00+09:00', null, false]]) {
  const got = ZONES.map(tz => underTZ(tz, M => resolve(M, spec[0])));
  const allOk = got.every(r => r && r.ok === true);
  const allNo = got.every(r => r && r.ok === false);
  let agree, detail;
  if (spec[2]) {
    agree = allOk && new Set(got.map(r => r.atMs)).size === 1 &&
            new Date(got[0].atMs).toISOString() === spec[1];
    detail = allOk ? new Date(got[0].atMs).toISOString() : 'diverged';
  } else {
    agree = allNo && new Set(got.map(r => r.why)).size === 1;
    detail = allNo ? 'refused identically in all ' + ZONES.length + ' zones' : 'diverged';
  }
  ok('"' + spec[0] + '" is read as written in every zone', agree, detail);
}

/* +09:00 lands before the 07:00Z origin, so it is legitimately outside the
   span. The refusal must be TRUE, not merely present. */
const early = underTZ('UTC', M => resolve(M, '2026-08-05T15:00:00+09:00'));
ok('an instant genuinely outside the span is refused for the true reason',
   early && early.ok === false && /outside the declared span/.test(early.why || ''),
   early && early.why);

/* ── 3 · the assumed reading is disclosed ────────────────────────────────── */
console.log('\n3 · an assumed reading is disclosed, not silently chosen');
const unq = underTZ('America/Bogota', M => resolve(M, SUBJECT));
ok('an unqualified time reports that UTC was assumed',
   unq.ok && unq.assumedUTC === true);
const qual = underTZ('America/Bogota', M => resolve(M, '2026-08-05T15:00:00Z'));
ok('an explicitly qualified time reports that nothing was assumed',
   qual.ok && qual.assumedUTC === false);
const off = underTZ('America/Bogota', M => resolve(M, '2026-08-05T15:00:00-05:00'));
ok('an explicit non-UTC offset reports that nothing was assumed',
   off.ok && off.assumedUTC === false);
ok('the disclosure distinguishes the two, rather than always claiming UTC',
   unq.assumedUTC !== qual.assumedUTC);

/* A percentage or a ratio names no instant, so it must not claim a reading. */
for (const s of ['50%', '1/3']) {
  const r = underTZ('Asia/Tokyo', M => resolve(M, s));
  ok('"' + s + '" resolves without asserting a timezone reading',
     r.ok && r.assumedUTC === undefined, 'how=' + r.how);
}

/* ── 4 · date-only and date-time no longer disagree ──────────────────────── */
console.log('\n4 · adjacent forms no longer carry different semantics');
const dOnly = ZONES.map(tz => underTZ(tz, M => resolve(M, '2026-08-06')));
ok('a date-only form is offset-independent',
   dOnly.every(r => r && r.ok) && new Set(dOnly.map(r => r.atMs)).size === 1,
   dOnly[0] && dOnly[0].ok ? new Date(dOnly[0].atMs).toISOString() : 'n/a');
ok('a date-only form lands on the day it names, in every zone',
   dOnly.every(r => r.ok && new Date(r.atMs).toISOString().slice(0, 10) === '2026-08-06'));
ok('a date-only form also discloses that UTC was assumed',
   dOnly.every(r => r.ok && r.assumedUTC === true),
   'ECMAScript reads date-only as UTC and date-time as local; the reader ' +
   'was never told either way');

/* ── 5 · one authority, not two derivations ──────────────────────────────── */
console.log('\n5 · both cores resolve through one parser');
ok('DataDoc exposes the single instant parser',
   underTZ('UTC', M => typeof M.DataDoc.toInstantMs === 'function'));
ok('Clock refuses rather than deriving its own reading if it is absent',
   underTZ('UTC', M => {
     if (!M.DataDoc || typeof M.DataDoc.toInstantMs !== 'function') return false;
     const saved = M.DataDoc.toInstantMs;
     delete M.DataDoc.toInstantMs;
     const r = M.Clock.parseOpening('2026-08-05 15:00:00', ctx());
     M.DataDoc.toInstantMs = saved;
     return r && r.ok === false && /parser is unavailable/.test(r.why || '');
   }),
   'a second derivation is how two modules drift apart');
/* Guarded: on a build without the shared parser this must FAIL, not throw. A
   suite that crashes reports the defect as a stack trace and abandons every
   check after it. */
const viaDoc = underTZ('Asia/Tokyo', M =>
  M.DataDoc && typeof M.DataDoc.toInstantMs === 'function'
    ? M.DataDoc.toInstantMs('2026-08-05 15:00:00') : null);
const viaClk = underTZ('Asia/Tokyo', M => resolve(M, '2026-08-05 15:00:00'));
ok('both cores agree on the instant, in a non-UTC zone',
   !!viaDoc && !!viaClk && viaClk.ok === true && viaDoc.ms === viaClk.atMs,
   viaDoc ? new Date(viaDoc.ms).toISOString() : 'no shared parser to agree with');

/* ── 6 · no source file still parses an unqualified time locally ─────────── */
console.log('\n6 · the local parse is gone from the resolution path');
const clockSrc = fs.readFileSync(path.join(__dirname, '..', 'api', '_clock-core.js'), 'utf8');
const docSrc   = fs.readFileSync(path.join(__dirname, '..', 'api', '_datadoc-core.js'), 'utf8');
ok('_clock-core no longer calls Date.parse on the opening string',
   !/Date\.parse\(s\.replace\(' ', 'T'\)\)/.test(clockSrc));
ok('_datadoc-core no longer calls Date.parse on the instant string',
   !/var abs = Date\.parse\(s\.replace\(' ', 'T'\)\)/.test(docSrc));
ok('_clock-core no longer claims a discipline it does not practise',
   !/is to say so rather than to guess an offset\.\s*\*\//.test(clockSrc),
   'the comment now records what the code actually does');

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
