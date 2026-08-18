/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.Generator — deterministic, seeded, time-addressed   (Build Spec §1.2, Phase 4)

   Contract
   ────────
   value(metric, timestamp, profile, seed) → number

   Pure. Nothing accumulates. Any moment — past, present or future — is
   computable on demand at O(number of states), so the header time ranges are
   real aggregation over generated hours rather than a multiplier, and a scrub
   backward finds exactly what a scrub forward left behind.

   No DOM, no window, no fetch, no Date.now() inside any generated value.

   How a number is made
   ────────────────────
     1 · the timestamp locates a cycle and a phase within it, per unit
     2 · the phase names a state (the journey partition, bound explicitly)
     3 · the state supplies a CLEAN contextual baseline from the profile —
         clean meaning the quarantined incident rows are already subtracted
     4 · unit and clock-scheduled dimensions (a shift) apply as residual factors
     5 · smooth seeded noise at the cell's own dispersion
     6 · scripted incidents are replayed on top, from the control sheet

   Step 3 and step 6 are the same decision seen twice: the profiler takes the
   incidents OUT of the baselines, and the generator puts them BACK as scripted
   events. What was contamination in the data becomes a findable event in the
   simulation, and the observed level is reproduced by composition rather than
   by being baked in.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(root){
'use strict';

var MOMENTUM = root.MOMENTUM = root.MOMENTUM || {};

/* ═══ 1 · deterministic arithmetic ═════════════════════════════════════════
   One 32-bit mixer, fed by strings and integers. The same inputs always
   produce the same bits, on any engine, in any order of calls. */

function hstr(s, h){
  h = (h === undefined ? 2166136261 : h) >>> 0;
  s = String(s);
  for(var i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function hint(n, h){
  h = (h ^ (n | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
/** uniform [0,1) from any mixed key */
function u01(h){ return (h >>> 0) / 4294967296; }
/** standard normal, sd 1, bounded at ±3 — three uniforms, no transcendentals */
function gauss(h){
  var a = u01(hint(1, h)), b = u01(hint(2, h)), c = u01(hint(3, h));
  return (a + b + c - 1.5) * 2;
}
function clamp(x, lo, hi){ return x < lo ? lo : (x > hi ? hi : x); }
function num(x){ return typeof x === 'number' && isFinite(x) ? x : null; }

/* ═══ 2 · reading a profile ════════════════════════════════════════════════ */

function pick(o, k){ return o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; }

/** clean level for a cell, falling back to the observed one when nothing was
 *  quarantined — baselineMean exists only where an exact subtraction was made */
function cellLevel(cell){
  if(!cell) return null;
  var v = num(cell.baselineMean);
  return v === null ? num(cell.mean) : v;
}
function cellN(cell){
  if(!cell) return 0;
  var n = num(cell.baselineN);
  return n === null ? (num(cell.n) || 0) : n;
}

/** Order the states of one column into a cycle by following the strongest
 *  observed transition out of each — the order of work as the data recorded it,
 *  never an assumed one. Returns [] when there is no usable chain. */
function cycleOrder(trans, states){
  if(!trans) return [];
  var present = {}, i;
  for(i = 0; i < states.length; i++) present[states[i]] = true;
  // start where the chain is most travelled, so a rare state cannot anchor it
  var best = null, bestN = -1;
  Object.keys(trans).forEach(function(from){
    if(!present[from]) return;
    var tot = 0;
    Object.keys(trans[from]).forEach(function(to){ if(present[to]) tot += trans[from][to]; });
    if(tot > bestN){ bestN = tot; best = from; }
  });
  if(best === null) return [];
  var order = [best], seen = {}; seen[best] = true;
  for(i = 0; i < states.length + 2; i++){
    var row = trans[order[order.length - 1]];
    if(!row) break;
    var nxt = null, nxtN = -1;
    Object.keys(row).forEach(function(to){
      if(!present[to] || seen[to]) return;
      if(row[to] > nxtN){ nxtN = row[to]; nxt = to; }
    });
    if(nxt === null) break;
    order.push(nxt); seen[nxt] = true;
  }
  // states the chain never reached still exist; append them by dwell so the
  // cycle covers the whole partition
  states.forEach(function(s){ if(!seen[s]) order.push(s); });
  return order;
}

/* ═══ 3 · the plan — everything derived once, then read-only ═══════════════ */

function buildPlan(profile, opts){
  opts = opts || {};
  var P = profile || {};
  var roll = P.rollups || {};
  var plan = {
    ok: false, reason: null,
    seed: opts.seed == null ? 'momentum' : String(opts.seed),
    noise: opts.noise == null ? 1 : +opts.noise,
    incidents: opts.incidents === false ? false : true,
    // Incident windows are anchored where the control sheet places them. Looking
    // outside the profiled span therefore shows incident-free time, which is
    // honest but makes a Week view quieter than the day the client recorded.
    // 'span' folds the clock back into the span so the script recurs; it is an
    // explicit choice, never the default.
    incidentRecurrence: opts.incidentRecurrence === 'span' ? 'span' : 'none',
    stateColumn: null, cycleMeasure: null, incidentMeasure: null,
    states: [], units: [], unitIndex: {}, measures: {}, measureNames: [],
    epochMs: null, endMs: null, spanSec: 0, grainSec: 1,
    schedules: [], cases: [], notes: []
  };
  if(!P.time || !P.time.present){ plan.reason = 'the profile has no time column'; return plan; }
  plan.epochMs = Date.parse(P.time.startISO);
  plan.endMs   = Date.parse(P.time.endISO);
  plan.spanSec = P.time.spanSec || ((plan.endMs - plan.epochMs) / 1000);
  plan.grainSec = P.time.grainSec || 1;

  /* — the cycle carrier: the quantity counted once per completed cycle — */
  var cm = roll.cycleModel || {};
  plan.cycleMeasure = opts.cycleMeasure || cm.carrier || null;

  /* — the journey partition. Bound explicitly; the profiler ranks and reports,
       the binding decides. Where no binding is given, the column named by the
       cycle's terminal event wins over the eta² ranking: the partition in which
       the work cycle actually closes is the operating state, whatever else
       happens to correlate with the measures. A transmission gear can explain
       fuel almost perfectly and still not be the state work moves through. — */
  var bl = P.baselines || {};
  var termCol = cm.terminalEvent && cm.terminalEvent.column;
  if(opts.stateColumn){ plan.stateColumn = opts.stateColumn; plan.stateColumnSource = 'bound'; }
  else if(termCol && bl[termCol]){ plan.stateColumn = termCol; plan.stateColumnSource = 'cycle-terminal'; }
  else { plan.stateColumn = roll.primaryStateColumn || null; plan.stateColumnSource = 'ranked'; }
  if(!plan.stateColumn || !bl[plan.stateColumn]){
    plan.reason = 'no state column is bound'; return plan;
  }
  plan.stateColumnRanked = roll.primaryStateColumn || null;

  plan.terminalState = null;
  if(cm.terminalEvent && cm.terminalEvent.column === plan.stateColumn)
    plan.terminalState = cm.terminalEvent.value;
  if(opts.terminalState) plan.terminalState = opts.terminalState;

  /* — measures — */
  (P.measures || []).forEach(function(m){
    plan.measures[m.name] = { name:m.name, unit:m.unit || null, mean:m.mean,
                              min:m.min, max:m.max, rate: !!(m.unit && /\//.test(m.unit)) };
    plan.measureNames.push(m.name);
  });

  /* — states, with their dwell and their own contextual levels — */
  var stateNames = Object.keys(bl[plan.stateColumn] || {});
  var epi = {}, dur = {};
  (roll.perUnit || []).forEach(function(u){
    var e = u.episodes && u.episodes[plan.stateColumn];
    if(!e) return;
    Object.keys(e).forEach(function(s){
      var r = e[s];
      if(!r.meanSec) return;
      var d = dur[s] = dur[s] || { secs:0, runs:0, sd:0, n:0 };
      d.secs += r.meanSec * r.runs; d.runs += r.runs;
      d.sd += (r.sdSec || 0) * r.runs; d.n += r.runs;
    });
    epi[u.unit] = e;
  });
  var order = cycleOrder((roll.transitions || {})[plan.stateColumn], stateNames);
  if(!order.length) order = stateNames.slice();
  plan.states = order.filter(function(s){ return dur[s] && dur[s].runs; })
    .map(function(s){
      var d = dur[s];
      return { name:s, meanSec: d.secs / d.runs, runs: d.runs,
               cv: d.secs ? clamp((d.sd / d.n) / (d.secs / d.runs), 0, 0.6) : 0 };
    });
  if(!plan.states.length){ plan.reason = 'no state durations in the profile'; return plan; }
  plan.stateIndex = {};
  plan.states.forEach(function(s, i){ plan.stateIndex[s.name] = i; });
  plan.cycleSec = plan.states.reduce(function(a, s){ return a + s.meanSec; }, 0);

  /* — units, each with its own cycle length and its own level — */
  // The fleet reference is the observed pooled mean, so a unit's level is
  // observed-against-observed. Comparing a unit's CLEAN mean against the fleet's
  // OBSERVED mean would look like a level, but it is really the quarantine: half
  // this workbook's rows were held out, and they were not held out evenly across
  // states, so the two pools are not the same population.
  var fleetObs = {};
  Object.keys(plan.measures).forEach(function(mn){
    var s = 0, n = 0;
    (roll.perUnit || []).forEach(function(u){
      var t = u.totals && u.totals[mn];
      if(t && t.n){ s += t.sum; n += t.n; }
    });
    fleetObs[mn] = n ? s / n : plan.measures[mn].mean;
  });
  plan.fleetObserved = fleetObs;
  (roll.perUnit || []).forEach(function(u){
    var e = epi[u.unit], sec = 0;
    plan.states.forEach(function(s){
      var r = e && e[s.name];
      sec += r && r.meanSec ? r.meanSec : s.meanSec;
    });
    var rec = { name:u.unit, cycleSec: sec || plan.cycleSec, level:{},
                dwell:{}, cycles: (u.cycles && plan.cycleMeasure &&
                                   u.cycles[plan.cycleMeasure]) || null };
    plan.states.forEach(function(s){
      var r = e && e[s.name];
      rec.dwell[s.name] = r && r.meanSec ? r.meanSec : s.meanSec;
    });
    // a unit's own level against the fleet, per measure — HT-003 really does
    // burn differently from HT-007, and the profile knows it exactly
    Object.keys(plan.measures).forEach(function(mn){
      var t = u.totals && u.totals[mn];
      var ref = fleetObs[mn];
      rec.level[mn] = (t && t.n && ref) ? clamp((t.sum / t.n) / ref, 0.4, 2.5) : 1;
    });
    plan.unitIndex[u.unit] = plan.units.length;
    plan.units.push(rec);
  });
  if(!plan.units.length){ plan.reason = 'no units in the profile'; return plan; }

  /* — clock-scheduled dimensions. A shift is a function of the hour; a road
       condition is not, and is left to the cycle rather than invented. — */
  var sch = P.schedules || {};

  /* The factor for a clock-scheduled dimension asks how a measure behaves on
     one level versus another. Read off the marginal it also carries how much
     of each state each level contained, and the quarantine does not remove
     rows evenly across the cycle — so a level whose surviving sample is
     lighter on the heavy states reads low for a reason that has nothing to do
     with the measure. The joint cross-tab (schema 3) separates the two: the
     level means are computed within each state and then pooled on ONE state
     weighting shared by every level, so two levels can differ only in how the
     measure behaves, never in how much of each state each contained.
     Without a joint — schema 2 and earlier, or a state column the profiler
     did not cross — this falls back to the marginal exactly as before. */
  var jointFor = (P.joint && P.joint[plan.stateColumn]) || null;

  function marginalFactor(cn, mn){
    var tot = 0, wsum = 0, per = {};
    Object.keys(bl[cn]).forEach(function(v){
      var c = bl[cn][v][mn], lv = cellLevel(c), n = cellN(c);
      if(lv === null || !n) return;
      per[v] = lv; tot += lv * n; wsum += n;
    });
    if(!wsum) return null;
    var overall = tot / wsum;
    var f = {};
    Object.keys(per).forEach(function(v){ f[v] = overall ? clamp(per[v] / overall, 0.5, 2) : 1; });
    return f;
  }

  /* States that carry this measure at EVERY level of the dimension. Common
     support is what makes the weighting shareable: a state present on one
     level and absent on another would re-enter as mix through the back door. */
  function commonStates(cn, mn, levels){
    if(!jointFor) return [];
    var out = [];
    Object.keys(jointFor).forEach(function(s){
      var d = jointFor[s] && jointFor[s][cn];
      if(!d) return;
      for(var i = 0; i < levels.length; i++){
        var c = d[levels[i]] && d[levels[i]][mn];
        if(!c || cellLevel(c) === null || !cellN(c)) return;
      }
      out.push(s);
    });
    return out;
  }

  function jointFactor(cn, mn, levels){
    var states = commonStates(cn, mn, levels);
    if(states.length < 2) return null;

    /* One weighting, built once from the pooled cells and reused unchanged
       for every level. This is the whole point of the standardisation. */
    var W = {}, wtot = 0;
    states.forEach(function(s){
      var w = 0;
      levels.forEach(function(v){ w += cellN(jointFor[s][cn][v][mn]); });
      W[s] = w; wtot += w;
    });
    if(!wtot) return null;

    var std = {}, nAt = {}, tot = 0, wsum = 0;
    for(var i = 0; i < levels.length; i++){
      var v = levels[i], num = 0, den = 0, n = 0;
      states.forEach(function(s){
        var c = jointFor[s][cn][v][mn];
        num += W[s] * cellLevel(c); den += W[s]; n += cellN(c);
      });
      if(!den || !n) return null;
      std[v] = num / den; nAt[v] = n;
      tot += std[v] * n; wsum += n;
    }
    if(!wsum) return null;

    var overall = tot / wsum;
    var f = {};
    levels.forEach(function(v){ f[v] = overall ? clamp(std[v] / overall, 0.5, 2) : 1; });
    return f;
  }

  Object.keys(sch).forEach(function(cn){
    if(cn === plan.stateColumn || !sch[cn].scheduled || !bl[cn]) return;
    var dim = { column: cn, byHour: sch[cn].byHour, factor: {}, basis: 'marginal' };
    var levels = Object.keys(bl[cn]), usedJoint = false;
    Object.keys(plan.measures).forEach(function(mn){
      var f = jointFactor(cn, mn, levels);
      if(f) usedJoint = true; else f = marginalFactor(cn, mn);
      if(f) dim.factor[mn] = f;
    });
    if(usedJoint) dim.basis = 'joint';
    plan.schedules.push(dim);
  });

  /* — the incident script: the control sheet doubles as the fault catalogue — */
  var scr = P.incidentScript || {};
  plan.incidentMeasure = opts.incidentMeasure || pickIncidentMeasure(plan, scr.cases || []);
  (scr.cases || []).forEach(function(c){
    var mag = num(c.expectedExcess);
    var ramp = /crecien|progres|ramp|increas/i.test(String(c.windowType || '') + ' ' + String(c.label || ''));
    // A case with no time window is not a case to discard. The control sheet
    // describes it as recurring or tied to a place — present throughout the
    // record, just not localised in it. It is placed across the whole span and
    // labelled context-conditional, so the panel can say which cases the
    // timeline genuinely locates and which it merely carries.
    var placed = c.startMs != null;
    plan.cases.push({
      unit: c.entity || null, label: c.label || 'incident',
      startMs: placed ? c.startMs : plan.epochMs,
      endMs: placed ? (c.endMs == null ? plan.endMs : c.endMs) : plan.endMs,
      magnitude: mag === null ? 0 : mag,
      shape: placed ? (ramp ? 'ramp' : 'step') : 'persistent',
      placement: placed ? 'scheduled' : 'context-conditional',
      quarantine: c.quarantine || null,
      windowType: c.windowType || null, variables: c.variables || [],
      measure: plan.incidentMeasure, zone: c.zone || null,
      companions: (c.variables || []).filter(function(v){
        return matchMeasure(plan, v) && matchMeasure(plan, v) !== plan.incidentMeasure; })
        .map(function(v){ return matchMeasure(plan, v); })
    });
  });
  plan.cases.sort(function(a, b){ return a.startMs - b.startMs; });
  plan.scheduledCases = plan.cases.filter(function(c){ return c.placement === 'scheduled'; }).length;
  plan.contextCases   = plan.cases.length - plan.scheduledCases;
  if(plan.contextCases) plan.notes.push(plan.contextCases +
    ' control case(s) carry no time window (recurring or tied to a place). They run across the whole span as context-conditional, and a scrub cannot localise their onset.');

  if(!plan.cycleMeasure) plan.notes.push('No cycle-carrying measure was found; quantities per cycle are unavailable.');
  if(!plan.schedules.length) plan.notes.push('No dimension is decided by the clock; only the cycle shapes the day.');
  plan.ok = true;
  return plan;
}

function norm(s){
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
/** loosest sensible match from a control-sheet variable name to a profiled measure */
function matchMeasure(plan, term){
  var t = norm(term);
  if(!t) return null;
  var names = plan.measureNames, i, n;
  for(i = 0; i < names.length; i++) if(norm(names[i]) === t) return names[i];
  for(i = 0; i < names.length; i++){
    n = norm(names[i]);
    if(n.indexOf(t) >= 0 || t.indexOf(n) >= 0) return names[i];
  }
  var words = t.split(' ').filter(function(w){ return w.length > 3; });
  for(i = 0; i < names.length; i++){
    n = norm(names[i]);
    for(var w = 0; w < words.length; w++) if(n.indexOf(words[w]) >= 0) return names[i];
  }
  return null;
}
/** The excess a control sheet quotes is an excess of consumption — it belongs to
 *  the rate measure the cases name, and to that one only. Companion variables
 *  are part of the signature; their magnitude is not quantified here, and the
 *  generator does not invent one. */
function pickIncidentMeasure(plan, cases){
  var votes = {};
  cases.forEach(function(c){
    (c.variables || []).forEach(function(v){
      var m = matchMeasure(plan, v);
      if(m && plan.measures[m] && plan.measures[m].rate) votes[m] = (votes[m] || 0) + 1;
    });
  });
  var best = null, bestN = 0;
  Object.keys(votes).forEach(function(m){ if(votes[m] > bestN){ bestN = votes[m]; best = m; } });
  if(best) return best;
  var rate = plan.measureNames.filter(function(m){ return plan.measures[m].rate; });
  return rate.length ? rate[0] : (plan.measureNames[0] || null);
}

/* ═══ 4 · the generator ════════════════════════════════════════════════════ */

function Generator(profile, opts){
  this.profile = profile;
  this.opts = opts || {};
  this.plan = buildPlan(profile, opts);
  this.seedH = hstr(this.plan.seed);
  this._blStates = (profile && profile.baselines && profile.baselines[this.plan.stateColumn]) || {};
}

Generator.prototype.ok = function(){ return this.plan.ok; };
Generator.prototype.units = function(){ return this.plan.units.map(function(u){ return u.name; }); };
Generator.prototype.stateNames = function(){ return this.plan.states.map(function(s){ return s.name; }); };
Generator.prototype.metrics = function(){ return this.plan.measureNames.slice(); };
Generator.prototype.span = function(){ return { startMs: this.plan.epochMs, endMs: this.plan.endMs }; };

Generator.prototype._unit = function(unit){
  var p = this.plan;
  if(unit == null) return p.units[0];
  if(typeof unit === 'number') return p.units[((unit % p.units.length) + p.units.length) % p.units.length];
  var i = p.unitIndex[unit];
  return i === undefined ? p.units[hstr(unit, this.seedH) % p.units.length] : p.units[i];
};

/** Which cycle, and where inside it. O(states), no accumulation, any t. */
Generator.prototype.locate = function(tsMs, unit){
  var p = this.plan, u = this._unit(unit);
  var uh = hstr(u.name, this.seedH);
  var offset = u01(hint(7, uh)) * u.cycleSec;          // units are not in lockstep
  var rel = (tsMs - p.epochMs) / 1000 + offset;
  var k = Math.floor(rel / u.cycleSec);
  var tau = rel - k * u.cycleSec;
  if(tau < 0) tau += u.cycleSec;                        // negative time is still addressable

  // one cycle's internal composition jitters; its length does not, which is
  // what keeps any moment O(1) to address instead of a walk from the epoch
  var n = p.states.length, d = new Array(n), sum = 0, i;
  var ch = hint(k, uh);
  for(i = 0; i < n; i++){
    var s = p.states[i];
    var base = u.dwell[s.name] || s.meanSec;
    var j = 1 + clamp(gauss(hint(i + 11, ch)), -2, 2) * s.cv;
    d[i] = Math.max(base * 0.15, base * j);
    sum += d[i];
  }
  var scale = sum ? u.cycleSec / sum : 1;
  var acc = 0, idx = n - 1, startSec = 0;
  for(i = 0; i < n; i++){
    var w = d[i] * scale;
    if(tau < acc + w || i === n - 1){ idx = i; startSec = acc; break; }
    acc += w;
  }
  var w2 = d[idx] * scale;
  return {
    unit: u.name, cycleIndex: k, cycleSec: u.cycleSec,
    cycleStartMs: p.epochMs + (k * u.cycleSec - offset) * 1000,
    state: p.states[idx].name, stateIndex: idx,
    stateSec: w2, phase: w2 ? clamp((tau - startSec) / w2, 0, 1) : 0,
    tau: tau
  };
};

Generator.prototype.stateAt = function(tsMs, unit){ return this.locate(tsMs, unit).state; };

/** Which value a clock-scheduled dimension holds at this instant. */
Generator.prototype.scheduledAt = function(tsMs){
  var out = [];
  this.plan.schedules.forEach(function(dim){
    var h = new Date(tsMs).getUTCHours();
    var v = dim.byHour[h];
    if(v != null) out.push({ column: dim.column, value: v });
  });
  return out;
};

/** Every incident live at this instant for this unit, with its current factor. */
Generator.prototype.incidentsAt = function(tsMs, unit, metric){
  var p = this.plan, out = [];
  if(!p.incidents) return out;
  var uname = this._unit(unit).name;
  var ts = tsMs;
  if(p.incidentRecurrence === 'span'){
    var spanMs = Math.max(1000, p.endMs - p.epochMs);
    ts = p.epochMs + (((tsMs - p.epochMs) % spanMs) + spanMs) % spanMs;
  }
  for(var i = 0; i < p.cases.length; i++){
    var c = p.cases[i];
    if(c.unit && c.unit !== uname) continue;
    if(ts < c.startMs || ts > c.endMs) continue;
    var span = Math.max(1, c.endMs - c.startMs);
    var prog = clamp((ts - c.startMs) / span, 0, 1);
    // a ramp averages its quoted excess across the window; a step holds it
    // a ramp averages its quoted excess across the window; a step and a
    // persistent condition hold it
    var f = c.shape === 'ramp' ? (1 + c.magnitude * 2 * prog) : (1 + c.magnitude);
    var applies = !metric || metric === c.measure;
    out.push({ label: c.label, unit: c.unit, measure: c.measure, shape: c.shape,
               placement: c.placement, startMs: c.startMs, endMs: c.endMs,
               magnitude: c.magnitude, zone: c.zone,
               progress: prog, factor: applies ? f : 1, applies: applies,
               companions: c.companions, windowType: c.windowType });
  }
  return out;
};
Generator.prototype.incidentsIn = function(fromMs, toMs, unit){
  var p = this.plan, out = [], uname = unit == null ? null : this._unit(unit).name;
  p.cases.forEach(function(c){
    if(uname && c.unit && c.unit !== uname) return;
    if(c.endMs < fromMs || c.startMs > toMs) return;
    out.push({ label:c.label, unit:c.unit, measure:c.measure, shape:c.shape,
               placement:c.placement, startMs:c.startMs, endMs:c.endMs,
               magnitude:c.magnitude, zone:c.zone,
               windowType:c.windowType, variables:c.variables });
  });
  return out;
};

/* ── the value ────────────────────────────────────────────────────────────── */

Generator.prototype._cell = function(metric, state){
  var s = this._blStates[state];
  return s ? s[metric] : null;
};

/** value(metric, timestamp[, unit]) → number. Pure. */
Generator.prototype.value = function(metric, tsMs, unit){
  var d = this.detail(metric, tsMs, unit);
  return d ? d.value : null;
};

/** The same number with its terms exposed — what the Activity tab explains. */
Generator.prototype.detail = function(metric, tsMs, unit){
  var p = this.plan;
  if(!p.ok || !p.measures[metric]) return null;
  var loc = this.locate(tsMs, unit);
  var u = this._unit(unit);
  var cell = this._cell(metric, loc.state);
  var base = cellLevel(cell);
  if(base === null) base = p.measures[metric].mean;
  if(base === null) return null;

  var terms = [{ term: 'state', value: loc.state, factor: null, level: base }];

  var f = 1;
  var fu = u.level[metric] == null ? 1 : u.level[metric];
  if(fu !== 1) terms.push({ term: 'unit', value: u.name, factor: fu });
  f *= fu;

  var hour = new Date(tsMs).getUTCHours();
  for(var i = 0; i < p.schedules.length; i++){
    var dim = p.schedules[i], v = dim.byHour[hour];
    var ff = v != null && dim.factor[metric] ? dim.factor[metric][v] : null;
    if(ff != null && ff !== 1){ f *= ff; terms.push({ term: dim.column, value: v, factor: ff }); }
  }

  var v0 = base * f;

  // smooth seeded noise: two draws per coarse step, interpolated, so a series
  // reads like telemetry instead of static — and is still a pure function of t
  var sd = cell && num(cell.sd) !== null ? cell.sd : Math.abs(base) * 0.05;
  var noise = 0;
  if(p.noise > 0 && sd > 0){
    var step = Math.max(p.grainSec, Math.round(loc.stateSec / 12) || p.grainSec);
    var t = (tsMs - p.epochMs) / 1000 / step;
    var i0 = Math.floor(t), frac = t - i0;
    var mh = hstr(metric, hstr(u.name, this.seedH));
    var g0 = gauss(hint(i0, mh)), g1 = gauss(hint(i0 + 1, mh));
    var sm = frac * frac * (3 - 2 * frac);            // smoothstep, C¹ continuous
    noise = (g0 + (g1 - g0) * sm) * sd * p.noise;
  }
  var v1 = v0 + noise;

  var inc = this.incidentsAt(tsMs, u.name, metric), incF = 1, incLabels = [];
  for(var j = 0; j < inc.length; j++){
    if(!inc[j].applies) continue;
    incF *= inc[j].factor;
    incLabels.push(inc[j].label);
  }
  var v2 = v1 * incF;

  // never leave the envelope the data actually occupied for this state
  var lo = cell && num(cell.min) !== null ? cell.min : -Infinity;
  var hi = cell && num(cell.max) !== null ? cell.max : Infinity;
  if(incF > 1) hi = hi * incF;                        // an incident may exceed it, by its own magnitude
  var v = clamp(v2, lo, hi);

  return { value: v, metric: metric, unit: u.name, at: tsMs,
           state: loc.state, phase: loc.phase, cycleIndex: loc.cycleIndex,
           base: base, contextFactor: f, noise: noise, incidentFactor: incF,
           incidents: incLabels, terms: terms, clamped: v !== v2,
           measureUnit: p.measures[metric].unit };
};

/* ── series and aggregation — real hours, never a multiplier ─────────────── */

Generator.prototype.series = function(metric, fromMs, toMs, stepSec, unit){
  var out = [], step = (stepSec || 60) * 1000;
  if(toMs < fromMs) { var t0 = fromMs; fromMs = toMs; toMs = t0; }
  var guard = 0;
  for(var t = fromMs; t <= toMs && guard < 200000; t += step, guard++)
    out.push({ t: t, v: this.value(metric, t, unit) });
  return out;
};

/**
 * aggregate(metric, from, to, {stepSec, unit|units, stat})
 * Sums the real generated hours in the window. A rate is also integrated over
 * the step into its own quantity, which is where gallons come from.
 */
Generator.prototype.aggregate = function(metric, fromMs, toMs, o){
  o = o || {};
  var p = this.plan;
  if(!p.ok || !p.measures[metric]) return null;
  var units = o.units || (o.unit != null ? [o.unit] : this.units());
  var stepSec = o.stepSec || autoStep(fromMs, toMs, p.grainSec);
  var n = 0, sum = 0, min = Infinity, max = -Infinity;
  var perUnit = {};
  for(var ui = 0; ui < units.length; ui++){
    var us = 0, un = 0;
    for(var t = fromMs; t <= toMs; t += stepSec * 1000){
      var v = this.value(metric, t, units[ui]);
      if(v === null) continue;
      us += v; un++;
      if(v < min) min = v;
      if(v > max) max = v;
    }
    perUnit[units[ui]] = { n: un, mean: un ? us / un : null, sum: us };
    n += un; sum += us;
  }
  var mu = p.measures[metric].unit || '';
  var m = /^(.+?)\s*\/\s*(h|hr|hour|min|s|sec)$/i.exec(mu);
  var integrated = null;
  if(m){
    var per = /^h/i.test(m[2]) ? 3600 : (/^m/i.test(m[2]) ? 60 : 1);
    integrated = { unit: m[1], value: sum * stepSec / per };
  }
  return { metric: metric, n: n, mean: n ? sum / n : null, sum: sum,
           min: n ? min : null, max: n ? max : null,
           stepSec: stepSec, units: units.length, perUnit: perUnit,
           integrated: integrated, fromMs: fromMs, toMs: toMs,
           hours: (toMs - fromMs) / 3600000 };
};
function autoStep(fromMs, toMs, grainSec){
  var sec = Math.max(1, (toMs - fromMs) / 1000);
  var step = Math.ceil(sec / 4000 / (grainSec || 1)) * (grainSec || 1);
  return Math.max(grainSec || 1, step);
}

/* ── completed cycles, and the quantity they carry ───────────────────────── */

/** Cycles whose terminal event falls inside the window — counted once, at the
 *  discharge, exactly as the profiler counts them. A cycle still in flight when
 *  the window closes is not counted: that load was never dumped. */
Generator.prototype.cyclesIn = function(fromMs, toMs, unit){
  var p = this.plan, out = [];
  if(!p.ok || !p.cycleMeasure) return out;
  var units = unit != null ? [this._unit(unit).name] : this.units();
  var termIdx = p.terminalState != null && p.stateIndex[p.terminalState] !== undefined
              ? p.stateIndex[p.terminalState] : (p.states.length - 1);
  for(var ui = 0; ui < units.length; ui++){
    var u = this._unit(units[ui]);
    var a = this.locate(fromMs, u.name), b = this.locate(toMs, u.name);
    for(var k = a.cycleIndex; k <= b.cycleIndex; k++){
      // where the terminal state of cycle k ends, in real time
      var end = this._stateEndMs(u, k, termIdx);
      if(end < fromMs || end > toMs) continue;
      out.push({ unit: u.name, cycleIndex: k, atMs: end,
                 quantity: this._cycleQuantity(u, k),
                 terminalState: p.states[termIdx].name });
    }
  }
  out.sort(function(x, y){ return x.atMs - y.atMs; });
  return out;
};
Generator.prototype._stateEndMs = function(u, k, idx){
  var p = this.plan;
  var uh = hstr(u.name, this.seedH);
  var offset = u01(hint(7, uh)) * u.cycleSec;
  var n = p.states.length, d = new Array(n), sum = 0, i;
  var ch = hint(k, uh);
  for(i = 0; i < n; i++){
    var s = p.states[i], base = u.dwell[s.name] || s.meanSec;
    d[i] = Math.max(base * 0.15, base * (1 + clamp(gauss(hint(i + 11, ch)), -2, 2) * s.cv));
    sum += d[i];
  }
  var scale = sum ? u.cycleSec / sum : 1, acc = 0;
  for(i = 0; i <= idx; i++) acc += d[i] * scale;
  return p.epochMs + (k * u.cycleSec + acc - offset) * 1000;
};
/** The quantity one completed cycle carries, at this unit's own level. */
Generator.prototype._cycleQuantity = function(u, k){
  var p = this.plan;
  // a unit's own figure first; the fleet's ranked carrier second. `|| [{}]`
  // guards a missing list but not an empty one, so index the array properly.
  var per = u.cycles && u.cycles.perCycleMean != null ? u.cycles.perCycleMean : null;
  if(per == null){
    var cands = ((this.profile && this.profile.rollups &&
                  this.profile.rollups.cycleModel) || {}).candidates;
    var top = (cands && cands.length) ? cands[0] : null;
    per = top && top.perCycleMean != null ? top.perCycleMean : null;
  }
  if(per == null) return null;
  var sd = u.cycles && u.cycles.perCycleSd != null ? u.cycles.perCycleSd : 0;
  var g = clamp(gauss(hint(k, hstr('qty', hstr(u.name, this.seedH)))), -2.5, 2.5);
  return Math.max(0, per + g * sd);
};

/**
 * The bound ratio KPI over a window, in the locked form:
 *   numerator   a rate integrated over real generated time
 *   denominator a quantity counted once per COMPLETED cycle, at the discharge
 * Never a per-row sum of the denominator, and never bent toward a target.
 */
Generator.prototype.kpi = function(fromMs, toMs, o){
  o = o || {};
  var p = this.plan;
  if(!p.ok) return null;
  var numMetric = o.numerator || p.incidentMeasure;
  var agg = this.aggregate(numMetric, fromMs, toMs, { stepSec: o.stepSec, units: o.units });
  var cyc = this.cyclesIn(fromMs, toMs, o.unit);
  var qty = 0;
  for(var i = 0; i < cyc.length; i++) qty += cyc[i].quantity || 0;
  var numer = agg && agg.integrated ? agg.integrated.value : (agg ? agg.sum : null);
  return {
    numerator: numer, numeratorUnit: agg && agg.integrated ? agg.integrated.unit : null,
    numeratorMetric: numMetric,
    denominator: qty, denominatorMetric: p.cycleMeasure,
    denominatorUnit: p.measures[p.cycleMeasure] ? p.measures[p.cycleMeasure].unit : null,
    cycles: cyc.length, perCycle: cyc.length ? qty / cyc.length : null,
    value: qty ? numer / qty : null,
    fromMs: fromMs, toMs: toMs
  };
};

/* ═══ 5 · public surface ═══════════════════════════════════════════════════ */

var _cache = { key: null, gen: null };

MOMENTUM.Generator = {
  version: 1,
  create: function(profile, opts){ return new Generator(profile, opts); },

  /** The Build Spec signature, verbatim: value(metric, timestamp, profile, seed).
   *  One plan is cached, so calling this in a loop costs the same as create(). */
  value: function(metric, timestamp, profile, seed){
    var key = (profile && profile.meta && profile.meta.datasetId) + '|' +
              (profile && profile.schemaVersion) + '|' + seed;
    if(_cache.key !== key){ _cache.key = key; _cache.gen = new Generator(profile, { seed: seed }); }
    return _cache.gen.value(metric, timestamp);
  },
  _internals: { hstr: hstr, hint: hint, u01: u01, gauss: gauss,
                cycleOrder: cycleOrder, buildPlan: buildPlan, matchMeasure: matchMeasure }
};

})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
