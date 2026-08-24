/* ═══════════════════════════════════════════════════════════════════════════
 * VALIDATE-CORE — the bundle is the unit, not the file
 *
 * WHY THIS EXISTS.
 *
 * Every defect this project has shipped was schema-valid. The mining Config
 * Doc declared a fuel-per-ton target of 0.478 against a workbook that produces
 * 0.1586, and an alarm at 0.52 that could therefore never fire. Logistics
 * declared Damage Rate higher-is-better. Five risk touchpoints were filed
 * under one of three results, leaving two Risk Meters with alarm conditions
 * and nothing able to detect them. Every idle-hours answer returned mph or
 * gal/h. Sixteen of seventeen industries declared no answers at all.
 *
 * A parser accepted all of it, because none of it breaks the grammar. The
 * errors are AGREEMENTS BETWEEN DOCUMENTS — a target disagreeing with the data
 * beneath it, a condition disagreeing with the detection above it, a unit
 * disagreeing with the result it measures. Validating one file at a time
 * cannot see any of them.
 *
 * So this validates the SET.
 *
 * REJECT VERSUS WARN.
 *
 *   reject — structurally impossible. A reference to something that does not
 *            exist. The bundle cannot be applied.
 *   warn   — legal, and probably wrong. A target 3x its observed baseline
 *            might be a stretch goal; it might be the mining defect. Only a
 *            human knows, so a human is asked.
 *
 * Warnings are never silent. A silent guess is the root of nearly every defect
 * listed above, and the one habit this file exists to break.
 * ═══════════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Validate = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REJECT = 'reject', WARN = 'warn';

  function Report() {
    this.items = [];
  }
  Report.prototype.add = function (level, code, doc, subject, message, detail) {
    this.items.push({ level: level, code: code, doc: doc, subject: subject,
                      message: message, detail: detail == null ? '' : String(detail) });
  };
  Report.prototype.reject = function (c, d, s, m, x) { this.add(REJECT, c, d, s, m, x); };
  Report.prototype.warn   = function (c, d, s, m, x) { this.add(WARN,   c, d, s, m, x); };
  Report.prototype.counts = function () {
    var r = 0, w = 0;
    this.items.forEach(function (i) { i.level === REJECT ? r++ : w++; });
    return { rejects: r, warnings: w, total: this.items.length };
  };
  Report.prototype.ok = function () { return this.counts().rejects === 0; };

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }
  function norm(s) { return String(s == null ? '' : s).trim(); }
  function key(s) { return norm(s).toLowerCase(); }
  function has(list, v) { return list.indexOf(key(v)) !== -1; }

  /* ── 1 · journey doc ─────────────────────────────────────────────────────
     Rows are kind-discriminated, exactly like the Config Doc, so a .docx
     table, an .xlsx sheet and a .csv all normalise to the same objects.
     A touchpoint declares WHAT IT OBSERVES in business language and never a
     column name — that is what keeps a journey scenario portable across
     datasets, and it is a rule the schema now enforces rather than a
     convention someone has to remember. */
  var JOURNEY_KINDS = ['result', 'stage', 'substage', 'touchpoint'];

  function validateJourney(journey, rep) {
    if (!journey || !journey.rows) return { results: [], stages: [], nodes: [] };
    var results = [], stages = [], subs = [], tps = [];

    journey.rows.forEach(function (r, i) {
      var kind = key(r.kind);
      if (!kind) return;
      if (JOURNEY_KINDS.indexOf(kind) === -1) {
        rep.reject('J-KIND', 'journey', norm(r.name) || ('row ' + (i + 2)),
                   'unknown row kind "' + norm(r.kind) + '"',
                   'expected one of: ' + JOURNEY_KINDS.join(', '));
        return;
      }
      if (!norm(r.name)) {
        rep.reject('J-NONAME', 'journey', 'row ' + (i + 2), 'row has no name');
        return;
      }
      if (kind === 'result') results.push(r);
      else if (kind === 'stage') stages.push(r);
      else if (kind === 'substage') subs.push(r);
      else tps.push(r);
    });

    var resultNames = results.map(function (r) { return key(r.name); });
    var stageNames = stages.map(function (r) { return key(r.name); });
    var subNames = subs.map(function (r) { return key(r.name); });
    var nodeNames = stageNames.concat(subNames);

    /* duplicate names make every reference ambiguous */
    [[results, 'result'], [stages, 'stage'], [subs, 'substage']].forEach(function (pair) {
      var seen = {};
      pair[0].forEach(function (r) {
        var k = key(r.name);
        if (seen[k]) rep.reject('J-DUP', 'journey', norm(r.name),
                                'duplicate ' + pair[1] + ' name');
        seen[k] = 1;
      });
    });

    stages.forEach(function (s) {
      if (norm(s.result) && !has(resultNames, s.result))
        rep.reject('J-NORESULT', 'journey', norm(s.name),
                   'contributes to a result that is not declared here',
                   'result: ' + norm(s.result));
      if (num(s.order) == null)
        rep.warn('J-NOORDER', 'journey', norm(s.name), 'stage has no order');
    });

    subs.forEach(function (s) {
      if (!norm(s.parent))
        rep.reject('J-ORPHAN', 'journey', norm(s.name), 'substage names no parent stage');
      else if (!has(stageNames, s.parent))
        rep.reject('J-NOPARENT', 'journey', norm(s.name),
                   'parent stage does not exist', 'parent: ' + norm(s.parent));
    });

    tps.forEach(function (t) {
      if (!norm(t.parent))
        rep.reject('J-ORPHAN', 'journey', norm(t.name), 'touchpoint names no parent');
      else if (!has(nodeNames, t.parent))
        rep.reject('J-NOPARENT', 'journey', norm(t.name),
                   'parent stage or substage does not exist', 'parent: ' + norm(t.parent));
      if (!norm(t.observes))
        rep.warn('J-NOOBS', 'journey', norm(t.name),
                 'touchpoint does not say what it observes');
      /* A touchpoint naming a literal column welds the journey to one dataset
         and breaks the case where a scenario journey is reused with the
         user's own data. Business language only. */
      if (/[#_]|Gateway|Ctrl\b|-Engine\b/.test(norm(t.observes)))
        rep.warn('J-COLUMNISH', 'journey', norm(t.name),
                 'what it observes looks like a data column, not a business observation',
                 norm(t.observes));
    });

    results.forEach(function (r) {
      if (!norm(r.unit)) rep.warn('J-NOUNIT', 'journey', norm(r.name), 'result has no unit');
      var d = key(r.direction);
      if (d && d !== 'up' && d !== 'down')
        rep.reject('J-DIR', 'journey', norm(r.name),
                   'direction must be up or down', norm(r.direction));
    });

    if (!results.length)
      rep.warn('J-NORESULTS', 'journey', '(document)', 'no results declared');
    if (!stages.length)
      rep.reject('J-NOSTAGES', 'journey', '(document)', 'no stages declared');

    return { results: results, stages: stages, subs: subs, tps: tps };
  }

  /* ── 2 · data doc ────────────────────────────────────────────────────────
     Declares span, grain and calendar so the clock knows what a row means,
     fields so the Config Doc has something real to bind to, limits so the
     generator and the Risk Meter share one source of truth, and named windows
     so a demo can start at a business moment rather than a row offset. */
  var DATA_KINDS = ['dataset', 'field', 'limit', 'window', 'calendar', 'measure', 'shape', 'event'];
  var MODES = ['replay', 'seeded', 'free'];

  function validateData(data, rep) {
    if (!data || !data.rows) return { fields: [], limits: [], windows: [], mode: null };
    var ds = null, fields = [], limits = [], windows = [], measures = [], events = [];

    data.rows.forEach(function (r, i) {
      var kind = key(r.kind);
      if (!kind) return;
      if (DATA_KINDS.indexOf(kind) === -1) {
        rep.reject('D-KIND', 'data', norm(r.name) || ('row ' + (i + 2)),
                   'unknown row kind "' + norm(r.kind) + '"',
                   'expected one of: ' + DATA_KINDS.join(', '));
        return;
      }
      if (kind === 'dataset') ds = r;
      else if (kind === 'field') fields.push(r);
      else if (kind === 'limit') limits.push(r);
      else if (kind === 'window') windows.push(r);
      else if (kind === 'measure') measures.push(r);
      else if (kind === 'event') events.push(r);
    });

    if (!ds) {
      rep.reject('D-NODATASET', 'data', '(document)',
                 'no dataset row — span, grain and mode are undeclared');
      return { fields: fields, limits: limits, windows: windows, mode: null };
    }

    var mode = key(ds.mode);
    if (MODES.indexOf(mode) === -1)
      rep.reject('D-MODE', 'data', '(dataset)',
                 'mode must be replay, seeded or free', norm(ds.mode));

    /* The clock cannot run without these. A per-second file and a
       per-transaction file are read completely differently. */
    if (!norm(ds.grain))
      rep.reject('D-NOGRAIN', 'data', '(dataset)', 'grain is undeclared');
    if (!norm(ds.span))
      rep.reject('D-NOSPAN', 'data', '(dataset)', 'span is undeclared');

    if (mode === 'replay' && !fields.length)
      rep.reject('D-NOFIELDS', 'data', '(document)',
                 'replay mode declares no fields — there is nothing to play');
    if (mode === 'seeded' && !measures.length)
      rep.reject('D-NOMEASURES', 'data', '(document)',
                 'seeded mode declares no measures — there is nothing to expand');

    fields.forEach(function (f) {
      if (!norm(f.unit) && key(f.type) === 'number')
        rep.warn('D-NOUNIT', 'data', norm(f.name), 'numeric field has no unit');
    });

    /* Limits declared beat limits inferred. Inferring thresholds from a file
       that contains injected faults teaches the detector that the fault is
       normal — the mining workbook has ten of them, and its manual is
       explicit that they must not feed detection. */
    if (mode !== 'free' && !limits.length)
      rep.warn('D-NOLIMITS', 'data', '(document)',
               'no limits declared — thresholds would have to be inferred from the data');

    limits.forEach(function (l) {
      var names = fields.map(function (f) { return key(f.name); });
      if (norm(l.field) && fields.length && !has(names, l.field))
        rep.reject('D-LIMITFIELD', 'data', norm(l.field),
                   'limit refers to a field that is not declared');
      if (num(l.correct_high) != null && num(l.out_high) != null &&
          num(l.out_high) < num(l.correct_high))
        rep.reject('D-LIMITORDER', 'data', norm(l.field) + ' / ' + norm(l.context),
                   'out-of-range band sits below the correct band');
    });

    if (mode === 'replay' && !windows.length)
      rep.warn('D-NOWINDOWS', 'data', '(document)',
               'no named windows — a demo can only start at a row offset');

    return { fields: fields, limits: limits, windows: windows,
             measures: measures, events: events, mode: mode, dataset: ds };
  }

  /* ── 3 · config doc ──────────────────────────────────────────────────────
     Checked alone for internal coherence, then against the other two. */
  var CONFIG_KINDS = ['kbr', 'answer', 'risk', 'risktouchpoint', 'condition',
                      'channel', 'anomrule', 'knownunknown', 'baseline'];

  function validateConfig(config, rep) {
    if (!config || !config.rows) return { kbrs: [] };
    var kbrs = [], answers = [], risks = [], conds = [], chans = [], rules = [], bases = [];

    config.rows.forEach(function (r, i) {
      var kind = key(r.kind);
      if (!kind || kind === 'kind') return;
      if (CONFIG_KINDS.indexOf(kind) === -1) {
        rep.reject('C-KIND', 'config', norm(r.name) || ('row ' + (i + 2)),
                   'unknown row kind "' + norm(r.kind) + '"',
                   'expected one of: ' + CONFIG_KINDS.join(', '));
        return;
      }
      if (kind === 'kbr') kbrs.push(r);
      else if (kind === 'answer') answers.push(r);
      else if (kind === 'risk' || kind === 'risktouchpoint') risks.push(r);
      else if (kind === 'condition') conds.push(r);
      else if (kind === 'channel') chans.push(r);
      else if (kind === 'baseline') bases.push(r);
      else rules.push(r);
    });

    var kbrNames = kbrs.map(function (k) { return key(k.kbr); });
    var chanNames = chans.map(function (c) { return key(c.name); });

    kbrs.forEach(function (k) {
      var d = key(k.direction);
      if (d && d !== 'up' && d !== 'down')
        rep.reject('C-DIR', 'config', norm(k.kbr),
                   'direction must be up or down', norm(k.direction));
    });

    /* every dependent row must name a result that exists */
    [[answers, 'answer'], [risks, 'risk touchpoint'],
     [conds, 'condition'], [rules, 'anomaly rule'], [bases, 'baseline']]
      .forEach(function (pair) {
        pair[0].forEach(function (r) {
          if (!norm(r.kbr))
            rep.reject('C-NOKBR', 'config', norm(r.name),
                       pair[1] + ' names no result');
          else if (!has(kbrNames, r.kbr))
            rep.reject('C-BADKBR', 'config', norm(r.name),
                       pair[1] + ' names a result with no kbr row', norm(r.kbr));
        });
      });

    conds.forEach(function (c) {
      if (!norm(c.op) || num(c.value) == null)
        rep.reject('C-CONDOP', 'config', norm(c.name),
                   'condition has no operator or no threshold');
      norm(c.channels).split(';').forEach(function (ch) {
        if (norm(ch) && chanNames.length && !has(chanNames, ch))
          rep.reject('C-BADCHAN', 'config', norm(c.name),
                     'routes to a channel that is not declared', norm(ch));
      });
    });

    var riskNames = risks.map(function (r) { return key(r.name); });
    rules.forEach(function (r) {
      if (norm(r.dimension) && riskNames.length && !has(riskNames, r.dimension))
        rep.reject('C-BADRULE', 'config', norm(r.name),
                   'anomaly rule watches a risk touchpoint that does not exist',
                   norm(r.dimension));
    });

    /* ── the half-filled rule ───────────────────────────────────────────────
       A section may be empty. It may not be half-filled. Mining declares an
       alarm on Toneladas Movidas and on Horas en Ralenti and zero risk
       touchpoints for either: an alarm with nothing able to detect it, which
       is precisely the empty Risk Meter that was reported as a bug. */
    kbrs.forEach(function (k) {
      var n = key(k.kbr);
      var nRisk = risks.filter(function (r) { return key(r.kbr) === n; }).length;
      var nCond = conds.filter(function (c) { return key(c.kbr) === n; }).length;
      var nAns = answers.filter(function (a) { return key(a.kbr) === n; }).length;
      var nBase = bases.filter(function (b) { return key(b.kbr) === n; }).length;

      if (nCond && !nRisk)
        rep.warn('C-HALFRISK', 'config', norm(k.kbr),
                 'has ' + nCond + ' condition(s) but no risk touchpoint to detect them',
                 'the Risk Meter will show a figure it cannot attribute');
      if (!nAns)
        rep.warn('C-NOANSWERS', 'config', norm(k.kbr),
                 'declares no answers — the answer engine falls back to generic scaffolding');
      if (num(k.target) == null && !nBase)
        rep.warn('C-NOTARGET', 'config', norm(k.kbr),
                 'has neither a target nor an observed baseline');
    });

    return { kbrs: kbrs, answers: answers, risks: risks, conds: conds,
             chans: chans, rules: rules, bases: bases };
  }

  /* ── 4 · the set ─────────────────────────────────────────────────────────
     Everything above is one document talking to itself. These are the checks
     that need two or three documents in the room at once, and they are the
     ones that would have caught what shipped. */
  function validateBundle(b, rep, opts) {
    opts = opts || {};
    var factor = opts.targetFactor || 2;

    var J = validateJourney(b.journey, rep);
    var D = validateData(b.data, rep);
    var C = validateConfig(b.config, rep);

    var haveJ = !!(b.journey && b.journey.rows && b.journey.rows.length);
    var haveD = !!(b.data && b.data.rows && b.data.rows.length);

    /* config <-> journey ------------------------------------------------- */
    if (haveJ) {
      var jResults = J.results.map(function (r) { return key(r.name); });
      C.kbrs.forEach(function (k) {
        if (!has(jResults, k.kbr))
          rep.reject('X-NOJRESULT', 'config', norm(k.kbr),
                     'configures a result the journey doc does not declare');
      });
      J.results.forEach(function (r) {
        if (!has(C.kbrs.map(function (k) { return key(k.kbr); }), r.name))
          rep.warn('X-UNCONFIGURED', 'journey', norm(r.name),
                   'result is declared but never configured');
      });
      /* Logistics shipped Damage Rate as higher-is-better because the doc and
         the board disagreed and nothing compared them. */
      C.kbrs.forEach(function (k) {
        var jr = J.results.filter(function (r) { return key(r.name) === key(k.kbr); })[0];
        if (!jr) return;
        if (norm(jr.direction) && norm(k.direction) && key(jr.direction) !== key(k.direction))
          rep.reject('X-DIR', 'config', norm(k.kbr),
                     'direction disagrees with the journey doc',
                     'journey: ' + norm(jr.direction) + ' · config: ' + norm(k.direction));
        if (norm(jr.unit) && norm(k.unit) && key(jr.unit) !== key(k.unit))
          rep.warn('X-UNIT', 'config', norm(k.kbr),
                   'unit disagrees with the journey doc',
                   'journey: ' + norm(jr.unit) + ' · config: ' + norm(k.unit));
      });
    }

    /* config <-> data ----------------------------------------------------- */
    if (haveD && D.fields.length) {
      var fieldNames = D.fields.map(function (f) { return key(f.name); });
      var BUILTIN = /^__/;
      C.answers.forEach(function (a) {
        [a.measure, a.denominator, a.dimension].forEach(function (m) {
          var v = norm(m);
          if (!v || BUILTIN.test(v)) return;
          if (!has(fieldNames, v))
            rep.reject('X-NOFIELD', 'config', norm(a.name),
                       'binds to a field the data doc does not declare', v);
        });
      });

      /* The idle-hours defect: five answers under a result measured in hours,
         every one of them returning mph or gal/h. Legal, and useless. */
      C.answers.forEach(function (a) {
        var k = C.kbrs.filter(function (x) { return key(x.kbr) === key(a.kbr); })[0];
        if (!k) return;
        var ku = norm(k.unit), au = norm(a.unit);
        if (ku && au && key(ku) !== key(au) && !/ratio|%/.test(key(a.format)))
          rep.warn('X-ANSUNIT', 'config', norm(a.name),
                   'answers a result measured in ' + ku + ' but reports ' + au,
                   'result: ' + norm(a.kbr));
      });
    }

    /* declared versus observed -------------------------------------------
       The check that catches 0.478 against 0.1586. A generated Config Doc
       writes the observed baseline and leaves the target blank on purpose, so
       whenever both are present a human put the target there and can be asked
       about it. */
    C.kbrs.forEach(function (k) {
      var t = num(k.target);
      if (t == null || !t) return;
      var base = C.bases.filter(function (b2) { return key(b2.kbr) === key(k.kbr); })[0];
      var obs = base ? num(base.value) : (opts.observed && opts.observed[norm(k.kbr)]);
      if (obs == null || !obs) return;
      var ratio = t / obs;
      if (ratio > factor || ratio < 1 / factor)
        rep.warn('X-TARGET', 'config', norm(k.kbr),
                 'declared target is ' + ratio.toFixed(2) + 'x the observed baseline',
                 'target ' + t + ' · observed ' + obs);

      /* A threshold beyond anything the data reaches is not a safeguard. */
      C.conds.filter(function (c) { return key(c.kbr) === key(k.kbr); })
        .forEach(function (c) {
          var v = num(c.value);
          if (v == null) return;
          if (key(c.op) === 'gt' && v > obs * factor)
            rep.warn('X-UNREACHABLE', 'config', norm(c.name),
                     'threshold is ' + (v / obs).toFixed(2) + 'x the observed baseline and cannot fire',
                     'threshold ' + v + ' · observed ' + obs);
          if (key(c.op) === 'lt' && v < obs / factor)
            rep.warn('X-UNREACHABLE', 'config', norm(c.name),
                     'threshold is far below the observed baseline and cannot fire',
                     'threshold ' + v + ' · observed ' + obs);
        });
    });

    return { journey: J, data: D, config: C, report: rep };
  }

  function validate(bundle, opts) {
    var rep = new Report();
    var out = validateBundle(bundle || {}, rep, opts);
    out.counts = rep.counts();
    out.ok = rep.ok();
    out.items = rep.items;
    return out;
  }

  return {
    validate: validate,
    validateJourney: validateJourney,
    validateData: validateData,
    validateConfig: validateConfig,
    Report: Report,
    REJECT: REJECT,
    WARN: WARN,
    KINDS: { journey: JOURNEY_KINDS, data: DATA_KINDS, config: CONFIG_KINDS },
  };
}));
