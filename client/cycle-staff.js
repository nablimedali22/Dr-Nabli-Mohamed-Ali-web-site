// Staff page: consent, review, summaries and CSV export for cycle-tracking teams.
// The database only returns athletes of teams with cycle_tracking = true (RLS + cycle_staff_can).
(async function () {
  var P = Portal, C = Cycle, esc = P.esc, sb = P.sb, root = P.$('#cycle-root');
  try { await P.requireUser('coach'); } catch (e) { return; }

  var athletes = [], consents = {}, profiles = {}, cycles = [], days = [];
  var f = { athlete: '', from: C.PERIOD.from, to: C.PERIOD.to };

  function code(id) { var c = consents[id]; return c && c.anon_code ? c.anon_code : '—'; }
  function name(id) { var a = athletes.find(function (x) { return x.id === id; }); return a ? (a.full_name || a.email) : ''; }
  function who(id) { return name(id) + (consents[id] && consents[id].anon_code ? ' (' + consents[id].anon_code + ')' : ''); }

  async function loadAthletes() {
    var teams = P.must(await sb.from('teams').select('id,name,club').eq('cycle_tracking', true));
    if (!teams.length) return teams;
    var mem = P.must(await sb.from('team_members').select('client_id').in('team_id', teams.map(function (t) { return t.id; })));
    var ids = Array.from(new Set(mem.map(function (m) { return m.client_id; })));
    athletes = ids.length ? P.must(await sb.from('profiles').select('id,full_name,email').in('id', ids).order('full_name')) : [];
    var r = await Promise.all([sb.from('cycle_consents').select('*'), sb.from('cycle_profiles').select('*')]);
    consents = {}; profiles = {};
    P.must(r[0]).forEach(function (c) { consents[c.athlete_id] = c; });
    P.must(r[1]).forEach(function (p) { profiles[p.athlete_id] = p; });
    return teams;
  }
  async function loadRecords() {
    var qc = sb.from('cycle_summary_view').select('*').gte('start_date', f.from).lte('start_date', f.to).order('start_date');
    var qd = sb.from('cycle_daily_view').select('*').gte('log_date', f.from).lte('log_date', f.to).order('log_date');
    if (f.athlete) { qc = qc.eq('athlete_id', f.athlete); qd = qd.eq('athlete_id', f.athlete); }
    var r = await Promise.all([qc, qd]);
    cycles = P.must(r[0]); days = P.must(r[1]);
  }

  var teams;
  try { teams = await loadAthletes(); } catch (e) { root.innerHTML = '<p class="status error">Cycle tracking could not be loaded. Has 11-cycle-tracking.sql been run in Supabase?</p>'; return; }
  if (!teams.length) { root.innerHTML = '<p class="lede">No team has cycle tracking switched on. Run 11-cycle-tracking.sql, or check the team name in the Team dashboard.</p>'; return; }

  root.innerHTML = '<p class="muted">Team: ' + esc(teams.map(function (t) { return (t.club ? t.club + ' · ' : '') + t.name; }).join(', ')) + '. Exports use the anonymous ID, never the name.</p>' +
    '<div id="consent-area"></div><div id="review-area" style="margin-top:2rem"></div>';

  // ---------- consent ----------
  function drawConsent() {
    var el = P.$('#consent-area');
    el.innerHTML = '<h2>Athletes and consent</h2><p class="muted">Record consent only once the signed form (athlete and parent or guardian) is filed. Until then the athlete cannot save anything.</p>' +
      (athletes.length ? '<div class="table-wrap"><table><thead><tr><th>Athlete</th><th>Anonymous ID</th><th>Consent filed on</th><th></th></tr></thead><tbody>' +
        athletes.map(function (a) {
          var c = consents[a.id] || {};
          return '<tr><td>' + esc(a.full_name || a.email) + '</td><td><input aria-label="Anonymous ID for ' + esc(a.full_name || a.email) + '" data-code="' + a.id + '" maxlength="20" pattern="[A-Za-z0-9-]{1,20}" placeholder="F-G1-01" value="' + esc(c.anon_code) + '" class="plain-input"></td>' +
            '<td><input type="date" aria-label="Consent date for ' + esc(a.full_name || a.email) + '" data-date="' + a.id + '" max="' + P.today() + '" value="' + esc(c.consent_on) + '" class="plain-input"></td>' +
            '<td><button type="button" class="btn btn-line btn-small" data-save="' + a.id + '">Save</button> <span class="status" role="status" data-st="' + a.id + '"></span></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="empty">No athletes in the team yet. Add them in the Team dashboard.</p>');
    P.$$('[data-save]', el).forEach(function (b) {
      b.addEventListener('click', async function () {
        var id = b.getAttribute('data-save'), s = P.$('[data-st="' + id + '"]', el);
        var cd = P.$('[data-code="' + id + '"]', el), dt = P.$('[data-date="' + id + '"]', el);
        if (!dt.value) return P.say(s, 'Choose the date the consent form was filed.', true);
        if (cd.value && !cd.checkValidity()) return P.say(s, 'ID: letters, numbers and - only.', true);
        P.say(s, 'Saving…');
        var r = await sb.from('cycle_consents').upsert({ athlete_id: id, anon_code: cd.value.trim() || null, consent_on: dt.value }, { onConflict: 'athlete_id' }).select().single();
        if (r.error) return P.say(s, r.error.code === '23505' ? 'This ID is already used.' : C.errText(r.error), true);
        consents[id] = r.data; P.say(s, 'Saved');
        drawReview();
      });
    });
  }

  // ---------- review ----------
  function teamMonthly() {
    var m = C.monthly(days), ath = {};
    days.forEach(function (d) { var k = d.log_date.slice(0, 7); (ath[k] = ath[k] || {})[d.athlete_id] = 1; });
    return m.map(function (r) { r.athletes = Object.keys(ath[r.month] || {}).length; return r; });
  }
  function drawReview() {
    var el = P.$('#review-area'), one = f.athlete, p = one ? profiles[one] || {} : null;
    el.innerHTML = '<h2>Review</h2><form id="flt" class="filters"><label>Athlete<select name="athlete"><option value="">All athletes (team)</option>' +
      athletes.map(function (a) { return '<option value="' + a.id + '"' + (a.id === f.athlete ? ' selected' : '') + '>' + esc(who(a.id)) + '</option>'; }).join('') + '</select></label>' +
      '<label>From<input type="date" name="from" min="2026-09-01" max="' + C.PERIOD.to + '" value="' + f.from + '"></label><label>To<input type="date" name="to" min="2026-09-01" max="' + C.PERIOD.to + '" value="' + f.to + '"></label>' +
      '<button class="btn btn-solid btn-small" type="submit">Show</button> <span class="status" role="status"></span></form>' +
      '<p class="muted">Export (CSV, opens in Excel):</p><div class="row" style="justify-content:flex-start;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem">' +
      '<button type="button" class="btn btn-line btn-small" data-x="profile">Profil initial</button><button type="button" class="btn btn-line btn-small" data-x="daily">Journal quotidien</button>' +
      '<button type="button" class="btn btn-line btn-small" data-x="cycles">Résumé par cycle</button><button type="button" class="btn btn-line btn-small" data-x="monthly">Synthèse mensuelle</button></div>' +
      (p ? '<h3>Profile</h3>' + (p.athlete_id ? '<p>Age ' + esc(C.age(p.date_of_birth)) + ' · BMI ' + esc(C.bmi(p.height_cm, p.weight_kg)) + ' · Usual cycle ' + esc(p.usual_cycle_days) + ' d · Usual period ' + esc(p.usual_period_days) + ' d · ' + esc(C.label(C.REGULAR, p.regularity)) +
        (p.contraception ? ' · Contraception/treatment: ' + esc(p.contraception) : '') + (p.medical_history ? '<br>Medical history: ' + esc(p.medical_history) : '') + '</p>' : '<p class="empty">Profile not filled in yet.</p>') : '') +
      '<h3>Cycles</h3>' + C.cycleTable(cycles.map(function (c) { return one ? c : Object.assign({ who: code(c.athlete_id) !== '—' ? code(c.athlete_id) : name(c.athlete_id) }, c); })) +
      '<h3>' + (one ? 'Monthly summary' : 'Team monthly summary') + '</h3>' + C.monthlyTable(days) +
      (!one && days.length ? '<p class="muted">Athletes logging each month: ' + teamMonthly().map(function (r) { return esc(C.monthLabel(r.month)) + ' ' + r.athletes; }).join(' · ') + '</p>' : '') +
      '<h3>Daily log</h3>' + C.dailyTable(days.slice().reverse(), one ? null : function (r) { return code(r.athlete_id) !== '—' ? code(r.athlete_id) : name(r.athlete_id); }) +
      (one ? '<h3>Add or correct a day for this athlete</h3>' + (consents[one] ? '<form id="sdf" class="inline-form" novalidate><label>Date<input name="log_date" type="date" required min="' + C.PERIOD.from + '" max="' + C.maxDay() + '"></label>' +
        C.dailyFields({}) + '<div class="wide row"><button class="btn btn-solid btn-small" type="submit">Save day</button> <span class="status" role="status"></span></div></form>' : '<p class="empty">Record consent first.</p>') : '') +
      '<p class="muted" style="margin-top:1rem">' + esc(C.PHASE_NOTE) + '</p>';

    var flt = P.$('#flt', el);
    flt.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (flt.elements.from.value > flt.elements.to.value) return P.say(P.$('.status', flt), '“From” must be before “To”.', true);
      f = { athlete: flt.elements.athlete.value, from: flt.elements.from.value || C.PERIOD.from, to: flt.elements.to.value || C.PERIOD.to };
      P.say(P.$('.status', flt), 'Loading…');
      try { await loadRecords(); } catch (err) { return P.say(P.$('.status', flt), 'Records could not be loaded.', true); }
      drawReview();
    });
    P.$$('[data-x]', el).forEach(function (b) { b.addEventListener('click', function () { exportCsv(b.getAttribute('data-x')); }); });

    var sdf = P.$('#sdf', el);
    if (sdf) {
      sdf.elements.log_date.addEventListener('change', function () {
        var d = days.find(function (x) { return x.athlete_id === one && x.log_date === sdf.elements.log_date.value; }) || {}, v = sdf.elements.log_date.value;
        var tmp = document.createElement('div'); tmp.innerHTML = C.dailyFields(d);
        P.$$('select,input', tmp).forEach(function (n) { var t = sdf.elements[n.name]; if (t) t.value = n.value; });
        sdf.elements.log_date.value = v;
      });
      sdf.addEventListener('submit', async function (e) {
        e.preventDefault();
        var s = P.$('.status', sdf), day = sdf.elements.log_date.value;
        if (!day || day < C.PERIOD.from || day > C.maxDay()) return P.say(s, 'Choose a date between 1 Nov 2026 and today.', true);
        P.say(s, 'Saving…');
        var r = await sb.from('cycle_daily_logs').upsert(Object.assign({ athlete_id: one, log_date: day }, C.readDaily(sdf)), { onConflict: 'athlete_id,log_date' });
        if (r.error) return P.say(s, C.errText(r.error), true);
        try { await loadRecords(); } catch (err) { return P.say(s, 'Saved, but the list could not be refreshed.', true); }
        drawReview(); P.say(P.$('#flt .status'), 'Day saved.');
      });
    }
  }

  // ---------- CSV export (anonymous ID only) ----------
  function yn(v) { return v == null ? '' : v ? 'Oui' : 'Non'; }
  function exportCsv(kind) {
    var tag = (f.athlete ? code(f.athlete) : 'equipe') + '_' + f.from + '_' + f.to, out;
    if (kind === 'profile') {
      var list = (f.athlete ? [f.athlete] : athletes.map(function (a) { return a.id; })).map(function (id) { return Object.assign({ athlete_id: id }, profiles[id] || {}); });
      out = C.csv([['ID', function (r) { return code(r.athlete_id); }], ['Date de naissance', 'date_of_birth'], ['Âge', function (r) { return C.age(r.date_of_birth); }],
        ['Ménarche', function (r) { return r.menarche === 'yes' ? 'Oui' : r.menarche === 'no' ? 'Non' : ''; }], ['Âge ménarche', 'menarche_age'], ['Régularité', function (r) { return C.label(C.REGULAR, r.regularity); }],
        ['Durée habituelle du cycle (j)', 'usual_cycle_days'], ['Durée habituelle des règles (j)', 'usual_period_days'], ['Contraception / traitement hormonal', 'contraception'],
        ['Antécédents médicaux', 'medical_history'], ['Taille (cm)', 'height_cm'], ['Poids (kg)', 'weight_kg'], ['IMC', function (r) { return C.bmi(r.height_cm, r.weight_kg); }],
        ['Consentement archivé', function (r) { return consents[r.athlete_id] ? 'Oui (' + consents[r.athlete_id].consent_on + ')' : 'Non'; }]], list);
    } else if (kind === 'daily') {
      out = C.csv([['ID', function (r) { return code(r.athlete_id); }], ['Date', 'log_date'], ['Menstruation', function (r) { return yn(r.menstruation); }], ['Jour du cycle', 'cycle_day'],
        ['Phase estimée', 'estimated_phase'], ['Flux', function (r) { return C.label(C.FLOW, r.flow); }], ['Douleur (0-10)', 'pain'], ['Humeur (1-7)', 'mood'], ['Énergie (1-7)', 'energy'],
        ['Sommeil (1-7)', 'sleep'], ['Fatigue (1-7)', 'fatigue'], ['Symptôme principal', 'main_symptom'], ['Médicament pris', 'medication'], ['RPE (0-10)', 'rpe'],
        ['Durée séance (min)', 'duration_min'], ['Charge séance (UA)', 'session_load'], ['Présence / disponibilité', function (r) { return C.label(C.AVAIL, r.availability); }],
        ['Commentaire', 'comment'], ['N° cycle', 'cycle_number']], days);
    } else if (kind === 'cycles') {
      out = C.csv([['ID', function (r) { return code(r.athlete_id); }], ['N° cycle', 'cycle_number'], ['Début du cycle', 'start_date'], ['Début cycle suivant', 'next_start'],
        ['Durée du cycle (j)', 'cycle_length'], ['Durée des règles (j)', 'period_days'], ['Douleur max', 'max_pain'], ['Alerte (<21 ou >35 j)', 'alert'], ['Statut', 'status']], cycles);
    } else {
      var rows = [], ids = f.athlete ? [f.athlete] : Array.from(new Set(days.map(function (d) { return d.athlete_id; })));
      ids.forEach(function (id) { C.monthly(days.filter(function (d) { return d.athlete_id === id; })).forEach(function (m) { rows.push(Object.assign({ id: code(id) }, m)); }); });
      if (!f.athlete) C.monthly(days).forEach(function (m) { rows.push(Object.assign({ id: 'ÉQUIPE' }, m)); });
      out = C.csv([['ID', 'id'], ['Mois', 'month'], ['Jours renseignés', 'days'], ['% jours avec menstruation', 'pct_menstruation'], ['Douleur moyenne', 'pain'], ['Fatigue moyenne', 'fatigue'],
        ['Énergie moyenne', 'energy'], ['Sommeil moyen', 'sleep'], ['Charge moyenne (UA)', 'load'], ['% jours avec symptômes', 'pct_symptoms']], rows);
    }
    C.download('cycle_' + kind + '_' + tag + '.csv', out);
  }

  drawConsent();
  try { await loadRecords(); } catch (e) { P.$('#review-area').innerHTML = '<p class="status error">Records could not be loaded. Please refresh the page.</p>'; return; }
  drawReview();
})();
