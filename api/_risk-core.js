/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.Risk — the Risk Meter engine              (Build Spec §5, Phase 6)

   BOb's risk workspace, adopted wholesale and adapted for hierarchy. Every
   constant below was read directly out of BOb_Sim_3-5.html and the line
   numbers were checked one at a time, so a later reader can verify rather
   than trust:

     SPD_MS                    1186   [4000,2500,1500,800,280]
     getCooldownMs             4323   SPD_MS[CFG.speed-1]*15
     deriveSeverity            4326   ticksInBreach>20 -> 'critical'
     sustained-breach cut      4328   the >20 line itself
     magnitude cut             4331   pct>=0.2 -> critical, else warning
     proximity bands       4393-4394  <=0.1 urgent (fast) · <=0.2 warning (slow)
     PEAK_WINDOWS              4316   [{start:9,end:11},{start:14,end:16}]
     isInPeakWindow            4317   new Date().getHours()
     known-unknown modes   2743-2745  contains · frequency · pattern
     Known vs Unknown      2770-2771  the two anomaly families
     Alert/Alarm/Action    2585-2587  and again at 2698-2700
     per-severity responses     2805  rules.unknown[sev], sev in critical|warning
     black-bar enrichment  2051,2090  a.chPerf on a --black bar
     getChannelPerfForMetric   4136   what fills that bar

   Three things are deliberately NOT ported
   ────────────────────────────────────────
   1 · BOb branches on metric id — 'sessions', 'nps', 'sentiment' (2110-2113,
       2460-2470, 2510-2512). A hierarchy has no fixed metric list, so the
       options are derived from the scoped item's FORMAT and DIRECTION, both
       of which Phase 5 already made explicit.
   2 · BOb's exception is a clock and only a clock (4316-4320). Generalised
       here to operational context. HT-010 carries startISO null and
       windowType "Recurrente por segmento" — it is not localised in time at
       all, it is localised in the ground the truck drives over. The clock is
       kept as one dimension among several, addressed as '__hour', so BOb's
       peak-time behaviour survives as a configuration rather than as the
       only shape available.
   3 · BOb escalates from several places. Here only the Risk Meter escalates.
       Pace, answers and touchpoint performance produce facts and hand them
       over — the one-notifier law.

   Optionality
   ───────────
   Nothing in this file fires on its own. No risk touchpoints, no exception
   and no conditions beyond the migrated legacy set means a KBR produces the
   number it produced before this phase existed.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

/* ═══ 1 · escalation constants, ported ═════════════════════════════════════ */

var SPD_MS          = [4000, 2500, 1500, 800, 280];  /* BOb 1186 */
var COOLDOWN_TICKS  = 15;    /* BOb 4323 */
var SUSTAINED_TICKS = 20;    /* BOb 4328 */
var CRITICAL_PCT    = 0.2;   /* BOb 4331 */
var PROX_URGENT     = 0.1;   /* BOb 4393 */
var PROX_WARNING    = 0.2;   /* BOb 4394 */

function cooldownMs(speed){
  var i = (speed == null ? 3 : speed) - 1;
  if(i < 0) i = 0;
  if(i >= SPD_MS.length) i = SPD_MS.length - 1;
  return SPD_MS[i] * COOLDOWN_TICKS;
}

/* BOb 4326. Sustained breach outranks magnitude: a small breach that will not
   go away is worse than a large one that already has. */
function deriveSeverity(val, thresh, type, ticksInBreach){
  if(ticksInBreach > SUSTAINED_TICKS) return 'critical';
  var diff = type === 'upper' ? (val - thresh) : (thresh - val);
  var pct = thresh > 0 ? diff / thresh : 0;
  return pct >= CRITICAL_PCT ? 'critical' : 'warning';
}

/* BOb 4381-4396. Distance to the nearer threshold as a fraction of that
   threshold — and evaluated ONLY when not already in breach, because a breach
   clears both pulse classes rather than adding a third. */
function proximity(val, upper, lower){
  if(val == null || !isFinite(val)) return null;
  if(upper == null && lower == null) return null;
  if((upper != null && val > upper) || (lower != null && val < lower))
    return { state: 'breach', proximity: 0, pulse: null };
  var p = 1;
  if(upper != null && upper > 0) p = Math.min(p, (upper - val) / upper);
  if(lower != null && lower > 0) p = Math.min(p, (val - lower) / lower);
  if(p <= PROX_URGENT)  return { state: 'urgent',  proximity: p, pulse: 'fast' };
  if(p <= PROX_WARNING) return { state: 'warning', proximity: p, pulse: 'slow' };
  return { state: 'clear', proximity: p, pulse: null };
}

/* ═══ 2 · the response taxonomy ════════════════════════════════════════════
   BOb 2585-2587 / 2698-2700, and the icon map at 2807. The glyphs travel with
   the meanings: one glyph must not mean two things across the two products. */

var TAXONOMY = {
  /* `glyph` is the monochrome mark the product draws. The colour emoji the
     taxonomy used to carry leaked into every condition row, so the bell in a
     Thresholds list was yellow while the bell in the tab bar was not. `emoji`
     keeps the original for anywhere prose genuinely wants one. */
  /* `svg` is what the product DRAWS — a real bell and a real bolt, inheriting
     currentColor. Substituting a lookalike codepoint fixed the colour and lost
     the meaning: a fisheye next to "falls below" reads as a bullet, not as an
     alarm. `emoji` is retained for prose that genuinely wants one. */
  alert:  { rank: 1, label: 'Alert',  glyph: '\u26a0\ufe0e', emoji: '\u26a0',
            notifies: false, acts: false, mark: 'warning',
            svg: '<svg class="tax-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' },
  alarm:  { rank: 2, label: 'Alarm',  glyph: '\u25c9',        emoji: '\ud83d\udd14',
            notifies: true,  acts: false, mark: 'bell',
            svg: '<svg class="tax-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>' },
  action: { rank: 3, label: 'Action', glyph: '\u26a1\ufe0e', emoji: '\u26a1',
            notifies: true,  acts: true,  mark: 'bolt',
            svg: '<svg class="tax-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' }
};
var RESPONSE_TYPES = ['alert', 'alarm', 'action'];
function taxonomyRank(kind){ return (TAXONOMY[kind] || TAXONOMY.alert).rank; }
function notifies(kind){ return !!(TAXONOMY[kind] || TAXONOMY.alert).notifies; }

/* ═══ 3 · anomaly families ═════════════════════════════════════════════════
   BOb 2770-2771 chooses between two, and they are not two settings of one
   thing — they ask different questions and carry different response shapes. */

var KNOWN_MODES = [                                   /* BOb 2743-2745 */
  { id: 'contains',  label: 'Contains keyword' },
  { id: 'frequency', label: 'Frequency exceeds' },
  { id: 'pattern',   label: 'Pattern detected' }
];
var UNKNOWN_SEVERITIES = ['critical', 'warning'];     /* BOb 2805 */

function newKnownRule(o){
  return Object.assign({ name: '', keywords: '', condition: 'contains',
                         responses: [] }, o || {});
}
function newAnomalyRules(){
  return { family: 'known', known: [], unknown: { critical: [], warning: [] } };
}
function newResponse(type){
  return { type: RESPONSE_TYPES.indexOf(type) >= 0 ? type : 'alert',
           name: '', channels: [], subject: '', message: '', url: '' };
}

/* ═══ 4 · options from format and direction ════════════════════════════════
   The replacement for BOb's metric-id branches. Phase 5 made every scoped
   item declare a format and a unit; direction says which way is bad. */

var OPS_BY_FORMAT = {
  currency:   [{ id: 'gt', label: 'rises above' },
               { id: 'lt', label: 'falls below' },
               { id: 'pct_change', label: 'changes by more than', unit: '%' }],
  count:      [{ id: 'gt', label: 'rises above' },
               { id: 'lt', label: 'falls below' },
               { id: 'pct_change', label: 'changes by more than', unit: '%' }],
  percentage: [{ id: 'gt', label: 'rises above' },
               { id: 'lt', label: 'falls below' },
               { id: 'pp_change', label: 'moves by more than', unit: 'pp' }],
  time:       [{ id: 'gt', label: 'runs longer than' },
               { id: 'lt', label: 'completes faster than' },
               { id: 'pct_change', label: 'changes by more than', unit: '%' }]
};

/* `item` is anything scoped: a KBR, a touchpoint, a source, an answer. It has
   to tell us its format; everything else has a defensible default. */
function optionsFor(item){
  var fmt = (item && item.format) || 'count';
  if(!OPS_BY_FORMAT[fmt]) fmt = 'count';
  var dir = (item && item.direction) || 'up';   /* 'up' = higher is better */
  var ops = OPS_BY_FORMAT[fmt].slice();
  /* Direction decides which comparison LEADS, never which ones exist. Lower
     is better means the interesting breach is the upward one. */
  var lead = dir === 'down' ? 'gt' : 'lt';
  ops.sort(function(a, b){ return (b.id === lead) - (a.id === lead); });
  return { format: fmt, direction: dir, unit: (item && item.unit) || '',
           ops: ops, responses: RESPONSE_TYPES.slice(),
           severities: UNKNOWN_SEVERITIES.slice(),
           references: REFERENCES.map(function(r){ return r.id; }) };
}

/* ═══ 5 · baseline-relative comparators ════════════════════════════════════
   The item deferred from §2 lands here. An absolute threshold cannot see a
   unit that is mechanically clean and still running above the peers it ought
   to match — every reading is inside every limit, and the fleet total hides
   it. The comparison needs a named reference rather than a number. */

var REFERENCES = [
  { id: 'fleet_median',    label: 'fleet median',       note: 'every comparable unit, this window' },
  { id: 'same_segment',    label: 'same segment',       note: 'units working the same ground' },
  { id: 'equivalent_unit', label: 'an equivalent unit', note: 'closest match by class and duty' },
  { id: 'own_30d',         label: 'its own 30-day',     note: 'the unit measured against itself' }
];
function referenceIds(){ return REFERENCES.map(function(r){ return r.id; }); }

function median(values){
  var vs = (values || []).filter(function(v){ return v != null && isFinite(v); }).slice();
  if(!vs.length) return null;
  vs.sort(function(a, b){ return a - b; });
  var m = Math.floor(vs.length / 2);
  return vs.length % 2 ? vs[m] : (vs[m - 1] + vs[m]) / 2;
}

/* `peers` is { ref, values[] } or { ref, base }. The engine never goes and
   fetches them — the caller owns that, because this file has to work with no
   profile bound at all. */
function baselinePct(sample, peers){
  if(sample == null || !isFinite(sample) || !peers) return null;
  var base = peers.base != null ? peers.base : median(peers.values);
  if(base == null || !base) return null;
  return { ref: peers.ref || 'fleet_median', base: base,
           pct: (sample - base) / base * 100,
           n: peers.values ? peers.values.length : null };
}

/* A baseline_pct condition fires on the signed excess in the bad direction. */
function evaluateBaseline(sample, peers, limitPct, direction){
  var r = baselinePct(sample, peers);
  if(!r) return null;
  var excess = direction === 'down' ? r.pct : -r.pct;  /* bad-direction excess */
  r.excess = excess;
  r.breached = limitPct != null && excess >= limitPct;
  return r;
}

/* ═══ 6 · the context exception ════════════════════════════════════════════
   BOb 4316-4320 suppresses inside two hard-coded hour ranges. Generalised: a
   window names a DIMENSION and the values of it that count. The clock becomes
   '__hour' — one dimension among stage, shift, segment and grade — so BOb's
   behaviour is reachable as configuration instead of being the only option.

   Suppression is never silent. exceptionFor returns the window that explains
   it so the Activity tab can say why, which is the whole difference between
   suppressing a false positive and hiding a real one. */

var CONTEXT_DIMENSIONS = ['__hour', 'stage', 'shift', 'segment', 'grade', 'zone'];
var EXCEPTION_MODES = ['off', 'manual', 'observed'];

function newException(o){
  return Object.assign({ mode: 'off', windows: [], learnedFrom: null }, o || {});
}

function inWindow(win, ctx){
  if(!win || !win.dimension || !ctx) return false;
  var v = ctx[win.dimension];
  if(v == null) return false;
  if(win.dimension === '__hour'){
    var h = Number(v);
    if(!isFinite(h)) return false;
    return (win.values || []).some(function(w){
      return (w && typeof w === 'object') ? (h >= w.start && h < w.end) : Number(w) === h;
    });
  }
  if(win.band && typeof v === 'number')
    return v >= win.band.lo && v <= win.band.hi;
  return (win.values || []).some(function(w){
    return String(w).toLowerCase() === String(v).toLowerCase();
  });
}

function exceptionFor(exc, ctx){
  if(!exc || exc.mode === 'off') return null;
  var ws = exc.windows || [];
  for(var i = 0; i < ws.length; i++) if(inWindow(ws[i], ctx)) return ws[i];
  return null;
}

/* Observed mode learns from the profile instead of being told.

   Three conditions, and all three are needed. Dropping any one of them makes
   this suppress real faults, which is the worst thing an exception can do.

     1 · not localised in time      — startISO and startMs both absent
     2 · localised in context       — it names a zone
     3 · no excess attributable to a fault — expectedExcess is zero

   The third is what separates context from fault, and it is why this is a
   rule rather than a special case. Two cases in this workbook satisfy 1 and 2
   and are genuine faults: "Vía en mal estado" at 6.81% and "Sobrecarga
   recurrente" at 5.62%. Both are recurrent, both are tied to ground rather
   than to a clock, and both must keep firing. What separates them from
   HT-010 is not their name — it is that the control sheet records an excess
   for them and records none for HT-010. A case the workbook itself says
   costs nothing is describing where the truck is, not what is wrong with it.

   No entity is named in this rule. HT-010 is defeated because it satisfies
   the general condition, not because it is HT-010. */
function learnWindows(profile){
  if(!profile) return [];
  var out = [], seen = {};
  var cases = (profile.incidentScript && profile.incidentScript.cases) || [];
  cases.forEach(function(c){
    var noClock = (c.startISO == null && c.startMs == null);
    if(!noClock || !c.zone) return;
    var excess = Number(c.expectedExcess);
    if(!(excess === 0 || c.expectedExcess == null)) return;   /* a fault, not context */
    var key = 'zone|' + c.zone;
    if(seen[key]) return;
    seen[key] = 1;
    out.push({ dimension: 'zone', values: [c.zone],
               note: (c.effect || c.label || 'operational context'),
               entity: c.entity || null,
               windowType: c.windowType || null,
               expectedExcess: c.expectedExcess,
               source: 'incidentScript' });
  });
  return out;
}

function observedException(profile){
  var w = learnWindows(profile);
  return newException({ mode: w.length ? 'observed' : 'off', windows: w,
                        learnedFrom: w.length ? 'data profile' : null });
}

/* ═══ 7 · conditions ═══════════════════════════════════════════════════════
   One model at the KBR. Every condition carries a scope and the scope
   defaults to the KBR, so the simple path is four fields — condition, value,
   response, channel — and never opens the rest. */

var SCOPES = ['kbr', 'touchpoint', 'source', 'answer'];
var _cid = 0;

function newCondition(o){
  _cid++;
  return Object.assign({
    cid: 'rc' + _cid,
    label: '',
    scope: { kind: 'kbr', ref: null },
    mode: 'absolute',          /* absolute | baseline_pct */
    reference: null,           /* one of REFERENCES, when mode is baseline_pct */
    op: 'lt',
    value: '',
    response: 'alert',         /* alert | alarm | action */
    severity: 'warning',
    channels: [],
    persistSec: 0,
    anomaly: null,             /* newAnomalyRules() when this is a detector */
    enabled: true,
    origin: 'user'
  }, o || {});
}

/* Four fields and nothing else opened. */
function isSimple(c){
  return !!c && !!c.scope && c.scope.kind === 'kbr'
         && c.mode === 'absolute' && !c.reference
         && !c.persistSec && !c.anomaly;
}
function simpleFields(){ return ['condition', 'value', 'response', 'channel']; }

/* ═══ 8 · migration ════════════════════════════════════════════════════════
   The older MOMENTUM shape:
     { aid, name, type: threshold|anomaly|missing,
       severity: critical|high|warning, metric, op, value, channels[], enabled }
   Nothing is dropped. A legacy alert that named a metric was already scoped
   to a touchpoint in everything but name, so that is where it migrates. */

var SEV_MAP = { critical: 'critical', high: 'critical', warning: 'warning' };

function migrateCondition(a){
  if(!a) return null;
  if(a.cid && a.scope) return a;                 /* already this shape */
  var anomaly = null;
  if(a.type === 'anomaly'){
    anomaly = newAnomalyRules();
    anomaly.family = 'unknown';                  /* statistical, per BOb 2771 */
  }
  return newCondition({
    cid: a.aid || undefined,
    label: a.name || 'Condition',
    scope: a.metric ? { kind: 'touchpoint', ref: a.metric }
                    : { kind: 'kbr', ref: null },
    mode: 'absolute',
    op: a.op || (a.type === 'threshold' ? 'lt' : 'any'),
    value: a.value == null ? '' : a.value,
    /* Channels were where a legacy alert went, so a legacy alert with
       channels was already an Alarm in BOb's vocabulary. */
    response: (a.channels && a.channels.length) ? 'alarm' : 'alert',
    severity: SEV_MAP[a.severity] || 'warning',
    channels: (a.channels || []).slice(),
    anomaly: anomaly,
    missing: a.type === 'missing' || undefined,
    enabled: a.enabled !== false,
    origin: 'migrated',
    legacy: { aid: a.aid, type: a.type, severity: a.severity, metric: a.metric }
  });
}

function migrate(list){
  return (list || []).map(migrateCondition).filter(Boolean);
}

/* ═══ 9 · composite risk — worst of the configured components (S2) ═════════
   An unconfigured component is ABSENT, not zero. A KBR with no risk
   touchpoints and no target is graded on performance alone, which is exactly
   what it was before. Tolerance is not applied here — it filters last, at
   the surface, which is the only place it has ever belonged. */

var COMPONENT_ORDER = ['performance', 'attainment', 'touchpoints'];

function composite(parts){
  var comps = [];
  COMPONENT_ORDER.forEach(function(k){
    var v = parts ? parts[k] : null;
    if(v == null || !isFinite(v)) return;
    comps.push({ component: k, pct: Math.max(0, Math.min(100, Math.round(v))) });
  });
  if(!comps.length) return { pct: null, components: [], driver: null };
  var worst = comps[0];
  comps.forEach(function(c){ if(c.pct > worst.pct) worst = c; });
  return { pct: worst.pct, components: comps, driver: worst.component };
}

/* Risk contributed by the risk touchpoints — leading indicators. Weight
   expresses threat importance and there are no value roles here at all. */
var WEIGHT = { HVY: 3, MED: 2, LGT: 1 };
var STATUS_RISK = { red: 100, amber: 55, yellow: 55, green: 8, gray: null };

function touchpointRisk(tps){
  if(!tps || !tps.length) return null;            /* absent, not zero */
  var num = 0, den = 0;
  tps.forEach(function(t){
    var r = STATUS_RISK[t && t.status];
    if(r == null) return;
    var w = WEIGHT[t && t.weight] || 2;
    num += r * w; den += w;
  });
  return den ? num / den : null;
}

/* ═══ 10 · the surface filter — the tolerance dial, applied last ═══════════
   MOMENTUM's 0-100 dial stays on top of everything BOb contributes. It is the
   final filter and it filters what is SHOWN; it never changes what was
   detected, and it never revives something an exception suppressed. */

function surface(items, tol){
  var t = tol == null ? 50 : tol;
  var criticalOnly = t >= 67;
  return (items || []).filter(function(i){
    if(!i || i.suppressed) return false;
    if(criticalOnly) return i.severity === 'critical';
    return true;
  });
}

/* ═══ 11 · black-bar context enrichment ═══════════════════════════════════
   BOb 2051/2090/2412 hang a --black bar under an alert carrying the channel
   performance at the moment it fired (4136). The generalisation: whatever
   context the scoped item had when it fired, stated on the item. */

function enrich(item, ctx){
  if(!item) return item;
  if(!ctx) return item;
  var bits = [];
  Object.keys(ctx).forEach(function(k){
    if(k.charAt(0) === '_' || ctx[k] == null) return;
    bits.push(k + ' ' + ctx[k]);
  });
  item.context = bits.length ? bits.join(' \u00b7 ') : null;
  return item;
}

MOMENTUM.Risk = {
  version: 1,

  /* ported constants, exposed so a suite can assert them rather than trust */
  SPD_MS: SPD_MS, COOLDOWN_TICKS: COOLDOWN_TICKS,
  SUSTAINED_TICKS: SUSTAINED_TICKS, CRITICAL_PCT: CRITICAL_PCT,
  PROX_URGENT: PROX_URGENT, PROX_WARNING: PROX_WARNING,

  TAXONOMY: TAXONOMY, RESPONSE_TYPES: RESPONSE_TYPES,
  KNOWN_MODES: KNOWN_MODES, UNKNOWN_SEVERITIES: UNKNOWN_SEVERITIES,
  REFERENCES: REFERENCES, SCOPES: SCOPES,
  CONTEXT_DIMENSIONS: CONTEXT_DIMENSIONS, EXCEPTION_MODES: EXCEPTION_MODES,

  cooldownMs: cooldownMs, deriveSeverity: deriveSeverity, proximity: proximity,
  taxonomyRank: taxonomyRank, notifies: notifies,

  optionsFor: optionsFor,
  median: median, baselinePct: baselinePct, evaluateBaseline: evaluateBaseline,
  referenceIds: referenceIds,

  newException: newException, inWindow: inWindow, exceptionFor: exceptionFor,
  learnWindows: learnWindows, observedException: observedException,

  newCondition: newCondition, isSimple: isSimple, simpleFields: simpleFields,
  newKnownRule: newKnownRule, newAnomalyRules: newAnomalyRules,
  newResponse: newResponse,

  migrate: migrate, migrateCondition: migrateCondition,

  composite: composite, touchpointRisk: touchpointRisk, surface: surface,
  enrich: enrich
};

})();
