/* ═══════════════════════════════════════════════════════════════════════════
   Response Options → the communication registry

   This tab used to print `records / notifies / acts` as static text with a
   paragraph of escalation constants underneath. It described the taxonomy and
   configured nothing. It is now what BOb's tab of the same name is: the place
   where channels are defined, so that every threshold and every anomaly can
   route to them by reference rather than by retyping an address.

   Handlers are delegated rather than written into the markup. BOb builds
   strings like onchange="metricCfg['x'].responses[0].subject=this.value",
   which breaks the moment a value contains a quote and cannot be escaped
   safely. Nothing here evaluates a string.

   No UI state is stored in the model either — which row is open lives in this
   file, not in the configuration. A randomised `rollup` sitting in the config
   is what made the Optionality gate flaky for months; expansion state is the
   same mistake wearing different clothes.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

function C(){ return (window.MOMENTUM && MOMENTUM.Channels) || null; }
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

/* UI-only state. Deliberately outside the configuration object. */
var ui = { editing:null, adding:false, addType:'email', error:'',
           draft:{ label:'', values:'' }, view:'channels' };

var GLYPH = {
  email:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 7l10 6 10-6"/></svg>',
  sms:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="2" width="12" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>',
  call:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8.1 9.7a16 16 0 006 6l1.2-1.2a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.9 2.2z"/></svg>',
  slack:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 11.5a8.4 8.4 0 01-.9 3.8A8.5 8.5 0 0112.5 20a8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 014 11.5a8.5 8.5 0 014.7-7.6A8.4 8.4 0 0112.5 3h.5a8.5 8.5 0 018 8v.5z"/></svg>',
  webhook:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7L12.3 19"/></svg>'
};

/** The whole tab. */
function renderChannelRegistry(){
  var box = document.getElementById('rmCfgContent') ||
            document.getElementById('cfgSubContent');
  if(!box) return;
  var ch = C(); if(!ch) return;

  var rows = ch.list().map(function(c){
    if(ui.editing === c.id) return editRow(c);
    return '<div class="mc-row" data-ch="' + esc(c.id) + '">' +
      '<span class="mc-ico">' + (GLYPH[c.type] || '') + '</span>' +
      '<div class="mc-info" data-act="edit" data-ch="' + esc(c.id) + '">' +
        '<div class="mc-label">' + esc(c.label) +
          '<span class="mc-count">(' + c.values.length + ')</span>' +
          (c.declared ? '<span class="mc-declared">declared</span>' : '') + '</div>' +
        '<div class="mc-values">' + esc(c.values.join(', ')) + '</div>' +
      '</div>' +
      '<button class="mc-x" data-act="remove" data-ch="' + esc(c.id) + '" title="Remove channel">&times;</button>' +
    '</div>';
  }).join('');

  /* Two questions, two views. Channels answers WHO is contacted and how often
     they may be; Signals answers what the BOARD does before anything fires.
     They were one block called Escalation, which described neither honestly:
     a slow pulse is not an escalation, nothing has responded yet. */
  var seg =
    '<div class="mc-seg">' +
      '<button class="mc-seg-b' + (ui.view === 'channels' ? ' on' : '') +
        '" data-act="view-channels">Channels</button>' +
      '<button class="mc-seg-b' + (ui.view === 'signals' ? ' on' : '') +
        '" data-act="view-signals">Signals</button>' +
    '</div>';

  var body;
  if(ui.view === 'signals'){
    body = signalsBlock(ch);
  } else {
    body =
      '<div class="cfg-sec-hd">Communication Channels</div>' +
      '<div class="mc-note">Define a destination once here and every threshold, ' +
        'anomaly and condition can route to it by name. Changing a number changes ' +
        'it everywhere.</div>' +
      (rows || '<div class="mc-empty">No channels yet.</div>') +
      (ui.error ? '<div class="mc-err">' + esc(ui.error) + '</div>' : '') +
      (ui.adding ? addForm(ch) :
        '<button class="mc-add" data-act="open-add">+ Add Channel</button>') +
      '';
  }
  box.innerHTML = seg + body;

  wire(box);
}
window.renderChannelRegistry = renderChannelRegistry;

function editRow(c){
  return '<div class="mc-row mc-editing">' +
    '<span class="mc-ico">' + (GLYPH[c.type] || '') + '</span>' +
    '<div class="mc-edit-fields">' +
      '<input class="mc-in" id="mcEditLabel" value="' + esc(c.label) + '" placeholder="Team / person name">' +
      '<input class="mc-in" id="mcEditValues" value="' + esc(c.values.join(', ')) + '">' +
      '<div class="mc-edit-btns">' +
        '<button class="mc-save" data-act="save-edit" data-ch="' + esc(c.id) + '">Save</button>' +
        '<button class="mc-cancel" data-act="cancel-edit">Cancel</button>' +
      '</div>' +
    '</div></div>';
}

function addForm(ch){
  var t = ch.TYPES[ui.addType] || ch.TYPES.email;
  var opts = ch.TYPE_ORDER.map(function(k){
    return '<option value="' + k + '"' + (k === ui.addType ? ' selected' : '') + '>' +
           esc(ch.TYPES[k].label) + '</option>';
  }).join('');
  return '<div class="mc-form">' +
    '<div class="mc-form-top">' +
      '<select class="mc-in mc-type" id="mcAddType">' + opts + '</select>' +
      '<input class="mc-in" id="mcAddLabel" placeholder="Team / person name" value="' +
      esc(ui.draft.label) + '">' +
    '</div>' +
    /* The field follows the type — an email asks for addresses, a webhook for
       a URL. Asking for "slack, email…" in one box is what we are replacing. */
    /* The draft is carried back in. A rejected address used to take the name
       typed beside it down with it, so the correction cost two fields. */
    '<input class="mc-in mc-wide" id="mcAddValues" type="' + esc(t.input) + '" placeholder="' +
      esc(t.placeholder) + '" value="' + esc(ui.draft.values) + '">' +
    '<div class="mc-eg">e.g. ' + esc(t.example) + '</div>' +
    '<div class="mc-edit-btns">' +
      '<button class="mc-save" data-act="commit-add">Save</button>' +
      '<button class="mc-cancel" data-act="cancel-add">Cancel</button>' +
    '</div></div>';
}

/* Signals is the whole language the board speaks about a threshold, in the
   order it speaks it. Two settings for APPROACHING and nothing for ARRIVED was
   an asymmetry in the model, not just a missing input — the board warned about
   a moment it then had nothing to say about.

       approaching   within N%   slow pulse
       imminent      within N%   fast pulse
       breached      crossed     turns red
       critical      held N ticks red, sustained

   Pulsing is the warning; red is the arrival. Critical is red that has stayed,
   which is why "Critical when held" is a threshold RULE and this is only its
   visual consequence.

   Cadence lives here too. It is not about WHO is contacted — that is the
   address book — it is about how the system paces itself, which is what every
   other row on this view describes. */
function signalsBlock(ch){
  var s = ch.getSettings();
  return '<div class="cfg-sec-hd">Threshold Signals</div>' +
    '<div class="mc-note">How the board reads as a result nears a threshold and ' +
      'then crosses it. Set once for the whole workspace \u2014 a fast pulse must ' +
      'mean the same thing on every result, or it means nothing.</div>' +
    '<div class="sg-ladder">' +
      sgRow('Approaching', 'slow pulse', 'proxWarning', s.proxWarning * 100, '% of threshold', 'sg-warn') +
      sgRow('Imminent', 'fast pulse', 'proxUrgent', s.proxUrgent * 100, '% of threshold', 'sg-urg') +
      sgStatic('Breached', 'turns red', 'the threshold is crossed', 'sg-red') +
      sgRow('Critical', 'red, sustained', 'sustainedTicks', s.sustainedTicks, 'ticks held', 'sg-crit') +
    '</div>' +
    (ui.error ? '<div class="mc-err">' + esc(ui.error) + '</div>' : '') +
    '<div class="cfg-sec-hd" style="margin-top:22px">Cadence</div>' +
    '<div class="mc-set"><label>Default cooldown</label>' +
      '<input class="mc-in mc-num" data-set="cooldownMs" value="' + (s.cooldownMs / 1000) +
      '"><span>s &middot; a KBR may override</span></div>' +
    '<div class="mc-note" style="margin-top:6px">How long a fired condition waits ' +
      'before it may fire again.</div>';
}
function sgRow(name, behaviour, key, value, suffix, cls){
  return '<div class="sg-row"><span class="sg-dot ' + cls + '"></span>' +
    '<div class="sg-name">' + esc(name) + '<span class="sg-beh">' + esc(behaviour) + '</span></div>' +
    '<input class="mc-in mc-num" data-set="' + key + '" value="' + esc(value) + '">' +
    '<span class="sg-suf">' + esc(suffix) + '</span></div>';
}
function sgStatic(name, behaviour, note, cls){
  return '<div class="sg-row"><span class="sg-dot ' + cls + '"></span>' +
    '<div class="sg-name">' + esc(name) + '<span class="sg-beh">' + esc(behaviour) + '</span></div>' +
    '<span class="sg-suf sg-static">' + esc(note) + '</span></div>';
}

/* ── delegated wiring · nothing is evaluated from a string ──────────────── */

function wire(box){
  box.querySelectorAll('[data-act]').forEach(function(el){
    el.addEventListener('click', function(ev){
      ev.preventDefault(); ev.stopPropagation();
      act(el.getAttribute('data-act'), el.getAttribute('data-ch'));
    });
  });
  var typeSel = box.querySelector('#mcAddType');
  if(typeSel) typeSel.addEventListener('change', function(){
    captureDraft(); ui.addType = typeSel.value; ui.error = ''; renderChannelRegistry();
  });
  box.querySelectorAll('[data-set]').forEach(function(el){
    el.addEventListener('change', function(){
      var ch = C(), key = el.getAttribute('data-set');
      var v = parseFloat(el.value);
      if(key === 'proxWarning' || key === 'proxUrgent') v = v / 100;
      if(key === 'cooldownMs') v = v * 1000;
      var r = ch.setSetting(key, v);
      ui.error = r.ok ? '' : r.reason;
      renderChannelRegistry();
    });
  });
}

function act(what, id){
  var ch = C(); if(!ch) return;
  ui.error = '';
  if(what === 'view-channels'){ ui.view = 'channels'; }
  else if(what === 'view-signals'){ ui.view = 'signals'; }
  else if(what === 'edit'){ ui.editing = id; ui.adding = false; }
  else if(what === 'cancel-edit'){ ui.editing = null; }
  else if(what === 'save-edit'){
    var l = document.getElementById('mcEditLabel'),
        v = document.getElementById('mcEditValues');
    var r = ch.update(id, l && l.value, v && v.value);
    if(r.ok) ui.editing = null; else ui.error = r.reason;
  }
  else if(what === 'open-add'){
    ui.adding = true; ui.editing = null; ui.draft = { label:'', values:'' };
  }
  else if(what === 'cancel-add'){ ui.adding = false; ui.draft = { label:'', values:'' }; }
  else if(what === 'commit-add'){
    captureDraft();
    var res = ch.add(ui.addType, ui.draft.label, ui.draft.values);
    if(res.ok){ ui.adding = false; ui.draft = { label:'', values:'' }; }
    else ui.error = res.reason;      /* the draft survives the rejection */
  }
  else if(what === 'remove'){
    /* Anything still pointing at this channel is reported rather than left
       to resolve into a blank recipient later. */
    var out = ch.remove(id, referencesTo);
    if(out.orphaned && out.orphaned.length)
      ui.error = 'Removed. ' + out.orphaned.length +
                 ' response(s) referenced it and now route nowhere.';
  }
  renderChannelRegistry();
}

/** Hold what is in the form so a re-render cannot swallow it. */
function captureDraft(){
  var lb = document.getElementById('mcAddLabel'),
      vv = document.getElementById('mcAddValues');
  if(lb) ui.draft.label = lb.value;
  if(vv) ui.draft.values = vv.value;
}

/** Every response, on every KBR, that names this channel. */
function referencesTo(id){
  var hits = [];
  try {
    KBRS.forEach(function(k){
      (k.riskConditions || []).forEach(function(c){
        (c.responses || []).forEach(function(r){
          if((r.channels || []).indexOf(id) >= 0)
            hits.push({ kbr:k.name, condition:c.label || c.id });
        });
      });
    });
  } catch(e){}
  return hits;
}
window.channelReferencesTo = referencesTo;

})();
