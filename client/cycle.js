// Shared helpers for menstrual-cycle tracking (athlete page cycle.html and staff page cycle-staff.html).
// Access is enforced by the database (11-cycle-tracking.sql). Never log or put health data in URLs.
(function () {
  var P = window.Portal, esc = P.esc;
  var PERIOD = { from: '2026-11-01', to: '2027-08-31' };
  var FLOW = [['spotting', 'Spotting'], ['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']];
  var AVAIL = [['full', 'Trained fully'], ['limited', 'Trained with limits'], ['absent', 'Did not train']];
  var REGULAR = [['regular', 'Regular'], ['irregular', 'Irregular'], ['unsure', 'Not sure']];
  var SCALES = [['mood', 'Mood'], ['energy', 'Energy'], ['sleep', 'Sleep quality'], ['fatigue', 'Fatigue']];
  var PHASE_NOTE = 'Estimated phase is a rough guide from your cycle day. It is not a medical assessment.';

  function label(list, v) { var o = list.find(function (x) { return x[0] === v; }); return o ? o[1] : (v == null ? '' : v); }
  function maxDay() { var t = P.today(); return t < PERIOD.to ? t : PERIOD.to; }
  function select(name, list, v, blank) {
    return '<select name="' + name + '"><option value="">' + (blank || '—') + '</option>' + list.map(function (o) {
      return '<option value="' + o[0] + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push([i, String(i)]); return r; }
  function num(v) { return v === '' || v == null ? null : +v; }
  function txt(v) { v = (v || '').trim(); return v || null; }

  // ---------- daily log (Journal quotidien) ----------
  function dailyFields(d) {
    d = d || {};
    return '<h3>Period</h3>' +
      '<label>Bleeding today?' + select('menstruation', [['yes', 'Yes'], ['no', 'No']], d.menstruation == null ? '' : d.menstruation ? 'yes' : 'no') + '</label>' +
      '<label>Flow (if bleeding)' + select('flow', FLOW, d.flow) + '</label>' +
      '<label>Pain (0 none – 10 worst)' + select('pain', range(0, 10), d.pain) + '</label>' +
      '<h3>How you feel (1 low – 7 high)</h3>' +
      SCALES.map(function (s) { return '<label>' + s[1] + select(s[0], range(1, 7), d[s[0]]) + '</label>'; }).join('') +
      '<label>Main symptom (optional)<input name="main_symptom" maxlength="80" value="' + esc(d.main_symptom) + '" placeholder="e.g. cramps, headache"></label>' +
      '<label>Medication taken (optional)<input name="medication" maxlength="120" value="' + esc(d.medication) + '"></label>' +
      '<h3>Training</h3>' +
      '<label>Session RPE (0–10)' + select('rpe', range(0, 10), d.rpe) + '</label>' +
      '<label>Duration (minutes)<input name="duration_min" type="number" min="0" max="600" inputmode="numeric" value="' + esc(d.duration_min) + '"></label>' +
      '<label>Training today' + select('availability', AVAIL, d.availability) + '</label>' +
      '<label class="wide">Comment (optional)<input name="comment" maxlength="500" value="' + esc(d.comment) + '"></label>';
  }
  function readDaily(f) {
    var m = f.elements.menstruation.value, row = {
      menstruation: m === '' ? null : m === 'yes', flow: txt(f.elements.flow.value), pain: num(f.elements.pain.value),
      main_symptom: txt(f.elements.main_symptom.value), medication: txt(f.elements.medication.value),
      rpe: num(f.elements.rpe.value), duration_min: num(f.elements.duration_min.value),
      availability: txt(f.elements.availability.value), comment: txt(f.elements.comment.value)
    };
    SCALES.forEach(function (s) { row[s[0]] = num(f.elements[s[0]].value); });
    if (row.menstruation === false) row.flow = null;
    return row;
  }

  // ---------- one-time profile (Profil initial) ----------
  function age(dob, ref) {
    if (!dob) return null;
    var b = new Date(dob + 'T00:00:00'), r = new Date((ref || P.today()) + 'T00:00:00');
    var a = r.getFullYear() - b.getFullYear();
    if (r.getMonth() < b.getMonth() || (r.getMonth() === b.getMonth() && r.getDate() < b.getDate())) a--;
    return a;
  }
  function bmi(h, w) { return h && w ? Math.round(w / Math.pow(h / 100, 2) * 10) / 10 : null; }
  function profileFields(p) {
    p = p || {};
    return '<label>Date of birth<input name="date_of_birth" type="date" min="2005-01-01" max="2020-12-31" value="' + esc(p.date_of_birth) + '"></label>' +
      '<label>Have you had your first period?' + select('menarche', [['yes', 'Yes'], ['no', 'Not yet']], p.menarche) + '</label>' +
      '<label>Age at first period<input name="menarche_age" type="number" min="8" max="18" step="0.5" value="' + esc(p.menarche_age) + '"></label>' +
      '<label>Are your cycles usually…' + select('regularity', REGULAR, p.regularity) + '</label>' +
      '<label>Usual cycle length (days)<input name="usual_cycle_days" type="number" min="15" max="60" value="' + esc(p.usual_cycle_days) + '"></label>' +
      '<label>Usual period length (days)<input name="usual_period_days" type="number" min="1" max="15" value="' + esc(p.usual_period_days) + '"></label>' +
      '<label>Height (cm)<input name="height_cm" type="number" min="100" max="230" step="0.1" value="' + esc(p.height_cm) + '"></label>' +
      '<label>Weight (kg)<input name="weight_kg" type="number" min="25" max="150" step="0.1" value="' + esc(p.weight_kg) + '"></label>' +
      '<label class="wide">Contraception or hormonal treatment (optional)<input name="contraception" maxlength="200" value="' + esc(p.contraception) + '"></label>' +
      '<label class="wide">Relevant medical history (optional)<textarea name="medical_history" rows="3" maxlength="1000">' + esc(p.medical_history) + '</textarea></label>';
  }
  function readProfile(f) {
    var e = f.elements;
    return { date_of_birth: e.date_of_birth.value || null, menarche: txt(e.menarche.value), menarche_age: num(e.menarche_age.value),
      regularity: txt(e.regularity.value), usual_cycle_days: num(e.usual_cycle_days.value), usual_period_days: num(e.usual_period_days.value),
      height_cm: num(e.height_cm.value), weight_kg: num(e.weight_kg.value), contraception: txt(e.contraception.value), medical_history: txt(e.medical_history.value) };
  }

  // ---------- cycle form ----------
  function cycleFields(c) {
    c = c || {};
    return '<label>First day of bleeding (Cycle Day 1)<input name="start_date" type="date" required min="2026-09-01" max="' + maxDay() + '" value="' + esc(c.start_date) + '"></label>' +
      '<label>Last day of bleeding (add later if you don\'t know yet)<input name="period_end" type="date" min="2026-09-01" max="' + maxDay() + '" value="' + esc(c.period_end) + '"></label>' +
      '<label class="wide">Comment (optional)<input name="comment" maxlength="500" value="' + esc(c.comment) + '"></label>';
  }
  function readCycle(f) {
    var s = f.elements.start_date.value, e = f.elements.period_end.value || null;
    if (!s) throw new Error('Please choose the first day of bleeding.');
    if (s > P.today()) throw new Error('The first day cannot be in the future.');
    if (e && (e < s || P.addDays(s, 14) < e)) throw new Error('The last day must be on or after the first day, within 15 days.');
    return { start_date: s, period_end: e, comment: txt(f.elements.comment.value) };
  }
  function cycleTable(rows) {
    if (!rows.length) return '<p class="empty">No cycles yet.</p>';
    return '<div class="table-wrap"><table><thead><tr><th>Cycle</th><th>Start</th><th>Next start</th><th>Length (days)</th><th>Period (days)</th><th>Max pain</th><th>Status</th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr><td>' + (c.who ? esc(c.who) + ' · ' : '') + 'Cycle ' + c.cycle_number + '</td><td>' + esc(P.fmtDate(c.start_date)) + '</td><td>' + esc(P.fmtDate(c.next_start)) +
          '</td><td class="num">' + esc(c.cycle_length) + (c.alert ? ' <span class="flag warn">' + esc(c.alert) + '</span>' : '') + '</td><td class="num">' + esc(c.period_days) +
          '</td><td class="num">' + esc(c.max_pain) + '</td><td>' + esc(c.status) + (c.edit ? ' <button type="button" class="link-btn" data-edit-cycle="' + c.id + '">Edit</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------- summaries ----------
  function avg(list, k) {
    var v = list.map(function (r) { return r[k]; }).filter(function (x) { return x != null; });
    return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 10) / 10 : null;
  }
  function pctOf(list, fn) { return list.length ? Math.round(list.filter(fn).length / list.length * 100) : null; }
  // Synthèse mensuelle, from daily rows (cycle_daily_view).
  function monthly(rows) {
    var by = {};
    rows.forEach(function (r) { var m = r.log_date.slice(0, 7); (by[m] = by[m] || []).push(r); });
    return Object.keys(by).sort().map(function (m) {
      var l = by[m];
      return { month: m, days: l.length, pct_menstruation: pctOf(l, function (r) { return r.menstruation; }),
        pain: avg(l, 'pain'), fatigue: avg(l, 'fatigue'), energy: avg(l, 'energy'), sleep: avg(l, 'sleep'),
        load: avg(l, 'session_load'), pct_symptoms: pctOf(l, function (r) { return !!r.main_symptom; }) };
    });
  }
  function monthLabel(m) { return P.fmtDate(m + '-01', { month: 'short', year: 'numeric' }); }
  function monthlyTable(rows) {
    var m = monthly(rows);
    if (!m.length) return '<p class="empty">No days logged in this period.</p>';
    return '<div class="table-wrap"><table><thead><tr><th>Month</th><th>Days logged</th><th>% days bleeding</th><th>Avg pain</th><th>Avg fatigue</th><th>Avg energy</th><th>Avg sleep</th><th>Avg load (AU)</th><th>% days with symptoms</th></tr></thead><tbody>' +
      m.map(function (r) {
        return '<tr><td>' + esc(monthLabel(r.month)) + '</td><td class="num">' + r.days + '</td><td class="num">' + esc(r.pct_menstruation) + '%</td><td class="num">' + esc(r.pain) +
          '</td><td class="num">' + esc(r.fatigue) + '</td><td class="num">' + esc(r.energy) + '</td><td class="num">' + esc(r.sleep) + '</td><td class="num">' + esc(r.load) + '</td><td class="num">' + esc(r.pct_symptoms) + '%</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function dailyTable(rows, who) {
    if (!rows.length) return '<p class="empty">No days logged yet.</p>';
    return '<div class="table-wrap"><table><thead><tr>' + (who ? '<th>Athlete</th>' : '') + '<th>Date</th><th>Cycle</th><th>Day</th><th>Estimated phase</th><th>Bleeding</th><th>Pain</th><th>Load (AU)</th><th>Training</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + (who ? '<td>' + esc(who(r)) + '</td>' : '') + '<td>' + esc(P.fmtDate(r.log_date, { weekday: 'short', day: 'numeric', month: 'short' })) + '</td><td class="num">' + esc(r.cycle_number) +
          '</td><td class="num">' + esc(r.cycle_day) + '</td><td>' + esc(r.estimated_phase ? r.estimated_phase + ' (est.)' : '') + '</td><td>' + (r.menstruation == null ? '' : r.menstruation ? 'Yes' + (r.flow ? ' · ' + esc(label(FLOW, r.flow)) : '') : 'No') +
          '</td><td class="num">' + esc(r.pain) + '</td><td class="num">' + esc(r.session_load) + '</td><td>' + esc(label(AVAIL, r.availability)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------- CSV export (opens in Excel; columns follow the workbook sheets) ----------
  function csv(cols, rows) {
    function cell(v) { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    return '﻿' + [cols.map(function (c) { return cell(c[0]); }).join(',')].concat(rows.map(function (r) {
      return cols.map(function (c) { return cell(typeof c[1] === 'function' ? c[1](r) : r[c[1]]); }).join(',');
    })).join('\r\n');
  }
  function download(name, text) {
    var a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  // Friendly message for database errors, without echoing any data.
  function errText(err, fallback) {
    if (err && err.code === '23505') return 'This date is already saved.';
    if (err && err.code === '42501') return 'You do not have permission to save this. Consent may be missing.';
    if (err && /future/.test(err.message || '')) return 'The date cannot be in the future.';
    return fallback || 'Could not save. Please check your connection and try again.';
  }

  window.Cycle = { PERIOD: PERIOD, FLOW: FLOW, AVAIL: AVAIL, REGULAR: REGULAR, SCALES: SCALES, PHASE_NOTE: PHASE_NOTE, label: label, maxDay: maxDay,
    dailyFields: dailyFields, readDaily: readDaily, profileFields: profileFields, readProfile: readProfile, age: age, bmi: bmi,
    cycleFields: cycleFields, readCycle: readCycle, cycleTable: cycleTable, monthly: monthly, monthLabel: monthLabel, monthlyTable: monthlyTable,
    dailyTable: dailyTable, csv: csv, download: download, errText: errText };
})();
