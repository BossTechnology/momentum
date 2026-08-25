/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.Clock — simulation time, the warm-up window, and the playhead

   SIM TIME IS NOT WALL TIME AND THE DIFFERENCE IS NOT COSMETIC. Before this
   module the board mapped wall time onto the profiled span at 1:1 and wrapped.
   That was serviceable while the rate was one, and it hid two faults that only
   appear the moment the rate is anything else.

   FAULT ONE — PERSISTENCE. Thresholds.applyPersistence counted wall-clock
   ticks: a declared 120 s landed after 120 real seconds, which was right only
   because a real second and a simulated second happened to be the same thing.
   Measured before this change, at the normal cadence a 120 s requirement took
   134 ticks; at a 600× rate those same 134 ticks span 72,360 seconds of
   simulated time — twenty simulated hours for a threshold that asked for two
   minutes. Nothing would ever escalate, and a board where nothing escalates
   looks calm rather than broken. Persistence is therefore counted in
   SIMULATED milliseconds here, and callers pass what the clock advanced, not
   what the wall did.

   FAULT TWO — READING AHEAD. The data for the whole span exists in memory from
   the first frame. Asked "which truck burned most fuel today" at 09:00, any
   consumer that reaches into the profile gets 15:00's answer, and the answer
   is plausible, well-formatted and wrong. Asking every consumer to remember to
   stop at the playhead is a discipline, and disciplines fail silently. So the
   clock owns the readable window: window() and readable() return a range
   already truncated at the playhead, and bound() clamps any instant. A
   consumer that goes through the clock cannot read the future; one that does
   not go through the clock is the thing to look for in review.

   THE WARM-UP IS RUN, NOT ASSERTED. A demo should open mid-scenario. It would
   be cheaper to compute the state at the playhead directly and skip the
   history — but persistence is path-dependent. Whether a threshold held for
   120 consecutive seconds cannot be known without walking those seconds, so a
   seek would have to either walk them anyway or invent them, and inventing
   them is the fault this module exists to prevent. warmUp() therefore runs the
   engine headless from the origin to the opening position at full grain. When
   that would cost more than the budget allows it REFUSES and says so, rather
   than striding — sampling is for previews, never for persistence.

   WHERE THE OPENING POSITION COMES FROM. A fraction of the declared span, not
   a clock time: "a third of the way in" means the same thing to a 24-hour
   mining shift and a 90-day claims cycle, where "15:00" means nothing to the
   second. Absolute instants and named windows are accepted as INPUT and
   resolved to a fraction whenever a calendar exists. Three sources, in
   precedence order:

     config    the industry's own default, declared in config/<industry>.csv
     declared  a Data Doc naming an opening window — a document outranks a
               template, here as everywhere
     session   the person's Settings control, which outranks both and is NOT
               written back into configuration: a chosen warm-up is UI state
               and configuration objects hold no UI state

   Nothing declared anywhere opens at the origin. Nothing bound means nothing
   changes.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

/* Walking a 24-hour span at one-second grain is 86,400 steps per stream. The
   budget is a step count rather than a duration because a duration would make
   the same warm-up succeed on one machine and fail on another. */
var DEFAULT_BUDGET = 250000;
var DEFAULT_GRAIN = 1;

function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
function norm(s) { return String(s == null ? '' : s).trim(); }
function key(s) { return norm(s).toLowerCase(); }

/* ── reading an opening position ──────────────────────────────────────────
   Four spellings, one meaning. A bare number is a fraction if it is in 0..1
   and a percentage if it is not, because "33" and "0.33" are both things
   people write in a spreadsheet cell and neither is ambiguous in context. */
function parseOpening(v, ctx) {
  ctx = ctx || {};
  var raw = v;
  if (v == null || norm(v) === '') return { ok: false, why: 'nothing declared' };

  if (typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(norm(v))) {
    var n = num(v);
    if (n == null) return { ok: false, why: 'not a number: ' + raw };
    var f = n > 1 ? n / 100 : n;
    if (f < 0 || f > 1)
      return { ok: false, why: 'an opening position must fall inside the span: ' + raw };
    return { ok: true, fraction: f, how: 'fraction', input: raw };
  }

  var s = norm(v);
  /* "1/3" rather than "0.3333". A third of a 24-hour span is 08:00 exactly;
     the decimal that fits in a spreadsheet cell is 08:00 minus eight seconds,
     and the demo opens at 14:59. Precision should not be something a person
     has to get right by typing more digits. */
  var frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    var a = num(frac[1]), b = num(frac[2]);
    if (a == null || b == null || b === 0)
      return { ok: false, why: 'not a usable ratio: ' + raw };
    var fr = a / b;
    if (fr < 0 || fr > 1)
      return { ok: false, why: 'an opening position must fall inside the span: ' + raw };
    return { ok: true, fraction: fr, how: 'ratio', input: raw };
  }
  if (/%$/.test(s)) {
    var p = num(s.replace(/%$/, ''));
    if (p == null || p < 0 || p > 100)
      return { ok: false, why: 'not a percentage of the span: ' + raw };
    return { ok: true, fraction: p / 100, how: 'percent', input: raw };
  }

  /* A named window — the Data Doc's `window` rows. Opening AT a window means
     opening at the moment it starts, so the demo begins as that window does. */
  var windows = ctx.windows || [];
  for (var i = 0; i < windows.length; i++) {
    if (key(windows[i].name) === key(s)) {
      var w = windows[i];
      if (w.startsMs == null) return { ok: false, why: 'window "' + s + '" declares no start' };
      var fw = toFraction(w.startsMs, ctx);
      if (fw == null) return { ok: false, why: 'window "' + s + '" falls outside the span' };
      return { ok: true, fraction: fw, how: 'window', input: raw, window: w.name };
    }
  }

  /* An absolute instant. Only meaningful once a calendar has been declared;
     without one there is no origin to measure it from, and the honest answer
     is to say so rather than to guess an offset. */
  var t = Date.parse(s.replace(' ', 'T'));
  if (!isNaN(t)) {
    if (ctx.originMs == null)
      return { ok: false, why: 'an absolute time needs a declared calendar; ' +
                              'use a percentage of the span instead' };
    var fa = toFraction(t, ctx);
    if (fa == null) return { ok: false, why: 'that instant falls outside the declared span: ' + raw };
    return { ok: true, fraction: fa, how: 'instant', input: raw, atMs: t };
  }

  if (windows.length)
    return { ok: false, why: 'not a percentage, an instant, or a declared window: ' + raw };
  return { ok: false, why: 'not a percentage or an instant: ' + raw };
}

function toFraction(ms, ctx) {
  if (ctx.originMs == null || !ctx.spanMs) return null;
  var f = (ms - ctx.originMs) / ctx.spanMs;
  if (f < 0 || f > 1) return null;
  return f;
}

/* ── the three tiers ──────────────────────────────────────────────────────
   Precedence is session, then document, then config. Each is reported by name
   so a surface can say WHERE the opening position came from; a warm-up that
   silently overrides a document is how a demo starts in the wrong place. */
var TIERS = [
  { key: 'session',  label: 'Settings' },
  { key: 'declared', label: 'the Data Doc' },
  { key: 'config',   label: 'the industry default' }
];

function resolveWarmup(sources, ctx) {
  sources = sources || {};
  ctx = ctx || {};
  var refused = [];
  for (var i = 0; i < TIERS.length; i++) {
    var t = TIERS[i];
    if (!(t.key in sources)) continue;
    var v = sources[t.key];
    if (v == null || norm(v) === '') continue;
    var r = parseOpening(v, ctx);
    if (r.ok)
      return { fraction: r.fraction, source: t.key, label: t.label,
               how: r.how, input: r.input, window: r.window || null,
               refused: refused };
    /* A declared opening that cannot be read is refused and reported, never
       quietly replaced by the tier below it. Refuse, don't demote. */
    refused.push({ source: t.key, label: t.label, input: v, why: r.why });
  }
  return { fraction: 0, source: 'none', label: 'the start of the span',
           how: 'origin', input: null, window: null, refused: refused };
}

/* ── the clock ───────────────────────────────────────────────────────────── */

function create(decl) {
  decl = decl || {};
  var originMs = decl.originMs == null ? null : +decl.originMs;
  var endMs = decl.endMs == null ? null : +decl.endMs;
  var spanMs = (originMs != null && endMs != null) ? Math.max(1, endMs - originMs) : 0;
  var grainSec = num(decl.grainSec) || DEFAULT_GRAIN;
  var rate = num(decl.rate) || 1;
  var windows = (decl.windows || []).slice();
  var budget = num(decl.budget) || DEFAULT_BUDGET;

  var playhead = originMs;
  var warmedTo = null;

  function ctx() {
    return { originMs: originMs, spanMs: spanMs, windows: windows };
  }

  var api = {
    /* ── shape ── */
    origin: function () { return originMs; },
    end: function () { return endMs; },
    spanMs: function () { return spanMs; },
    grainSec: function () { return grainSec; },
    windows: function () { return windows.slice(); },
    rate: function () { return rate; },
    setRate: function (r) { var n = num(r); if (n && n > 0) rate = n; return rate; },
    budget: function () { return budget; },

    /* ── the playhead ──
       advance() is the only way sim time moves, and it returns the SIMULATED
       milliseconds it moved. That return value is what persistence counts. */
    playhead: function () { return playhead; },
    advance: function (realMs) {
      if (originMs == null) return 0;
      var simMs = Math.max(0, num(realMs) || 0) * rate;
      var next = playhead + simMs;
      if (endMs != null && next > endMs) { simMs = Math.max(0, endMs - playhead); next = endMs; }
      playhead = next;
      return simMs;
    },
    /* What one tick of the wall buys in simulated time. Callers that count
       persistence ask this rather than reaching for the paint interval. */
    simMsPerTick: function (realMs) { return Math.max(0, num(realMs) || 0) * rate; },
    seek: function (ms) {
      if (originMs == null) return null;
      var t = +ms;
      if (!isFinite(t)) return playhead;
      playhead = Math.min(endMs == null ? t : endMs, Math.max(originMs, t));
      return playhead;
    },
    atEnd: function () { return endMs != null && playhead >= endMs; },
    /* How far through the span the playhead sits, 0..1. */
    progress: function () {
      if (originMs == null || !spanMs) return 0;
      return Math.min(1, Math.max(0, (playhead - originMs) / spanMs));
    },

    /* ── the readable window ──
       Everything a consumer is allowed to see, and nothing past the playhead.
       `clamped` is reported rather than hidden: a caller that asked for the
       future should be able to tell that it did not get it. */
    bound: function (ms) {
      if (playhead == null) return ms;
      var t = +ms;
      if (!isFinite(t)) return playhead;
      return Math.min(t, playhead);
    },
    window: function (fromMs, toMs) {
      var lo = fromMs == null ? originMs : Math.max(originMs, +fromMs);
      var wanted = toMs == null ? playhead : +toMs;
      var hi = Math.min(wanted, playhead);
      if (hi < lo) hi = lo;
      return { fromMs: lo, toMs: hi, clamped: wanted > playhead,
               requestedToMs: wanted };
    },
    readable: function () {
      return { fromMs: originMs, toMs: playhead, clamped: false, requestedToMs: playhead };
    },
    /* Drop anything a consumer holds that the playhead has not reached. `at`
       names the field carrying the instant. */
    visible: function (rows, at) {
      var f = at || 'atMs';
      var p = playhead;
      return (rows || []).filter(function (r) {
        var t = r && r[f] != null ? +r[f] : null;
        return t == null ? false : t <= p;
      });
    },

    /* ── the warm-up ── */
    resolve: function (sources) { return resolveWarmup(sources, ctx()); },
    openingFor: function (fraction) {
      if (originMs == null) return null;
      return originMs + Math.min(1, Math.max(0, num(fraction) || 0)) * spanMs;
    },
    /* What running the warm-up would cost, before running it. `streams` is the
       number of independent series walked in step — ten trucks walk together,
       so the step count is the span, not the span times ten. */
    plan: function (fraction, opts) {
      opts = opts || {};
      var f = Math.min(1, Math.max(0, num(fraction) || 0));
      var target = api.openingFor(f);
      var depthMs = target == null ? 0 : target - originMs;
      var steps = Math.ceil((depthMs / 1000) / grainSec);
      var cap = num(opts.budget) || budget;
      return { fraction: f, targetMs: target, depthMs: depthMs, steps: steps,
               grainSec: grainSec, budget: cap, withinBudget: steps <= cap,
               why: steps <= cap ? '' :
                 'Opening ' + Math.round(f * 100) + '% into the span means walking ' +
                 steps.toLocaleString() + ' steps at ' + grainSec + 's grain, over the ' +
                 cap.toLocaleString() + '-step budget. Choose an earlier opening or ' +
                 'raise the budget — the history is walked in full or not at all.' };
    },
    /* Run it. `step(simMs, stepSimMs, i)` is called once per grain from the
       origin to the opening position, in order, with nothing skipped. Returns
       what happened; refuses rather than striding when the budget is short. */
    warmUp: function (step, opts) {
      opts = opts || {};
      var p = api.plan(opts.fraction == null ? api.progress() : opts.fraction, opts);
      if (originMs == null)
        return { ok: false, ran: 0, why: 'no span is declared, so there is no history to walk' };
      if (!p.withinBudget) return { ok: false, ran: 0, plan: p, why: p.why };
      var stepMs = p.grainSec * 1000;
      playhead = originMs;
      for (var i = 0; i < p.steps; i++) {
        playhead = Math.min(p.targetMs, playhead + stepMs);
        if (typeof step === 'function') step(playhead, stepMs, i);
      }
      playhead = p.targetMs == null ? originMs : p.targetMs;
      warmedTo = playhead;
      return { ok: true, ran: p.steps, plan: p, playhead: playhead };
    },
    warmedTo: function () { return warmedTo; },

    /* A label for the opening position. Says the fraction always and the clock
       time only when a calendar makes one meaningful. */
    label: function (fraction) {
      var f = Math.min(1, Math.max(0, num(fraction) || 0));
      var pct = Math.round(f * 100) + '%';
      var at = api.openingFor(f);
      if (at == null || !decl.calendar) return pct;
      /* Rounded to the nearest minute, not truncated. The mining span ends at
         06:59:59 rather than 07:00:00, so it is 86,399,000 ms and a third of
         it lands at 14:59:59.7 — a caption reading 14:59 for a demo that opens
         at 15:00 is a small lie, and the kind that gets quoted back. */
      var d = new Date(at + 30000);
      var hh = ('0' + d.getUTCHours()).slice(-2), mm = ('0' + d.getUTCMinutes()).slice(-2);
      return pct + ' · ' + hh + ':' + mm;
    }
  };
  return api;
}

MOMENTUM.Clock = {
  version: 1,
  DEFAULT_BUDGET: DEFAULT_BUDGET,
  DEFAULT_GRAIN: DEFAULT_GRAIN,
  TIERS: TIERS,
  create: create,
  parseOpening: parseOpening,
  resolveWarmup: resolveWarmup
};

})();
