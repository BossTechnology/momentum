/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.Profile — DOM-free data-profiling core   (Build Spec v1 §1.3–1.4, Phase 3)

   Contract
   ────────
   Pure, versioned, portable. No DOM, no window, no fetch, no file I/O.
   Consumes rows; emits a profile JSON (≈50–200 KB) of the same schema from
   BOTH the Web-Worker light path and the api/profile.js heavy path.

   Single pass, constant memory: an 84 MB xlsx unpacks to ~850 MB of XML and is
   never held whole in any runtime. Numeric quantiles use an exact warm-up
   buffer that converts to a fixed 1024-bin histogram — deterministic, no RNG,
   so the same bytes always produce the same profile.

   Usage
   ─────
     const acc = MOMENTUM.Profile.create({ datasetId, sourceName, sizeBytes, path:'light' });
     acc.feed(sheetName, cellsArray);        // every row, header included
     acc.endSheet(sheetName);                // optional, flushes short sheets
     const profile = acc.finalize();
   ═══════════════════════════════════════════════════════════════════════════ */
(function(root){
'use strict';

var MOMENTUM = root.MOMENTUM = root.MOMENTUM || {};

/* ── limits (constant-memory guarantees) ─────────────────────────────────── */
var LIM = {
  headerScanRows : 12,      // rows buffered while sniffing the header row
  warmup         : 20000,   // exact values held before switching to histogram
  bins           : 1024,    // histogram resolution after warm-up
  maxDistinct    : 200,     // distinct values tracked per categorical column
  xtabMaxCard    : 60,      // categorical cardinality eligible for cross-tabs
  xtabMaxCells   : 40000,   // global ceiling on cross-tab cells
  episodeMaxCard : 60,      // cardinality eligible for episode (run) analysis
  preambleChars  : 900,     // preamble text kept per sheet
  refSheetRows   : 500,     // rows kept verbatim for recognised reference sheets
  xtabWarm       : 1500,    // cross-tab cells: small warm-up, coarse histogram
  xtabBins       : 256,
  sheetTopValues : 12,      // distinct values echoed per column in sheet output
  stateMinRows   : 500,     // minimum sample before a column can be scored as state
  stateMinRunRows: 60,      // run length at which a column counts as fully stable
  cycleZeroFrac  : 0.02,    // a quantity at ≤2% of its cycle peak has been discharged
  cycleArmFrac   : 0.05,    // …and must have reached ≥5% of the column max to count
  cycleMaxRuns   : 100000,  // guard: a measure that oscillates is not a cycle carrier
  scheduleShare  : 0.80,    // hour→value share above which a dimension is time-scheduled
  jointMaxCard   : 12,      // per-side cardinality eligible for the joint cross-tab
  jointMaxCells  : 60000    // global ceiling on joint cells (state × dim × measure)
};

/* ═══ 1 · value coercion ═══════════════════════════════════════════════════ */

var RE_NUM   = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
var RE_ISO   = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
var RE_DMY   = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function isBlank(v){ return v === null || v === undefined || v === ''; }

function toNum(v){
  if(typeof v === 'number') return isFinite(v) ? v : null;
  if(typeof v !== 'string') return null;
  var s = v.trim();
  if(!s) return null;
  if(RE_NUM.test(s)) return parseFloat(s.replace(/,/g,''));
  // "1 234,56" (es/fr) — only when there is no dot decimal
  if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g,'').replace(',','.'));
  if(/^-?\d+,\d+$/.test(s)) return parseFloat(s.replace(',','.'));
  return null;
}

/** Parse a timestamp to epoch ms. Accepts ISO, "YYYY-MM-DD HH:MM:SS", d/m/Y. */
function toTime(v){
  if(v instanceof Date) return v.getTime();
  if(typeof v !== 'string') return null;
  var s = v.trim(), m;
  if((m = RE_ISO.exec(s))){
    return Date.UTC(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  }
  if((m = RE_DMY.exec(s))){
    return Date.UTC(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  }
  return null;
}
function isoOf(ms){
  if(ms == null) return null;
  return new Date(ms).toISOString().replace('.000Z','Z');
}

/* ═══ 2 · numeric accumulator ══════════════════════════════════════════════
   Welford mean/variance (exact), exact min/max/sum, and quantiles via an
   exact warm-up buffer promoted to a fixed histogram. Deterministic. */

function NumStat(warm, bins){
  this.n = 0; this.sum = 0; this.mean = 0; this._m2 = 0;
  this.min = Infinity; this.max = -Infinity;
  this._buf = []; this._hist = null; this._lo = 0; this._hi = 0; this._w = 0;
  this._warm = warm || LIM.warmup; this._bins = bins || LIM.bins;
}

/* Mean-only accumulator: hour-of-day and other dense grids never need
   quantiles, and a NumStat per cell would cost megabytes of warm-up buffer. */
function MeanStat(){ this.n = 0; this.sum = 0; }
MeanStat.prototype.push = function(x){ this.n++; this.sum += x; };
Object.defineProperty(MeanStat.prototype, 'mean', {
  get: function(){ return this.n ? this.sum / this.n : 0; } });

/* Mean + spread in constant memory, no warm-up buffer and no histogram. Joint
   cells need a level and a dispersion, never a quantile, and there are two
   orders of magnitude more of them than there are marginal cells — so the
   Phase 3 lesson about per-cell buffers applies here with force. */
function SpreadStat(){ this.n = 0; this.sum = 0; this.mean = 0; this._m2 = 0;
                       this.min = Infinity; this.max = -Infinity; }
SpreadStat.prototype.push = function(x){
  this.n++; this.sum += x;
  var d = x - this.mean;
  this.mean += d / this.n;
  this._m2 += d * (x - this.mean);
  if(x < this.min) this.min = x;
  if(x > this.max) this.max = x;
};
Object.defineProperty(SpreadStat.prototype, 'sd', {
  get: function(){ return this.n > 1 ? Math.sqrt(this._m2 / (this.n - 1)) : 0; } });
NumStat.prototype.push = function(x){
  this.n++;
  this.sum += x;
  var d = x - this.mean;
  this.mean += d / this.n;
  this._m2 += d * (x - this.mean);
  if(x < this.min) this.min = x;
  if(x > this.max) this.max = x;
  if(this._hist){
    var i = Math.floor((x - this._lo) / this._w);
    if(i < 0) i = 0; else if(i >= this._bins) i = this._bins - 1;
    this._hist[i]++;
  } else {
    this._buf.push(x);
    if(this._buf.length >= this._warm) this._promote();
  }
};
NumStat.prototype._promote = function(){
  var lo = this.min, hi = this.max;
  if(!(hi > lo)) hi = lo + 1;
  var pad = (hi - lo) * 0.25;
  this._lo = lo - pad; this._hi = hi + pad;
  this._w  = (this._hi - this._lo) / this._bins;
  this._hist = new Float64Array(this._bins);
  for(var k = 0; k < this._buf.length; k++){
    var i = Math.floor((this._buf[k] - this._lo) / this._w);
    if(i < 0) i = 0; else if(i >= this._bins) i = this._bins - 1;
    this._hist[i]++;
  }
  this._buf = null;
};
NumStat.prototype.quantile = function(q){
  if(this.n === 0) return null;
  if(this._buf){
    var a = this._buf.slice().sort(function(x,y){ return x - y; });
    var pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }
  var target = q * this.n, cum = 0;
  for(var i = 0; i < this._bins; i++){
    cum += this._hist[i];
    if(cum >= target){
      var within = this._hist[i] ? (cum - target) / this._hist[i] : 0;
      var v = this._lo + (i + 1 - within) * this._w;
      return Math.min(this.max, Math.max(this.min, v));
    }
  }
  return this.max;
};
NumStat.prototype.out = function(){
  if(!this.n) return { n:0 };
  var sd = this.n > 1 ? Math.sqrt(this._m2 / (this.n - 1)) : 0;
  return {
    n: this.n, sum: r6(this.sum), mean: r6(this.mean), sd: r6(sd),
    min: r6(this.min), max: r6(this.max),
    p05: r6(this.quantile(0.05)), p25: r6(this.quantile(0.25)),
    p50: r6(this.quantile(0.50)), p75: r6(this.quantile(0.75)),
    p95: r6(this.quantile(0.95)),
    cv: this.mean ? r6(sd / Math.abs(this.mean)) : null,
    exact: !!this._buf          // true → quantiles exact; false → 1024-bin estimate
  };
};
function r6(x){
  if(x == null || !isFinite(x)) return null;
  return Math.round(x * 1e6) / 1e6;
}
function r3(x){
  if(x == null || !isFinite(x)) return null;
  return Math.round(x * 1e3) / 1e3;
}

/* Exact median over a small array (used for rosters / fleet medians). */
function medianOf(arr){
  if(!arr || !arr.length) return null;
  var a = arr.slice().sort(function(x,y){ return x - y; });
  var m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

/* ═══ 3 · column role inference ════════════════════════════════════════════
   Explicit prefixes win (self-describing template files):
     time | who: | ctx: | val:name[unit]
   Absent prefixes → inferred from observed values, so real-world exports
   profile untouched. */

var WHO_HINT = /\b(operator|operador|driver|conductor|employee|empleado|user|usuario|customer|cliente|agent|agente|truck|camion|camión|unit|unidad|vehicle|vehiculo|vehículo|asset|equipo|store|tienda|technician|tecnico|técnico|staff|person|persona|crew|id)\b/i;
var CTX_HINT = /\b(shift|turno|route|ruta|zone|zona|segment|segmento|region|region|state|estado|status|condition|condicion|condición|category|categoria|categoría|type|tipo|channel|canal|location|ubicacion|ubicación|position|posicion|posición|site|area|área|grade|class|clase|group|grupo|reason|motivo|causa|weather|clima)\b/i;
var TIME_HINT = /\b(date|fecha|time|hora|timestamp|datetime|periodo|period|day|dia|día|month|mes)\b/i;

/** Split "Fuel Consumption Rate-Engine (gal/h)" → {label, unit} */
function splitUnit(name){
  // headers exported from BI tools carry sort arrows and similar decoration
  var s = String(name == null ? '' : name)
            .replace(/[\u25B2\u25BC\u2191\u2193\u25B4\u25BE\u2B06\u2B07*\u2022]+/g, ' ')
            .replace(/\s+/g, ' ').trim();
  var m = /^(.*?)\s*[\(\[]([^)\]]{0,14})[\)\]]$/.exec(s);
  if(m && m[1].trim()) return { label: m[1].trim(), unit: m[2].trim() || null };
  return { label: s, unit: null };
}

/** Read the header-prefix convention; returns null when absent. */
function explicitRole(raw){
  var s = String(raw||'').trim();
  var m = /^(time|who|ctx|val)\s*:\s*(.*)$/i.exec(s);
  if(m) return { role: m[1].toLowerCase(), rest: m[2] };
  if(/^time$/i.test(s)) return { role:'time', rest: s };
  return null;
}

function Column(index, rawName){
  var ex = explicitRole(rawName);
  var su = splitUnit(ex ? ex.rest : rawName);
  this.index    = index;
  this.raw      = String(rawName == null ? '' : rawName);
  this.name     = su.label || ('col' + (index + 1));
  this.unit     = su.unit;
  this.declared = ex ? ex.role : null;
  this.n = 0; this.missing = 0; this.nNum = 0; this.nTime = 0; this.nStr = 0;
  this.num  = new NumStat();
  this.cats = new Map();
  this.catTruncated = false;
  this.tMin = null; this.tMax = null; this._tPrev = null;
  this.deltas = new Map();          // observed inter-row time deltas (seconds)
  this.byHour = null;               // filled for measures once a time column exists
}
Column.prototype.observe = function(v){
  this.n++;
  if(isBlank(v)){ this.missing++; return null; }
  var num = toNum(v);
  if(num !== null){
    this.nNum++; this.num.push(num);
    return { kind:'num', v:num };
  }
  var t = toTime(v);
  if(t !== null){
    this.nTime++;
    if(this.tMin === null || t < this.tMin) this.tMin = t;
    if(this.tMax === null || t > this.tMax) this.tMax = t;
    if(this._tPrev !== null){
      var d = Math.round((t - this._tPrev) / 1000);
      if(d > 0 && d < 86400 * 31) this.deltas.set(d, (this.deltas.get(d)||0) + 1);
    }
    this._tPrev = t;
    return { kind:'time', v:t };
  }
  this.nStr++;
  var s = String(v);
  if(this.cats.has(s)) this.cats.set(s, this.cats.get(s) + 1);
  else if(this.cats.size < LIM.maxDistinct) this.cats.set(s, 1);
  else this.catTruncated = true;
  return { kind:'str', v:s };
};
Column.prototype.role = function(){
  if(this.declared) return this.declared;
  var live = this.n - this.missing;
  if(!live) return 'ctx';
  if(this.nTime / live > 0.8) return 'time';
  if(this.nNum  / live > 0.8) return 'val';
  if(TIME_HINT.test(this.name) && this.nTime) return 'time';
  if(CTX_HINT.test(this.name)) return 'ctx';
  if(WHO_HINT.test(this.name)) return 'who';
  return 'ctx';
};
Column.prototype.type = function(){
  var live = this.n - this.missing;
  if(!live) return 'empty';
  if(this.nTime / live > 0.8) return 'datetime';
  if(this.nNum  / live > 0.8) return 'number';
  return 'category';
};
Column.prototype.grainSec = function(){
  var best = null, bestN = 0;
  this.deltas.forEach(function(c, d){ if(c > bestN){ bestN = c; best = d; } });
  return best;
};
Column.prototype.out = function(){
  var type = this.type(), role = this.role();
  var o = {
    name: this.name, raw: this.raw, unit: this.unit, index: this.index,
    role: role, roleSource: this.declared ? 'declared' : 'inferred', type: type,
    n: this.n, missing: this.missing,
    fill: this.n ? r3((this.n - this.missing) / this.n) : 0
  };
  if(type === 'number') o.stats = this.num.out();
  if(type === 'datetime'){
    o.start = isoOf(this.tMin); o.end = isoOf(this.tMax);
    o.grainSec = this.grainSec();
    var tot = 0, self = this;
    this.deltas.forEach(function(c){ tot += c; });
    var g = o.grainSec, gN = g ? (this.deltas.get(g)||0) : 0;
    o.grainRegularity = tot ? r3(gN / tot) : null;
    o.gaps = tot - gN;
  }
  if(type === 'category' || (type === 'number' && this.cats.size)){
    var arr = [];
    this.cats.forEach(function(c, k){ arr.push({ value:k, count:c }); });
    arr.sort(function(a,b){ return b.count - a.count; });
    o.distinct = arr.length + (this.catTruncated ? LIM.maxDistinct : 0);
    o.distinctTruncated = this.catTruncated;
    o.top = arr.slice(0, LIM.sheetTopValues);
  }
  return o;
};

/* ═══ 4 · reference-sheet recognisers ══════════════════════════════════════
   Generic by header semantics (es/en synonyms), never by sheet name alone, so
   an ice-cream workbook with a "Limits" tab is recognised exactly the same way
   and a workbook with none of them still profiles cleanly. */

function norm(s){
  return String(s == null ? '' : s).toLowerCase()
    .normalize ? String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()
               : String(s == null ? '' : s).toLowerCase().trim();
}
function hasAll(hdr, words){
  var h = hdr.map(norm);
  return words.every(function(w){ return h.some(function(c){ return c.indexOf(w) >= 0; }); });
}
function pick(hdr, words){
  var h = hdr.map(norm);
  for(var i = 0; i < words.length; i++){
    for(var j = 0; j < h.length; j++) if(h[j].indexOf(words[i]) >= 0) return j;
  }
  return -1;
}

/** ">120 s" → 120 · "Por ciclo" → null + note · "45" → 45 */
function parsePersistence(v){
  if(isBlank(v)) return { sec:null, note:null };
  var s = String(v).trim();
  var m = /(\d+(?:\.\d+)?)\s*(s|seg|sec|segundos?|m|min|minutos?|h|hora?s?)?/i.exec(s);
  if(m){
    var n = parseFloat(m[1]), u = (m[2]||'s').toLowerCase();
    if(/^m/.test(u) && !/^ms/.test(u)) n *= 60;
    else if(/^h/.test(u)) n *= 3600;
    return { sec: Math.round(n), note: /^[><]/.test(s) ? s : null };
  }
  return { sec:null, note:s };            // "Por ciclo", "Por segmento", "Contexto"
}

/** "4-12" · ">12-18" · ">18" · "<3 o >15" · "3-4.9 o 12.1-15" · "Buena / Regular" */
function parseBand(v){
  if(isBlank(v)) return null;
  var s = String(v).trim();
  var parts = s.split(/\s+(?:o|or|\/|\|)\s+/i);
  var ranges = [], text = [];
  parts.forEach(function(p){
    p = p.trim();
    var m;
    if((m = /^([<>]=?)\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/.exec(p))){
      ranges.push({ lo:parseFloat(m[2]), hi:parseFloat(m[3]), exLo: m[1] === '>' });
    } else if((m = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/.exec(p))){
      ranges.push({ lo:parseFloat(m[1]), hi:parseFloat(m[2]) });
    } else if((m = /^([<>]=?)\s*(-?\d+(?:\.\d+)?)/.exec(p))){
      if(m[1][0] === '>') ranges.push({ lo:parseFloat(m[2]), hi:null, exLo: m[1] === '>' });
      else ranges.push({ lo:null, hi:parseFloat(m[2]), exHi: m[1] === '<' });
    } else if((m = /^(-?\d+(?:\.\d+)?)$/.exec(p))){
      ranges.push({ lo:parseFloat(m[1]), hi:parseFloat(m[1]) });
    } else if(p){
      text.push(p);
    }
  });
  var out = { raw:s };
  if(ranges.length) out.ranges = ranges;
  if(text.length)   out.labels = text;
  return out;
}

/** Fold correct/out/critical bands into a MOMENTUM.Thresholds-shaped object. */
function bandsToThresholds(correct, out, crit){
  var c = correct && correct.ranges && correct.ranges[0];
  if(!c) return null;
  var t = {};
  if(c.lo != null && c.hi != null){
    // two-sided → dir:'within' with green band and derived yellow band
    t.dir = 'within'; t.glo = c.lo; t.ghi = c.hi;
    var yl = c.lo, yh = c.hi;
    (out && out.ranges || []).forEach(function(r){
      if(r.lo != null && r.lo < yl) yl = r.lo;
      if(r.hi != null && r.hi > yh) yh = r.hi;
      if(r.hi == null && r.lo != null && r.lo >= c.hi) yh = Math.max(yh, r.lo);
    });
    t.ylo = yl; t.yhi = yh;
  } else if(c.hi != null){
    t.dir = 'lte'; t.g = c.hi;
    var o1 = out && out.ranges && out.ranges[0];
    t.y = o1 && o1.hi != null ? o1.hi : c.hi;
    var k1 = crit && crit.ranges && crit.ranges[0];
    t.r = k1 && k1.lo != null ? k1.lo : t.y;
  } else if(c.lo != null){
    t.dir = 'gte'; t.g = c.lo;
    var o2 = out && out.ranges && out.ranges[0];
    t.y = o2 && o2.lo != null ? o2.lo : c.lo;
    var k2 = crit && crit.ranges && crit.ranges[0];
    t.r = k2 && k2.hi != null ? k2.hi : t.y;
  } else return null;
  return t;
}

var RECOGNISERS = [
  {
    id: 'thresholds',
    test: function(name, hdr){
      // a limits table grades a parameter; a summary table merely lists one, so
      // the graded bands are what identifies it.
      var param = hasAll(hdr, ['parametro']) || hasAll(hdr, ['parameter']) || hasAll(hdr, ['variable']);
      var good  = hasAll(hdr, ['correcto']) || hasAll(hdr, ['correct']) || hasAll(hdr, ['normal']);
      var bad   = hasAll(hdr, ['critico'])  || hasAll(hdr, ['critical']) ||
                  hasAll(hdr, ['falla'])    || hasAll(hdr, ['fail']) ||
                  hasAll(hdr, ['fuera'])    || hasAll(hdr, ['out of']);
      return param && good && bad;
    },
    ingest: function(hdr, rows){
      var iG = pick(hdr, ['grupo','group']),         iP = pick(hdr, ['parametro','parameter','variable']),
          iU = pick(hdr, ['unidad','unit']),         iC = pick(hdr, ['contexto','context']),
          iOk= pick(hdr, ['correcto','correct','ok']),iOut=pick(hdr, ['fuera','out of','warning']),
          iCr= pick(hdr, ['critico','critical','falla','fail']),
          iT = pick(hdr, ['tolerancia','tolerance','ceiling']),
          iPe= pick(hdr, ['persistencia','persistence','duration']),
          iJ = pick(hdr, ['criterio','criterion','evaluation','notes']);
      var out = [];
      rows.forEach(function(r){
        if(iP < 0 || isBlank(r[iP])) return;
        var ok = parseBand(r[iOk]), bad = parseBand(r[iOut]), cr = parseBand(r[iCr]);
        var per = parsePersistence(iPe >= 0 ? r[iPe] : null);
        out.push({
          group: iG >= 0 ? r[iG] : null,
          param: String(r[iP]).trim(),
          paramKey: norm(splitUnit(r[iP]).label),
          unit: iU >= 0 && !isBlank(r[iU]) ? String(r[iU]).trim() : splitUnit(r[iP]).unit,
          context: iC >= 0 ? r[iC] : null,
          correct: ok, out: bad, critical: cr,
          ceiling: iT >= 0 ? toNum(r[iT]) : null,
          persistSec: per.sec, persistNote: per.note,
          criterion: iJ >= 0 ? r[iJ] : null,
          thresholds: bandsToThresholds(ok, bad, cr)
        });
      });
      return { kind:'thresholds', rows: out };
    }
  },
  {
    id: 'incidents',
    test: function(name, hdr){
      return (hasAll(hdr, ['caso']) && (hasAll(hdr,['inicio']) || hasAll(hdr,['exceso']))) ||
             (hasAll(hdr, ['case']) && (hasAll(hdr,['start'])  || hasAll(hdr,['excess'])));
    },
    ingest: function(hdr, rows){
      var iE = pick(hdr, ['camion','unidad','entity','asset','unit','truck']),
          iC = pick(hdr, ['caso','case','anomaly','incident']),
          iS = pick(hdr, ['inicio','start']),  iF = pick(hdr, ['fin','end']),
          iW = pick(hdr, ['tipo de ventana','window','tipo']),
          iV = pick(hdr, ['variables','signals','pattern']),
          iP = pick(hdr, ['efecto','effect','physical']),
          iR = pick(hdr, ['filas','rows','records']),
          iX = pick(hdr, ['exceso','excess','impact']),
          iZ = pick(hdr, ['ruta','zona','zone','route','segment']),
          iU = pick(hdr, ['uso','use','purpose','notes']);
      var out = [];
      rows.forEach(function(r){
        if(iC < 0 || isBlank(r[iC])) return;
        var st = iS >= 0 ? toTime(r[iS]) : null, en = iF >= 0 ? toTime(r[iF]) : null;
        var zone = iZ >= 0 && !isBlank(r[iZ]) ? String(r[iZ]).trim() : null;
        // "Toda la ruta cargada" names no place the profiler can exclude, so it
        // is reported as un-quarantinable rather than silently doing nothing.
        var terms = zone ? zone.split(/\s*\/\s*/).map(function(z){ return norm(z); })
                               .filter(function(t){ return t.length > 4 && !/^(toda|todo|all)\b/.test(t); })
                         : [];
        var quarantine = st != null ? 'window' : (terms.length ? 'zone' : 'none');
        out.push({
          entity: iE >= 0 && !isBlank(r[iE]) ? String(r[iE]).trim() : null,
          label:  String(r[iC]).trim(),
          startISO: isoOf(st), endISO: isoOf(en), startMs: st, endMs: en,
          windowType: iW >= 0 ? r[iW] : null,
          variables: iV >= 0 && !isBlank(r[iV]) ? String(r[iV]).split(/\s*,\s*/) : [],
          effect: iP >= 0 ? r[iP] : null,
          rowsAffected: iR >= 0 ? toNum(r[iR]) : null,
          expectedExcess: iX >= 0 ? toNum(r[iX]) : null,
          zone: zone,
          zoneTerms: terms,
          use: iU >= 0 ? r[iU] : null,
          quarantine: quarantine
        });
      });
      return { kind:'incidents', rows: out };
    }
  },
  {
    id: 'roster',
    test: function(name, hdr){
      var who   = hasAll(hdr, ['operator']) || hasAll(hdr, ['operador']) || hasAll(hdr, ['employee']);
      var shift = hasAll(hdr, ['shift'])    || hasAll(hdr, ['turno']);
      // a roster is keyed by person-and-period and carries a period total; a
      // telemetry export also names a shift and an operator, so require the
      // roster-only columns and the absence of a per-row timestamp.
      var rollup = hasAll(hdr, ['horario']) || hasAll(hdr, ['schedule']) ||
                   hasAll(hdr, ['mediana']) || hasAll(hdr, ['median']) ||
                   hasAll(hdr, ['desvio'])  || hasAll(hdr, ['desvío']) || hasAll(hdr, ['deviation']);
      var perRowTime = hasAll(hdr, ['date/time']) || hasAll(hdr, ['timestamp']) ||
                       hasAll(hdr, ['fecha y hora']);
      return who && shift && rollup && !perRowTime;
    },
    ingest: function(hdr, rows){
      var iE = pick(hdr, ['camion','unidad','unit','truck','asset','entity']),
          iS = pick(hdr, ['shift id','shift','turno']),
          iH = pick(hdr, ['horario','schedule','hours']),
          iO = pick(hdr, ['operator','operador','employee']),
          iV = pick(hdr, ['combustible','consumo','value','total','fuel']),
          iM = pick(hdr, ['mediana','median','baseline']),
          iD = pick(hdr, ['desvio','desvío','deviation','variance','vs']),
          iF = pick(hdr, ['marca','flag','tag','note']);
      var out = [];
      rows.forEach(function(r){
        if(iO < 0 || isBlank(r[iO])) return;
        out.push({
          entity: iE >= 0 ? String(r[iE]||'').trim() : null,
          shift:  iS >= 0 ? String(r[iS]||'').trim() : null,
          schedule: iH >= 0 ? String(r[iH]||'').trim() : null,
          who:    String(r[iO]).trim(),
          value:  iV >= 0 ? toNum(r[iV]) : null,
          baseline: iM >= 0 ? toNum(r[iM]) : null,
          deviation: iD >= 0 ? toNum(r[iD]) : null,
          flag:   iF >= 0 && !isBlank(r[iF]) ? String(r[iF]).trim() : null
        });
      });
      return { kind:'roster', rows: out };
    }
  },
  {
    id: 'map',
    test: function(name, hdr){
      return (hasAll(hdr, ['route']) || hasAll(hdr, ['ruta'])) &&
             (hasAll(hdr, ['segmento']) || hasAll(hdr, ['segment']));
    },
    ingest: function(hdr, rows){
      var iR = pick(hdr, ['route id','route','ruta']),
          iO = pick(hdr, ['orden','order','seq']),
          iS = pick(hdr, ['segmento','segment']),
          iL = pick(hdr, ['longitud','length','distance']),
          iG = pick(hdr, ['pendiente nominal','pendiente','grade','slope','incl']),
          iMx= pick(hdr, ['maximo','máximo','max']),
          iC = pick(hdr, ['condicion','condición','condition']);
      var out = [];
      rows.forEach(function(r){
        if(iS < 0 || isBlank(r[iS])) return;
        out.push({
          route: iR >= 0 ? String(r[iR]||'').trim() : null,
          order: iO >= 0 ? toNum(r[iO]) : null,
          segment: String(r[iS]).trim(),
          lengthM: iL >= 0 ? toNum(r[iL]) : null,
          grade: iG >= 0 ? toNum(r[iG]) : null,
          gradeMax: iMx >= 0 ? toNum(r[iMx]) : null,
          condition: iC >= 0 ? String(r[iC]||'').trim() : null
        });
      });
      return { kind:'map', rows: out };
    }
  },
  {
    id: 'dictionary',
    test: function(name, hdr){
      return (hasAll(hdr, ['variable']) && (hasAll(hdr, ['descripcion']) || hasAll(hdr, ['description']))) ||
             (hasAll(hdr, ['campo'])    && hasAll(hdr, ['descripcion']));
    },
    ingest: function(hdr, rows){
      var iG = pick(hdr, ['grupo','group']),  iV = pick(hdr, ['variable','campo','field']),
          iD = pick(hdr, ['descripcion','descripción','description']),
          iU = pick(hdr, ['unidad','unit','tipo','type']),
          iR = pick(hdr, ['rol','role']),     iS = pick(hdr, ['origen','source']);
      var out = [];
      rows.forEach(function(r){
        if(iV < 0 || isBlank(r[iV])) return;
        out.push({
          group: iG >= 0 ? r[iG] : null,
          variable: String(r[iV]).trim(),
          variableKey: norm(splitUnit(r[iV]).label),
          description: iD >= 0 ? r[iD] : null,
          unit: iU >= 0 ? r[iU] : null,
          role: iR >= 0 ? r[iR] : null,
          origin: iS >= 0 ? r[iS] : null
        });
      });
      return { kind:'dictionary', rows: out };
    }
  }
];

/* ═══ 5 · per-sheet accumulator ════════════════════════════════════════════ */

function Sheet(name, acc){
  this.name = name; this.acc = acc;
  this.rawRows = 0; this.dataRows = 0;
  this.pre = [];                   // buffered rows while sniffing the header
  this.header = null; this.cols = null; this.headerRowIndex = null;
  this.preamble = []; this.preambleFacts = [];
  this.recogniser = null; this.refRows = null; this.refResult = null;
  this.timeIdx = -1; this.measureIdx = []; this.catIdx = [];
  this.xtab = null;                // Map "catCol|value|measCol" → NumStat
  this.episodes = null;            // Map catCol → {value → {runs, secs, sumMax:{}}}
  this._epState = null;
  this.trans = null;               // Map catCol → Map "from\u0001to" → count
  this.catHour = null;             // Map catCol → Map value → Int32Array(24)
  this.cycles = null;              // Map measCol → completed-cycle accumulator
  this._cyOpen = null;             // Map measCol → the cycle currently in flight
  this.quarantined = 0; this.tQuarantine = null; this.zoneQuarantine = null;
  this.baseline = null;            // Map measCol → NumStat over non-quarantined rows
  this.entityKey = null;           // sheet-level entity (e.g. truck id from name)
  this.totals = null;              // Map measCol → {sum,n} over ALL rows
  this.finished = false;
  this._warm = [];
}

Sheet.prototype.feed = function(cells){
  this.rawRows++;
  if(this.header === null){
    this.pre.push(cells);
    if(this.pre.length >= LIM.headerScanRows) this._decideHeader();
    return;
  }
  this._data(cells);
};

Sheet.prototype._decideHeader = function(){
  var rows = this.pre, best = -1, bestScore = 0;
  for(var i = 0; i < rows.length; i++){
    var r = rows[i] || [], live = 0, allStr = true;
    for(var j = 0; j < r.length; j++){
      if(isBlank(r[j])) continue;
      live++;
      if(toNum(r[j]) !== null) allStr = false;
    }
    if(live < 2 || !allStr) continue;
    var nxt = rows[i+1] || [], nLive = 0;
    for(var k = 0; k < nxt.length; k++) if(!isBlank(nxt[k])) nLive++;
    var score = Math.min(live, nLive || live);
    if(score > bestScore){ bestScore = score; best = i; }
  }
  if(best < 0) best = 0;
  this.headerRowIndex = best;
  var hdr = rows[best] || [];
  this.header = hdr.map(function(h){ return String(h == null ? '' : h).trim(); });

  for(var p = 0; p < best; p++){
    var txt = (rows[p] || []).filter(function(c){ return !isBlank(c); })
                             .map(function(c){ return String(c).trim(); }).join(' · ');
    if(txt) this.preamble.push(txt);
  }
  this._extractPreambleFacts();

  for(var rc = 0; rc < RECOGNISERS.length; rc++){
    if(RECOGNISERS[rc].test(this.name, this.header)){
      this.recogniser = RECOGNISERS[rc]; this.refRows = []; break;
    }
  }
  this.cols = this.header.map(function(h, ix){ return new Column(ix, h); });

  var buffered = rows.slice(best + 1);
  this.pre = null;
  for(var b = 0; b < buffered.length; b++) this._data(buffered[b]);
};

Sheet.prototype._extractPreambleFacts = function(){
  var txt = this.preamble.join(' · ');
  var re = /(\d[\d.,]*)\s+([A-Za-zÁÉÍÓÚáéíóúÑñ][A-Za-zÁÉÍÓÚáéíóúÑñ]{2,20})/g, m, seen = {};
  while((m = re.exec(txt))){
    var n = toNum(m[1]); if(n === null) continue;
    var k = norm(m[2]); if(seen[k]) continue; seen[k] = 1;
    this.preambleFacts.push({ n:n, label:m[2] });
    if(this.preambleFacts.length >= 12) break;
  }
  var kv = /([A-Za-zÁÉÍÓÚáéíóúÑñ][^:·.]{2,28}):\s*([^·.]{1,40})/g, q;
  while((q = kv.exec(txt))){
    this.preambleFacts.push({ key:q[1].trim(), value:q[2].trim() });
    if(this.preambleFacts.length >= 20) break;
  }
};

Sheet.prototype._data = function(cells){
  var live = 0;
  for(var i = 0; i < cells.length; i++) if(!isBlank(cells[i])) live++;
  if(!live) return;
  this.dataRows++;

  if(this.recogniser){
    if(this.refRows.length < LIM.refSheetRows) this.refRows.push(cells);
  }

  var cols = this.cols;
  for(var c = 0; c < cols.length; c++) cols[c].observe(cells[c]);
  // widen if a row is longer than the header
  for(var e = cols.length; e < cells.length; e++){
    if(isBlank(cells[e])) continue;
    var nc = new Column(e, 'col' + (e + 1)); nc.observe(cells[e]); cols.push(nc);
  }
  // Role detection needs a few hundred rows of evidence, so those rows are
  // buffered (fixed 400-row ceiling) and replayed once the plan is locked —
  // cross-tabs and baselines therefore cover every row, not just row 401+.
  if(this.dataRows <= ROLE_WARM){
    this._warm.push(cells);
    if(this.dataRows === ROLE_WARM) this._lockAndReplay();
    return;
  }
  this._crossTab(cells);
};

var ROLE_WARM = 400;

Sheet.prototype._lockAndReplay = function(){
  this._lockRoles();
  var w = this._warm; this._warm = null;
  for(var i = 0; i < w.length; i++) this._crossTab(w[i]);
};

/** After 400 rows the column shapes are settled — fix the analysis plan once. */
Sheet.prototype._lockRoles = function(){
  var self = this;
  this.acc.bindQuarantine(this);
  this.timeIdx = -1; this.measureIdx = []; this.catIdx = [];
  this.cols.forEach(function(col, ix){
    var t = col.type(), r = col.role();
    if(t === 'datetime' && self.timeIdx < 0) self.timeIdx = ix;
    else if(t === 'number' && r === 'val') self.measureIdx.push(ix);
    else if(t === 'category' && col.cats.size && col.cats.size <= LIM.xtabMaxCard) self.catIdx.push(ix);
  });
  this.xtab = new Map();
  this.xtabExc = new Map();
  /* Joint cross-tab (Phase 5). The marginal cross-tab above answers "what does
     this measure look like in this state" and "…on this shift" separately, and
     a factor read off two marginals carries whatever the two dimensions share.
     The joint cell answers both at once. Only low-cardinality categoricals are
     eligible on either side, because the cell count is the product. */
  this.jointIdx = this.catIdx.filter(function(ix){
    return self.cols[ix].cats.size <= LIM.jointMaxCard; });
  this.joint = new Map();
  this.jointExc = new Map();
  this.episodes = new Map();
  this._epState = new Map();
  this.baseline = new Map();
  this.totals = new Map();
  this.trans = new Map();
  this.catHour = new Map();
  this.cycles = new Map();
  this._cyOpen = new Map();
  this.catIdx.forEach(function(ci){
    self.episodes.set(ci, new Map()); self._epState.set(ci, null);
    self.trans.set(ci, new Map()); self.catHour.set(ci, new Map());
  });
  var nm = this.measureIdx.length;
  this.measureIdx.forEach(function(mi){
    // completed-cycle detection: a quantity that fills and discharges defines a
    // cycle. Counted once at the discharge — never summed per row. Measures that
    // never return to zero (a rate, a temperature) simply produce no cycles.
    self.cycles.set(mi, { runs:0, peakSum:0, peakSq:0, secs:0, secsSq:0, rows:0,
                          colMax:0, open:null, firstMs:null, lastMs:null,
                          dischSum:0, zeroRows:0, hiRows:0, allRows:0,
                          sums:new Float64Array(nm), sumsSq:new Float64Array(nm),
                          term:new Map(), openAtEnd:0 });
  });
  this.measureIdx.forEach(function(mi){
    self.baseline.set(mi, new NumStat());
    self.totals.set(mi, { sum:0, n:0 });
    self.cols[mi].byHour = [];
    for(var h = 0; h < 24; h++) self.cols[mi].byHour.push(new MeanStat());
  });
};

Sheet.prototype._crossTab = function(cells){
  var self = this;
  var tMs = this.timeIdx >= 0 ? toTime(cells[this.timeIdx]) : null;
  var quarantined = this._isQuarantined(tMs, cells);
  if(quarantined) this.quarantined++;
  var hour = tMs != null ? new Date(tMs).getUTCHours() : null;

  var mv = [];
  this.measureIdx.forEach(function(mi){
    var v = toNum(cells[mi]);
    mv.push(v);
    if(v === null) return;
    var tot = self.totals.get(mi); tot.sum += v; tot.n++;
    if(!quarantined) self.baseline.get(mi).push(v);
    if(hour !== null) self.cols[mi].byHour[hour].push(v);
  });

  this._cycleStep(cells, mv, tMs);

  this.catIdx.forEach(function(ci){
    var cv = cells[ci];
    if(isBlank(cv)) return;
    cv = String(cv);
    // hour-of-day occupancy per value — tells the generator which dimensions are
    // scheduled by the clock (a shift) and which are not (road condition).
    if(hour !== null){
      var hb = self.catHour.get(ci), ha = hb.get(cv);
      if(!ha){ if(hb.size < LIM.episodeMaxCard){ ha = new Int32Array(24); hb.set(cv, ha); } }
      if(ha) ha[hour]++;
    }
    // cross-tab: every row feeds the observed figure; quarantined rows are
    // tallied separately so the clean baseline is an exact subtraction.
    for(var k = 0; k < self.measureIdx.length; k++){
      if(mv[k] === null) continue;
      var key = ci + '\u0001' + cv + '\u0001' + self.measureIdx[k];
      var st = self.xtab.get(key);
      if(!st){
        if(self.acc.xtabCells >= LIM.xtabMaxCells) continue;
        st = new NumStat(LIM.xtabWarm, LIM.xtabBins); self.xtab.set(key, st); self.acc.xtabCells++;
      }
      st.push(mv[k]);
      if(quarantined){
        var ex = self.xtabExc.get(key);
        if(!ex){ ex = new MeanStat(); self.xtabExc.set(key, ex); }
        ex.push(mv[k]);
      }
    }
    // episodes: contiguous runs of the same categorical value
    var ep = self._epState.get(ci);
    if(!ep || ep.value !== cv){
      if(ep){
        self._closeEpisode(ci, ep, tMs);
        // first-order transition counts: the observed order of work, which is
        // what lets a generator lay out a cycle instead of inventing one.
        var tk = ep.value + '\u0001' + cv, tm2 = self.trans.get(ci);
        if(tm2.size < LIM.episodeMaxCard * LIM.episodeMaxCard)
          tm2.set(tk, (tm2.get(tk) || 0) + 1);
      }
      ep = { value:cv, startMs:tMs, rows:0, max:new Array(self.measureIdx.length).fill(null),
             sum:new Array(self.measureIdx.length).fill(0),
             cnt:new Array(self.measureIdx.length).fill(0) };
      self._epState.set(ci, ep);
    }
    ep.rows++; ep.endMs = tMs;
    for(var q = 0; q < mv.length; q++){
      if(mv[q] === null) continue;
      if(ep.max[q] === null || mv[q] > ep.max[q]) ep.max[q] = mv[q];
      ep.sum[q] += mv[q]; ep.cnt[q]++;
    }
  });

  /* — joint cells, one pass over the eligible categorical pairs — */
  if(this.jointIdx.length > 1) this._jointStep(cells, mv, quarantined);
};

/* Every unordered pair of eligible categoricals, crossed with every measure.
   Which pair matters is decided later, in finalize, where the schedules are
   known — accumulating them all here costs one pass and keeps the row loop
   ignorant of downstream decisions. */
Sheet.prototype._jointStep = function(cells, mv, quarantined){
  var self = this, J = this.jointIdx, a, b, k;
  for(a = 0; a < J.length; a++){
    var ia = J[a], va = cells[ia];
    if(isBlank(va)) continue;
    va = String(va);
    for(b = a + 1; b < J.length; b++){
      var ib = J[b], vb = cells[ib];
      if(isBlank(vb)) continue;
      vb = String(vb);
      for(k = 0; k < this.measureIdx.length; k++){
        if(mv[k] === null) continue;
        var key = ia + '\u0001' + va + '\u0001' + ib + '\u0001' + vb + '\u0001' + this.measureIdx[k];
        var st = self.joint.get(key);
        if(!st){
          if(self.acc.jointCells >= LIM.jointMaxCells) continue;
          st = new SpreadStat(); self.joint.set(key, st); self.acc.jointCells++;
        }
        st.push(mv[k]);
        // the same exact-subtraction contract the marginal cells honour: the
        // observed figure counts every row, and what was quarantined is tallied
        // beside it rather than silently dropped
        if(quarantined){
          var ex = self.jointExc.get(key);
          if(!ex){ ex = new MeanStat(); self.jointExc.set(key, ex); }
          ex.push(mv[k]);
        }
      }
    }
  }
};

/* ── completed cycles ──────────────────────────────────────────────────────
   A generic primitive, not a mining rule: a quantity that fills and then
   discharges to (near) zero has completed one cycle, and the quantity credited
   to that cycle is the peak it reached — counted ONCE, at the discharge. A haul
   is one payload, not one payload per second.

   A cycle runs discharge-to-discharge, so its measure sums cover the whole
   loop — waiting, loading, laden travel, discharge, empty return. A cycle still
   in flight when the data ends is not counted: that load was never dumped.

   Measures that never return to zero (a rate, a pressure, a temperature) simply
   never commit, and report no cycles.                                        */
Sheet.prototype._totalsSnap = function(mv, subtract){
  var out = new Float64Array(this.measureIdx.length);
  for(var k = 0; k < this.measureIdx.length; k++){
    var t = this.totals.get(this.measureIdx[k]);
    out[k] = t.sum - (subtract && mv[k] !== null ? mv[k] : 0);
  }
  return out;
};
Sheet.prototype._cycleStep = function(cells, mv, tMs){
  for(var k = 0; k < this.measureIdx.length; k++){
    var v = mv[k];
    if(v === null) continue;
    var cy = this.cycles.get(this.measureIdx[k]);
    if(cy.runs >= LIM.cycleMaxRuns){ cy.overflow = true; continue; }
    if(v > cy.colMax) cy.colMax = v;
    // shape evidence: a carried quantity rests at zero for part of the loop and
    // holds near its peak for another part. A rate that merely dips does neither.
    cy.allRows++;
    if(cy.colMax > 0){
      if(v <= cy.colMax * 0.005) cy.zeroRows++;
      else if(v >= cy.colMax * 0.9) cy.hiRows++;
    }
    var op = cy.open;
    if(op === null){
      cy.open = { peak: v, startMs: tMs, rows: 1, armed: false,
                  snap: this._totalsSnap(mv, true) };
      continue;
    }
    op.rows++;
    if(v > op.peak) op.peak = v;
    if(!op.armed && op.peak > 0 && op.peak >= cy.colMax * LIM.cycleArmFrac) op.armed = true;
    if(op.armed && v <= op.peak * LIM.cycleZeroFrac){
      this._commitCycle(cy, op, tMs, cells, mv, v);
      cy.open = { peak: v, startMs: tMs, rows: 0, armed: false,
                  snap: this._totalsSnap(mv, false) };
    }
  }
};
Sheet.prototype._commitCycle = function(cy, op, tMs, cells, mv, dischargeValue){
  var self = this;
  cy.runs++; cy.rows += op.rows;
  cy.peakSum += op.peak; cy.peakSq += op.peak * op.peak;
  cy.dischSum += dischargeValue || 0;
  if(op.peak < cy.colMax * LIM.cycleArmFrac) cy.smallRuns = (cy.smallRuns || 0) + 1;
  if(op.startMs != null && tMs != null){
    var sec = Math.max(0, (tMs - op.startMs) / 1000);
    cy.secs += sec; cy.secsSq += sec * sec;
    if(cy.firstMs === null) cy.firstMs = op.startMs;
    cy.lastMs = tMs;
  }
  // per-cycle measure sums, taken as a delta of the running totals — no
  // per-row work, so cycle-level quantities cost nothing on the hot path.
  for(var k = 0; k < this.measureIdx.length; k++){
    var t = this.totals.get(this.measureIdx[k]);
    var d = t.sum - op.snap[k];
    cy.sums[k] += d; cy.sumsSq[k] += d * d;
  }
  // which categorical value was live at the discharge — reported, never assumed
  this.catIdx.forEach(function(ci){
    var v = cells[ci];
    if(isBlank(v)) return;
    var key = ci + '\u0001' + String(v);
    if(cy.term.size < LIM.episodeMaxCard * 4) cy.term.set(key, (cy.term.get(key) || 0) + 1);
  });
};

Sheet.prototype._closeEpisode = function(ci, ep, nowMs){
  var bucket = this.episodes.get(ci);
  var rec = bucket.get(ep.value);
  if(!rec){
    if(bucket.size >= LIM.episodeMaxCard) return;
    rec = { runs:0, rows:0, secs:0, secsSq:0, sumMax:new Array(this.measureIdx.length).fill(0),
            nMax:new Array(this.measureIdx.length).fill(0),
            sum:new Array(this.measureIdx.length).fill(0),
            cnt:new Array(this.measureIdx.length).fill(0) };
    bucket.set(ep.value, rec);
  }
  rec.runs++; rec.rows += ep.rows;
  if(ep.startMs != null && (ep.endMs != null || nowMs != null)){
    var esec = Math.max(0, ((nowMs != null ? nowMs : ep.endMs) - ep.startMs) / 1000);
    rec.secs += esec; rec.secsSq += esec * esec;
  }
  for(var q = 0; q < ep.max.length; q++){
    if(ep.max[q] !== null){ rec.sumMax[q] += ep.max[q]; rec.nMax[q]++; }
    rec.sum[q] += ep.sum[q]; rec.cnt[q] += ep.cnt[q];
  }
};

/** Incident quarantine — window (time range) or zone (context term match). */
Sheet.prototype._isQuarantined = function(tMs, cells){
  var q = this.tQuarantine, i;
  if(q && tMs != null){
    for(i = 0; i < q.length; i++) if(tMs >= q[i][0] && tMs <= q[i][1]) return true;
  }
  var z = this.zoneQuarantine;
  if(z && z.length){
    for(i = 0; i < this.catIdx.length; i++){
      var v = cells[this.catIdx[i]];
      if(isBlank(v)) continue;
      var nv = norm(v);
      for(var j = 0; j < z.length; j++) if(nv.indexOf(z[j]) >= 0) return true;
    }
  }
  return false;
};

Sheet.prototype.end = function(){
  if(this.finished) return;
  this.finished = true;
  if(this.header === null) this._decideHeader();
  if(this._warm) this._lockAndReplay();
  if(this._epState){
    var self = this;
    this._epState.forEach(function(ep, ci){ if(ep) self._closeEpisode(ci, ep, null); });
  }
  // a cycle still in flight when the data ends never discharged — it is counted
  // as unfinished, never as a completed cycle.
  if(this.cycles) this.cycles.forEach(function(cy){
    if(cy.open && cy.open.armed){ cy.openAtEnd++; cy.openPeak = cy.open.peak; }
    cy.open = null;
  });
  if(this.recogniser && this.dataRows > LIM.refSheetRows){
    this.recogniser = null; this.refRows = null;      // bulk data, not a reference table
  }
  if(this.recogniser && this.refRows){
    try { this.refResult = this.recogniser.ingest(this.header, this.refRows); }
    catch(e){ this.refResult = { kind:this.recogniser.id, error:String(e && e.message || e), rows:[] }; }
  }
};

Sheet.prototype.out = function(){
  var self = this;
  var o = {
    name: this.name,
    kind: this.recogniser ? this.recogniser.id : (this.timeIdx >= 0 ? 'series' : 'table'),
    rows: this.dataRows, headerRowIndex: this.headerRowIndex,
    preamble: this.preamble.join(' · ').slice(0, LIM.preambleChars) || null,
    preambleFacts: this.preambleFacts.length ? this.preambleFacts : undefined,
    columns: (this.cols || []).map(function(c){ return c.out(); })
  };
  if(this.timeIdx >= 0) o.timeColumn = this.cols[this.timeIdx].name;
  if(this.measureIdx && this.measureIdx.length){
    o.measures = this.measureIdx.map(function(i){ return self.cols[i].name; });
    o.contextColumns = this.catIdx.map(function(i){ return self.cols[i].name; });
    o.quarantinedRows = this.quarantined;

    o.totals = {};
    this.totals.forEach(function(t, mi){
      o.totals[self.cols[mi].name] = { sum:r3(t.sum), n:t.n };
    });
    o.baselines = {};
    this.baseline.forEach(function(st, mi){
      if(st.n) o.baselines[self.cols[mi].name] = st.out();
    });
    o.contextualCells = this.xtab.size;
    o.episodeColumns = [];
    this.episodes.forEach(function(bucket, ci){
      if(bucket.size) o.episodeColumns.push(self.cols[ci].name);
    });
  }
  if(this.refResult) o.reference = this.refResult;
  o.contributes = !this.recogniser && (this.timeIdx >= 0 || this.dataRows > LIM.refSheetRows);
  return o;
};

/* ═══ 6 · the accumulator ══════════════════════════════════════════════════ */

function Accumulator(opts){
  opts = opts || {};
  this.meta = {
    schemaVersion: MOMENTUM.Profile.SCHEMA,
    coreVersion:   MOMENTUM.Profile.version,
    datasetId:     opts.datasetId || null,
    sourceName:    opts.sourceName || null,
    sourceType:    opts.sourceType || null,
    sizeBytes:     opts.sizeBytes || null,
    path:          opts.path || 'light',
    profiledAt:    opts.now || new Date().toISOString()
  };
  this.sheets = new Map();
  this.order  = [];
  this.xtabCells = 0;
  this.jointCells = 0;
  this.notes = [];
  this.truncated = false;
}
Accumulator.prototype.feed = function(sheetName, cells){
  var s = this.sheets.get(sheetName);
  if(!s){ s = new Sheet(sheetName, this); this.sheets.set(sheetName, s); this.order.push(sheetName); }
  s.feed(cells);
  return this;
};
Accumulator.prototype.endSheet = function(sheetName){
  var s = this.sheets.get(sheetName);
  if(s) s.end();
  return this;
};
Accumulator.prototype.note = function(msg){ if(msg) this.notes.push(String(msg)); return this; };

/** Two-pass hint: reference sheets discovered anywhere in the workbook feed
 *  the quarantine windows of the telemetry sheets. Callers that can order the
 *  stream put reference sheets first (both shipped paths do). */
Accumulator.prototype.applyIncidents = function(incidents){
  var self = this;
  this.incidents = (this.incidents || []).concat(incidents || []);
  this.order.forEach(function(name){
    var s = self.sheets.get(name);
    if(!s.recogniser) self.bindQuarantine(s);
  });
  return this;
};

/** Attach the incident script's quarantine windows to one sheet. Called both
 *  when incidents arrive and when a later sheet locks its analysis plan, so
 *  ordering of the stream never silently drops a quarantine. */
Accumulator.prototype.bindQuarantine = function(sheet){
  if(!this.incidents || !this.incidents.length) return;
  sheet.tQuarantine = null; sheet.zoneQuarantine = null;
  this.incidents.forEach(function(inc){
    var match = !inc.entity || norm(sheet.name) === norm(inc.entity) ||
                norm(sheet.name).indexOf(norm(inc.entity)) >= 0;
    if(!match) return;
    if(inc.quarantine === 'window' && inc.startMs != null){
      sheet.tQuarantine = sheet.tQuarantine || [];
      sheet.tQuarantine.push([inc.startMs, inc.endMs != null ? inc.endMs : Infinity]);
    } else if(inc.quarantine === 'zone' && inc.zoneTerms.length){
      sheet.zoneQuarantine = (sheet.zoneQuarantine || []).concat(inc.zoneTerms);
    }
  });
};

/* ═══ 7 · finalize — the profile document ══════════════════════════════════ */

Accumulator.prototype.finalize = function(){
  var self = this;
  this.order.forEach(function(n){ self.sheets.get(n).end(); });

  var sheetsOut = this.order.map(function(n){ return self.sheets.get(n).out(); });
  // if nothing qualifies as bulk data, every non-reference sheet contributes —
  // a twenty-row CSV is still somebody's dataset.
  if(!sheetsOut.some(function(s){ return s.contributes; }))
    sheetsOut.forEach(function(s){ if(!s.reference) s.contributes = true; });
  var contributing = sheetsOut.filter(function(s){ return s.contributes; });
  this._contributes = {};
  contributing.forEach(function(s){ self._contributes[s.name] = true; });
  var refs = { thresholds:[], incidents:[], roster:[], map:[], dictionary:[] };
  sheetsOut.forEach(function(s){
    if(s.reference && refs[s.reference.kind]) refs[s.reference.kind] =
      refs[s.reference.kind].concat(s.reference.rows || []);
  });

  var profile = {
    schemaVersion: this.meta.schemaVersion,
    meta: this.meta,
    sheets: sheetsOut
  };

  profile.time      = this._time(contributing);
  this._grain       = profile.time.grainSec || null;
  profile.entities  = this._entities(contributing, refs);
  profile.measures  = this._measures(contributing);
  profile.context   = this._context(contributing);
  profile.baselines = this._baselines();
  profile.rhythm    = this._rhythm();
  profile.thresholdMap = this._thresholdMap(refs.thresholds, profile.measures);
  profile.incidentScript = this._incidentScript(refs.incidents, sheetsOut);
  profile.roster    = refs.roster;
  profile.map       = refs.map;
  profile.dictionary= refs.dictionary;
  profile.rollups   = this._rollups(refs);
  profile.schedules = this._schedules();
  /* the joint cross-tab needs both of the above: which columns look like states,
     and which dimensions the clock decides */
  var stateCols = (profile.rollups.stateColumns || []).map(function(s){ return s.name; });
  var cm0 = profile.rollups.cycleModel || {};
  if(cm0.terminalEvent && cm0.terminalEvent.column &&
     stateCols.indexOf(cm0.terminalEvent.column) < 0) stateCols.push(cm0.terminalEvent.column);
  var jt = this._joint(profile.schedules, stateCols);
  if(jt){
    profile.joint = jt.by;
    profile.jointMeta = { cells: jt.cells, stateColumns: stateCols,
      dimensions: Object.keys(profile.schedules).filter(function(k){
        return profile.schedules[k].scheduled; }) };
    var m0 = (profile.measures && profile.measures[0] && profile.measures[0].name) || null;
    if(m0) profile.jointMeta.confound = this._jointNote(jt, m0);
  }
  profile.quality   = this._quality(contributing, profile);
  profile.coverage  = this._coverage(profile, sheetsOut);
  profile.notes     = this.notes;
  return profile;
};

/* time span across every series sheet */
Accumulator.prototype._time = function(sheets){
  var lo = null, hi = null, grains = new Map(), gaps = 0, seriesSheets = 0;
  sheets.forEach(function(s){
    (s.columns || []).forEach(function(c){
      if(c.type !== 'datetime' || !c.start) return;
      var a = Date.parse(c.start), b = Date.parse(c.end);
      if(lo === null || a < lo) lo = a;
      if(hi === null || b > hi) hi = b;
      if(c.grainSec) grains.set(c.grainSec, (grains.get(c.grainSec)||0) + 1);
      gaps += c.gaps || 0;
    });
    if(s.timeColumn) seriesSheets++;
  });
  if(lo === null) return { present:false };
  var grain = null, best = 0;
  grains.forEach(function(n, g){ if(n > best){ best = n; grain = g; } });
  var spanSec = (hi - lo) / 1000;
  return {
    present: true, startISO: isoOf(lo), endISO: isoOf(hi),
    spanSec: spanSec, spanDays: r3(spanSec / 86400),
    grainSec: grain, gaps: gaps, seriesSheets: seriesSheets,
    grainLabel: grainLabel(grain)
  };
};
function grainLabel(g){
  if(!g) return 'irregular';
  if(g < 60)    return g + ' s';
  if(g < 3600)  return r3(g/60) + ' min';
  if(g < 86400) return r3(g/3600) + ' h';
  return r3(g/86400) + ' d';
}

/* entity rosters — sheet-level entities, who: columns, and reference sheets */
Accumulator.prototype._entities = function(sheets, refs){
  var groups = {};
  function add(kind, value){
    if(isBlank(value)) return;
    var v = String(value).trim(); if(!v) return;
    (groups[kind] = groups[kind] || new Set()).add(v);
  }
  // sheet names that repeat a common shape are themselves an entity roster
  sheets = sheets.filter(function(s){ return !s.reference; });
  var seriesNames = sheets.filter(function(s){ return s.timeColumn; })
                          .map(function(s){ return s.name; });
  if(seriesNames.length > 1) seriesNames.forEach(function(n){ add('units', n); });

  sheets.forEach(function(s){
    (s.columns || []).forEach(function(c){
      if(c.role !== 'who' || !c.top || !c.top.length) return;
      if(c.distinct > LIM.xtabMaxCard) return;
      c.top.forEach(function(t){ add(c.name, t.value); });
    });
  });
  refs.map.forEach(function(m){ add('segments', m.segment); add('routes', m.route); });
  refs.roster.forEach(function(r){ add('operators', r.who); if(r.shift) add('shifts', r.shift); });

  var keys = Object.keys(groups);
  var lists = {};
  keys.forEach(function(k){ lists[k] = Array.from(groups[k]).sort(); });
  var dropped = {};
  keys.forEach(function(a){
    if(dropped[a]) return;
    keys.forEach(function(b){
      if(a === b || dropped[b] || dropped[a]) return;
      var A = lists[a], B = lists[b];
      if(A.length !== B.length) return;
      for(var i = 0; i < A.length; i++) if(A[i] !== B[i]) return;
      // identical rosters — keep the plainer, shorter name
      var keep = a.length <= b.length ? a : b;
      dropped[keep === a ? b : a] = true;
    });
  });
  var out = {};
  keys.forEach(function(k){
    if(dropped[k]) return;
    var arr = lists[k];
    out[k] = { count: arr.length, values: arr.slice(0, 120), truncated: arr.length > 120 };
  });
  if(refs.roster.length) out._rosterRecords = { count: refs.roster.length };
  return out;
};

Accumulator.prototype._measures = function(sheets){
  var by = new Map();
  sheets.forEach(function(s){
    if(s.reference) return;
    (s.columns || []).forEach(function(c){
      if(c.type !== 'number' || c.role !== 'val' || !c.stats) return;
      var rec = by.get(c.name);
      if(!rec){ rec = { name:c.name, unit:c.unit, sheets:0, n:0, sum:0,
                        min:Infinity, max:-Infinity, means:[] }; by.set(c.name, rec); }
      rec.sheets++; rec.n += c.stats.n; rec.sum += c.stats.sum || 0;
      rec.min = Math.min(rec.min, c.stats.min); rec.max = Math.max(rec.max, c.stats.max);
      rec.means.push(c.stats.mean);
      if(!rec.unit && c.unit) rec.unit = c.unit;
    });
  });
  var out = [];
  by.forEach(function(r){
    out.push({ name:r.name, unit:r.unit, sheets:r.sheets, n:r.n,
               sum:r3(r.sum), mean:r.n ? r3(r.sum / r.n) : null,
               min:r3(r.min), max:r3(r.max),
               acrossSheetMedian: r3(medianOf(r.means)),
               spread: r3((Math.max.apply(null, r.means) - Math.min.apply(null, r.means))) });
  });
  out.sort(function(a,b){ return b.n - a.n; });
  return out;
};

Accumulator.prototype._context = function(sheets){
  var by = new Map();
  sheets.forEach(function(s){
    if(s.reference) return;
    (s.columns || []).forEach(function(c){
      if(c.type !== 'category' || !c.top) return;
      var rec = by.get(c.name);
      if(!rec){ rec = { name:c.name, role:c.role, values:new Map() }; by.set(c.name, rec); }
      c.top.forEach(function(t){ rec.values.set(t.value, (rec.values.get(t.value)||0) + t.count); });
    });
  });
  var out = [];
  by.forEach(function(r){
    var vals = []; r.values.forEach(function(n, v){ vals.push({ value:v, count:n }); });
    vals.sort(function(a,b){ return b.count - a.count; });
    out.push({ name:r.name, role:r.role, distinct:vals.length, top:vals.slice(0, 30) });
  });
  out.sort(function(a,b){ return a.distinct - b.distinct; });
  return out;
};

/* fleet-wide contextual baselines: measure × context value, pooled over sheets */
Accumulator.prototype._baselines = function(){
  var self = this, pool = {};
  this.order.forEach(function(name){
    var sh = self.sheets.get(name);
    if(!sh.xtab || !self._contributes[name]) return;
    sh.xtab.forEach(function(st, key){
      var p = key.split('\u0001');
      var cn = sh.cols[+p[0]].name, val = p[1], mn = sh.cols[+p[2]].name;
      var ex = sh.xtabExc.get(key);
      var k = pool[cn] = pool[cn] || {};
      var v = k[val] = k[val] || {};
      var m = v[mn] = v[mn] || { n:0, sum:0, exN:0, exSum:0, min:Infinity, max:-Infinity,
                                 per:[], m2:0, sqm:0 };
      m.n += st.n; m.sum += st.mean * st.n;
      // exact pooled variance across sheets: Σm2ᵢ + Σnᵢ·meanᵢ² − N·M²
      m.m2 += st._m2 || 0; m.sqm += st.n * st.mean * st.mean;
      if(ex){ m.exN += ex.n; m.exSum += ex.sum; }
      m.min = Math.min(m.min, st.min); m.max = Math.max(m.max, st.max);
      m.per.push(st.mean);
    });
  });
  var out = {};
  Object.keys(pool).forEach(function(cn){
    out[cn] = {};
    Object.keys(pool[cn]).forEach(function(val){
      out[cn][val] = {};
      Object.keys(pool[cn][val]).forEach(function(mn){
        var m = pool[cn][val][mn];
        var M = m.sum / m.n;
        var m2t = m.m2 + m.sqm - m.n * M * M;
        var cell = { n:m.n, mean:r3(M), p50:r3(medianOf(m.per)),
                     sd: m.n > 1 ? r3(Math.sqrt(Math.max(0, m2t) / (m.n - 1))) : 0,
                     min:r3(m.min), max:r3(m.max) };
        // quarantined rows subtracted exactly — what is safe to model from
        if(m.exN && m.exN < m.n){
          cell.baselineN = m.n - m.exN;
          cell.baselineMean = r3((m.sum - m.exSum) / (m.n - m.exN));
          cell.excludedN = m.exN;
        }
        out[cn][val][mn] = cell;
      });
    });
  });
  return out;
};

/* ── the joint cross-tab (Phase 5 amendment) ───────────────────────────────
   Emitted for every state-shaped categorical crossed with every dimension the
   clock decides, per measure. On the mining workbook that is 7 truck states ×
   2 shifts × 14 measures = 196 cells for the pair that matters.

   Why it exists: a shift factor read off the marginal baselines carries every
   difference between the two shifts, including differences in what the trucks
   were doing. The joint cell separates them, so a factor can be standardised on
   one common state mix and answer "the same work, at night" rather than "the
   night, whatever it contained".

   What it does NOT fix, on this workbook, is stated in the note the finalizer
   attaches: see _jointNote below. */
Accumulator.prototype._joint = function(schedules, states){
  var self = this, pool = {};
  var sched = {}, st = {};
  Object.keys(schedules || {}).forEach(function(k){ if(schedules[k].scheduled) sched[k] = 1; });
  (states || []).forEach(function(k){ st[k] = 1; });
  if(!Object.keys(sched).length || !Object.keys(st).length) return null;

  this.order.forEach(function(name){
    var sh = self.sheets.get(name);
    if(!sh.joint || !self._contributes[name]) return;
    sh.joint.forEach(function(cell, key){
      var p = key.split('\u0001');
      var ca = sh.cols[+p[0]].name, va = p[1], cb = sh.cols[+p[2]].name, vb = p[3];
      var mn = sh.cols[+p[4]].name;
      // orient the pair: state first, clock-scheduled dimension second. A pair
      // that is not one of each is not what this cross-tab is for.
      var sc, sv, dc, dv;
      if(st[ca] && sched[cb]){ sc = ca; sv = va; dc = cb; dv = vb; }
      else if(st[cb] && sched[ca]){ sc = cb; sv = vb; dc = ca; dv = va; }
      else return;
      var ex = sh.jointExc.get(key);
      var A = pool[sc] = pool[sc] || {};
      var B = A[sv] = A[sv] || {};
      var C = B[dc] = B[dc] || {};
      var D = C[dv] = C[dv] || {};
      var m = D[mn] = D[mn] || { n:0, sum:0, m2:0, sqm:0, exN:0, exSum:0,
                                 min:Infinity, max:-Infinity };
      m.n += cell.n; m.sum += cell.mean * cell.n;
      m.m2 += cell._m2 || 0; m.sqm += cell.n * cell.mean * cell.mean;
      if(ex){ m.exN += ex.n; m.exSum += ex.sum; }
      m.min = Math.min(m.min, cell.min); m.max = Math.max(m.max, cell.max);
    });
  });

  var out = {}, cells = 0;
  Object.keys(pool).forEach(function(sc){
    out[sc] = {};
    Object.keys(pool[sc]).forEach(function(sv){
      out[sc][sv] = {};
      Object.keys(pool[sc][sv]).forEach(function(dc){
        out[sc][sv][dc] = {};
        Object.keys(pool[sc][sv][dc]).forEach(function(dv){
          out[sc][sv][dc][dv] = {};
          Object.keys(pool[sc][sv][dc][dv]).forEach(function(mn){
            var m = pool[sc][sv][dc][dv][mn];
            var M = m.sum / m.n;
            var m2t = m.m2 + m.sqm - m.n * M * M;
            var c = { n:m.n, mean:r3(M),
                      sd: m.n > 1 ? r3(Math.sqrt(Math.max(0, m2t) / (m.n - 1))) : 0,
                      min:r3(m.min), max:r3(m.max) };
            if(m.exN && m.exN < m.n){
              c.baselineN = m.n - m.exN;
              c.baselineMean = r3((m.sum - m.exSum) / (m.n - m.exN));
              c.excludedN = m.exN;
            } else if(m.exN){ c.baselineN = 0; c.excludedN = m.exN; }
            out[sc][sv][dc][dv][mn] = c; cells++;
          });
        });
      });
    });
  });
  Object.defineProperty(out, 'cells', { value: cells, enumerable: false });
  return { cells: cells, by: out };
};

/* What the joint cross-tab actually removed, said in numbers rather than
   claimed. Compares the marginal margin between two values of a scheduled
   dimension against the same margin standardised on one common state mix. If
   the two agree, the state mix was never the confound and the note says so —
   which is a result, not a failure. */
Accumulator.prototype._jointNote = function(joint, measure){
  if(!joint || !joint.by) return null;
  var out = [];
  Object.keys(joint.by).forEach(function(sc){
    var states = Object.keys(joint.by[sc]);
    if(!states.length) return;
    var dims = Object.keys(joint.by[sc][states[0]] || {});
    dims.forEach(function(dc){
      var vals = {}, w = {};
      states.forEach(function(sv){
        var node = (joint.by[sc][sv] || {})[dc] || {};
        Object.keys(node).forEach(function(dv){
          var cell = node[dv][measure];
          if(!cell || !cell.n) return;
          (vals[dv] = vals[dv] || {})[sv] = cell;
          w[sv] = (w[sv] || 0) + cell.n;
        });
      });
      var names = Object.keys(vals);
      if(names.length !== 2) return;
      var raw = {}, adj = {};
      names.forEach(function(dv){
        var rn = 0, rs = 0, an = 0, ad = 0;
        Object.keys(vals[dv]).forEach(function(sv){
          var c = vals[dv][sv];
          rs += c.mean * c.n; rn += c.n;
          an += w[sv] * c.mean; ad += w[sv];
        });
        raw[dv] = rn ? rs / rn : null;
        adj[dv] = ad ? an / ad : null;
      });
      var a = names[0], b = names[1];
      if(raw[a] == null || raw[b] == null || !raw[a] || !adj[a]) return;
      out.push({
        stateColumn: sc, dimension: dc, measure: measure,
        values: names,
        marginalPct: r3((raw[b] / raw[a] - 1) * 100),
        mixStandardisedPct: r3((adj[b] / adj[a] - 1) * 100),
        mixConfoundPts: r3(((adj[b] / adj[a]) - (raw[b] / raw[a])) * 100)
      });
    });
  });
  return out.length ? out : null;
};

/* hour-of-day rhythm per measure, pooled — feeds profile-shaped pacing (Phase 5) */
Accumulator.prototype._rhythm = function(){
  var self = this, pool = {};
  this.order.forEach(function(name){
    var shR = self.sheets.get(name);
    if(!self._contributes[name]) return;
    (shR.cols || []).forEach(function(c){
      if(!c.byHour) return;
      var m = pool[c.name] = pool[c.name] ||
        new Array(24).fill(null).map(function(){ return { n:0, sum:0 }; });
      c.byHour.forEach(function(h, i){ if(h && h.n){ m[i].n += h.n; m[i].sum += h.sum; } });
    });
  });
  var out = {};
  Object.keys(pool).forEach(function(name){
    var hrs = pool[name].map(function(h){ return h.n ? h.sum / h.n : null; });
    var live = hrs.filter(function(x){ return x !== null; });
    if(live.length < 4) return;
    var avg = live.reduce(function(a,b){ return a + b; }, 0) / live.length;
    out[name] = {
      hours: hrs.map(function(x){ return x === null ? null : r3(x); }),
      index: hrs.map(function(x){ return x === null || !avg ? null : r3(x / avg); }),
      mean: r3(avg),
      amplitude: avg ? r3((Math.max.apply(null, live) - Math.min.apply(null, live)) / avg) : null
    };
  });
  return out;
};

/* Unit equivalence for threshold matching. Two units are compatible when they
   normalise to the same token; an empty unit on either side abstains rather than
   objects, because plenty of columns carry no unit at all. */
function unitKey(u){
  // the degree sign is decoration, not information: "°F" and "Deg F" are the
  // same unit written two ways, and the workbook uses both
  var s = norm(u).replace(/[^a-z0-9\/%]+/g, '');
  if(!s) return '';
  var alias = { degf:'f', deg_f:'f', fahrenheit:'f', degc:'c', celsius:'c',
                rpm:'rpm', r_min:'rpm', tons:'ton', tonnes:'ton', t:'ton',
                mph:'mph', kph:'kph', psi:'psi', pct:'%', percent:'%',
                galh:'gal/h', gal_h:'gal/h', categoria:'', category:'',
                regla:'', rule:'', marcha:'', gear:'' };
  return alias[s] != null ? alias[s] : s;
}
function unitsCompatible(a, b){
  var x = unitKey(a), y = unitKey(b);
  return !x || !y || x === y;
}

/* Límites → threshold map keyed by parameter, matched to observed measures.

   Phase 5 correction. This was first-hit-wins substring matching over the
   measures in column order, with no exact-match preference and no unit check.
   On the mining workbook that bound "Engine Speed-Engine (RPM)" to
   "Percent Engine Load at Current Engine Speed-Engine", because the param key
   occurs as a substring at offset 31 of that column's name and that column is
   listed before the real one. The count of matched parameters was unchanged —
   14 either way — so a count assertion could not see it. The RPM band would
   have been graded against a 0–100 % signal, and the real RPM column would have
   carried no thresholds at all.

   Now: exact key equality wins outright; containment is a ranked fallback
   scored by how much of the candidate name the parameter actually explains;
   incompatible units are rejected before ranking; and an already-claimed
   measure loses to an unclaimed one of equal standing. */
function matchParamToMeasure(paramKey, paramUnit, mKeys, claimed){
  var i, best = null, bestScore = -1;
  for(i = 0; i < mKeys.length; i++){
    var m = mKeys[i];
    if(!unitsCompatible(paramUnit, m.unit)) continue;
    var score = null;
    if(m.key === paramKey) score = 1000;                       // exact — decisive
    else if(m.key.indexOf(paramKey) >= 0 || paramKey.indexOf(m.key) >= 0){
      // how much of the longer name the shorter one accounts for: a 19-char
      // parameter explains a 19-char column completely and a 47-char column
      // barely at all, and the complete explanation is the right one
      var lo = Math.min(m.key.length, paramKey.length);
      var hi = Math.max(m.key.length, paramKey.length) || 1;
      score = 100 * (lo / hi);
    }
    if(score === null) continue;
    if(claimed[m.name]) score -= 0.5;         // prefer a measure nothing else took
    if(score > bestScore){ bestScore = score; best = m.name; }
  }
  return best;
}

Accumulator.prototype._thresholdMap = function(rows, measures){
  var byParam = {}, order = [];
  var mKeys = (measures || []).map(function(m){
    return { name:m.name, key:norm(m.name), unit:m.unit }; });
  rows.forEach(function(r){
    var entry = {
      context: r.context || 'all', unit: r.unit,
      correct: r.correct, out: r.out, critical: r.critical,
      ceiling: r.ceiling, persistSec: r.persistSec, persistNote: r.persistNote,
      criterion: r.criterion, thresholds: r.thresholds, group: r.group
    };
    var bucket = byParam[r.param];
    if(!bucket){
      bucket = byParam[r.param] = { param:r.param, unit:r.unit, match:null,
                                    paramKey:r.paramKey, bands:[] };
      order.push(bucket);
    }
    bucket.bands.push(entry);
  });
  // matched in one pass after every parameter is known, so "already claimed"
  // means something — resolving them row by row would make the answer depend on
  // the order the Límites sheet happens to list its rows in
  var claimed = {};
  order.forEach(function(b){
    var m = matchParamToMeasure(b.paramKey, b.unit, mKeys, claimed);
    if(m){ b.match = m; claimed[m] = (claimed[m] || 0) + 1; }
    delete b.paramKey;
  });
  var list = Object.keys(byParam).map(function(k){ return byParam[k]; });
  return {
    count: rows.length,
    withPersistence: rows.filter(function(r){ return r.persistSec != null; }).length,
    contextual: rows.filter(function(r){ return r.context && String(r.context).trim(); }).length,
    matchedToMeasures: list.filter(function(b){ return b.match; }).length,
    params: list
  };
};

/* Anomálias Control → incident script (Phase 4 fault-injection catalogue) */
Accumulator.prototype._incidentScript = function(rows, sheets){
  var quarantinedTotal = 0;
  sheets.forEach(function(s){ quarantinedTotal += s.quarantinedRows || 0; });
  var unquarantinable = rows.filter(function(r){ return r.quarantine === 'none'; });
  return {
    count: rows.length,
    quarantineWindows: rows.filter(function(r){ return r.quarantine === 'window'; }).length,
    quarantineZones:   rows.filter(function(r){ return r.quarantine === 'zone'; }).length,
    unquarantinable:   unquarantinable.length,
    unquarantinableCases: unquarantinable.map(function(r){ return r.label; }),
    rowsExcludedFromBaselines: quarantinedTotal,
    cases: rows
  };
};

/* derived business rollups the value lane (Phase 5) binds to */
Accumulator.prototype._rollups = function(refs){
  var self = this, out = { perUnit: [], shift: null, primaryStateColumn: null };
  var grainSec = this._grain;

  // Which categorical column is the operating state? Not the one that changes
  // most (gear churns every few seconds and explains little) but the one whose
  // values best explain the measures — between-group variance share (eta^2)
  // over the cross-tab, which is already computed exactly.
  var scores = new Map();
  this.order.forEach(function(name){
    var sh = self.sheets.get(name);
    if(!sh.xtab || !self._contributes[name]) return;
    var per = new Map();                                    // "col|meas" → cells
    sh.xtab.forEach(function(st, key){
      var pk = key.split('\u0001');
      var k = pk[0] + '\u0001' + pk[2];
      (per.get(k) || per.set(k, []).get(k)).push(st);
    });
    per.forEach(function(cells, k){
      if(cells.length < 2) return;
      var N = 0, S = 0;
      cells.forEach(function(c){ N += c.n; S += c.mean * c.n; });
      if(N < LIM.stateMinRows) return;      // tiny groups make eta^2 meaningless
      var gm = S / N, between = 0, within = 0;
      cells.forEach(function(c){
        var sd = c.out().sd || 0;
        between += c.n * (c.mean - gm) * (c.mean - gm);
        within  += (c.n - 1) * sd * sd;
      });
      var tot = between + within;
      if(!tot) return;
      var ci = +k.split('\u0001')[0];
      var cn = sh.cols[ci].name;
      var eta = between / tot;
      var cur = scores.get(cn) || { name: cn, eta: 0, sheets: 0 };
      if(eta > cur.eta) cur.eta = eta;
      cur.sheets = (cur.sheets || 0) + 1;
      scores.set(cn, cur);
    });
  });
  // eta^2 alone crowns whichever signal is mechanically closest to the measures
  // — transmission gear is a near-perfect proxy for "stopped" but changes every
  // few seconds. An operating state holds. Weight the score by run stability so
  // a churning proxy cannot displace the state the work actually moves through.
  var runLen = new Map();
  this.order.forEach(function(name){
    var sh = self.sheets.get(name);
    if(!sh.episodes || !self._contributes[name]) return;
    sh.episodes.forEach(function(bucket, ci){
      var cn = sh.cols[ci].name, runs = 0, rows = 0;
      bucket.forEach(function(r){ runs += r.runs; rows += r.rows; });
      if(!runs) return;
      var cur = runLen.get(cn) || { runs:0, rows:0 };
      cur.runs += runs; cur.rows += rows; runLen.set(cn, cur);
    });
  });
  scores.forEach(function(rec, cn){
    var rl = runLen.get(cn);
    var meanRunRows = rl && rl.runs ? rl.rows / rl.runs : null;
    rec.meanRunRows = meanRunRows == null ? null : r3(meanRunRows);
    rec.stability = meanRunRows == null ? 1 : Math.min(1, meanRunRows / LIM.stateMinRunRows);
    rec.score = rec.eta * rec.stability;
  });
  var ranked = Array.from(scores.values()).sort(function(a, b){ return b.score - a.score; });
  out.stateColumns = ranked.slice(0, 4).map(function(r){
    return { name:r.name, eta2:r3(r.eta), meanRunRows:r.meanRunRows, score:r3(r.score) }; });
  out.primaryStateColumn = ranked.length ? ranked[0].name : null;
  var episodeCols = ranked.slice(0, 2).map(function(r){ return r.name; });

  this.order.forEach(function(name){
    var sh = self.sheets.get(name);
    if(!self._contributes[name] || !sh.totals || sh.timeIdx < 0) return;
    var rec = { unit: name, rows: sh.dataRows, quarantinedRows: sh.quarantined,
                totals: {}, integrated: {}, episodes: {} };
    sh.totals.forEach(function(t, mi){
      var col = sh.cols[mi];
      rec.totals[col.name] = { sum: r3(t.sum), n: t.n, mean: t.n ? r3(t.sum / t.n) : null };
      // a per-hour (or per-minute) rate integrated over a known grain becomes a quantity
      var um = col.unit && /^(.+?)\s*\/\s*(h|hr|hour|min|s|sec)$/i.exec(col.unit);
      if(um && grainSec){
        var per = um[2].toLowerCase();
        var secs = /^h/.test(per) ? 3600 : (/^m/.test(per) ? 60 : 1);
        rec.integrated[col.name] = { unit: um[1], value: r3(t.sum * grainSec / secs), grainSec: grainSec };
      }
    });
    sh.baseline.forEach(function(st, mi){ if(st.n){
      (rec.baselines = rec.baselines || {})[sh.cols[mi].name] =
        { n: st.n, mean: r3(st.mean), p50: r3(st.quantile(0.5)) }; } });

    sh.episodes.forEach(function(bucket, ci){
      var colName = sh.cols[ci].name;
      if(episodeCols.indexOf(colName) < 0) return;
      var dst = {};
      bucket.forEach(function(r, val){
        var mSec = r.runs ? r.secs / r.runs : null;
        var e = { runs: r.runs, rows: r.rows,
                  meanSec: r3(mSec), totalSec: r3(r.secs),
                  sdSec: r.runs > 1 ? r3(Math.sqrt(Math.max(0,
                            (r.secsSq - r.runs * mSec * mSec) / (r.runs - 1)))) : 0,
                  means: {}, peaks: {} };
        for(var q = 0; q < r.nMax.length; q++){
          var mn = sh.cols[sh.measureIdx[q]].name;
          if(r.cnt[q]) e.means[mn] = r3(r.sum[q] / r.cnt[q]);
          if(r.nMax[q]) e.peaks[mn] = { sum: r3(r.sumMax[q]), mean: r3(r.sumMax[q] / r.nMax[q]) };
        }
        dst[val] = e;
      });
      rec.episodes[colName] = dst;
    });

    // completed cycles per unit, per cycle-carrying measure
    sh.cycles.forEach(function(cy, mi){
      if(!cy.runs) return;
      var name = sh.cols[mi].name;
      var pMean = cy.peakSum / cy.runs, sMean = cy.runs ? cy.secs / cy.runs : null;
      var c = {
        measure: name, unit: sh.cols[mi].unit || null,
        cycles: cy.runs, rowsPerCycle: r3(cy.rows / cy.runs),
        quantity: r3(cy.peakSum),
        perCycleMean: r3(pMean),
        perCycleSd: cy.runs > 1 ? r3(Math.sqrt(Math.max(0,
                      (cy.peakSq - cy.runs * pMean * pMean) / (cy.runs - 1)))) : 0,
        meanSec: r3(sMean),
        sdSec: cy.runs > 1 && sMean != null ? r3(Math.sqrt(Math.max(0,
                 (cy.secsSq - cy.runs * sMean * sMean) / (cy.runs - 1)))) : 0,
        unfinished: cy.openAtEnd, smallCycles: cy.smallRuns || 0,
        dischargeMean: r3(cy.dischSum / cy.runs),
        dischargeRatio: pMean ? r3((cy.dischSum / cy.runs) / pMean) : null,
        zeroShare: cy.allRows ? r3(cy.zeroRows / cy.allRows) : null,
        plateauShare: cy.allRows ? r3(cy.hiRows / cy.allRows) : null,
        firstISO: isoOf(cy.firstMs), lastISO: isoOf(cy.lastMs),
        sums: {}, terminal: []
      };
      // every measure's total inside completed cycles — waiting, loading, laden
      // travel, discharge and empty return, which is the whole loop
      for(var k = 0; k < sh.measureIdx.length; k++){
        var mk = sh.cols[sh.measureIdx[k]];
        var per = cy.sums[k] / cy.runs;
        c.sums[mk.name] = { sum: r3(cy.sums[k]), perCycleMean: r3(per),
          perCycleSd: cy.runs > 1 ? r3(Math.sqrt(Math.max(0,
            (cy.sumsSq[k] - cy.runs * per * per) / (cy.runs - 1)))) : 0 };
      }
      cy.term.forEach(function(n, key){
        var p = key.split('\u0001');
        c.terminal.push({ column: sh.cols[+p[0]].name, value: p[1],
                          share: r3(n / cy.runs) });
      });
      c.terminal.sort(function(a, b){ return b.share - a.share; });
      c.terminal = c.terminal.filter(function(t){ return t.share >= 0.5; });
      (rec.cycles = rec.cycles || {})[name] = c;
    });
    out.perUnit.push(rec);
  });

  out.cycleModel = this._cycleModel(out);
  out.transitions = this._transitions(episodeCols);

  // shift-level medians straight from the roster (exact, small-N)
  if(refs.roster.length){
    var byShift = {};
    refs.roster.forEach(function(r){
      if(!r.shift || r.value == null) return;
      (byShift[String(r.shift)] = byShift[String(r.shift)] || []).push(r.value);
    });
    var shifts = Object.keys(byShift).map(function(k){
      var a = byShift[k];
      return { shift:k, n:a.length, median:r3(medianOf(a)),
               mean:r3(a.reduce(function(x,y){ return x + y; }, 0) / a.length),
               min:r3(Math.min.apply(null, a)), max:r3(Math.max.apply(null, a)) };
    });
    var lo = shifts.reduce(function(a,b){ return (a && a.median <= b.median) ? a : b; }, null);
    shifts.forEach(function(x){
      x.vsLowestPct = lo && lo.median ? r3((x.median / lo.median - 1) * 100) : null;
    });
    out.shift = { records: refs.roster.length, baselineShift: lo ? lo.shift : null, shifts: shifts };
  }
  return out;
};

/* Fleet-wide cycle model. Ranks the cycle-carrying measures by how much work
   one cycle represents — the longest loop is the operating cycle; a measure
   that merely oscillates (a speed that touches zero at every stop) produces
   many short ones and ranks below it. Reported, not decided: the binding layer
   chooses, exactly as it does for the state column. */
Accumulator.prototype._cycleModel = function(out){
  var pool = {};
  out.perUnit.forEach(function(u){
    if(!u.cycles) return;
    Object.keys(u.cycles).forEach(function(name){
      var c = u.cycles[name];
      var p = pool[name] = pool[name] || { measure:name, unit:c.unit, units:0,
        cycles:0, quantity:0, rows:0, secs:0, unfinished:0, smallCycles:0,
        sums:{}, term:{} };
      p.units++; p.cycles += c.cycles; p.quantity += c.quantity;
      p.rows += c.rowsPerCycle * c.cycles; p.secs += (c.meanSec || 0) * c.cycles;
      p.disch = (p.disch || 0) + (c.dischargeMean || 0) * c.cycles;
      p.zero = (p.zero || 0) + (c.zeroShare || 0); p.plateau = (p.plateau || 0) + (c.plateauShare || 0);
      p.unfinished += c.unfinished; p.smallCycles += c.smallCycles;
      Object.keys(c.sums).forEach(function(mn){
        p.sums[mn] = (p.sums[mn] || 0) + c.sums[mn].sum; });
      c.terminal.forEach(function(t){
        var k = t.column + '\u0001' + t.value;
        p.term[k] = (p.term[k] || 0) + t.share * c.cycles; });
    });
  });
  var list = Object.keys(pool).map(function(k){
    var p = pool[k];
    var sums = {};
    Object.keys(p.sums).forEach(function(mn){
      sums[mn] = { sum: r3(p.sums[mn]), perCycleMean: r3(p.sums[mn] / p.cycles) }; });
    var term = Object.keys(p.term).map(function(kk){
      var s = kk.split('\u0001');
      return { column:s[0], value:s[1], share:r3(p.term[kk] / p.cycles) };
    }).sort(function(a,b){ return b.share - a.share; });
    var pcm = p.quantity / p.cycles;
    var dRatio = pcm ? (p.disch / p.cycles) / pcm : null;
    return { measure:p.measure, unit:p.unit, units:p.units, cycles:p.cycles,
             quantity:r3(p.quantity), perCycleMean:r3(pcm),
             rowsPerCycle:r3(p.rows / p.cycles), meanSec:r3(p.secs / p.cycles),
             unfinished:p.unfinished, smallCycles:p.smallCycles,
             dischargeRatio: r3(dRatio),
             dischargesToZero: dRatio != null && dRatio <= 0.005,
             zeroShare: r3(p.zero / p.units), plateauShare: r3(p.plateau / p.units),
             terminalEvent: term.length ? term[0] : null, sums:sums };
  }).filter(function(c){ return c.cycles >= 2 && c.perCycleMean > 0; })
    .sort(function(a, b){
      // a carried quantity empties completely (discharge ≈ 0) and rides near its
      // peak for part of the loop. A rate that merely dips does neither, however
      // long its apparent cycle. Length breaks the remaining tie.
      if(a.dischargesToZero !== b.dischargesToZero) return a.dischargesToZero ? -1 : 1;
      if(Math.abs(b.plateauShare - a.plateauShare) > 0.02) return b.plateauShare - a.plateauShare;
      return b.rowsPerCycle - a.rowsPerCycle;
    });

  return { carrier: list.length ? list[0].measure : null,
           terminalEvent: list.length ? list[0].terminalEvent : null,
           candidates: list.slice(0, 6) };
};

/* First-order transition counts per state column — the observed order of work.
   A generator needs this to lay a cycle out; without it, stage order is a
   guess. Pooled across units. */
Accumulator.prototype._transitions = function(cols){
  var self = this, out = {};
  this.order.forEach(function(name){
    var sh = self.sheets.get(name);
    if(!sh.trans || !self._contributes[name]) return;
    sh.trans.forEach(function(tm, ci){
      var cn = sh.cols[ci].name;
      if(cols.indexOf(cn) < 0) return;
      var dst = out[cn] = out[cn] || {};
      tm.forEach(function(n, key){
        var p = key.split('\u0001');
        (dst[p[0]] = dst[p[0]] || {})[p[1]] = (dst[p[0]][p[1]] || 0) + n;
      });
    });
  });
  return out;
};

/* Which context dimensions the clock decides. A shift is a function of the hour
   of day; a road condition is not. Only the scheduled ones can be placed on a
   generated timeline from the timestamp alone — the rest are left to the cycle
   model, and said so. */
Accumulator.prototype._schedules = function(){
  var self = this, pool = {};
  this.order.forEach(function(name){
    var sh = self.sheets.get(name);
    if(!sh.catHour || !self._contributes[name]) return;
    sh.catHour.forEach(function(vm, ci){
      var cn = sh.cols[ci].name;
      var dst = pool[cn] = pool[cn] || {};
      vm.forEach(function(arr, val){
        var d = dst[val] = dst[val] || new Float64Array(24);
        for(var h = 0; h < 24; h++) d[h] += arr[h];
      });
    });
  });
  var out = {};
  Object.keys(pool).forEach(function(cn){
    var vals = Object.keys(pool[cn]);
    if(vals.length < 2 || vals.length > LIM.xtabMaxCard) return;
    var hours = [], shares = [], minShare = 1, live = 0;
    for(var h = 0; h < 24; h++){
      var tot = 0, best = null, bestN = -1;
      vals.forEach(function(v){
        var n = pool[cn][v][h]; tot += n;
        if(n > bestN){ bestN = n; best = v; }
      });
      if(!tot){ hours.push(null); shares.push(null); continue; }
      live++;
      var sh2 = bestN / tot;
      if(sh2 < minShare) minShare = sh2;
      hours.push(best); shares.push(r3(sh2));
    }
    if(!live) return;
    out[cn] = { scheduled: minShare >= LIM.scheduleShare, minShare: r3(minShare),
                values: vals, byHour: hours, shareByHour: shares };
  });
  return out;
};

Accumulator.prototype._quality = function(sheets, profile){
  var issues = [], strengths = [];
  var t = profile.time;
  if(t.present){
    if(t.spanDays < 2) issues.push({ level:'note', text:
      'Single day of data (' + r3(t.spanDays) + ' d). Weekday and seasonal patterns cannot be observed — they will be inferred, not measured.' });
    if(t.gaps) issues.push({ level:'note', text: t.gaps.toLocaleString() +
      ' irregular time steps found against a ' + t.grainLabel + ' grain.' });
    else strengths.push('Time series is gapless at ' + t.grainLabel + '.');
  } else {
    issues.push({ level:'warn', text:'No time column recognised — periodicity and pacing cannot be profiled.' });
  }
  sheets.forEach(function(s){
    (s.columns || []).forEach(function(c){
      if(c.n && c.fill < 0.9) issues.push({ level:'note', text:
        s.name + ' · ' + c.name + ' is ' + Math.round((1 - c.fill) * 100) + '% empty.' });
    });
  });
  if(profile.incidentScript.unquarantinable) issues.push({ level:'note', text:
    profile.incidentScript.unquarantinable + ' control case(s) describe a recurring condition with no time window (' +
    profile.incidentScript.unquarantinableCases.join('; ') + ') — they stay in the baselines and are listed as known contamination.' });
  if(this.truncated) issues.push({ level:'warn', text:'Profiling stopped early at the row ceiling; statistics describe the rows read.' });
  return { issues: issues.slice(0, 24), strengths: strengths };
};

/* the coverage panel payload — honest, never gatekeeping */
Accumulator.prototype._coverage = function(profile, sheets){
  var t = profile.time, ent = profile.entities;
  var entityLines = Object.keys(ent).filter(function(k){ return k[0] !== '_'; })
    .map(function(k){ return { label:k, count:ent[k].count }; })
    .sort(function(a,b){ return b.count - a.count; }).slice(0, 8);

  var ctxCols = profile.context.filter(function(c){
    return c.role !== 'who' && c.distinct > 1 && c.distinct <= LIM.xtabMaxCard; });
  var improvements = [];
  if(t.present && t.spanDays < 7)
    improvements.push('Add a second week of data so MOMENTUM can model weekday patterns instead of inferring them.');
  if(entityLines.length && entityLines[0].count < 5)
    improvements.push('More units or people in the export sharpens peer comparison — the fleet median gets its power from breadth, not resolution.');
  if(ctxCols.length < 3)
    improvements.push('Add context columns (shift, route, zone, condition) — they explain variance that finer sampling cannot.');
  if(!profile.thresholdMap.count)
    improvements.push('A limits sheet (correct / out of range / critical, with persistence) turns raw signals into graded thresholds.');
  if(t.present && t.grainSec && t.grainSec <= 60 && t.spanDays < 7)
    improvements.push('Resolution is already high at ' + t.grainLabel + '. More days, entities and context columns beat finer resolution.');
  if(!improvements.length)
    improvements.push('Coverage is strong. Adding an outcome column (tons, revenue, units shipped) would let MOMENTUM compute ratio KBRs directly.');

  return {
    span: t.present ? {
      startISO: t.startISO, endISO: t.endISO, days: r3(t.spanDays),
      label: spanLabel(t.spanSec)
    } : null,
    resolution: t.present ? { grainSec: t.grainSec, label: t.grainLabel,
                              gapless: !t.gaps, gaps: t.gaps } : null,
    cycles: profile.rhythm && Object.keys(profile.rhythm).length ? {
      detected: Object.keys(profile.rhythm).length,
      strongest: strongestRhythm(profile.rhythm)
    } : null,
    entities: entityLines,
    contextColumns: ctxCols.map(function(c){ return { name:c.name, distinct:c.distinct }; }).slice(0, 10),
    measures: profile.measures.slice(0, 14).map(function(m){ return { name:m.name, unit:m.unit }; }),
    thresholds: { rows: profile.thresholdMap.count,
                  withPersistence: profile.thresholdMap.withPersistence,
                  matched: profile.thresholdMap.matchedToMeasures },
    incidents: { cases: profile.incidentScript.count,
                 quarantined: profile.incidentScript.rowsExcludedFromBaselines,
                 unquarantinable: profile.incidentScript.unquarantinable },
    rowsProfiled: sheets.reduce(function(a,s){ return a + (s.rows || 0); }, 0),
    sheets: sheets.length,
    improvements: improvements.slice(0, 3),
    honesty: profile.quality.issues.filter(function(i){ return i.level === 'note' || i.level === 'warn'; })
                                   .slice(0, 3).map(function(i){ return i.text; })
  };
};
function spanLabel(sec){
  if(sec < 5400)   return Math.max(1, Math.round(sec / 60)) + ' minutes';
  if(sec < 172800) return r3(Math.round(sec / 360) / 10) + ' hours';
  return r3(Math.round(sec / 8640) / 10) + ' days';
}
function strongestRhythm(rhythm){
  var best = null;
  Object.keys(rhythm).forEach(function(k){
    var a = rhythm[k].amplitude;
    if(a != null && (!best || a > best.amplitude)) best = { name:k, amplitude:a };
  });
  return best;
}

/* ═══ 8 · structured analyzer payload (S5) ═════════════════════════════════
   Replaces the flat 6,000-character document slice. Profile summary first —
   compact, factual, model-legible — then the document text with a raised
   budget. Arithmetic stays in code; only language work goes to the model. */

var MOMENTUM_ProfileBrief = function(profile, opts){
  opts = opts || {};
  if(!profile) return '';
  var L = [], t = profile.time, cov = profile.coverage;
  L.push('DATA PROFILE (computed deterministically from the attached data file — these are measured facts, not estimates):');
  L.push('- Source: ' + (profile.meta.sourceName || 'dataset') + ' · ' +
         (profile.meta.sizeBytes ? Math.round(profile.meta.sizeBytes / 1048576) + ' MB · ' : '') +
         profile.sheets.length + ' sheets · ' + (cov.rowsProfiled || 0).toLocaleString() + ' rows profiled');
  if(t.present) L.push('- Time span: ' + t.startISO + ' → ' + t.endISO + ' (' + cov.span.label +
                       ') at ' + t.grainLabel + ' resolution' + (t.gaps ? '' : ', gapless'));

  var ents = Object.keys(profile.entities).filter(function(k){ return k[0] !== '_'; });
  if(ents.length){
    L.push('- Entity rosters:');
    ents.slice(0, 8).forEach(function(k){
      var e = profile.entities[k];
      L.push('    ' + k + ' (' + e.count + '): ' + e.values.slice(0, 12).join(', ') +
             (e.count > 12 ? ' …' : ''));
    });
  }
  if(profile.measures.length){
    L.push('- Measures (name · unit · mean · range):');
    profile.measures.slice(0, 16).forEach(function(m){
      L.push('    ' + m.name + (m.unit ? ' (' + m.unit + ')' : '') +
             ' · mean ' + m.mean + ' · ' + m.min + '–' + m.max);
    });
  }
  if(profile.context.length){
    L.push('- Context columns (dimensions available for answers and conditions):');
    profile.context.slice(0, 10).forEach(function(c){
      L.push('    ' + c.name + ' (' + c.distinct + '): ' +
             c.top.slice(0, 8).map(function(v){ return v.value; }).join(', '));
    });
  }
  var bl = profile.baselines, blKeys = Object.keys(bl || {});
  if(blKeys.length && profile.measures.length){
    var m0 = profile.measures[0].name;
    blKeys.slice(0, 3).forEach(function(cn){
      var vals = Object.keys(bl[cn]).filter(function(v){ return bl[cn][v][m0]; }).slice(0, 10);
      if(!vals.length) return;
      L.push('- ' + m0 + ' by ' + cn + ': ' + vals.map(function(v){
        return v + ' ' + bl[cn][v][m0].mean; }).join(' · '));
    });
  }
  if(profile.rollups && profile.rollups.shift && profile.rollups.shift.shifts.length > 1){
    L.push('- Shift comparison: ' + profile.rollups.shift.shifts.map(function(s){
      return s.shift + ' median ' + s.median + (s.vsLowestPct ? ' (+' + s.vsLowestPct + '%)' : ' (baseline)');
    }).join(' · '));
  }
  if(profile.thresholdMap.count)
    L.push('- Threshold map: ' + profile.thresholdMap.count + ' contextual limit rows (' +
           profile.thresholdMap.withPersistence + ' carry a persistence value) covering ' +
           profile.thresholdMap.params.slice(0, 10).map(function(p){ return p.param; }).join(', '));
  if(profile.incidentScript.count)
    L.push('- Control cases: ' + profile.incidentScript.count + ' documented incidents — ' +
           profile.incidentScript.cases.slice(0, 10).map(function(c){
             return (c.entity ? c.entity + ' ' : '') + c.label; }).join('; '));
  if(cov.improvements && cov.improvements.length)
    L.push('- Coverage note: ' + cov.improvements[0]);
  L.push('Use these exact entity names, measure names and units when naming touchpoints, sources, KBRs and answers. Do not invent placeholder entities when the roster above supplies real ones.');
  return L.join('\n');
};

/* ═══ 9 · public surface ═══════════════════════════════════════════════════ */

MOMENTUM.Profile = {
  version: 2,
  SCHEMA: 3,          /* 3 · joint cross-tab + unit-gated threshold matching (Phase 5) */
  LIMITS: LIM,
  create: function(opts){ return new Accumulator(opts); },
  /** Convenience: profile an already-materialised table (CSV/JSON light path). */
  fromRows: function(sheetName, rows, opts){
    var acc = new Accumulator(opts);
    for(var i = 0; i < rows.length; i++) acc.feed(sheetName, rows[i]);
    return acc.finalize();
  },
  brief: function(profile, opts){ return MOMENTUM_ProfileBrief(profile, opts); },
  // exposed for tests and for the ingestion layers
  _internals: { toNum:toNum, toTime:toTime, isoOf:isoOf, parseBand:parseBand,
                parsePersistence:parsePersistence, splitUnit:splitUnit, norm:norm,
                medianOf:medianOf, NumStat:NumStat, RECOGNISERS:RECOGNISERS }
};

})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
