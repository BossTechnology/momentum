/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.RiskLog — what the conditions DID

   The Alerts tab showed a state list: for each condition, is it live right
   now. That cannot express the thing worth knowing. By the time a condition
   has recovered its state is simply "not firing", indistinguishable from a
   condition that has been quiet all day — so a breach that resolved left no
   trace at all, and a condition flapping nine times an hour looked exactly
   like one that had never fired.

   BOb's Alerts view is an event log for that reason: a red card when a
   threshold is crossed, a green card when the metric returns, each stamped
   and each naming the channel it went to. This produces those events.

   Two things already shipped were resting on a history that did not exist.
   Cooldown means "how long before this may fire AGAIN", and "critical when
   held for 20 ticks" means held — both need a last-fired time. They have one
   now.

   Nothing here notifies. It records transitions and hands them over; the
   Risk Meter remains the only thing that escalates.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

/* A rolling window, not an archive. This is a simulation and nothing survives
   a reload, so the only question is how much of the recent past stays
   readable; 200 entries is a few hours of a busy result and keeps the tail
   scrollable rather than endless. */
var LIMIT = 200;

var logs  = {};    /* kbrId -> [entry]  newest first */
var state = {};    /* kbrId -> { condId: { firing, since, lastFired, count } } */

function entriesFor(kbrId){ return (logs[kbrId] || []).slice(); }
function clear(kbrId){
  if(kbrId == null){ logs = {}; state = {}; return; }
  delete logs[kbrId]; delete state[kbrId];
}

function push(kbrId, entry){
  if(!logs[kbrId]) logs[kbrId] = [];
  logs[kbrId].unshift(entry);
  if(logs[kbrId].length > LIMIT) logs[kbrId].length = LIMIT;
  return entry;
}

/* ── evaluating one condition ─────────────────────────────────────────────
   A condition compares an observed value against its threshold. Where the
   threshold is absent the condition cannot fire — it is configured but not
   armed, which is a different thing from quiet, and it must never be counted
   as either firing or recovered. */
function observed(kbr, cond){
  if(!kbr) return null;
  var sc = cond && cond.scope;
  if(sc && sc.kind === 'touchpoint' && sc.ref != null){
    var tps = kbr.touchpoints || [];
    for(var i = 0; i < tps.length; i++){
      if(tps[i].tid === sc.ref || tps[i].name === sc.ref){
        var h = tps[i].health;
        return (typeof h === 'number') ? h : null;
      }
    }
    return null;
  }
  return (typeof kbr.value === 'number') ? kbr.value : null;
}

function fires(cond, value){
  if(value == null || !isFinite(value)) return null;      /* cannot judge   */
  var t = cond && cond.value;
  if(t === '' || t == null) return null;                  /* not armed      */
  var n = parseFloat(t);
  if(!isFinite(n)) return null;
  switch(cond.op){
    case 'gt':  return value >  n;
    case 'gte': return value >= n;
    case 'lte': return value <= n;
    case 'lt':
    default:    return value <  n;
  }
}

/* ── the tick ─────────────────────────────────────────────────────────────
   Compare each condition's firing state with the state it held last time and
   write an entry only where it CHANGED. Recording every tick would produce a
   log that says the same thing two hundred times and hides the one line that
   matters. */
function evaluate(kbr, conds, opts){
  opts = opts || {};
  if(!kbr || !kbr.id) return [];
  var now = opts.now || Date.now();
  var kid = kbr.id;
  if(!state[kid]) state[kid] = {};
  var st = state[kid], written = [];

  (conds || []).forEach(function(c){
    if(!c || !c.id) return;
    var prev = st[c.id] || { firing:false, since:null, lastFired:null, count:0 };

    /* A silenced condition is not evaluated. If it was firing when it was
       silenced, that is recorded once so the log does not simply stop. */
    if(c.enabled === false){
      if(prev.firing){
        written.push(push(kid, mk(c, 'silenced', null, now, kbr)));
        st[c.id] = { firing:false, since:null, lastFired:prev.lastFired, count:prev.count };
      }
      return;
    }

    var v = observed(kbr, c);
    var f = fires(c, v);
    if(f === null){ st[c.id] = prev; return; }            /* unarmed: no event */

    if(f && !prev.firing){
      /* Cooldown decides whether this may be ANNOUNCED again, not whether it
         happened — the transition is recorded either way, and the entry
         carries whether it was suppressed. */
      var cd = cooldownMs(kbr);
      var muted = prev.lastFired != null && (now - prev.lastFired) < cd;
      written.push(push(kid, mk(c, 'breach', v, now, kbr, { suppressed: muted })));
      st[c.id] = { firing:true, since:now, lastFired:now, count:prev.count + 1 };
    } else if(!f && prev.firing){
      written.push(push(kid, mk(c, 'recovered', v, now, kbr,
                                { heldMs: prev.since ? now - prev.since : 0 })));
      st[c.id] = { firing:false, since:null, lastFired:prev.lastFired, count:prev.count };
    } else {
      prev.firing = f;
      st[c.id] = prev;
    }
  });
  return written;
}

function cooldownMs(kbr){
  var C = MOMENTUM.Channels;
  return C && C.cooldownFor ? C.cooldownFor(kbr) : 22500;
}

function mk(cond, kind, value, at, kbr, extra){
  var e = {
    id: kind + '_' + cond.id + '_' + at,
    condId: cond.id,
    label: cond.label || cond.id,
    kind: kind,                       /* breach · recovered · silenced      */
    at: at,
    value: value,
    threshold: (cond.value === '' || cond.value == null) ? null : parseFloat(cond.value),
    unit: (kbr && kbr.goal && kbr.goal.unit) || (kbr && kbr.unit) || '',
    response: cond.response || 'alert',
    channels: channelLabels(cond),
    origin: cond.origin || null
  };
  if(extra) for(var k in extra) if(extra.hasOwnProperty(k)) e[k] = extra[k];
  return e;
}
function channelLabels(cond){
  var C = MOMENTUM.Channels;
  if(!C) return [];
  var ids = [];
  (cond.responses || []).forEach(function(r){
    (r.channels || []).forEach(function(id){ if(ids.indexOf(id) < 0) ids.push(id); });
  });
  return ids.map(function(id){ var c = C.get(id); return c ? c.label : null; })
            .filter(Boolean);
}

/** How long a condition has been firing, for the "held" rule. */
function heldMs(kbrId, condId, now){
  var s = state[kbrId] && state[kbrId][condId];
  return (s && s.firing && s.since) ? ((now || Date.now()) - s.since) : 0;
}
function timesFired(kbrId, condId){
  var s = state[kbrId] && state[kbrId][condId];
  return s ? s.count : 0;
}
/** Conditions that fired and recovered repeatedly — invisible without a log,
 *  and usually the real problem. */
function flapping(kbrId, minCount){
  var s = state[kbrId] || {};
  return Object.keys(s).filter(function(id){
    return s[id].count >= (minCount || 3);
  });
}

MOMENTUM.RiskLog = {
  version: 1, LIMIT: LIMIT,
  entriesFor: entriesFor, clear: clear, evaluate: evaluate,
  fires: fires, observed: observed,
  heldMs: heldMs, timesFired: timesFired, flapping: flapping
};

})();
