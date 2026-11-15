// Athlete page: her own cycles, daily log and profile. The database returns only her rows (RLS).
(async function () {
  var P = Portal, C = Cycle, esc = P.esc, sb = P.sb, me, uid, data = {}, root = P.$('#cycle-root');
  try { me = await P.requireUser('client'); } catch (e) { return; }
  uid = me.user.id;

  var st = await sb.rpc('cycle_status');
  if (st.error) { root.innerHTML = '<p class="status error">Cycle tracking is not available right now. Please try again later.</p>'; return; }
  if (!st.data.eligible) { root.innerHTML = '<p class="lede">This section is only open to athletes of the U16 Fille BB national team.</p>'; return; }
  if (!st.data.consent) {
    root.innerHTML = '<div class="card"><span class="k">Consent needed first</span><p>Before you can use cycle tracking, your coach needs to receive and file the signed consent form (from you and your parent or guardian). Please speak to your coach. Nothing has been saved.</p></div>';
    return;
  }

  async function load() {
    var r = await Promise.all([
      sb.from('cycle_summary_view').select('*').eq('athlete_id', uid).order('start_date', { ascending: false }),
      sb.from('cycle_daily_view').select('*').eq('athlete_id', uid).order('log_date', { ascending: false }),
      sb.from('cycle_profiles').select('*').eq('athlete_id', uid).maybeSingle()
    ]);
    r.forEach(function (x) { if (x.error) throw x.error; });
    data = { cycles: r[0].data, days: r[1].data, profile: r[2].data || {} };
  }

  root.innerHTML = '<p class="muted">Only you and your coach can see what you save here.</p>' +
    '<div class="tabs" role="tablist" aria-label="Cycle tracking" style="margin-top:1rem"><button type="button" role="tab" data-tab="cycles">My cycles</button><button type="button" role="tab" data-tab="today">Daily log</button><button type="button" role="tab" data-tab="summary">Summary</button><button type="button" role="tab" data-tab="profile">About me</button></div>' +
    '<div class="panel" id="tab-cycles" role="tabpanel" hidden></div><div class="panel" id="tab-today" role="tabpanel" hidden></div><div class="panel" id="tab-summary" role="tabpanel" hidden></div><div class="panel" id="tab-profile" role="tabpanel" hidden></div>';

  var editing = null, dayPick = C.maxDay();
  function refreshFailed(s) { P.say(s, 'Saved, but the page could not be refreshed. Please reload it.', true); }
  var render = {
    cycles: function (el, msg) {
      var c = editing ? data.cycles.find(function (x) { return x.id === editing; }) : null;
      el.innerHTML = '<h2>' + (c ? 'Edit cycle ' + c.cycle_number : 'Record a new cycle') + '</h2>' +
        '<p class="muted">A new cycle starts on the first day of your period (bleeding). That day is Cycle Day 1. It can be any date.</p>' +
        '<form id="cf" class="inline-form" novalidate>' + C.cycleFields(c) +
        '<div class="wide row"><span><button class="btn btn-solid btn-small" type="submit">' + (c ? 'Save changes' : 'Save cycle') + '</button>' +
        (c ? ' <button class="btn btn-line btn-small" type="button" id="cancel">Cancel</button>' : '') + '</span> <span class="status" role="status"></span></div></form>' +
        '<h3>My cycles</h3>' + C.cycleTable(data.cycles.map(function (x) { return Object.assign({ edit: true }, x); }));
      var f = P.$('#cf', el), s = P.$('.status', f);
      if (msg) P.say(s, msg);
      if (c) P.$('#cancel', el).addEventListener('click', function () { editing = null; render.cycles(el); });
      P.$$('[data-edit-cycle]', el).forEach(function (b) {
        b.addEventListener('click', function () { editing = +b.getAttribute('data-edit-cycle'); render.cycles(el); P.$('#cf input', el).focus(); });
      });
      f.addEventListener('submit', async function (e) {
        e.preventDefault();
        var row; try { row = C.readCycle(f); } catch (err) { return P.say(s, err.message, true); }
        P.say(s, 'Saving…');
        var r = c ? await sb.from('cycles').update(row).eq('id', c.id) : await sb.from('cycles').insert(Object.assign({ athlete_id: uid }, row));
        if (r.error) {
          var dup = r.error.code === '23505' && data.cycles.find(function (x) { return x.start_date === row.start_date; });
          if (dup) {
            P.say(s, 'You already saved a cycle that starts on ' + P.fmtDate(row.start_date) + ' (Cycle ' + dup.cycle_number + '). ', true);
            var b = document.createElement('button'); b.type = 'button'; b.className = 'link-btn'; b.textContent = 'Open it';
            b.addEventListener('click', function () { editing = dup.id; render.cycles(el); });
            s.appendChild(b); return;
          }
          return P.say(s, C.errText(r.error), true);
        }
        try { await load(); } catch (err) { return refreshFailed(s); }
        editing = null; render.cycles(el, c ? 'Changes saved.' : 'Cycle saved.');
      });
    },
    today: function (el, msg) {
      var d = data.days.find(function (x) { return x.log_date === dayPick; }) || {};
      el.innerHTML = '<h2>Daily log</h2><p class="muted">Fill in what you can. Every question is optional. ' + esc(C.PHASE_NOTE) + '</p>' +
        '<form id="df" class="inline-form" novalidate><label>Date<input name="log_date" type="date" required min="' + C.PERIOD.from + '" max="' + C.maxDay() + '" value="' + esc(dayPick) + '"></label>' +
        '<p class="muted" style="align-self:center;margin:0">' + (d.cycle_day ? 'Cycle ' + d.cycle_number + ', day ' + d.cycle_day + (d.estimated_phase ? ' · ' + esc(d.estimated_phase) + ' phase (estimate)' : '')
          : (data.cycles.length ? '' : 'Tip: record your cycle start first, so your cycle day is worked out for you.')) + '</p>' +
        C.dailyFields(d) + '<div class="wide row"><button class="btn btn-solid btn-small" type="submit">' + (d.id ? 'Update this day' : 'Save this day') + '</button> <span class="status" role="status"></span></div></form>' +
        '<h3>Recent days</h3>' + C.dailyTable(data.days.slice(0, 31));
      var f = P.$('#df', el), s = P.$('.status', f);
      if (msg) P.say(s, msg);
      f.elements.log_date.addEventListener('change', function () { if (f.elements.log_date.value) { dayPick = f.elements.log_date.value; render.today(el); } });
      f.addEventListener('submit', async function (e) {
        e.preventDefault();
        var day = f.elements.log_date.value;
        if (!day || day < C.PERIOD.from || day > C.maxDay()) return P.say(s, 'Please choose a date between 1 Nov 2026 and today.', true);
        if (!f.checkValidity()) return P.say(s, 'Please check the highlighted values.', true);
        P.say(s, 'Saving…');
        var r = await sb.from('cycle_daily_logs').upsert(Object.assign({ athlete_id: uid, log_date: day }, C.readDaily(f)), { onConflict: 'athlete_id,log_date' });
        if (r.error) return P.say(s, C.errText(r.error), true);
        try { await load(); } catch (err) { return refreshFailed(s); }
        render.today(el, 'Day saved.');
      });
    },
    summary: function (el) {
      el.innerHTML = '<h2>Monthly summary</h2>' + C.monthlyTable(data.days) +
        '<p class="muted" style="margin-top:1rem">A cycle shorter than 21 days or longer than 35 days is flagged so you can talk about it with your coach.</p>';
    },
    profile: function (el, msg) {
      var p = data.profile, a = C.age(p.date_of_birth), b = C.bmi(p.height_cm, p.weight_kg);
      el.innerHTML = '<h2>About me</h2><p class="muted">Filled in once at the start, and updated if something changes. All questions are optional.</p>' +
        (a != null || b != null ? '<p>' + (a != null ? 'Age: <strong>' + a + '</strong>' : '') + (a != null && b != null ? ' · ' : '') + (b != null ? 'BMI: <strong>' + b + '</strong>' : '') + '</p>' : '') +
        '<form id="pf" class="inline-form" novalidate>' + C.profileFields(p) + '<div class="wide row"><button class="btn btn-solid btn-small" type="submit">Save</button> <span class="status" role="status"></span></div></form>';
      var f = P.$('#pf', el), s = P.$('.status', f);
      if (msg) P.say(s, msg);
      f.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (!f.checkValidity()) return P.say(s, 'Please check the highlighted values.', true);
        P.say(s, 'Saving…');
        var r = await sb.from('cycle_profiles').upsert(Object.assign({ athlete_id: uid }, C.readProfile(f)), { onConflict: 'athlete_id' });
        if (r.error) return P.say(s, C.errText(r.error), true);
        try { await load(); } catch (err) { return refreshFailed(s); }
        render.profile(el, 'Saved.');
      });
    }
  };

  try { await load(); } catch (e) { root.innerHTML = '<p class="status error">Your records could not be loaded. Please refresh the page.</p>'; return; }
  P.tabs(function (name) { render[name](P.$('#tab-' + name)); });
})();
