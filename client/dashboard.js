// Private client dashboard. The database only returns this client's rows (RLS);
// the client_id filters below are for speed, not for security.
(async function () {
  var P = Portal, esc = P.esc, sb = P.sb, me, data = {};
  try { me = await P.requireUser('client'); } catch (e) { return; }
  var uid = me.user.id;
  P.$('#hello').textContent = 'Welcome, ' + ((me.profile.full_name || '').split(' ')[0] || 'athlete');

  async function load() {
    var q = function (t, sel, order, asc) { return sb.from(t).select(sel || '*').eq('client_id', uid).order(order, { ascending: !!asc }); };
    var r = await Promise.all([
      q('coaching_plans', '*', 'start_date'),
      q('training_sessions', '*, session_exercises(*)', 'session_date', true),
      q('assessments', '*', 'measured_on', true),
      q('coach_notes', '*', 'note_date'),
      q('documents', '*', 'created_at'),
      q('messages', '*', 'created_at', true),
      q('wellness_entries', '*', 'entry_date', true),
      q('srpe_entries', '*', 'session_date', true)
    ]);
    r.forEach(function (x) { if (x.error) throw x.error; });
    data = { plans: r[0].data, sessions: r[1].data, tests: r[2].data, notes: r[3].data, docs: r[4].data, msgs: r[5].data, wellness: r[6].data, srpe: r[7].data };
    data.sessions.forEach(function (s) { (s.session_exercises || []).sort(function (a, b) { return a.position - b.position; }); });
  }

  function empty(t) { return '<p class="empty">' + esc(t) + '</p>'; }
  function exerciseTable(ex) {
    if (!ex || !ex.length) return '';
    return '<div class="table-wrap"><table><thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Load</th><th>RPE</th><th>Rest</th><th>Notes</th></tr></thead><tbody>' +
      ex.map(function (e) {
        return '<tr><td>' + esc(e.name) + '</td><td class="num">' + esc(e.sets) + '</td><td class="num">' + esc(e.reps) + '</td><td>' + esc(e.load) +
          '</td><td class="num">' + esc(e.target_rpe) + '</td><td>' + esc(e.rest) + '</td><td>' + esc(e.notes) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function sessionCard(s) {
    return '<li id="s-' + s.id + '"><div class="row"><span class="date">' + esc(P.fmtDate(s.session_date, { weekday: 'short', day: 'numeric', month: 'short' })) + '</span>' +
      (s.completed ? '<span class="tag done">Done</span>' : '') + '</div>' +
      '<h3 style="margin:.25rem 0">' + esc(s.title) + '</h3>' + (s.focus ? '<p class="muted">' + esc(s.focus) + '</p>' : '') +
      (s.coach_notes ? '<p class="pre" style="margin-top:.5rem">' + esc(s.coach_notes) + '</p>' : '') +
      exerciseTable(s.session_exercises) +
      (s.pdf_path ? '<p style="margin-top:.75rem"><a href="#" data-file="' + esc(s.pdf_path) + '">Download the programme (PDF)</a></p>' : '') +
      '<form class="inline-form report" data-id="' + s.id + '" style="margin:1rem 0 0">' +
      '<label class="check"><input type="checkbox" name="completed"' + (s.completed ? ' checked' : '') + '> Session done</label>' +
      '<label>My RPE (1-10)<input name="rpe" type="number" min="1" max="10" value="' + esc(s.client_rpe) + '"></label>' +
      '<label class="wide">How did it go?<textarea name="feedback" rows="2">' + esc(s.client_feedback) + '</textarea></label>' +
      '<div><button class="btn btn-line btn-small" type="submit">Save</button> <span class="status" role="status"></span></div></form></li>';
  }
  function bindReports(root) {
    P.$$('form.report', root).forEach(function (f) {
      f.addEventListener('submit', async function (e) {
        e.preventDefault();
        var st = P.$('.status', f); P.say(st, 'Saving…');
        var rpe = f.rpe.value ? parseInt(f.rpe.value, 10) : null;
        var r = await sb.from('training_sessions').update({ completed: f.completed.checked, client_rpe: rpe, client_feedback: f.feedback.value || null }).eq('id', f.getAttribute('data-id'));
        if (r.error) { P.say(st, 'Could not save.', true); return; }
        var s = data.sessions.find(function (x) { return String(x.id) === f.getAttribute('data-id'); });
        if (s) { s.completed = f.completed.checked; s.client_rpe = rpe; s.client_feedback = f.feedback.value; }
        P.say(st, 'Saved');
      });
    });
    P.bindFileLinks(root);
  }

  var render = {
    overview: function (el) {
      var t = P.today();
      var next = data.sessions.filter(function (s) { return s.session_date >= t; });
      var todays = next.filter(function (s) { return s.session_date === t; });
      var unread = data.msgs.filter(function (m) { return m.sender_id !== uid && !m.read_at; }).length;
      var plan = data.plans.find(function (p) { return p.active; });
      var done = data.sessions.filter(function (s) { return s.completed; }).length;
      el.innerHTML = '<div class="cards">' +
        '<div class="card"><span class="k">Current plan</span><span class="v">' + esc(plan ? plan.title : '—') + '</span>' + (plan && plan.phase ? '<span class="muted">' + esc(plan.phase) + '</span>' : '') + '</div>' +
        '<div class="card"><span class="k">Next session</span><span class="v">' + esc(next[0] ? P.fmtDate(next[0].session_date, { weekday: 'short', day: 'numeric', month: 'short' }) : '—') + '</span>' + (next[0] ? '<span class="muted">' + esc(next[0].title) + '</span>' : '') + '</div>' +
        '<div class="card"><span class="k">Sessions done</span><span class="v">' + done + ' / ' + data.sessions.length + '</span></div>' +
        '<div class="card"><span class="k">Today\'s wellness</span>' + (function () {
          var w = data.wellness.find(function (e) { return e.entry_date === t; });
          return w ? '<span class="v">' + w.hooper + ' / 28</span><a href="#wellness">Update</a>' : '<span class="v">—</span><a href="#wellness">Log it now</a>';
        })() + '</div>' +
        '<div class="card"><span class="k">Training load, last 7 days</span><span class="v">' + P.loadMetrics(data.srpe).acute + ' AU</span><a href="#load">Log a session</a></div>' +
        '<div class="card"><span class="k">New messages</span><span class="v">' + unread + '</span>' + (unread ? '<a href="#messages">Read them</a>' : '') + '</div></div>' +
        '<h2 style="margin-top:2rem">Today</h2>' + (todays.length ? '<ul class="list">' + todays.map(sessionCard).join('') + '</ul>' : empty('No session planned for today. Rest well.'));
      bindReports(el);
    },
    wellness: function (el) {
      var t = P.today(), w = data.wellness.find(function (e) { return e.entry_date === t; }) || {};
      el.innerHTML = '<h2>Daily wellness</h2><p class="muted" style="margin-bottom:1.25rem">Hooper index. Rate each item from 0 (best) to 7 (worst), ideally every morning.</p>' +
        '<form id="wf" class="hooper">' + P.HOOPER.map(function (h) {
          var opts = '';
          for (var i = 0; i <= 7; i++) opts += '<label><input type="radio" name="' + h[0] + '" value="' + i + '" required' + (w[h[0]] === i ? ' checked' : '') + '><span>' + i + '</span></label>';
          return '<fieldset><legend>' + h[1] + '</legend><div class="scale">' + opts + '</div><div class="scale-ends"><span>0 best</span><span>7 worst</span></div></fieldset>';
        }).join('') +
        '<label class="muted" for="wc">Comment (optional)</label><input id="wc" name="comment" maxlength="500" value="' + P.esc(w.comment) + '" style="font:inherit;padding:.5rem .65rem;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--ink)">' +
        '<div class="row"><span>Today\'s total: <span class="hooper-total" id="wt">' + (w.id ? w.hooper : '–') + '</span> / 28</span>' +
        '<span><button class="btn btn-solid btn-small" type="submit">' + (w.id ? 'Update today' : 'Save today') + '</button> <span class="status" role="status"></span></span></div></form>' +
        '<h3>History</h3><div id="wh">' + P.wellnessHistory(data.wellness) + '</div>';
      var f = P.$('#wf');
      function total() {
        var vals = P.HOOPER.map(function (h) { var c = f.querySelector('[name=' + h[0] + ']:checked'); return c ? +c.value : null; });
        P.$('#wt').textContent = vals.indexOf(null) < 0 ? vals.reduce(function (a, b) { return a + b; }, 0) : '–';
        return vals;
      }
      f.addEventListener('change', total);
      f.addEventListener('submit', async function (e) {
        e.preventDefault(); var st = P.$('.status', f), v = total();
        var row = { sleep: v[0], stress: v[1], fatigue: v[2], soreness: v[3], comment: f.comment.value.trim() || null };
        var r = w.id
          ? await sb.from('wellness_entries').update(row).eq('id', w.id).select().single()
          : await sb.from('wellness_entries').insert(Object.assign({ client_id: uid, entry_date: t }, row)).select().single();
        if (r.error) return P.say(st, 'Could not save.', true);
        if (w.id) Object.assign(w, r.data); else data.wellness.push(r.data);
        render.wellness(el); P.say(P.$('#wf .status'), 'Saved');
      });
    },
    load: function (el) {
      var t = P.today(), rpe = '';
      for (var i = 0; i <= 10; i++) rpe += '<label title="' + P.CR10[i] + '"><input type="radio" name="rpe" value="' + i + '" required><span>' + i + '</span></label>';
      el.innerHTML = '<h2>Training load (s-RPE)</h2><p class="muted" style="margin-bottom:1.25rem">About 30 minutes after each session, rate how hard the whole session was (0 = rest, 10 = maximal) and enter its duration. Load = RPE × minutes.</p>' +
        '<form id="sf" class="hooper">' +
        '<div class="inline-form" style="margin:0"><label>Date<input name="date" type="date" required value="' + t + '" min="' + P.addDays(t, -7) + '" max="' + t + '"></label>' +
        '<label>Session<select name="type"><option>Training</option><option>Match</option><option>Gym</option><option>Conditioning</option><option>Other</option></select></label>' +
        '<label>Duration (min)<input name="min" type="number" min="1" max="600" required></label></div>' +
        '<fieldset><legend>Session RPE</legend><div class="scale scale-11">' + rpe + '</div><div class="scale-ends"><span>0 rest</span><span id="rpe-label"></span><span>10 maximal</span></div></fieldset>' +
        '<label class="muted" for="sn">Notes (optional)</label><input id="sn" name="notes" maxlength="500" class="plain-input">' +
        '<div class="row"><span>Session load: <span class="hooper-total" id="sl">–</span> AU</span>' +
        '<span><button class="btn btn-solid btn-small" type="submit">Save session</button> <span class="status" role="status"></span></span></div></form>' +
        '<h3>My load</h3><div id="sh">' + P.srpeHistory(data.srpe, true) + '</div>';
      var f = P.$('#sf');
      function calc() {
        var c = f.querySelector('[name=rpe]:checked'), m = +f.elements.min.value;
        P.$('#rpe-label').textContent = c ? P.CR10[+c.value] : '';
        P.$('#sl').textContent = c && m ? (+c.value) * m : '–';
      }
      f.addEventListener('input', calc); f.addEventListener('change', calc);
      f.addEventListener('submit', async function (e) {
        e.preventDefault(); var st = P.$('.status', f);
        var row = { client_id: uid, session_date: f.elements.date.value, session_type: f.elements.type.value, rpe: +f.querySelector('[name=rpe]:checked').value,
          duration_min: +f.elements.min.value, notes: f.elements.notes.value.trim() || null };
        var r = await sb.from('srpe_entries').insert(row).select().single();
        if (r.error) return P.say(st, 'Could not save. Sessions can be logged up to 7 days back.', true);
        data.srpe.push(r.data); render.load(el); P.say(P.$('#sf .status'), 'Saved');
      });
      P.$$('[data-del-srpe]', el).forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('Delete this session?')) return;
          var id = b.getAttribute('data-del-srpe'), r = await sb.from('srpe_entries').delete().eq('id', id);
          if (r.error) return alert('Could not delete.');
          data.srpe = data.srpe.filter(function (x) { return String(x.id) !== id; }); render.load(el);
        });
      });
    },
    profile: function (el) {
      var p = me.profile;
      function f(name, label, type) { return '<label>' + label + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(p[name]) + '"></label>'; }
      el.innerHTML = '<h2>My profile</h2><form id="pf" class="inline-form">' +
        f('full_name', 'Full name') + '<label>Email<input value="' + esc(p.email) + '" disabled></label>' + f('phone', 'Phone', 'tel') + f('sport', 'Sport') +
        f('birth_year', 'Birth year', 'number') + f('height_cm', 'Height (cm)', 'number') +
        '<label class="wide">My goals<textarea name="goals" rows="2">' + esc(p.goals) + '</textarea></label>' +
        '<label class="wide">Injuries or health notes<textarea name="injuries" rows="2">' + esc(p.injuries) + '</textarea></label>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Save</button> <span class="status" role="status"></span></div></form>' +
        '<h3>Change password</h3><form id="pw" class="inline-form"><label>New password<input name="pw" type="password" minlength="8" autocomplete="new-password" required></label>' +
        '<div><button class="btn btn-line btn-small" type="submit">Change</button> <span class="status" role="status"></span></div></form>';
      P.$('#pf').addEventListener('submit', async function (e) {
        e.preventDefault(); var f = e.target, st = P.$('.status', f);
        var row = { full_name: f.full_name.value, phone: f.phone.value || null, sport: f.sport.value || null, birth_year: f.birth_year.value ? +f.birth_year.value : null,
          height_cm: f.height_cm.value ? +f.height_cm.value : null, goals: f.goals.value || null, injuries: f.injuries.value || null };
        var r = await sb.from('profiles').update(row).eq('id', uid);
        if (r.error) return P.say(st, 'Could not save.', true);
        Object.assign(me.profile, row); P.say(st, 'Saved');
      });
      P.$('#pw').addEventListener('submit', async function (e) {
        e.preventDefault(); var st = P.$('.status', e.target);
        var r = await sb.auth.updateUser({ password: e.target.pw.value });
        P.say(st, r.error ? r.error.message : 'Password changed', !!r.error); if (!r.error) e.target.reset();
      });
    },
    plan: function (el) {
      el.innerHTML = '<h2>My coaching plan</h2>' + (data.plans.length ? '<ul class="list">' + data.plans.map(function (p) {
        return '<li><div class="row"><h3 style="margin:0">' + esc(p.title) + '</h3>' + (p.active ? '<span class="tag done">Current</span>' : '<span class="tag">Past</span>') + '</div>' +
          '<p class="date" style="margin-top:.25rem">' + esc(P.fmtDate(p.start_date)) + (p.end_date ? ' → ' + esc(P.fmtDate(p.end_date)) : '') + '</p>' +
          (p.goal ? '<p style="margin-top:.5rem"><strong>Goal:</strong> ' + esc(p.goal) + '</p>' : '') + (p.phase ? '<p><strong>Phase:</strong> ' + esc(p.phase) + '</p>' : '') +
          (p.details ? '<p class="pre" style="margin-top:.5rem">' + esc(p.details) + '</p>' : '') + '</li>';
      }).join('') + '</ul>' : empty('Your coach has not added a plan yet.'));
    },
    program: function (el) {
      var t = P.today();
      var up = data.sessions.filter(function (s) { return s.session_date >= t; });
      var past = data.sessions.filter(function (s) { return s.session_date < t; }).reverse().slice(0, 10);
      el.innerHTML = '<h2>Training programme</h2>' + (up.length ? '<ul class="list">' + up.map(sessionCard).join('') + '</ul>' : empty('No upcoming sessions yet.')) +
        (past.length ? '<h3>Recent sessions</h3><ul class="list">' + past.map(sessionCard).join('') + '</ul>' : '');
      bindReports(el);
      if (location.hash.indexOf('s-') > 0) { var x = document.getElementById(location.hash.split('/')[1]); if (x) x.scrollIntoView(); }
    },
    performance: function (el) {
      if (!data.tests.length) { el.innerHTML = '<h2>Performance and testing</h2>' + empty('No tests or measurements yet.'); return; }
      var rows = data.tests.slice().reverse();
      el.innerHTML = '<h2>Performance and testing</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Test or measure</th><th>Result</th><th>Notes</th></tr></thead><tbody>' +
        rows.map(function (a) { return '<tr><td class="num">' + esc(P.fmtDate(a.measured_on)) + '</td><td>' + esc(a.category === 'test' ? 'Test' : 'Measure') + '</td><td>' + esc(a.name) + '</td><td class="num">' + esc(a.value) + ' ' + esc(a.unit) + '</td><td>' + esc(a.notes) + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    },
    progress: function (el) {
      var by = {};
      data.tests.forEach(function (a) { (by[a.name] = by[a.name] || []).push(a); });
      var names = Object.keys(by);
      el.innerHTML = '<h2>Progress</h2>' + (names.length ? '<div class="cards">' + names.map(function (n) {
        var pts = by[n].map(function (a) { return { date: a.measured_on, value: a.value }; });
        var first = Number(pts[0].value), last = Number(pts[pts.length - 1].value), d = last - first;
        var good = by[n][0].higher_is_better ? d > 0 : d < 0;
        var delta = pts.length > 1 && d !== 0 ? '<span class="' + (good ? 'delta-up' : 'delta-down') + '">' + (d > 0 ? '+' : '') + esc(+d.toFixed(2)) + ' ' + esc(by[n][0].unit) + ' since ' + esc(P.fmtDate(pts[0].date)) + '</span>' : '';
        return '<div class="card"><span class="k">' + esc(n) + '</span><span class="v">' + esc(last) + ' ' + esc(by[n][0].unit) + '</span>' + delta + P.lineChart(pts, by[n][0].unit) + '</div>';
      }).join('') + '</div>' : empty('Your progress charts will appear after your first tests.'));
    },
    notes: function (el) {
      el.innerHTML = '<h2>Coach notes</h2>' + (data.notes.length ? '<ul class="list">' + data.notes.map(function (n) {
        return '<li><span class="date">' + esc(P.fmtDate(n.note_date)) + '</span>' + (n.title ? '<h3 style="margin:.25rem 0">' + esc(n.title) + '</h3>' : '') + '<p class="pre">' + esc(n.body) + '</p></li>';
      }).join('') + '</ul>' : empty('No notes yet.'));
    },
    calendar: function (el, offset) {
      offset = offset || 0;
      var now = new Date(), m = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      var start = new Date(m); start.setDate(1 - ((m.getDay() + 6) % 7));
      var t = P.today(), cells = '';
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) { cells += '<div class="dow">' + d + '</div>'; });
      for (var i = 0; i < 42; i++) {
        var d = new Date(start); d.setDate(start.getDate() + i);
        var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        var ss = data.sessions.filter(function (s) { return s.session_date === iso; });
        cells += '<div class="' + (d.getMonth() !== m.getMonth() ? 'out' : '') + (iso === t ? ' today' : '') + '"><span class="n">' + d.getDate() + '</span>' +
          ss.map(function (s) { return '<a href="#program/s-' + s.id + '" class="' + (s.completed ? 'done' : '') + '">' + esc(s.title) + '</a>'; }).join('') + '</div>';
      }
      el.innerHTML = '<h2>Training calendar</h2><div class="cal-head"><button class="btn btn-line btn-small" data-m="-1" type="button" aria-label="Previous month">‹</button><strong>' +
        esc(m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })) + '</strong><button class="btn btn-line btn-small" data-m="1" type="button" aria-label="Next month">›</button></div><div class="cal">' + cells + '</div>';
      P.$$('[data-m]', el).forEach(function (b) { b.addEventListener('click', function () { render.calendar(el, offset + Number(b.getAttribute('data-m'))); }); });
    },
    documents: function (el) {
      var label = { program: 'Programme', report: 'Report', assessment: 'Assessment', photo: 'Photo', other: 'Document' };
      var files = data.docs.slice();
      data.sessions.forEach(function (s) { if (s.pdf_path) files.push({ title: s.title + ' (' + P.fmtDate(s.session_date) + ')', kind: 'program', storage_path: s.pdf_path, created_at: s.created_at }); });
      el.innerHTML = '<h2>Documents and reports</h2>' + (files.length ? '<ul class="list">' + files.map(function (d) {
        return '<li class="row"><span><span class="tag">' + esc(label[d.kind] || 'Document') + '</span> <a href="#" data-file="' + esc(d.storage_path) + '">' + esc(d.title) + '</a></span><span class="date">' + esc(P.fmtDate(d.created_at)) + '</span></li>';
      }).join('') + '</ul>' : empty('No documents yet.'));
      P.bindFileLinks(el);
    },
    messages: async function (el) {
      function draw() {
        el.innerHTML = '<h2>Messages with your coach</h2><div class="thread" id="thread">' + (data.msgs.length ? data.msgs.map(function (m) {
          return '<div class="msg' + (m.sender_id === uid ? ' mine' : '') + '"><span class="pre">' + esc(m.body) + '</span><span class="meta">' + (m.sender_id === uid ? 'You' : 'Coach') + ' · ' + esc(P.fmtDateTime(m.created_at)) + '</span></div>';
        }).join('') : empty('No messages yet. Write your first one below.')) + '</div>' +
          '<form id="mf" class="thread-form"><label for="mbody" class="muted">Your message</label><textarea id="mbody" rows="3" required maxlength="4000"></textarea><button class="btn btn-solid btn-small" type="submit">Send</button><span class="status" role="status"></span></form>';
        var th = P.$('#thread'); th.scrollTop = th.scrollHeight;
        P.$('#mf').addEventListener('submit', async function (e) {
          e.preventDefault(); var st = P.$('.status', e.target);
          var r = await sb.from('messages').insert({ client_id: uid, sender_id: uid, body: P.$('#mbody').value.trim() }).select().single();
          if (r.error) return P.say(st, 'Could not send.', true);
          data.msgs.push(r.data); draw();
        });
      }
      draw();
      var unread = data.msgs.filter(function (m) { return m.sender_id !== uid && !m.read_at; });
      if (unread.length) {
        var now = new Date().toISOString();
        await sb.from('messages').update({ read_at: now }).in('id', unread.map(function (m) { return m.id; }));
        unread.forEach(function (m) { m.read_at = now; });
      }
    }
  };

  try { await load(); } catch (e) { P.$('#tab-overview').innerHTML = '<p class="status error">Your data could not be loaded. Please refresh the page.</p>'; return; }
  P.tabs(function (name) { render[name](P.$('#tab-' + name)); });
})();
