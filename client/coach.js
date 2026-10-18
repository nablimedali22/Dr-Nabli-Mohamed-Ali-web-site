// Coach area: pick a client, then manage their plan, program, sessions, tests, notes, files and messages.
// The session library and programs are shared and can be assigned to any client.
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
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];  // profiles.available_days values
  var CATS = [['strength', 'Strength & hypertrophy'], ['speed', 'Speed & acceleration'], ['power', 'Jumping & power'],
    ['conditioning', 'Conditioning'], ['core', 'Core & injury prevention'], ['mobility', 'Mobility & recovery']];
  function catName(id) { var c = CATS.find(function (x) { return x[0] === id; }); return c ? c[1] : id; }
  function catOptions(sel) { return CATS.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === sel ? ' selected' : '') + '>' + c[1] + '</option>'; }).join(''); }
  // " → 5×100, 5×100" from what the client logged for one exercise
  function loggedSets(e) {
    var s = (e.set_logs || []).slice().sort(function (a, b) { return a.set_no - b.set_no; });
    return s.length ? ' <span class="logged">→ ' + s.map(function (x) { return esc(x.reps || '–') + (x.load ? '×' + esc(x.load) : ''); }).join(', ') + '</span>' : '';
  }
  // Exercise names from the client's "exercises to avoid" lines that match a session's exercises.
  function restricted(client, names) {
    var lines = (client.restrictions || '').split(/[\n,;]/).map(function (l) { return l.trim().toLowerCase(); }).filter(function (l) { return l.length > 2; });
    return names.filter(function (n) { var x = n.toLowerCase(); return lines.some(function (l) { return x.indexOf(l) >= 0 || l.indexOf(x) >= 0; }); });
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
  var AREAS = ['#team-area', '#library-area', '#programs-area', '#client-area'];
  // Shows one coach-wide area (team, library, programs) instead of a client.
  function openArea(id, title) {
    cur = null;
    P.$$('[data-c]').forEach(function (b) { b.setAttribute('aria-current', 'false'); });
    AREAS.forEach(function (a) { P.$(a).hidden = a !== id; });
    P.$('#client-name').textContent = title;
    return P.$(id);
  }
  function select(id) {
    AREAS.forEach(function (a) { P.$(a).hidden = a !== '#client-area'; });
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
      el.innerHTML = P.profileSummary(cur) + '<form class="inline-form">' + P.profileFields(cur) +
        '<label class="wide">Exercises to avoid in programs (coach only, one per line, checked when you assign a program)<textarea name="restrictions" rows="2" placeholder="Depth jump&#10;Overhead press">' + esc(cur.restrictions) + '</textarea></label>' +
        '<label class="check wide"><input type="checkbox" name="active"' + (cur.active ? ' checked' : '') + '> Account active (untick to pause access)</label>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Save</button> <span class="status" role="status"></span></div></form>';
      onSubmit(P.$('form', el), async function (f) {
        var row = P.readProfile(f);
        row.restrictions = val(f, 'restrictions'); row.active = f.elements.active.checked;
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
    program: async function (el) {
      await loadLib();
      var asg = await rows('program_assignments', 'start_date');
      var sess = await rows('training_sessions', 'session_date', true, 'id, assignment_id, completed, session_date');
      var nextMon = P.addDays(P.today(), (7 - ((new Date(P.today() + 'T00:00:00').getDay() + 6) % 7)) % 7);
      el.innerHTML = (lib.programs.length ? '<form class="inline-form"><label class="wide">Program<select name="program" required><option value="">Choose a program…</option>' +
        lib.programs.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + ' (' + p.weeks + ' weeks)</option>'; }).join('') + '</select></label>' +
        '<label>Start date<input name="start" type="date" required value="' + nextMon + '"></label>' +
        '<div class="wide" id="assign-check"></div>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Assign program</button> <span class="status" role="status"></span></div></form>'
        : '<p class="empty">No programs yet. Build one under Programs first.</p>') +
        '<p class="muted" style="margin-bottom:1rem;font-size:.92rem">Assigning copies the program\'s sessions into this client\'s calendar. Later changes to the library do not change sessions already assigned.</p>' +
        (asg.length ? '<ul class="list">' + asg.map(function (a) {
          var mine = sess.filter(function (s) { return s.assignment_id === a.id; }), done = mine.filter(function (s) { return s.completed; }).length;
          return '<li><div class="row"><strong>' + esc(a.program_name) + '</strong><span><span class="tag">' + done + ' / ' + mine.length + ' done</span> ' +
            (mine.length > done ? '<button class="link-btn danger" data-unassign="' + a.id + '">Remove sessions not done yet</button>' : '') + '</span></div>' +
            '<p class="date">' + esc(P.fmtDate(a.start_date)) + ' · ' + a.weeks + ' weeks</p></li>';
        }).join('') + '</ul>' : empty('No program assigned yet.'));
      var f = P.$('form', el);
      if (f) {
        var check = function () {
          var p = lib.programs.find(function (x) { return String(x.id) === f.elements.program.value; });
          P.$('#assign-check').innerHTML = p ? assignWarnings(cur, p, expand(p, f.elements.start.value)) : '';
        };
        f.addEventListener('change', check);
        onSubmit(f, async function (f) {
          var p = lib.programs.find(function (x) { return String(x.id) === f.elements.program.value; });
          var plan = expand(p, val(f, 'start'));
          if (!plan.length) throw new Error('This program has no sessions yet');
          var a = P.must(await sb.from('program_assignments').insert({ client_id: cur.id, program_id: p.id, program_name: p.name, start_date: val(f, 'start'), weeks: p.weeks }).select().single());
          var made = P.must(await sb.from('training_sessions').insert(plan.map(function (x) {
            return { client_id: cur.id, session_date: x.date, title: x.t.name, focus: x.t.focus || catName(x.t.category) + (p.weeks > 1 ? ' · week ' + x.week : ''),
              coach_notes: x.t.coach_notes, duration_min: x.t.duration_min, template_id: x.t.id, assignment_id: a.id };
          })).select('id, session_date'));
          var ex = [];
          made.forEach(function (s) {
            var x = plan.find(function (k) { return k.date === s.session_date; });
            (x.t.template_exercises || []).forEach(function (e) {
              ex.push({ session_id: s.id, client_id: cur.id, position: e.position, name: e.name, sets: e.sets, reps: e.reps, load: e.load, target_rpe: e.target_rpe, rest: e.rest, notes: e.notes, demo_url: e.demo_url });
            });
          });
          if (ex.length) P.must(await sb.from('session_exercises').insert(ex));
        });
      }
      P.$$('[data-unassign]', el).forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('Remove every session of this program that the client has not completed?')) return;
          try {
            var id = +b.getAttribute('data-unassign');
            P.must(await sb.from('training_sessions').delete().eq('assignment_id', id).eq('completed', false));
            if (!sess.some(function (s) { return s.assignment_id === id && s.completed; })) P.must(await sb.from('program_assignments').delete().eq('id', id));
            showPanel();
          } catch (err) { alert('Could not remove: ' + (err.message || err)); }
        });
      });
    },
    sessions: async function (el) {
      var list = await rows('training_sessions', 'session_date', false, '*, session_exercises(*, set_logs(*))');
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
            (ex.length ? '<p style="font-size:.92rem;margin-top:.3rem">' + ex.map(function (e) { return esc(e.name) + (e.sets ? ' ' + esc(e.sets) + '×' + esc(e.reps || '') : '') + (e.load ? ' @ ' + esc(e.load) : '') + (e.target_rpe ? ' RPE ' + esc(e.target_rpe) : '') + loggedSets(e); }).join(' · ') + '</p>' : '') +
            (s.pdf_path ? '<p><a href="#" data-file="' + esc(s.pdf_path) + '">Programme PDF</a></p>' : '') +
            (s.client_rpe != null || s.client_feedback ? '<p style="margin-top:.4rem"><strong>Client:</strong> ' + (s.client_rpe != null ? 'RPE ' + esc(s.client_rpe) + '. ' : '') + esc(s.client_feedback || '') + '</p>' : '') + '</li>';
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
      el.innerHTML = '<p class="muted" style="margin-bottom:1rem">Session RPE (CR-10) × duration, logged by the client: their own sessions (team training, self-training…) and the programme sessions they rated with a duration. Daily load = total of the day\'s sessions. ACWR = last 7 days ÷ weekly average of the last 28 days.</p>' + P.srpeHistory(list, 'all');
      P.bindLoadViews(el);
      P.$$('[data-del-srpe]', el).forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('Delete this session?')) return;
          try { P.must(await sb.from('srpe_entries').delete().eq('id', b.getAttribute('data-del-srpe'))); showPanel(); }
          catch (err) { alert('Could not delete: ' + (err.message || err)); }
        });
      });
    },
    nutrition: async function (el) {
      var r = await Promise.all([rows('nutrition_plans', 'created_at'), rows('weight_logs', 'log_date', true), rows('supplements', 'created_at'), rows('meal_photos', 'created_at')]);
      var plans = r[0], weights = r[1].sort(function (x, y) { return x.log_date < y.log_date ? -1 : x.log_date > y.log_date ? 1 : x.moment === 'week_start' ? -1 : 1; });
      el.innerHTML = '<h3 style="margin-top:0">Send a programme or recommendation</h3>' +
        '<form class="inline-form" id="np"><label>Type<select name="kind"><option value="programme">Nutrition programme</option><option value="recommendation">Recommendation</option></select></label>' +
        '<label class="wide">Title<input name="title" required maxlength="200" placeholder="Meal plan, week 1 · Hydration on match day"></label>' +
        '<label class="wide">Text<textarea name="body" rows="5" maxlength="10000" placeholder="Meals, quantities, timing, advice…"></textarea></label>' +
        '<label>File (optional)<input name="file" type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"></label>' +
        '<div><button class="btn btn-solid btn-small" type="submit">Send to client</button> <span class="status" role="status"></span></div></form>' +
        P.nutritionPlans(plans, true) +
        '<h3>Weekly weigh-ins</h3>' + P.weightHistory(weights, 'all') +
        '<h3>Supplements</h3>' + P.supplementList(r[2], false) +
        '<h3>Meal photos</h3>' + P.mealGallery(r[3], 'coach');
      onSubmit(P.$('#np', el), async function (f) {
        var file = f.elements.file.files[0], path = file ? await upload(file) : null;
        P.must(await sb.from('nutrition_plans').insert({ client_id: cur.id, kind: val(f, 'kind'), title: val(f, 'title').trim(), body: val(f, 'body'), file_path: path }));
      });
      P.$$('form.meal-comment', el).forEach(function (f) {
        f.addEventListener('submit', async function (e) {
          e.preventDefault(); var st = P.$('.status', f);
          var res = await sb.from('meal_photos').update({ coach_comment: f.elements.c.value.trim() || null }).eq('id', f.getAttribute('data-id'));
          P.say(st, res.error ? 'Could not save.' : 'Saved', !!res.error);
        });
      });
      function del(attr, table, msg) {
        P.$$('[' + attr + ']', el).forEach(function (b) {
          b.addEventListener('click', async function () {
            if (!confirm(msg)) return;
            try {
              P.must(await sb.from(table).delete().eq('id', b.getAttribute(attr)));
              await removeFile(b.getAttribute('data-path'));
              showPanel();
            } catch (err) { alert('Could not delete: ' + (err.message || err)); }
          });
        });
      }
      del('data-del-plan', 'nutrition_plans', 'Delete this programme or recommendation?');
      del('data-del-weight', 'weight_logs', 'Delete this weigh-in?');
      del('data-del-meal', 'meal_photos', 'Delete this meal photo?');
      P.bindFileLinks(el);
      P.loadPhotos(el);
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
    var el = openArea('#team-area', 'Team dashboard'); el.innerHTML = '<p class="muted">Loading…</p>';
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
  // ---------- Session library and programs: built once, assigned to any client ----------
  var lib = { templates: [], programs: [], exercises: [] }, libCat = '';
  async function loadLib() {
    var r = await Promise.all([
      sb.from('session_templates').select('*, template_exercises(*)').order('name'),
      sb.from('programs').select('*, program_sessions(*)').order('name'),
      sb.from('exercise_library').select('*').order('name')
    ]);
    r.forEach(function (x) { if (x.error) throw x.error; });
    lib = { templates: r[0].data, programs: r[1].data, exercises: r[2].data };
    lib.templates.forEach(function (t) { t.template_exercises.sort(function (a, b) { return a.position - b.position; }); });
  }
  function tpl(id) { return lib.templates.find(function (t) { return t.id === id; }); }
  // Dated sessions of a program from a start date. Week-specific rows replace the "every week" rows for that week.
  function expand(p, start) {
    if (!start) return [];
    var mon = P.addDays(start, -((new Date(start + 'T00:00:00').getDay() + 6) % 7)), out = [];
    for (var w = 1; w <= p.weeks; w++) {
      var rowsW = p.program_sessions.filter(function (r) { return r.week === w; });
      if (!rowsW.length) rowsW = p.program_sessions.filter(function (r) { return r.week === 0; });
      rowsW.forEach(function (r) {
        var d = P.addDays(mon, (w - 1) * 7 + r.day_of_week), t = tpl(r.template_id);
        if (d >= start && t) out.push({ date: d, week: w, day: r.day_of_week, t: t });
      });
    }
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function assignWarnings(c, p, plan) {
    var av = (c.available_days || []).map(function (k) { return DAY_KEYS.indexOf(k); }).filter(function (i) { return i >= 0; }), out = [];
    var off = Array.from(new Set(plan.filter(function (x) { return av.length && av.indexOf(x.day) < 0; }).map(function (x) { return DAYS[x.day]; })));
    if (off.length) out.push('<span class="flag warn">Not available on ' + off.join(', ') + '</span>');
    var names = [];
    plan.forEach(function (x) { x.t.template_exercises.forEach(function (e) { if (names.indexOf(e.name) < 0) names.push(e.name); }); });
    restricted(c, names).forEach(function (n) { out.push('<span class="flag">Restricted: ' + esc(n) + '</span>'); });
    return '<p style="font-size:.92rem">' + plan.length + ' sessions, ' + (plan.length ? esc(P.fmtDate(plan[0].date)) + ' → ' + esc(P.fmtDate(plan[plan.length - 1].date)) : 'none') + '</p>' +
      (out.length ? '<div>' + out.join('') + '</div>' : '<p class="muted" style="font-size:.92rem">No clash with availability or restrictions.</p>');
  }

  function libExRow(e) {
    e = e || {};
    function v(x) { return x == null ? '' : esc(x); }
    return '<div class="ex-row"><input name="ex_name" list="lib-ex" value="' + v(e.name) + '" placeholder="Exercise" aria-label="Exercise"><input name="ex_sets" type="number" min="0" value="' + v(e.sets) + '" placeholder="Sets" aria-label="Sets">' +
      '<input name="ex_reps" value="' + v(e.reps) + '" placeholder="Reps" aria-label="Reps"><input name="ex_load" value="' + v(e.load) + '" placeholder="Load" aria-label="Load">' +
      '<input name="ex_rpe" type="number" step="0.5" min="1" max="10" value="' + v(e.target_rpe) + '" placeholder="RPE" aria-label="Target RPE">' +
      '<input name="ex_rest" value="' + v(e.rest) + '" placeholder="Rest" aria-label="Rest"><input name="ex_notes" value="' + v(e.notes) + '" placeholder="Notes" aria-label="Notes"></div>';
  }
  function libForm(el, done) {
    P.$$('form', el).forEach(function (f) {
      f.addEventListener('submit', async function (e) {
        e.preventDefault();
        var st = P.$('.status', f), btn = P.$('button[type=submit]', f);
        P.say(st, 'Saving…'); btn.disabled = true;
        try { await f._save(f); done(); }
        catch (err) { P.say(st, 'Could not save: ' + (err.message || err), true); btn.disabled = false; }
      });
    });
  }
  async function showLibrary(editId) {
    var el = openArea('#library-area', 'Session library'); el.innerHTML = '<p class="muted">Loading…</p>';
    try { await loadLib(); } catch (e) { el.innerHTML = '<p class="status error">The library could not be loaded. Has 09-library-programs.sql been run in Supabase?</p>'; return; }
    var t = editId ? tpl(editId) : null, ex = t ? t.template_exercises : [];
    var list = lib.templates.filter(function (x) { return !libCat || x.category === libCat; });
    el.innerHTML = '<datalist id="lib-ex">' + lib.exercises.map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('') + '</datalist>' +
      '<form id="tpl-form" class="inline-form"><label class="wide">' + (t ? 'Editing session' : 'Session name') + '<input name="name" required value="' + esc(t && t.name) + '" placeholder="Acceleration 0-20 m"></label>' +
      '<label>Objective<select name="category">' + catOptions(t && t.category) + '</select></label>' +
      '<label>Duration (min)<input name="duration_min" type="number" min="1" max="600" value="' + esc(t && t.duration_min) + '"></label>' +
      '<label>Focus<input name="focus" value="' + esc(t && t.focus) + '" placeholder="Max strength, 85-90%"></label>' +
      '<label class="wide">Instructions<textarea name="coach_notes" rows="2" placeholder="Warm-up, cues, what to report">' + esc(t && t.coach_notes) + '</textarea></label>' +
      '<div class="wide"><strong style="font-size:.9rem">Exercises</strong><div class="ex-scroll"><div class="ex-rows"><div class="ex-row ex-head" aria-hidden="true"><span>Exercise</span><span>Sets</span><span>Reps</span><span>Load</span><span>RPE</span><span>Rest</span><span>Notes</span></div>' +
      (ex.length ? ex.map(libExRow).join('') : libExRow() + libExRow() + libExRow()) + '</div></div>' +
      '<button type="button" class="link-btn" id="lib-add-ex" style="margin-top:.4rem">+ Add an exercise</button></div>' +
      '<div><button class="btn btn-solid btn-small" type="submit">' + (t ? 'Save changes' : 'Add to library') + '</button> ' + (t ? '<button type="button" class="link-btn" id="lib-cancel">Cancel</button> ' : '') + '<span class="status" role="status"></span></div></form>' +
      '<div class="chips-row"><button type="button" class="chip' + (libCat ? '' : ' on') + '" data-cat="">All (' + lib.templates.length + ')</button>' +
      CATS.map(function (c) { return '<button type="button" class="chip' + (libCat === c[0] ? ' on' : '') + '" data-cat="' + c[0] + '">' + c[1] + ' (' + lib.templates.filter(function (x) { return x.category === c[0]; }).length + ')</button>'; }).join('') + '</div>' +
      (list.length ? '<ul class="list">' + list.map(function (x) {
        var used = lib.programs.filter(function (p) { return p.program_sessions.some(function (r) { return r.template_id === x.id; }); }).length;
        return '<li class="cat-' + x.category + '"><div class="row"><span><span class="tag">' + esc(catName(x.category)) + '</span> <strong>' + esc(x.name) + '</strong></span>' +
          '<span><button class="link-btn" data-edit="' + x.id + '">Edit</button> · <button class="link-btn" data-dup="' + x.id + '">Duplicate</button> · <button class="link-btn danger" data-del-tpl="' + x.id + '">Delete</button></span></div>' +
          '<p class="muted" style="font-size:.9rem">' + (x.duration_min ? x.duration_min + ' min · ' : '') + x.template_exercises.length + ' exercises · ' + (used ? 'in ' + used + ' program' + (used > 1 ? 's' : '') : 'not in a program') + '</p>' +
          '<p style="font-size:.92rem;margin-top:.3rem">' + x.template_exercises.map(function (e) { return esc(e.name) + (e.sets ? ' ' + esc(e.sets) + '×' + esc(e.reps || '') : '') + (e.load ? ' @ ' + esc(e.load) : ''); }).join(' · ') + '</p></li>';
      }).join('') + '</ul>' : empty('No sessions in this category yet.')) +
      '<h3>Exercise library</h3><p class="muted" style="font-size:.92rem">Exercises with a demo link show a “Watch demo” link to the client.</p>' +
      '<form id="ex-form" class="inline-form"><label>Exercise<input name="name" required placeholder="Hip thrust"></label><label>Objective<select name="category">' + catOptions() + '</select></label>' +
      '<label>Demo video link<input name="demo_url" type="url" placeholder="https://youtu.be/…"></label><label>Coaching cue<input name="cue" maxlength="300"></label>' +
      '<div><button class="btn btn-solid btn-small" type="submit">Add exercise</button> <span class="status" role="status"></span></div></form>' +
      '<div class="table-wrap"><table><thead><tr><th>Exercise</th><th>Objective</th><th>Cue</th><th>Demo</th><th></th></tr></thead><tbody>' +
      lib.exercises.map(function (x) {
        return '<tr><td>' + esc(x.name) + '</td><td>' + esc(catName(x.category)) + '</td><td>' + esc(x.cue) + '</td><td>' +
          (x.demo_url ? '<a href="' + esc(x.demo_url) + '" target="_blank" rel="noopener">Watch</a> · ' : '') + '<button class="link-btn" data-demo="' + x.id + '">' + (x.demo_url ? 'Change' : 'Add link') + '</button></td>' +
          '<td><button class="link-btn danger" data-del-ex="' + x.id + '">Delete</button></td></tr>';
      }).join('') + '</tbody></table></div>';

    P.$('#lib-add-ex').addEventListener('click', function () { P.$('.ex-rows', el).insertAdjacentHTML('beforeend', libExRow()); });
    if (t) P.$('#lib-cancel').addEventListener('click', function () { showLibrary(); });
    P.$('#tpl-form')._save = async function (f) {
      var row = { name: val(f, 'name'), category: val(f, 'category'), duration_min: val(f, 'duration_min') && +val(f, 'duration_min'), focus: val(f, 'focus'), coach_notes: val(f, 'coach_notes') };
      var exs = P.$$('.ex-row:not(.ex-head)', f).map(function (r) {
        var g = function (n) { var v = P.$('[name=' + n + ']', r).value.trim(); return v === '' ? null : v; };
        var known = g('ex_name') && lib.exercises.find(function (x) { return x.name.toLowerCase() === g('ex_name').toLowerCase(); });
        return g('ex_name') && { name: g('ex_name'), sets: g('ex_sets') && +g('ex_sets'), reps: g('ex_reps'), load: g('ex_load'), target_rpe: g('ex_rpe') && +g('ex_rpe'), rest: g('ex_rest'), notes: g('ex_notes'), demo_url: known ? known.demo_url : null };
      }).filter(Boolean).map(function (e, i) { e.position = i + 1; return e; });
      var id;
      if (t) { P.must(await sb.from('session_templates').update(row).eq('id', t.id)); P.must(await sb.from('template_exercises').delete().eq('template_id', t.id)); id = t.id; }
      else id = P.must(await sb.from('session_templates').insert(row).select('id').single()).id;
      if (exs.length) P.must(await sb.from('template_exercises').insert(exs.map(function (e) { e.template_id = id; return e; })));
    };
    P.$('#ex-form')._save = async function (f) {
      P.must(await sb.from('exercise_library').insert({ name: val(f, 'name').trim(), category: val(f, 'category'), demo_url: val(f, 'demo_url'), cue: val(f, 'cue') }));
    };
    libForm(el, function () { showLibrary(); });
    P.$$('[data-cat]', el).forEach(function (b) { b.addEventListener('click', function () { libCat = b.getAttribute('data-cat'); showLibrary(); }); });
    P.$$('[data-edit]', el).forEach(function (b) { b.addEventListener('click', function () { showLibrary(+b.getAttribute('data-edit')); window.scrollTo(0, 0); }); });
    P.$$('[data-dup]', el).forEach(function (b) {
      b.addEventListener('click', async function () {
        var x = tpl(+b.getAttribute('data-dup'));
        try {
          var id = P.must(await sb.from('session_templates').insert({ name: x.name + ' (copy)', category: x.category, duration_min: x.duration_min, focus: x.focus, coach_notes: x.coach_notes }).select('id').single()).id;
          if (x.template_exercises.length) P.must(await sb.from('template_exercises').insert(x.template_exercises.map(function (e) {
            return { template_id: id, position: e.position, name: e.name, sets: e.sets, reps: e.reps, load: e.load, target_rpe: e.target_rpe, rest: e.rest, notes: e.notes, demo_url: e.demo_url };
          })));
          showLibrary(id);
        } catch (err) { alert('Could not duplicate: ' + (err.message || err)); }
      });
    });
    P.$$('[data-del-tpl]', el).forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Delete this session from the library? It is also removed from programs. Sessions already assigned to clients are kept.')) return;
        try { P.must(await sb.from('session_templates').delete().eq('id', b.getAttribute('data-del-tpl'))); showLibrary(); }
        catch (err) { alert('Could not delete: ' + (err.message || err)); }
      });
    });
    P.$$('[data-demo]', el).forEach(function (b) {
      b.addEventListener('click', async function () {
        var x = lib.exercises.find(function (e) { return String(e.id) === b.getAttribute('data-demo'); });
        var url = prompt('Demo video link for ' + x.name + ' (leave empty to remove)', x.demo_url || '');
        if (url === null) return;
        url = url.trim() || null;
        try {
          P.must(await sb.from('exercise_library').update({ demo_url: url }).eq('id', x.id));
          // keep library sessions in step; sessions already assigned keep their own copy
          P.must(await sb.from('template_exercises').update({ demo_url: url }).ilike('name', x.name.replace(/[\\%_]/g, '\\$&')));
          showLibrary();
        } catch (err) { alert('Could not save the link: ' + (err.message || err)); }
      });
    });
    P.$$('[data-del-ex]', el).forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Delete this exercise from the library? Sessions that use it keep it.')) return;
        try { P.must(await sb.from('exercise_library').delete().eq('id', b.getAttribute('data-del-ex'))); showLibrary(); }
        catch (err) { alert('Could not delete: ' + (err.message || err)); }
      });
    });
  }

  async function showPrograms(editId) {
    var el = openArea('#programs-area', 'Programs'); el.innerHTML = '<p class="muted">Loading…</p>';
    try { await loadLib(); } catch (e) { el.innerHTML = '<p class="status error">Programs could not be loaded. Has 09-library-programs.sql been run in Supabase?</p>'; return; }
    var assigned = P.must(await sb.from('program_assignments').select('program_id, client_id'));
    var p = editId ? lib.programs.find(function (x) { return x.id === editId; }) : null;
    var rowsP = p ? p.program_sessions : [];
    var weeksUsed = Array.from(new Set(rowsP.map(function (r) { return r.week; }))).filter(function (w) { return w > 0; }).sort(function (a, b) { return a - b; });
    function tplOptions(sel) {
      return '<option value="">Rest</option>' + CATS.map(function (c) {
        var ts = lib.templates.filter(function (t) { return t.category === c[0]; });
        return ts.length ? '<optgroup label="' + c[1] + '">' + ts.map(function (t) { return '<option value="' + t.id + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</optgroup>' : '';
      }).join('');
    }
    function weekRow(w) {
      return '<tr data-week="' + w + '"><th scope="row">' + (w ? 'Week ' + w : 'Every week') + '</th>' + DAYS.map(function (d, i) {
        var r = rowsP.find(function (x) { return x.week === w && x.day_of_week === i; });
        return '<td><select data-day="' + i + '" aria-label="' + (w ? 'Week ' + w : 'Every week') + ', ' + d + '">' + tplOptions(r && r.template_id) + '</select></td>';
      }).join('') + '</tr>';
    }
    el.innerHTML = (lib.templates.length ? '' : '<p class="status error">Add sessions to the Session library first, then place them on days here.</p>') +
      '<form id="prog-form" class="inline-form"><label class="wide">' + (p ? 'Editing program' : 'Program name') + '<input name="name" required value="' + esc(p && p.name) + '" placeholder="Pre-season speed block"></label>' +
      '<label>Length (weeks)<input name="weeks" type="number" min="1" max="52" required value="' + (p ? p.weeks : 4) + '"></label>' +
      '<label class="wide">Description<input name="description" value="' + esc(p && p.description) + '"></label>' +
      '<div class="wide"><strong style="font-size:.9rem">Weekly schedule</strong><div class="table-wrap"><table class="week-grid"><thead><tr><th></th>' + DAYS.map(function (d) { return '<th>' + d + '</th>'; }).join('') + '</tr></thead><tbody>' +
      weekRow(0) + weeksUsed.map(weekRow).join('') + '</tbody></table></div>' +
      '<p class="muted" style="font-size:.88rem;margin-top:.4rem">A week-specific row replaces “Every week” for that week only, e.g. a deload or test week. ' +
      '<label class="inline-pick">Customise week <input id="add-week" type="number" min="1" max="52" style="width:4.5rem"></label> <button type="button" class="link-btn" id="add-week-btn">Add row</button></p></div>' +
      '<div><button class="btn btn-solid btn-small" type="submit">' + (p ? 'Save changes' : 'Create program') + '</button> ' + (p ? '<button type="button" class="link-btn" id="prog-cancel">Cancel</button> ' : '') + '<span class="status" role="status"></span></div></form>' +
      (lib.programs.length ? '<ul class="list">' + lib.programs.map(function (x) {
        var every = x.program_sessions.filter(function (r) { return r.week === 0; });
        var who = assigned.filter(function (a) { return a.program_id === x.id; }).map(function (a) { var c = clients.find(function (k) { return k.id === a.client_id; }); return c ? c.full_name || c.email : ''; }).filter(Boolean);
        who = Array.from(new Set(who));
        return '<li><div class="row"><strong>' + esc(x.name) + '</strong><span><button class="link-btn" data-edit-prog="' + x.id + '">Edit</button> · <button class="link-btn" data-dup-prog="' + x.id + '">Duplicate</button> · <button class="link-btn danger" data-del-prog="' + x.id + '">Delete</button></span></div>' +
          '<p class="muted" style="font-size:.9rem">' + x.weeks + ' weeks · ' + every.length + ' sessions a week' + (who.length ? ' · assigned to ' + who.map(esc).join(', ') : '') + '</p>' +
          (x.description ? '<p style="font-size:.92rem">' + esc(x.description) + '</p>' : '') +
          '<div class="week-strip">' + DAYS.map(function (d, i) {
            var r = every.find(function (k) { return k.day_of_week === i; }), t = r && tpl(r.template_id);
            return '<span class="' + (t ? 'cat-' + t.category : 'rest') + '"><b>' + d + '</b>' + (t ? esc(t.name) : 'Rest') + '</span>';
          }).join('') + '</div></li>';
      }).join('') + '</ul>' : empty('No programs yet.'));

    P.$('#add-week-btn').addEventListener('click', function () {
      var w = +P.$('#add-week').value, wk = +P.$('#prog-form').elements.weeks.value;
      if (!w || w > wk || P.$('tr[data-week="' + w + '"]', el)) return;
      P.$('.week-grid tbody', el).insertAdjacentHTML('beforeend', weekRow(w));
    });
    if (p) P.$('#prog-cancel').addEventListener('click', function () { showPrograms(); });
    P.$('#prog-form')._save = async function (f) {
      var row = { name: val(f, 'name'), weeks: +val(f, 'weeks'), description: val(f, 'description') };
      var cells = [];
      P.$$('tr[data-week]', f).forEach(function (tr) {
        var w = +tr.getAttribute('data-week');
        if (w > row.weeks) return;
        P.$$('select[data-day]', tr).forEach(function (s) { if (s.value) cells.push({ week: w, day_of_week: +s.getAttribute('data-day'), template_id: +s.value }); });
      });
      var id;
      if (p) { P.must(await sb.from('programs').update(row).eq('id', p.id)); P.must(await sb.from('program_sessions').delete().eq('program_id', p.id)); id = p.id; }
      else id = P.must(await sb.from('programs').insert(row).select('id').single()).id;
      if (cells.length) P.must(await sb.from('program_sessions').insert(cells.map(function (c) { c.program_id = id; return c; })));
    };
    libForm(el, function () { showPrograms(); });
    P.$$('[data-edit-prog]', el).forEach(function (b) { b.addEventListener('click', function () { showPrograms(+b.getAttribute('data-edit-prog')); window.scrollTo(0, 0); }); });
    P.$$('[data-dup-prog]', el).forEach(function (b) {
      b.addEventListener('click', async function () {
        var x = lib.programs.find(function (k) { return String(k.id) === b.getAttribute('data-dup-prog'); });
        try {
          var id = P.must(await sb.from('programs').insert({ name: x.name + ' (copy)', weeks: x.weeks, description: x.description }).select('id').single()).id;
          if (x.program_sessions.length) P.must(await sb.from('program_sessions').insert(x.program_sessions.map(function (r) { return { program_id: id, week: r.week, day_of_week: r.day_of_week, template_id: r.template_id }; })));
          showPrograms(id);
        } catch (err) { alert('Could not duplicate: ' + (err.message || err)); }
      });
    });
    P.$$('[data-del-prog]', el).forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Delete this program? Sessions already assigned to clients are kept.')) return;
        try { P.must(await sb.from('programs').delete().eq('id', b.getAttribute('data-del-prog'))); showPrograms(); }
        catch (err) { alert('Could not delete: ' + (err.message || err)); }
      });
    });
  }
  P.$('#go-library').addEventListener('click', function () { showLibrary(); });
  P.$('#go-programs').addEventListener('click', function () { showPrograms(); });

  P.$('#go-team').addEventListener('click', showTeam);

  try { await loadClients(); } catch (e) { P.$('#clients').innerHTML = '<li class="status error">Clients could not be loaded.</li>'; return; }
  P.tabs(function (name) { active = name; showPanel(); });
})();
