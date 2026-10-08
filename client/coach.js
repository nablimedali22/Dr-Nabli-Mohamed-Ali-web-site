// Coach area: pick a client, then manage their plan, sessions, tests, notes, files and messages.
// Only an account with profiles.role = 'coach' can write; the database enforces it.
(async function () {
  var P = Portal, esc = P.esc, sb = P.sb, me, clients = [], cur = null, unread = {};
  try { me = await P.requireUser('coach'); } catch (e) { return; }
  var uid = me.user.id;

  function empty(t) { return '<p class="empty">' + esc(t) + '</p>'; }
  function val(f, n) { var v = f.elements[n] && f.elements[n].value; return v === '' || v == null ? null : v; }
  function safeName(n) { return n.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80); }
  async function upload(file) {
    var path = cur.id + '/' + Date.now() + '-' + safeName(file.name);
    P.must(await sb.storage.from('client-files').upload(path, file, { contentType: file.type || undefined }));
    return path;
  }
  async function rows(table, order, asc, sel) {
    return P.must(await sb.from(table).select(sel || '*').eq('client_id', cur.id).order(order, { ascending: !!asc }));
  }
  // Wires a form: runs fn(form), shows status, re-renders the current panel on success.
  function onSubmit(f, fn) {
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var st = P.$('.status', f), btn = P.$('button[type=submit]', f);
      P.say(st, 'Saving…'); btn.disabled = true;
      try { await fn(f); P.say(st, 'Saved'); showPanel(); }
      catch (err) { P.say(st, 'Could not save: ' + (err.message || err), true); }
      finally { btn.disabled = false; }
    });
  }
  function onDelete(root, table, extra) {
    P.$$('[data-del]', root).forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Delete this item? This cannot be undone.')) return;
        try {
          if (extra) await extra(b);
          P.must(await sb.from(table).delete().eq('id', b.getAttribute('data-del')));
          showPanel();
        } catch (err) { alert('Could not delete: ' + (err.message || err)); }
      });
    });
  }
  async function removeFile(path) { if (path) await sb.storage.from('client-files').remove([path]); }

  async function loadClients() {
    clients = P.must(await sb.from('profiles').select('*').eq('role', 'client').order('full_name'));
    var m = P.must(await sb.from('messages').select('client_id, sender_id').is('read_at', null));
    unread = {};
    m.forEach(function (x) { if (x.sender_id === x.client_id) unread[x.client_id] = (unread[x.client_id] || 0) + 1; });
    P.$('#clients').innerHTML = clients.length ? clients.map(function (c) {
      return '<li><button type="button" data-c="' + c.id + '"' + (cur && cur.id === c.id ? ' aria-current="true"' : '') + '>' +
        (unread[c.id] ? '<span class="badge">' + unread[c.id] + '</span>' : '') + esc(c.full_name || c.email) +
        (c.active ? '' : ' <span class="tag">paused</span>') + '<br><span class="muted" style="font-size:.82rem">' + esc(c.sport || c.email) + '</span></button></li>';
    }).join('') : empty('No clients yet. See “How to add a client” below.');
    P.$$('[data-c]').forEach(function (b) { b.addEventListener('click', function () { select(b.getAttribute('data-c')); }); });
  }
  function select(id) {
    P.$('#team-area').hidden = true;
    cur = clients.find(function (c) { return c.id === id; });
    P.$$('[data-c]').forEach(function (b) { b.setAttribute('aria-current', b.getAttribute('data-c') === id ? 'true' : 'false'); });
    P.$('#client-name').textContent = cur.full_name || cur.email;
    P.$('#client-area').hidden = false;
    showPanel();
  }
  var active = 'profile';
  function showPanel() { if (cur) render[active](P.$('#tab-' + active)).catch(function (e) { P.$('#tab-' + active).innerHTML = '<p class="status error">Could not load: ' + esc(e.message || e) + '</p>'; }); }

  var render = {
    profile: async function (el) {
      var c = cur;
      function f(n, l, t) { return '<label>' + l + '<input name="' + n + '" type="' + (t || 'text') + '" value="' + esc(c[n]) + '"></label>'; }
      el.innerHTML = '<form class="inline-form">' + f('full_name', 'Full name') + '<label>Email<input value="' + esc(c.email) + '" disabled></label>' +
        f('phone', 'Phone', 'tel') + f('sport', 'Sport') + f('birth_year', 'Birth year', 'number') + f('height_cm', 'Height (cm)', 'number') +
        '<label class="wide">Goals<textarea name="goals" rows="2">' + esc(c.goals) + '</textarea></label>' +
        '<label class="wide">Injuries or health notes<textarea name="injuries" rows="2">' + esc(c.injuries) + '</textarea></label>' +
        '<label class="check"><input type="checkbox" name="active"' + (c.active ? ' checked' : '') + '> Account active (untick to pause access)</label>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Save</button> <span class="status" role="status"></span></div></form>';
      onSubmit(P.$('form', el), async function (f) {
        var row = { full_name: val(f, 'full_name') || '', phone: val(f, 'phone'), sport: val(f, 'sport'), birth_year: val(f, 'birth_year') && +val(f, 'birth_year'),
          height_cm: val(f, 'height_cm') && +val(f, 'height_cm'), goals: val(f, 'goals'), injuries: val(f, 'injuries'), active: f.elements.active.checked };
        P.must(await sb.from('profiles').update(row).eq('id', cur.id));
        Object.assign(cur, row); P.$('#client-name').textContent = cur.full_name || cur.email; await loadClients();
      });
    },
    plan: async function (el) {
      var plans = await rows('coaching_plans', 'start_date');
      el.innerHTML = '<form class="inline-form"><label class="wide">Plan title<input name="title" required placeholder="Pre-season 2026"></label>' +
        '<label>Start<input name="start_date" type="date" value="' + P.today() + '"></label><label>End<input name="end_date" type="date"></label>' +
        '<label>Phase<input name="phase" placeholder="General preparation"></label><label class="wide">Goal<input name="goal"></label>' +
        '<label class="wide">Details<textarea name="details" rows="4"></textarea></label>' +
        '<label class="check"><input type="checkbox" name="active" checked> Current plan</label>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Add plan</button> <span class="status" role="status"></span></div></form>' +
        (plans.length ? '<ul class="list">' + plans.map(function (p) {
          return '<li><div class="row"><strong>' + esc(p.title) + '</strong><span>' + (p.active ? '<span class="tag done">Current</span> ' : '') +
            '<button class="link-btn" data-toggle="' + p.id + '" data-on="' + (p.active ? 1 : 0) + '">' + (p.active ? 'Mark as past' : 'Make current') + '</button> · ' +
            '<button class="link-btn danger" data-del="' + p.id + '">Delete</button></span></div>' +
            '<p class="date">' + esc(P.fmtDate(p.start_date)) + (p.end_date ? ' → ' + esc(P.fmtDate(p.end_date)) : '') + '</p>' +
            (p.goal ? '<p><strong>Goal:</strong> ' + esc(p.goal) + '</p>' : '') + (p.phase ? '<p><strong>Phase:</strong> ' + esc(p.phase) + '</p>' : '') +
            (p.details ? '<p class="pre">' + esc(p.details) + '</p>' : '') + '</li>';
        }).join('') + '</ul>' : empty('No plan yet.'));
      onSubmit(P.$('form', el), async function (f) {
        P.must(await sb.from('coaching_plans').insert({ client_id: cur.id, title: val(f, 'title'), start_date: val(f, 'start_date'), end_date: val(f, 'end_date'),
          phase: val(f, 'phase'), goal: val(f, 'goal'), details: val(f, 'details'), active: f.elements.active.checked }));
      });
      P.$$('[data-toggle]', el).forEach(function (b) {
        b.addEventListener('click', async function () {
          await sb.from('coaching_plans').update({ active: b.getAttribute('data-on') !== '1' }).eq('id', b.getAttribute('data-toggle')); showPanel();
        });
      });
      onDelete(el, 'coaching_plans');
    },
    sessions: async function (el) {
      var list = await rows('training_sessions', 'session_date', false, '*, session_exercises(*)');
      function exRow() {
        return '<div class="ex-row"><input name="ex_name" placeholder="Exercise" aria-label="Exercise"><input name="ex_sets" type="number" min="0" placeholder="Sets" aria-label="Sets">' +
          '<input name="ex_reps" placeholder="Reps" aria-label="Reps"><input name="ex_load" placeholder="Load" aria-label="Load"><input name="ex_rpe" type="number" step="0.5" min="1" max="10" placeholder="RPE" aria-label="Target RPE">' +
          '<input name="ex_rest" placeholder="Rest" aria-label="Rest"><input name="ex_notes" placeholder="Notes" aria-label="Notes"></div>';
      }
      el.innerHTML = '<form class="inline-form"><label>Date<input name="session_date" type="date" required value="' + P.today() + '"></label>' +
        '<label>Title<input name="title" required placeholder="Lower body strength"></label><label>Focus<input name="focus" placeholder="Max strength, 85-90%"></label>' +
        '<label>Programme PDF (optional)<input name="pdf" type="file" accept="application/pdf"></label>' +
        '<label class="wide">Instructions<textarea name="coach_notes" rows="2" placeholder="Warm-up, cues, what to report"></textarea></label>' +
        '<div class="wide"><strong style="font-size:.9rem">Exercises</strong><div class="ex-scroll"><div class="ex-rows"><div class="ex-row ex-head" aria-hidden="true"><span>Exercise</span><span>Sets</span><span>Reps</span><span>Load</span><span>RPE</span><span>Rest</span><span>Notes</span></div>' + exRow() + exRow() + exRow() + '</div></div>' +
        '<button type="button" class="link-btn" id="add-ex" style="margin-top:.4rem">+ Add an exercise</button></div>' +
        '<label>Repeat weekly for<select name="repeat"><option value="1">This date only</option>' + [2, 3, 4, 6, 8, 12].map(function (n) { return '<option value="' + n + '">' + n + ' weeks</option>'; }).join('') + '</select></label>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Add session</button> <span class="status" role="status"></span></div></form>' +
        (list.length ? '<ul class="list">' + list.map(function (s) {
          var ex = (s.session_exercises || []).sort(function (a, b) { return a.position - b.position; });
          return '<li><div class="row"><span><span class="date">' + esc(P.fmtDate(s.session_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })) + '</span> <strong>' + esc(s.title) + '</strong></span>' +
            '<span>' + (s.completed ? '<span class="tag done">Done</span> ' : '') + '<button class="link-btn danger" data-del="' + s.id + '" data-path="' + esc(s.pdf_path || '') + '">Delete</button></span></div>' +
            (s.focus ? '<p class="muted">' + esc(s.focus) + '</p>' : '') +
            (ex.length ? '<p style="font-size:.92rem;margin-top:.3rem">' + ex.map(function (e) { return esc(e.name) + (e.sets ? ' ' + esc(e.sets) + '×' + esc(e.reps || '') : '') + (e.load ? ' @ ' + esc(e.load) : '') + (e.target_rpe ? ' RPE ' + esc(e.target_rpe) : ''); }).join(' · ') + '</p>' : '') +
            (s.pdf_path ? '<p><a href="#" data-file="' + esc(s.pdf_path) + '">Programme PDF</a></p>' : '') +
            (s.client_rpe || s.client_feedback ? '<p style="margin-top:.4rem"><strong>Client:</strong> ' + (s.client_rpe ? 'RPE ' + esc(s.client_rpe) + '. ' : '') + esc(s.client_feedback || '') + '</p>' : '') + '</li>';
        }).join('') + '</ul>' : empty('No sessions yet.'));
      P.$('#add-ex').addEventListener('click', function () { P.$('.ex-rows', el).insertAdjacentHTML('beforeend', exRow()); });
      onSubmit(P.$('form', el), async function (f) {
        var file = f.elements.pdf.files[0], pdf = file ? await upload(file) : null;
        var exercises = P.$$('.ex-row:not(.ex-head)', f).map(function (r, i) {
          var g = function (n) { var v = P.$('[name=' + n + ']', r).value.trim(); return v === '' ? null : v; };
          return g('ex_name') && { position: i + 1, name: g('ex_name'), sets: g('ex_sets') && +g('ex_sets'), reps: g('ex_reps'), load: g('ex_load'), target_rpe: g('ex_rpe') && +g('ex_rpe'), rest: g('ex_rest'), notes: g('ex_notes') };
        }).filter(Boolean);
        var weeks = +f.elements.repeat.value, d0 = new Date(val(f, 'session_date') + 'T00:00:00');
        var sessions = [];
        for (var w = 0; w < weeks; w++) {
          var d = new Date(d0); d.setDate(d0.getDate() + 7 * w);
          sessions.push({ client_id: cur.id, session_date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
            title: val(f, 'title'), focus: val(f, 'focus'), coach_notes: val(f, 'coach_notes'), pdf_path: pdf });
        }
        var made = P.must(await sb.from('training_sessions').insert(sessions).select('id'));
        if (exercises.length) {
          var all = [];
          made.forEach(function (s) { exercises.forEach(function (e) { all.push(Object.assign({ session_id: s.id, client_id: cur.id }, e)); }); });
          P.must(await sb.from('session_exercises').insert(all));
        }
      });
      onDelete(el, 'training_sessions', async function (b) {
        var path = b.getAttribute('data-path');
        // A repeated session shares its PDF; delete the file only when no other session uses it.
        if (path && list.filter(function (s) { return s.pdf_path === path; }).length === 1) await removeFile(path);
      });
      P.bindFileLinks(el);
    },
    wellness: async function (el) {
      var list = await rows('wellness_entries', 'entry_date', true);
      el.innerHTML = '<p class="muted" style="margin-bottom:1rem">Daily Hooper index entered by the client (0 best, 7 worst per item; total out of 28). Items at 5 or more are shown in red.</p>' + P.wellnessHistory(list);
    },
    load: async function (el) {
      var list = await rows('srpe_entries', 'session_date', true);
      el.innerHTML = '<p class="muted" style="margin-bottom:1rem">Session RPE (CR-10) × duration, logged by the client. ACWR = last 7 days ÷ weekly average of the last 28 days.</p>' + P.srpeHistory(list, 'all');
      P.$$('[data-del-srpe]', el).forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('Delete this session?')) return;
          try { P.must(await sb.from('srpe_entries').delete().eq('id', b.getAttribute('data-del-srpe'))); showPanel(); }
          catch (err) { alert('Could not delete: ' + (err.message || err)); }
        });
      });
    },
    tests: async function (el) {
      var list = await rows('assessments', 'measured_on');
      var names = Array.from(new Set(list.map(function (a) { return a.name; })));
      el.innerHTML = '<form class="inline-form"><label>Date<input name="measured_on" type="date" required value="' + P.today() + '"></label>' +
        '<label>Type<select name="category"><option value="test">Test</option><option value="measurement">Measurement</option></select></label>' +
        '<label>Name<input name="name" list="test-names" required placeholder="CMJ, Yo-Yo IR1, Body mass…"></label><datalist id="test-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
        '<label>Value<input name="value" type="number" step="any" required></label><label>Unit<input name="unit" placeholder="cm, kg, s, m"></label>' +
        '<label>Better when<select name="hib"><option value="1">Higher</option><option value="0">Lower (e.g. sprint time, body fat)</option></select></label>' +
        '<label class="wide">Notes<input name="notes"></label>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Add result</button> <span class="status" role="status"></span></div></form>' +
        (list.length ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Result</th><th>Notes</th><th></th></tr></thead><tbody>' + list.map(function (a) {
          return '<tr><td class="num">' + esc(P.fmtDate(a.measured_on)) + '</td><td>' + esc(a.name) + '</td><td class="num">' + esc(a.value) + ' ' + esc(a.unit) + '</td><td>' + esc(a.notes) + '</td><td><button class="link-btn danger" data-del="' + a.id + '">Delete</button></td></tr>';
        }).join('') + '</tbody></table></div>' : empty('No results yet.'));
      onSubmit(P.$('form', el), async function (f) {
        P.must(await sb.from('assessments').insert({ client_id: cur.id, measured_on: val(f, 'measured_on'), category: val(f, 'category'), name: val(f, 'name').trim(),
          value: +val(f, 'value'), unit: val(f, 'unit'), higher_is_better: val(f, 'hib') === '1', notes: val(f, 'notes') }));
      });
      onDelete(el, 'assessments');
    },
    notes: async function (el) {
      var list = await rows('coach_notes', 'note_date');
      el.innerHTML = '<form class="inline-form"><label>Date<input name="note_date" type="date" value="' + P.today() + '"></label><label>Title<input name="title"></label>' +
        '<label class="wide">Note<textarea name="body" rows="3" required></textarea></label>' +
        '<label class="check"><input type="checkbox" name="visible" checked> Visible to the client (untick for a private note)</label>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Add note</button> <span class="status" role="status"></span></div></form>' +
        (list.length ? '<ul class="list">' + list.map(function (n) {
          return '<li><div class="row"><span class="date">' + esc(P.fmtDate(n.note_date)) + '</span><span>' + (n.visible_to_client ? '<span class="tag">Shared</span>' : '<span class="tag">Private</span>') +
            ' <button class="link-btn danger" data-del="' + n.id + '">Delete</button></span></div>' + (n.title ? '<strong>' + esc(n.title) + '</strong>' : '') + '<p class="pre">' + esc(n.body) + '</p></li>';
        }).join('') + '</ul>' : empty('No notes yet.'));
      onSubmit(P.$('form', el), async function (f) {
        P.must(await sb.from('coach_notes').insert({ client_id: cur.id, note_date: val(f, 'note_date'), title: val(f, 'title'), body: val(f, 'body'), visible_to_client: f.elements.visible.checked }));
      });
      onDelete(el, 'coach_notes');
    },
    documents: async function (el) {
      var list = await rows('documents', 'created_at');
      el.innerHTML = '<form class="inline-form"><label>Title<input name="title" required placeholder="Assessment report, October"></label>' +
        '<label>Type<select name="kind"><option value="report">Report</option><option value="assessment">Assessment</option><option value="program">Programme</option><option value="photo">Progress photo</option><option value="other">Other</option></select></label>' +
        '<label>File<input name="file" type="file" required accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.csv"></label>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Upload</button> <span class="status" role="status"></span></div></form>' +
        (list.length ? '<ul class="list">' + list.map(function (d) {
          return '<li class="row"><span><span class="tag">' + esc(d.kind) + '</span> <a href="#" data-file="' + esc(d.storage_path) + '">' + esc(d.title) + '</a></span><span><span class="date">' + esc(P.fmtDate(d.created_at)) + '</span> · ' +
            '<button class="link-btn danger" data-del="' + d.id + '" data-path="' + esc(d.storage_path) + '">Delete</button></span></li>';
        }).join('') + '</ul>' : empty('No documents yet.'));
      onSubmit(P.$('form', el), async function (f) {
        var path = await upload(f.elements.file.files[0]);
        P.must(await sb.from('documents').insert({ client_id: cur.id, title: val(f, 'title'), kind: val(f, 'kind'), storage_path: path }));
      });
      onDelete(el, 'documents', function (b) { return removeFile(b.getAttribute('data-path')); });
      P.bindFileLinks(el);
    },
    messages: async function (el) {
      var list = await rows('messages', 'created_at', true);
      el.innerHTML = '<div class="thread">' + (list.length ? list.map(function (m) {
        return '<div class="msg' + (m.sender_id === uid ? ' mine' : '') + '"><span class="pre">' + esc(m.body) + '</span><span class="meta">' + (m.sender_id === uid ? 'You' : esc(cur.full_name || 'Client')) + ' · ' + esc(P.fmtDateTime(m.created_at)) + (m.sender_id === uid && m.read_at ? ' · read' : '') + '</span></div>';
      }).join('') : empty('No messages yet.')) + '</div>' +
        '<form class="thread-form"><label class="muted" for="cbody">Message to ' + esc(cur.full_name || 'client') + '</label><textarea id="cbody" name="body" rows="3" required maxlength="4000"></textarea>' +
        '<button class="btn btn-solid btn-small" type="submit">Send</button><span class="status" role="status"></span></form>';
      var th = P.$('.thread', el); th.scrollTop = th.scrollHeight;
      onSubmit(P.$('form', el), async function (f) {
        P.must(await sb.from('messages').insert({ client_id: cur.id, sender_id: uid, body: val(f, 'body').trim() }));
      });
      var ids = list.filter(function (m) { return m.sender_id === cur.id && !m.read_at; }).map(function (m) { return m.id; });
      if (ids.length) { await sb.from('messages').update({ read_at: new Date().toISOString() }).in('id', ids); loadClients(); }
    }
  };

  // ---------- Team dashboard: today's Hooper and s-RPE for every player, by club and team ----------
  var teams = [], members = [], tf = { club: '', team: '', date: P.today() };
  async function loadTeams() {
    teams = P.must(await sb.from('teams').select('*').order('club').order('name'));
    members = P.must(await sb.from('team_members').select('*'));
  }
  function teamLabel(t) { return (t.club ? t.club + ' · ' : '') + t.name; }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function fmt(v, d) { return v == null ? '—' : (+v).toFixed(d == null ? 1 : d); }
  async function showTeam() {
    cur = null;
    P.$$('[data-c]').forEach(function (b) { b.setAttribute('aria-current', 'false'); });
    P.$('#client-area').hidden = true;
    P.$('#client-name').textContent = 'Team dashboard';
    var el = P.$('#team-area'); el.hidden = false; el.innerHTML = '<p class="muted">Loading…</p>';
    try { await loadTeams(); } catch (e) { el.innerHTML = '<p class="status error">Teams could not be loaded. Has teams.sql been run in Supabase?</p>'; return; }
    var from = P.addDays(tf.date, -27);
    var well = P.must(await sb.from('wellness_entries').select('*').gte('entry_date', from).order('entry_date'));
    var load = P.must(await sb.from('srpe_entries').select('*').gte('session_date', from).order('session_date'));
    drawTeam(el, well.filter(function (w) { return w.entry_date <= tf.date; }), load.filter(function (l) { return l.session_date <= tf.date; }));
  }
  function drawTeam(el, well, load) {
    var clubs = Array.from(new Set(teams.map(function (t) { return t.club; }))).sort();
    var shownTeams = teams.filter(function (t) { return (!tf.club || t.club === tf.club) && (!tf.team || String(t.id) === tf.team); });
    var teamIds = shownTeams.map(function (t) { return t.id; });
    var anyFilter = tf.club || tf.team;
    var players = clients.filter(function (c) {
      return c.active && (!anyFilter || members.some(function (m) { return m.client_id === c.id && teamIds.indexOf(m.team_id) >= 0; }));
    });
    var rows = players.map(function (c) {
      var mine = well.filter(function (w) { return w.client_id === c.id; });
      var w = mine.find(function (x) { return x.entry_date === tf.date; });
      var past = mine.filter(function (x) { return x.entry_date < tf.date; }).map(function (x) { return x.hooper; });
      var base = mean(past), sd = past.length > 2 ? Math.sqrt(past.reduce(function (a, v) { return a + Math.pow(v - base, 2); }, 0) / (past.length - 1)) : null;
      var k = P.loadMetrics(load.filter(function (l) { return l.client_id === c.id; }), tf.date);
      var flags = [];
      if (!w) flags.push('<span class="flag warn">No wellness</span>');
      else {
        P.HOOPER.forEach(function (h) { if (w[h[0]] >= 5) flags.push('<span class="flag">' + h[1] + ' ' + w[h[0]] + '</span>'); });
        if (sd != null && w.hooper > base + sd) flags.push('<span class="flag">Hooper above usual</span>');
      }
      if (k.acwr != null && k.acwr > 1.5) flags.push('<span class="flag">ACWR ' + k.acwr.toFixed(2) + '</span>');
      else if (k.acwr != null && k.acwr < 0.8) flags.push('<span class="flag warn">ACWR ' + k.acwr.toFixed(2) + '</span>');
      if (k.monotony != null && k.monotony > 2) flags.push('<span class="flag">Monotony ' + k.monotony.toFixed(1) + '</span>');
      var myTeams = members.filter(function (m) { return m.client_id === c.id; }).map(function (m) { var t = teams.find(function (x) { return x.id === m.team_id; }); return t ? t.name : ''; }).filter(Boolean);
      return { c: c, w: w, base: base, k: k, flags: flags, teams: myTeams.join(', ') };
    });
    rows.sort(function (a, b) { return b.flags.length - a.flags.length || (a.c.full_name || '').localeCompare(b.c.full_name || ''); });
    var logged = rows.filter(function (r) { return r.w; });
    function avg(f) { var v = rows.map(f).filter(function (x) { return x != null; }); return mean(v); }
    var head = '<tr><th>Player</th><th>Team</th>' + P.HOOPER.map(function (h) { return '<th>' + h[1].replace('Muscle soreness', 'Soreness') + '</th>'; }).join('') +
      '<th>Hooper</th><th>Usual</th><th>Load today</th><th>7-day load</th><th>ACWR</th><th>Monotony</th><th>Flags</th></tr>';
    var body = rows.map(function (r) {
      return '<tr><td><button class="link-btn" data-open="' + r.c.id + '">' + esc(r.c.full_name || r.c.email) + '</button></td><td>' + esc(r.teams) + '</td>' +
        P.HOOPER.map(function (h) { return '<td class="num' + (r.w && r.w[h[0]] >= 5 ? ' hi' : '') + '">' + (r.w ? r.w[h[0]] : '—') + '</td>'; }).join('') +
        '<td class="num"><strong>' + (r.w ? r.w.hooper : '—') + '</strong></td><td class="num">' + fmt(r.base) + '</td>' +
        '<td class="num">' + r.k.today + '</td><td class="num">' + r.k.acute + '</td><td class="num">' + fmt(r.k.acwr, 2) + '</td><td class="num">' + fmt(r.k.monotony, 2) + '</td>' +
        '<td>' + (r.flags.join('') || '<span class="muted">—</span>') + '</td></tr>';
    }).join('');
    var avgRow = rows.length ? '<tr class="avg"><td>Team average</td><td></td>' + P.HOOPER.map(function (h) { return '<td class="num">' + fmt(avg(function (r) { return r.w ? r.w[h[0]] : null; })) + '</td>'; }).join('') +
      '<td class="num">' + fmt(avg(function (r) { return r.w ? r.w.hooper : null; })) + '</td><td class="num">' + fmt(avg(function (r) { return r.base; })) + '</td>' +
      '<td class="num">' + fmt(avg(function (r) { return r.k.today; }), 0) + '</td><td class="num">' + fmt(avg(function (r) { return r.k.acute; }), 0) + '</td>' +
      '<td class="num">' + fmt(avg(function (r) { return r.k.acwr; }), 2) + '</td><td class="num">' + fmt(avg(function (r) { return r.k.monotony; }), 2) + '</td><td></td></tr>' : '';
    var flagged = rows.filter(function (r) { return r.flags.some(function (f) { return f.indexOf('warn') < 0; }); }).length;
    el.innerHTML = '<div class="filters">' +
      '<label>Club<select id="f-club"><option value="">All clubs</option>' + clubs.map(function (c) { return '<option' + (c === tf.club ? ' selected' : '') + ' value="' + esc(c) + '">' + esc(c || '(no club)') + '</option>'; }).join('') + '</select></label>' +
      '<label>Team<select id="f-team"><option value="">' + (tf.club ? 'All teams in club' : 'All teams') + '</option>' + teams.filter(function (t) { return !tf.club || t.club === tf.club; }).map(function (t) { return '<option value="' + t.id + '"' + (String(t.id) === tf.team ? ' selected' : '') + '>' + esc(teamLabel(t)) + '</option>'; }).join('') + '</select></label>' +
      '<label>Date<input id="f-date" type="date" value="' + tf.date + '" max="' + P.today() + '"></label></div>' +
      '<div class="cards" style="margin-bottom:1rem"><div class="card"><span class="k">Players</span><span class="v">' + rows.length + '</span></div>' +
      '<div class="card"><span class="k">Wellness logged</span><span class="v">' + logged.length + ' / ' + rows.length + '</span></div>' +
      '<div class="card"><span class="k">Players flagged</span><span class="v">' + flagged + '</span></div>' +
      '<div class="card"><span class="k">Team Hooper average</span><span class="v">' + fmt(avg(function (r) { return r.w ? r.w.hooper : null; })) + ' / 28</span></div></div>' +
      (rows.length ? '<div class="table-wrap"><table class="team-table"><thead>' + head + '</thead><tbody>' + body + avgRow + '</tbody></table></div>' +
        '<p class="muted" style="font-size:.85rem;margin-top:.5rem">Red flags: a Hooper item at 5 or more, Hooper total above the player\'s usual (28-day mean + 1 SD), ACWR above 1.5, monotony above 2. Yellow: no wellness entry, ACWR below 0.8.</p>'
        : '<p class="empty">No players in this selection. Add players to a team below.</p>') +
      '<h3>Teams</h3>' + manageTeams();
    P.$('#f-club').addEventListener('change', function (e) { tf.club = e.target.value; tf.team = ''; drawTeam(el, well, load); });
    P.$('#f-team').addEventListener('change', function (e) { tf.team = e.target.value; drawTeam(el, well, load); });
    P.$('#f-date').addEventListener('change', function (e) { tf.date = e.target.value || P.today(); showTeam(); });
    P.$$('[data-open]', el).forEach(function (b) { b.addEventListener('click', function () { select(b.getAttribute('data-open')); }); });
    bindManage(el);
  }
  function manageTeams() {
    return '<form id="new-team" class="inline-form"><label>Team name<input name="name" required placeholder="Seniors, U18 girls…"></label><label>Club<input name="club" placeholder="Al Khor SC"></label>' +
      '<label>Sport<input name="sport" placeholder="Basketball"></label><div><button class="btn btn-solid btn-small" type="submit">Create team</button> <span class="status" role="status"></span></div></form>' +
      (teams.length ? '<ul class="list team-list">' + teams.map(function (t) {
        var ms = members.filter(function (m) { return m.team_id === t.id; });
        var inTeam = ms.map(function (m) { return m.client_id; });
        return '<li><div class="row"><strong>' + esc(teamLabel(t)) + '</strong><span class="muted">' + ms.length + (ms.length === 1 ? ' player' : ' players') + (t.sport ? ' · ' + esc(t.sport) : '') +
          ' · <button class="link-btn danger" data-del-team="' + t.id + '">Delete team</button></span></div><div class="members">' +
          ms.map(function (m) { var c = clients.find(function (x) { return x.id === m.client_id; }); return c ? '<span class="chip">' + esc(c.full_name || c.email) + ' <button class="link-btn danger" aria-label="Remove" data-rm="' + t.id + '|' + c.id + '">×</button></span>' : ''; }).join('') +
          '</div><div class="filters" style="margin:.6rem 0 0"><label>Add player<select data-add="' + t.id + '"><option value="">Choose…</option>' +
          clients.filter(function (c) { return inTeam.indexOf(c.id) < 0; }).map(function (c) { return '<option value="' + c.id + '">' + esc(c.full_name || c.email) + '</option>'; }).join('') + '</select></label></div></li>';
      }).join('') + '</ul>' : '<p class="empty">No teams yet.</p>');
  }
  function bindManage(el) {
    var f = P.$('#new-team', el);
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); var st = P.$('.status', f);
      var r = await sb.from('teams').insert({ name: f.elements.name.value.trim(), club: f.elements.club.value.trim(), sport: f.elements.sport.value.trim() || null });
      if (r.error) return P.say(st, r.error.code === '23505' ? 'This club already has a team with that name.' : 'Could not create the team.', true);
      showTeam();
    });
    P.$$('[data-add]', el).forEach(function (s) {
      s.addEventListener('change', async function () {
        if (!s.value) return;
        var r = await sb.from('team_members').insert({ team_id: +s.getAttribute('data-add'), client_id: s.value });
        if (r.error) return alert('Could not add the player.');
        showTeam();
      });
    });
    P.$$('[data-rm]', el).forEach(function (b) {
      b.addEventListener('click', async function () {
        var p = b.getAttribute('data-rm').split('|');
        await sb.from('team_members').delete().eq('team_id', p[0]).eq('client_id', p[1]); showTeam();
      });
    });
    P.$$('[data-del-team]', el).forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Delete this team? Players and their data are kept.')) return;
        await sb.from('teams').delete().eq('id', b.getAttribute('data-del-team')); showTeam();
      });
    });
  }
  P.$('#go-team').addEventListener('click', showTeam);

  try { await loadClients(); } catch (e) { P.$('#clients').innerHTML = '<li class="status error">Clients could not be loaded.</li>'; return; }
  P.tabs(function (name) { active = name; showPanel(); });
})();
