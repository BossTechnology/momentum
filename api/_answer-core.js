/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.Answer — the Answer Engine                (Build Spec §6, Phase 7)

   One mechanism, nine answer kinds
   ────────────────────────────────
   An answer is a query, not a special case:

       { dimension, measure, aggregation, rank }

   dimension  WHICH things are being compared      (context column, unit,
              roster record, incident case, or the cycle ledger itself)
   measure    WHAT is measured about each          (a profiled measure, or a
              ratio of two of them)
   aggregation HOW the measure collapses           mean · sum · ratio ·
              deviation · frequency · count
   rank       WHICH one wins                       max · min · none

   The nine kinds the spec names — person, item, cohort, money, count,
   percentage, duration, date, reason — are not nine code paths. Five of them
   (person, item, cohort, reason, date) are what a DIMENSION returns; four
   (money, count, percentage, duration) are what a MEASURE returns. Every
   answer is one dimension crossed with one measure, so every answer already
   carries both halves. `kind` is a label on the result, not a branch in it.

   Per-answer format, explicit
   ───────────────────────────
   Every answer carries its own format, independent of its KBR. The English
   regex resolver of Phase 5 is demoted to what it always should have been:
   the opening suggestion in BOBee's editor, extended to es/fr/pt. It is
   never the authority. `formatOf` reads the declared format and only falls
   back to a suggestion when nothing has been declared.

   Multiple feeds
   ──────────────
   An answer may draw on more than one source. "Operador con Mayor Variación"
   needs the telemetry AND the shift roster: the deviation is telemetry, the
   name attached to it is roster. `evidence.feeds` names every feed that was
   read, so the model never assumes one source per answer.

   Flags are not risks
   ───────────────────
   `flag()` returns a local red flag and nothing else. It has no severity, no
   persistence and no route to the surface. An answer becomes a notification
   only by way of a Risk Meter condition scoped to it — one owner, two
   windows. The freezer case is the test: −15 °C flags the answer where it
   stands; −12 °C sustained for twenty minutes is an alarm, and only the Risk
   Meter may raise it.

   Optionality
   ───────────
   No profile bound means every resolver returns ok:false and the caller keeps
   the hash-seeded value it had before this file existed. Nothing here throws
   on absent data.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

/* ═══ 1 · the nine kinds ═══════════════════════════════════════════════════ */

/* Five come from the dimension — they answer WHICH thing. */
var DIMENSION_KINDS = {
  person : 'person',   /* an operator, a driver, a rep      */
  item   : 'item',     /* a unit, a truck, a SKU            */
  cohort : 'cohort',   /* a segment, a shift, a route       */
  reason : 'reason',   /* a named cause                     */
  date   : 'date'      /* a day, an hour, a window          */
};
/* Four come from the measure — they answer HOW MUCH. */
var MEASURE_KINDS = {
  money      : 'money',
  count      : 'count',
  percentage : 'percentage',
  duration   : 'duration'
};
var KINDS = ['person','item','cohort','money','count','percentage','duration','date','reason'];

/* The four Phase 5 formats are the only formats. `percentage` and `count`
   carry the measure kinds of the same name; money → currency; duration →
   time. A kind is what an answer IS; a format is how it is WRITTEN. */
var KIND_FORMAT = {
  money:'currency', count:'count', percentage:'percentage', duration:'time',
  person:'count', item:'count', cohort:'count', reason:'count', date:'count'
};

/* ═══ 2 · format suggestion — four languages, never the authority ══════════ */

/* Phase 5's English resolver, extended to the three languages the client and
   its vendors actually name things in. This only ever DEFAULTS a suggestion
   in the editor; `formatOf` prefers whatever the answer declares. */
var SUGGEST = {
  duration: /\b(days?|hours?|mins?|minutes?|seconds?|duration|lead ?time|turnaround|time to|cycle time|uptime|downtime|idle|ralent[ií]|d[ií]as?|horas?|minutos?|segundos?|duraci[oó]n|tiempo|plazo|espera|jours?|heures?|dur[eé]e|temps|d[ée]lai|inactivit[eé]|dias?|tempo|prazo|ociosidade)\b/i,
  percentage: /(%|\bpercent|\bpercentage|\brate\b|\bshare\b|\bratio\b|conversion|utilisation|utilization|variaci[oó]n|desviaci[oó]n|porcentaje|tasa\b|cuota|conversi[oó]n|pourcentage|taux\b|[eé]cart|percentual|percentagem|taxa\b|varia[cç][aã]o)/i,
  currency: /(\$|€|£|¥|\brevenue|\bsales\b|\bcost\b|\bspend\b|\bprofit\b|\bmargin\b|\bprice\b|\bbudget\b|\bcash\b|\bgmv\b|\bmrr\b|ingres[oa]s?|ventas?|costos?|coste|gasto|precio|presupuesto|beneficio|recette|chiffre d.affaires|co[uû]ts?|d[eé]penses?|prix|budget|b[eé]n[eé]fice|receita|vendas?|custos?|despesas?|pre[cç]o|or[cç]amento|lucro)/i
};
function suggestFormat(name, unit){
  var t = String(name == null ? '' : name) + ' ' + String(unit == null ? '' : unit);
  if(String(unit || '').indexOf('%') >= 0) return 'percentage';
  if(SUGGEST.duration.test(t))   return 'time';
  if(SUGGEST.currency.test(t))   return 'currency';
  if(SUGGEST.percentage.test(t)) return 'percentage';
  return 'count';
}
/** The declared format wins. A suggestion is only reached when an answer has
 *  never been configured — which is exactly the Optionality default. */
function formatOf(answer, kbr){
  if(answer && answer.format && KIND_FORMAT_VALID[answer.format]) return answer.format;
  if(answer && answer.value && answer.value.format && KIND_FORMAT_VALID[answer.value.format])
    return answer.value.format;
  /* The suggestion reads the ANSWER and only the answer. Borrowing the KBR's
     unit here would let a percentage KBR reach back in and re-decide the
     format of every answer under it — which is precisely the authority this
     phase takes away from it. `kbr` stays in the signature because callers
     pass it, and is deliberately unused. */
  return suggestFormat((answer && answer.name) || '', (answer && answer.unit) || '');
}
var KIND_FORMAT_VALID = { currency:1, count:1, percentage:1, time:1 };

/* ═══ 3 · reading the profile ══════════════════════════════════════════════ */

function has(o, k){ return o && Object.prototype.hasOwnProperty.call(o, k); }
function num(v){ return (typeof v === 'number' && isFinite(v)) ? v : null; }

/** Every dimension the profile can rank over, with the kind each returns. */
function dimensions(profile){
  var out = [];
  if(!profile) return out;
  (profile.context || []).forEach(function(c){
    out.push({ id:'context:' + c.name, kind:kindOfColumn(c.name), source:'context',
               column:c.name, distinct:c.distinct || 0, feed:'telemetry' });
  });
  if(profile.rollups && profile.rollups.perUnit && profile.rollups.perUnit.length)
    out.push({ id:'unit', kind:'item', source:'unit', column:'unit',
               distinct:profile.rollups.perUnit.length, feed:'telemetry' });
  if(profile.roster && profile.roster.length)
    out.push({ id:'roster', kind:'person', source:'roster', column:'who',
               distinct:distinctCount(profile.roster, 'who'), feed:'roster' });
  if(profile.incidentScript && profile.incidentScript.cases &&
     profile.incidentScript.cases.length)
    out.push({ id:'incident', kind:'reason', source:'incident', column:'label',
               distinct:profile.incidentScript.cases.length, feed:'incident script' });
  return out;
}
function distinctCount(rows, key){
  var seen = {}, n = 0;
  (rows || []).forEach(function(r){ var v = r && r[key];
    if(v != null && !seen[v]){ seen[v] = 1; n++; } });
  return n;
}
/** A column's kind. Operator-shaped columns are people; the rest are cohorts
 *  unless they name a unit. This is the ONLY place naming influences kind,
 *  and it is a default a configuration can override. */
function kindOfColumn(name){
  var low = String(name || '').toLowerCase();
  if(/operator|operador|driver|conductor|employee|person|who\b/.test(low)) return 'person';
  if(/\bunit\b|truck|cami[oó]n|veh[ií]cle|veh[ií]culo|equipo|machine|\bsku\b|item|product/.test(low)) return 'item';
  return 'cohort';
}

function measures(profile){
  return ((profile && profile.measures) || []).map(function(m){
    return { name:m.name, unit:m.unit || '', kind:kindOfMeasure(m) };
  });
}
function kindOfMeasure(m){
  var u = String((m && m.unit) || '').toLowerCase();
  if(u === '%') return 'percentage';
  if(/^(h|hr|hrs|hour|s|sec|min|d|day)$/.test(u)) return 'duration';
  if(/^(usd|eur|\$)$/.test(u)) return 'money';
  return 'count';
}

/* ── the cells a dimension produces, one row per member ──────────────────── */

/** Read every member of `dim` and attach `measure` to each. Returns
 *  [{ member, value, n, feeds[] }]. Returns [] when nothing can be read —
 *  never throws, never invents. */
/* The registered elapsed reader, or null. A module-level registration rather
   than a parameter: `cells` and `resolve` have one caller between them and
   threading a reader through every signature would put the burden of
   remembering it on every future call site. Set once when a profile binds,
   cleared when it detaches. */
var READER = null;

function cells(profile, dim, measure, opts){
  opts = opts || {};
  var basis = opts.basis === 'clean' ? 'clean' : 'observed';
  var out = [];
  if(!profile || !dim) return out;

  if(dim.source === 'context'){
    var b = profile.baselines && profile.baselines[dim.column];
    if(!b) return out;
    Object.keys(b).forEach(function(member){
      var s = b[member] && b[member][measure];
      if(!s) return;
      var v = basis === 'clean' ? num(s.baselineMean) : num(s.mean);
      if(v == null) return;
      out.push({ member:member, value:v, n:(basis === 'clean' ? s.baselineN : s.n) || 0,
                 sd:num(s.sd), feeds:['telemetry'] });
    });
    return out;
  }

  if(dim.source === 'unit'){
    /* PHASE 3C · the reading stops at the playhead.
       `profile.rollups` are whole-file scalars. Before 3C this branch handed
       them out whatever the clock said, so an answer asked at 09:00 was
       computed from the whole day — measured at 86,400 samples where 7,200 had
       elapsed. A registered reader accumulates the same measure at full grain
       as sim time passes; when one is present it is authoritative.

       When it is absent — no profile bound, no clock, a headless parse — this
       falls through to exactly the code it always ran. That is Optionality,
       and it is why an unbound board still renders character for character. */
    var read = opts.__noReader ? null : READER;
    if(read){
      var got = [], missing = 0;
      (profile.rollups.perUnit || []).forEach(function(u){
        var e = read(u.unit, measure, basis);
        if(e == null){ missing++; return; }
        got.push({ member:u.unit, value:e.value, n:e.n, feeds:['telemetry'],
                   elapsed:true, upToMs:e.upToMs });
      });
      /* All or nothing. A ranking half of whose members stop at the playhead
         and half of whose run to midnight is not a ranking — it is a race
         between two clocks, and the member with the longer day wins it. */
      if(got.length && !missing) return got;
    }
    (profile.rollups.perUnit || []).forEach(function(u){
      var v = unitMeasure(u, measure);
      if(v == null) return;
      out.push({ member:u.unit, value:v.value, n:v.n, feeds:['telemetry'] });
    });
    return out;
  }

  if(dim.source === 'roster'){
    /* TWO feeds. The deviation is telemetry; the name on it is the roster. */
    (profile.roster || []).forEach(function(r){
      var v = measure === '__deviation' ? num(r.deviation)
            : measure === '__value'     ? num(r.value)
            : measure === '__baseline'  ? num(r.baseline) : null;
      if(v == null) return;
      out.push({ member:r.who, value:v, n:1, feeds:['telemetry','roster'],
                 entity:r.entity, shift:r.shift, flag:r.flag || null });
    });
    return out;
  }

  if(dim.source === 'incident'){
    var cs = (profile.incidentScript && profile.incidentScript.cases) || [];
    /* Cases are grouped into cause FAMILIES first. A cause that appears on
       two units is one cause, not two — which is the whole point of asking
       which cause is principal. */
    var fam = {};
    cs.forEach(function(c){
      var f = familyOf(c.label);
      if(!fam[f]) fam[f] = { member:f, value:0, n:0, rows:0, units:[],
                             feeds:['incident script'] };
      fam[f].n++;
      fam[f].units.push(c.entity);
      fam[f].rows += (c.rowsAffected || 0);
      if(measure === '__frequency')      fam[f].value = fam[f].n;
      else if(measure === '__rows')      fam[f].value = fam[f].rows;
      else /* __excess */                fam[f].value += (c.expectedExcess || 0);
    });
    return Object.keys(fam).map(function(k){ return fam[k]; });
  }
  return out;
}

/** Cause families. Two air-filter saturation cases are one cause. Everything
 *  else stands alone, so this collapses exactly what the data says repeats. */
function familyOf(label){
  var s = String(label || '');
  if(/filtro(s)? (de aire|#1 y #3)|filtro de aire/i.test(s)) return 'Saturación de filtro de aire';
  return s;
}

/** A measure read off one unit's rollup. Integrated quantities are gallons;
 *  cycle carriers are tons; everything else is a mean. */
function unitMeasure(u, measure){
  if(!u) return null;
  if(measure === '__gallons'){
    var g = u.integrated && u.integrated['Fuel Consumption Rate-Engine'];
    return g ? { value:num(g.value), n:1 } : null;
  }
  if(measure === '__tons'){
    var c = u.cycles && u.cycles['Truck Payload-Communication Gateway #2'];
    return c ? { value:num(c.quantity), n:c.cycles || 0 } : null;
  }
  if(measure === '__cycles'){
    var f = u.cycles && u.cycles['Fuel Consumption Rate-Engine'];
    return f ? { value:num(f.cycles), n:f.cycles || 0 } : null;
  }
  var t = u.totals && u.totals[measure];
  if(t) return { value:num(t.mean), n:t.n || 0 };
  return null;
}

/* ═══ 4 · the one mechanism ════════════════════════════════════════════════ */

/**
 * Resolve one answer.
 *
 *   spec = { dimension, measure, aggregation, rank, format, unit, basis }
 *
 * `measure` may be a plain measure name, one of the reserved readings above,
 * or a ratio: { numerator:'__gallons', denominator:'__tons' }. A ratio is the
 * denominator law made explicit — it is computed member by member and never
 * as a mean of ratios.
 *
 * Returns { ok, kind, member, magnitude, format, unit, display, evidence }.
 * ok:false means the profile could not answer, and the caller keeps whatever
 * it had. Nothing here throws.
 */
function resolve(profile, spec){
  spec = spec || {};
  var fail = function(reason){
    return { ok:false, reason:reason, kind:spec.kind || 'count', member:null,
             magnitude:null, ranking:[], evidence:{ feeds:[] } };
  };
  if(!profile) return fail('no profile bound');

  var dim = findDimension(profile, spec.dimension);
  if(!dim) return fail('dimension not in profile: ' + spec.dimension);

  var agg  = spec.aggregation || 'mean';
  var rank = spec.rank || 'max';
  var rows, feeds;

  if(spec.measure && spec.measure.numerator){
    /* A ratio. Both sides are read per member and divided per member. */
    var nRows = cells(profile, dim, spec.measure.numerator, spec),
        dRows = cells(profile, dim, spec.measure.denominator, spec);
    /* BOTH SIDES OR NEITHER. Some measures are integrations and cycle counts
       that the accumulator declines to produce, so one side of a ratio can be
       bounded at the playhead while the other runs to the end of the file.
       Nine hours of fuel over a whole day of tonnage is not a ratio — it is
       the denominator law bent by a clock, which is exactly the way it would
       get bent without anyone deciding to bend it. */
    var nE = nRows.some(function(r){ return r.elapsed; }),
        dE = dRows.some(function(r){ return r.elapsed; });
    if(nE !== dE){
      var plain = assign({}, spec, { __noReader:true });
      nRows = cells(profile, dim, spec.measure.numerator, plain);
      dRows = cells(profile, dim, spec.measure.denominator, plain);
    }
    var byMember = {};
    dRows.forEach(function(r){ byMember[r.member] = r; });
    rows = [];
    nRows.forEach(function(r){
      var d = byMember[r.member];
      if(!d || !d.value) return;
      rows.push({ member:r.member, value:r.value / d.value, n:d.n,
                  numerator:r.value, denominator:d.value, feeds:r.feeds });
    });
    feeds = ['telemetry'];
  } else {
    rows = cells(profile, dim, spec.measure, spec);
    feeds = rows.length ? rows[0].feeds : [dim.feed];
  }

  if(!rows.length) return fail('no cells for ' + dim.id + ' × ' + describeMeasure(spec.measure));

  /* Deviation re-expresses every member against the population, so a
     "variation" answer is one aggregation, not a second mechanism. */
  if(agg === 'deviation'){
    var base = median(rows.map(function(r){ return r.value; }));
    if(base) rows = rows.map(function(r){
      return assign({}, r, { raw:r.value, value:(r.value - base) / base, baseline:base });
    });
  }
  if(agg === 'count')  return countAnswer(profile, spec, dim, rows, feeds);

  var sorted = rows.slice().sort(function(a, b){
    return rank === 'min' ? a.value - b.value
         : (spec.absolute ? Math.abs(b.value) - Math.abs(a.value) : b.value - a.value);
  });
  var top = sorted[0];
  var kind   = spec.kind || dim.kind;
  var format = spec.format || measureFormat(profile, spec, agg);
  var unit   = spec.unit != null ? spec.unit : measureUnit(profile, spec, agg);

  return {
    ok: true,
    kind: kind,
    member: top.member,
    magnitude: top.value,
    format: format,
    unit: unit,
    display: display(top.member, top.value, format, unit, kind),
    ranking: sorted.slice(0, 10).map(function(r){
      return { member:r.member, value:r.value, n:r.n };
    }),
    evidence: {
      feeds: uniq(feeds.concat(top.feeds || [])),
      dimension: dim.id, dimensionLabel: labelDimension(dim.id),
      measure: describeMeasure(spec.measure),
      aggregation: agg, rank: rank, basis: spec.basis || 'observed',
      members: rows.length, n: top.n,
      numerator: top.numerator != null ? top.numerator : null,
      denominator: top.denominator != null ? top.denominator : null,
      baseline: top.baseline != null ? top.baseline : null,
      raw: top.raw != null ? top.raw : null,
      entity: top.entity || null, shift: top.shift || null, flag: top.flag || null,
      runnerUp: sorted[1] ? { member:sorted[1].member, value:sorted[1].value } : null,
      separation: sorted[1] && sorted[0].value
                ? (sorted[0].value - sorted[1].value) / Math.abs(sorted[0].value) : null
    }
  };
}

/** A count answer ranks nothing — it reports the size of the ledger. */
function countAnswer(profile, spec, dim, rows, feeds){
  var total = 0;
  rows.forEach(function(r){ total += (r.value || 0); });
  return {
    ok: true, kind: 'count', member: null, magnitude: total,
    format: spec.format || 'count', unit: spec.unit || '',
    display: magnitudeText(total, spec.format || 'count', spec.unit || ''),
    ranking: rows.map(function(r){ return { member:r.member, value:r.value, n:r.n }; }),
    evidence: { feeds:uniq(feeds), dimension:dim.id,
                dimensionLabel:labelDimension(dim.id),
                measure:describeMeasure(spec.measure), aggregation:'count',
                rank:'none', members:rows.length, basis:spec.basis || 'observed' }
  };
}

function findDimension(profile, id){
  var all = dimensions(profile);
  for(var i = 0; i < all.length; i++) if(all[i].id === id) return all[i];
  return null;
}
/* The reserved readings are addressed internally with a double underscore so
   they can never collide with a profiled column name. That prefix is a
   namespace, not a label — the surface shows the words a person would use. */
var RESERVED_LABEL = {
  __gallons:'gallons', __tons:'tons hauled and dumped', __cycles:'completed cycles',
  __deviation:'deviation from baseline', __value:'shift consumption',
  __baseline:'baseline', __excess:'expected excess', __frequency:'case count',
  __rows:'rows affected'
};
function labelMeasure(m){
  if(m == null) return '(none)';
  var s = String(m);
  return RESERVED_LABEL[s] || s;
}
function describeMeasure(m){
  if(!m) return '(none)';
  if(m.numerator) return labelMeasure(m.numerator) + ' ÷ ' + labelMeasure(m.denominator);
  return labelMeasure(m);
}
/* A dimension is addressed as 'context:<column>' so context columns cannot
   collide with the four built-in dimensions. Same rule: namespace in, words out. */
var DIM_LABEL = { unit:'unit', roster:'operator roster', incident:'incident script' };
function labelDimension(id){
  var s = String(id == null ? '' : id);
  if(s.indexOf('context:') === 0) return s.slice(8);
  return DIM_LABEL[s] || s;
}
function measureFormat(profile, spec, agg){
  if(agg === 'deviation') return 'percentage';
  if(spec.measure && spec.measure.numerator) return 'count';
  var ms = measures(profile);
  for(var i = 0; i < ms.length; i++)
    if(ms[i].name === spec.measure) return KIND_FORMAT[ms[i].kind] || 'count';
  return 'count';
}
function measureUnit(profile, spec, agg){
  if(agg === 'deviation') return '';
  var ms = measures(profile);
  for(var i = 0; i < ms.length; i++) if(ms[i].name === spec.measure) return ms[i].unit;
  return '';
}

/** How an answer reads. Dimension kinds lead with the member and carry the
 *  magnitude behind it; measure kinds are the magnitude. */
function display(member, value, format, unit, kind){
  var mag = magnitudeText(value, format, unit);
  if(DIMENSION_KINDS[kind]) return memberLabel(member) + (value != null ? ' · ' + mag : '');
  return mag;
}
function kindIsPercent(format){ return format === 'percentage'; }

/** Phase 5's formatter is the authority and is not touched here. Two things
 *  it cannot know are settled on this side of the boundary:
 *
 *  A whole count is written whole. `format('count')` gives one decimal below
 *  a thousand, which is right for 0.1586 gal/ton and wrong for 299 trips —
 *  299 completed cycles is not 299.0 of anything. */
function magnitudeText(value, format, unit){
  var V = MOMENTUM.Value;
  if(value == null || !isFinite(value)) return '—';
  if(format === 'count' && !unit && Math.abs(value - Math.round(value)) < 1e-9)
    return Math.round(value).toLocaleString();
  return V ? V.format(kindIsPercent(format) ? value * 100 : value, format, unit)
           : String(value);
}

/** A member is labelled with the part of it that varies. The Shift ID column
 *  carries its date in every value ("2026-08-05 · Noche"), so a single day of
 *  data makes the date pure noise in front of the only word that differs.
 *  This strips a leading ISO date and its separator and nothing else — the
 *  underlying member is untouched, so ranking, evidence and any Risk Meter
 *  condition still address the value the data actually holds. */
function memberLabel(member){
  var s = String(member == null ? '' : member);
  var m = s.match(/^\d{4}-\d{2}-\d{2}\s*[·\-–—|/]\s*(.+)$/);
  return m ? m[1].trim() : s;
}

/* ═══ 5 · question suggestion from the profile ═════════════════════════════ */

/**
 * Context columns × measures, ranked by variance — an answer that never
 * changes is not worth a slot on the board.
 *
 * The spec's prose says 7 × 21. The bound profile carries 6 context columns
 * and 14 measures, which is 84; and one of those columns
 * (Transmission Current Gear) has a single distinct value, so it cannot
 * differentiate anything and every question built on it is degenerate by
 * construction. `candidates()` reports both numbers and excludes the
 * degenerate column from the ranked shortlist, which is why `usable` is 70
 * where `nominal` is 84. The count is reconciled against the data, not the
 * prose.
 */
function candidates(profile, opts){
  opts = opts || {};
  var minDistinct = opts.minDistinct == null ? 2 : opts.minDistinct;
  var ctx = (profile && profile.context) || [];
  var ms  = measures(profile);
  var nominal = ctx.length * ms.length;
  var out = [], degenerate = [];

  ctx.forEach(function(c){
    if((c.distinct || 0) < minDistinct){
      degenerate.push({ column:c.name, distinct:c.distinct || 0,
                        why:'a single distinct value cannot differentiate' });
      return;
    }
    ms.forEach(function(m){
      var dim  = { id:'context:' + c.name, source:'context', column:c.name,
                   kind:kindOfColumn(c.name), feed:'telemetry' };
      var rows = cells(profile, dim, m.name, {});
      if(rows.length < 2) return;
      var v = spread(rows.map(function(r){ return r.value; }));
      out.push({
        dimension:dim.id, column:c.name, measure:m.name, unit:m.unit,
        kind:kindOfColumn(c.name), format:KIND_FORMAT[m.kind] || 'count',
        members:rows.length, variance:v.cv, range:v.range,
        question:phrase(c.name, m.name),
        spec:{ dimension:dim.id, measure:m.name, aggregation:'mean', rank:'max' }
      });
    });
  });
  out.sort(function(a, b){ return b.variance - a.variance; });
  return { nominal:nominal, usable:out.length, degenerate:degenerate,
           contextColumns:ctx.length, measures:ms.length, ranked:out };
}

/** The shortlist MOMENTUM proposes for one KBR: the highest-variance
 *  questions that are not already on the board. */
function shortlist(profile, existingNames, n){
  var c = candidates(profile);
  var taken = {};
  (existingNames || []).forEach(function(s){ taken[norm(s)] = 1; });
  var out = [], seen = {};
  for(var i = 0; i < c.ranked.length && out.length < (n || 5); i++){
    var q = c.ranked[i];
    var key = q.column + '|' + q.measure;
    if(seen[key] || taken[norm(q.question)]) continue;
    seen[key] = 1; out.push(q);
  }
  return out;
}
function norm(s){ return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function phrase(column, measure){
  return measure + ' by ' + column.replace(/-[^-]*$/, '').trim();
}

/* ═══ 6 · flags — local, and only local ════════════════════════════════════ */

/**
 * A flag is a red mark on the answer where it stands: concentration risk, a
 * margin leak, a variance leader. It has no severity and no persistence, and
 * `notifies` is false and cannot be set true. Escalation belongs to the Risk
 * Meter, which owns its own threshold and its own persistence.
 *
 * The freezer case, which is the test of this split:
 *     flag({magnitude:-15}, {op:'lt', value:-14})   → flagged, notifies false
 *     a Risk Meter condition at −12 °C for 20 min   → alarm
 * The two are independent. Neither implies the other.
 */
function newFlag(){
  return { enabled:false, op:'gt', value:null, label:'', notifies:false };
}
function flag(answer, threshold){
  var t = threshold || {};
  var out = { flagged:false, notifies:false, threshold:t.value == null ? null : t.value,
              op:t.op || 'gt', label:t.label || '' };
  if(!t.enabled || t.value == null || !answer || !answer.ok) return out;
  var v = answer.magnitude;
  if(v == null || !isFinite(v)) return out;
  out.flagged = t.op === 'lt' ? (v < t.value)
              : t.op === 'lte' ? (v <= t.value)
              : t.op === 'gte' ? (v >= t.value)
              : (v > t.value);
  return out;                       /* notifies stays false. Always. */
}

/* ═══ 7 · the quiet link into the Risk Meter ═══════════════════════════════ */

/**
 * Pre-fill a Risk Meter condition scoped to one answer. This does not create
 * the condition and does not escalate anything — it hands the Risk Meter a
 * draft with the answer's scope, format and current reading already filled
 * in, and the Risk Meter decides. One owner, two windows.
 */
function riskDraft(kbr, answer, resolved){
  var scope = { type:'answer', kbrId:kbr && kbr.id, answerId:answer && answer.tid,
                label:(answer && answer.name) || 'this answer' };
  var d = {
    scope: scope,
    format: (resolved && resolved.format) || formatOf(answer, kbr),
    unit: (resolved && resolved.unit) || '',
    direction: 'up',
    threshold: (resolved && resolved.magnitude != null) ? resolved.magnitude : null,
    persistenceSec: 0,
    source: 'answer-engine'
  };
  return d;
}
/** The read-only line the gear shows once a scoped condition exists. */
function scopedCondition(conditions, kbrId, answerId){
  var list = conditions || [];
  for(var i = 0; i < list.length; i++){
    var s = list[i] && list[i].scope;
    if(s && s.type === 'answer' && s.kbrId === kbrId && s.answerId === answerId)
      return list[i];
  }
  return null;
}

/* ═══ 8 · S3 · legacy answers auto-wrap ════════════════════════════════════ */

/**
 * An answer configured before this phase has a name, sources and a status and
 * nothing else. Wrapping gives it the query it always implied — inferred from
 * its name — plus an explicit format and an empty flag. It does NOT bind it
 * to the profile: an unwrapped legacy answer and a wrapped one with no query
 * resolve to the same hash-seeded value, which is the Optionality law.
 */
function migrate(answer, kbr){
  if(!answer || typeof answer !== 'object') return answer;
  if(answer.answerSchema >= 1) return answer;
  answer.answerSchema = 1;
  /* Same rule as formatOf: the suggestion reads the answer, not the KBR.
     Stamping the KBR's unit on at migration time would bake the old
     authority into the data permanently — a name answer under a currency
     KBR would come out of the wrap declaring itself money. */
  if(!answer.format) answer.format = suggestFormat(answer.name, answer.unit || '');
  if(!answer.query)  answer.query  = null;      /* null = never configured    */
  if(!answer.flag)   answer.flag   = newFlag();
  if(!Array.isArray(answer.touchpoints)) answer.touchpoints = [];
  return answer;
}
function migrateAll(kbr){
  if(!kbr || !Array.isArray(kbr.answers)) return kbr;
  kbr.answers.forEach(function(a){ migrate(a, kbr); });
  return kbr;
}

/* ═══ 9 · small maths ══════════════════════════════════════════════════════ */

function median(a){
  var s = (a || []).filter(function(v){ return v != null && isFinite(v); })
                   .slice().sort(function(x, y){ return x - y; });
  if(!s.length) return null;
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function spread(a){
  var v = (a || []).filter(function(x){ return x != null && isFinite(x); });
  if(v.length < 2) return { cv:0, range:0, mean:v[0] || 0 };
  var mean = 0, i;
  for(i = 0; i < v.length; i++) mean += v[i];
  mean /= v.length;
  var ss = 0;
  for(i = 0; i < v.length; i++) ss += (v[i] - mean) * (v[i] - mean);
  var sd = Math.sqrt(ss / (v.length - 1));
  var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v);
  return { cv: mean ? Math.abs(sd / mean) : 0, range: mx - mn, mean: mean, sd: sd };
}
function uniq(a){
  var seen = {}, out = [];
  (a || []).forEach(function(x){ if(x != null && !seen[x]){ seen[x] = 1; out.push(x); } });
  return out;
}
function assign(t){
  for(var i = 1; i < arguments.length; i++){
    var s = arguments[i];
    if(s) for(var k in s) if(has(s, k)) t[k] = s[k];
  }
  return t;
}

/* ═══ 10 · the shipped mining configuration ════════════════════════════════
   REMOVED. Fifteen answer definitions used to live here as a MINING table
   keyed by KBR name, and five risk touchpoints lived in the risk UI as
   MINING_RISK_TPS. They were the last precooked client configuration in the
   product: the simulation could only ever be as good as what somebody had
   already hardcoded for one mine, and a second client meant a second table.

   They now live in a Config Doc, which is a client deliverable rather than a
   constant. The document reproduces every one of them against the real
   profile — HT-006 · 0.1756 gal/ton, Noche, OP-02, Rampa B-11 Oeste,
   Saturación de filtro de aire, 299 — with zero unresolved names, because the
   mechanism computing them was never mining-specific. Only the DECLARATION
   was, and a declaration belongs in a document.

   `miningAnswers` is kept as a stub returning null so that any caller which
   still asks gets a clean "nothing declared" rather than a ReferenceError. */
function miningAnswers(){ return null; }


/* ═══ 11 · exports ═════════════════════════════════════════════════════════ */

MOMENTUM.Answer = {
  version: 1,
  KINDS: KINDS, DIMENSION_KINDS: DIMENSION_KINDS, MEASURE_KINDS: MEASURE_KINDS,
  KIND_FORMAT: KIND_FORMAT,

  suggestFormat: suggestFormat, formatOf: formatOf,
  dimensions: dimensions, measures: measures, cells: cells, familyOf: familyOf,
  resolve: resolve, display: display,

  /* fn(unit, measure, basis) -> {value, n, upToMs} | null, or null to clear. */
  useReader: function(fn){ READER = (typeof fn === 'function') ? fn : null; return READER; },
  reader: function(){ return READER; },

  candidates: candidates, shortlist: shortlist,

  newFlag: newFlag, flag: flag,
  riskDraft: riskDraft, scopedCondition: scopedCondition,

  migrate: migrate, migrateAll: migrateAll,

  miningAnswers: miningAnswers,
  median: median, spread: spread,
  memberLabel: memberLabel, magnitudeText: magnitudeText,
  labelMeasure: labelMeasure, labelDimension: labelDimension
};

})();
