// Shared helpers for the Client Space: Supabase connection, login guard, small DOM utilities.
(function () {
  var cfg = window.SITE_CONFIG || {};
  var ready = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  var sb = ready ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(d, opts) {
    if (!d) return '';
    var x = new Date(String(d).length === 10 ? d + 'T00:00:00' : d);
    return x.toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(d) {
    return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function say(el, text, isError) {
    if (typeof el === 'string') el = $(el);
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }
  // Throws on Supabase errors so callers can use one try/catch.
  function must(res) {
    if (res.error) throw res.error;
    return res.data;
  }
  function notConfigured() {
    var m = $('main');
    if (m) m.innerHTML = '<section><div class="wrap narrow"><h1>Client Space</h1><p class="lede">The Client Space is being set up. Please come back soon, or contact your coach.</p></div></section>';
  }

  // Redirects to the login page when nobody is signed in; returns {user, profile}.
  async function requireUser(role) {
    if (!ready) { notConfigured(); throw new Error('not configured'); }
    var s = must(await sb.auth.getSession()).session;
    if (!s) { location.replace('index.html'); throw new Error('signed out'); }
    var profile = must(await sb.from('profiles').select('*').eq('id', s.user.id).single());
    if (role === 'coach' && profile.role !== 'coach') { location.replace('dashboard.html'); throw new Error('not coach'); }
    if (role === 'client' && profile.role === 'coach') { location.replace('coach.html'); throw new Error('coach'); }
    if (!profile.active && profile.role !== 'coach') {
      await sb.auth.signOut();
      location.replace('index.html?inactive=1');
      throw new Error('inactive');
    }
    var who = $('#who');
    if (who) who.textContent = profile.full_name || profile.email;
    var out = $('#logout');
    if (out) out.addEventListener('click', async function () { await sb.auth.signOut(); location.replace('index.html'); });
    return { user: s.user, profile: profile };
  }

  async function signedUrl(path) {
    var d = must(await sb.storage.from('client-files').createSignedUrl(path, 600));
    return d.signedUrl;
  }
  // Opens a private file in a new tab through a short-lived signed link.
  function bindFileLinks(root) {
    $$('[data-file]', root).forEach(function (a) {
      a.addEventListener('click', async function (e) {
        e.preventDefault();
        var w = window.open('', '_blank');
        try { w.location = await signedUrl(a.getAttribute('data-file')); }
        catch (err) { if (w) w.close(); alert('This file could not be opened.'); }
      });
    });
  }

  // Simple tabs driven by the URL hash: buttons [data-tab=x] show panel #tab-x.
  function tabs(onShow) {
    function show() {
      var name = (location.hash || '').slice(1).split('/')[0];
      var btn = $('[data-tab="' + name + '"]') || $('[data-tab]');
      name = btn.getAttribute('data-tab');
      $$('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
      $$('.panel').forEach(function (p) { p.hidden = p.id !== 'tab-' + name; });
      onShow(name);
    }
    $$('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { location.hash = b.getAttribute('data-tab'); });
    });
    window.addEventListener('hashchange', show);
    show();
  }

  // Line chart (inline SVG) for one metric over time.
  function lineChart(points, unit) {
    if (points.length < 2) return '<p class="muted">More results are needed to draw a trend.</p>';
    var W = 560, H = 200, L = 44, R = 12, T = 14, B = 30;
    var xs = points.map(function (p) { return new Date(p.date + 'T00:00:00').getTime(); });
    var ys = points.map(function (p) { return Number(p.value); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var pad = (y1 - y0) * 0.15 || Math.abs(y1) * 0.1 || 1; y0 -= pad; y1 += pad;
    function X(v) { return L + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    var path = points.map(function (p, i) { return (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(ys[i]).toFixed(1); }).join(' ');
    var dots = points.map(function (p, i) {
      return '<circle cx="' + X(xs[i]).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '" r="4"><title>' + esc(fmtDate(p.date)) + ': ' + esc(p.value) + ' ' + esc(unit || '') + '</title></circle>';
    }).join('');
    var ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad].map(function (v) {
      return '<text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(+v.toFixed(1)) + '</text>' +
        '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Trend">' + ticks +
      '<text x="' + L + '" y="' + (H - 8) + '">' + esc(fmtDate(points[0].date)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + esc(fmtDate(points[points.length - 1].date)) + '</text>' +
      '<path d="' + path + '" class="line"/>' + dots + '</svg>';
  }

  var HOOPER = [['sleep', 'Sleep'], ['stress', 'Stress'], ['fatigue', 'Fatigue'], ['soreness', 'Muscle soreness']];
  // Chart of the daily Hooper total plus a table of recent days (entries sorted oldest first).
  function wellnessHistory(entries) {
    if (!entries.length) return '<p class="empty">No wellness entries yet.</p>';
    var last = entries.slice(-30);
    var recent = entries.slice(-7), avg = recent.reduce(function (a, e) { return a + e.hooper; }, 0) / recent.length;
    return '<div class="card"><span class="k">Hooper index, last ' + last.length + ' entries (lower is better)</span>' +
      '<span class="v">' + esc(+avg.toFixed(1)) + ' <span class="muted" style="font-size:1rem;font-family:var(--body);font-weight:400">/ 28, 7-entry average</span></span>' +
      lineChart(last.map(function (e) { return { date: e.entry_date, value: e.hooper }; }), '/ 28') + '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Date</th>' + HOOPER.map(function (h) { return '<th>' + h[1] + '</th>'; }).join('') + '<th>Total</th><th>Comment</th></tr></thead><tbody>' +
      entries.slice().reverse().slice(0, 30).map(function (e) {
        return '<tr><td class="num">' + esc(fmtDate(e.entry_date, { weekday: 'short', day: 'numeric', month: 'short' })) + '</td>' +
          HOOPER.map(function (h) { return '<td class="num' + (e[h[0]] >= 5 ? ' hi' : '') + '">' + esc(e[h[0]]) + '</td>'; }).join('') +
          '<td class="num"><strong>' + esc(e.hooper) + '</strong></td><td>' + esc(e.comment) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---- s-RPE training load (Foster): load = RPE (CR-10) x minutes, in AU ----
  // Perceived exertion scale 0-10 (Dr Nabli's chart): label, how it feels, example activity, colour and its text colour.
  var RPE_SCALE = [
    ['Complete rest', 'Totally relaxed, no effort at all.', 'Sitting, sleeping', '#1d4f9c', '#fff'],
    ['Very, very light', 'Very little effort, I am barely moving.', 'Very slow walk', '#2563c4', '#fff'],
    ['Light', 'Easy and comfortable, I could keep going for hours.', 'Easy walk', '#0f7d94', '#fff'],
    ['Moderate', 'Slight effort, my breathing is normal.', 'Brisk walk', '#167a4b', '#fff'],
    ['Medium', 'Moderate effort, I can talk easily.', 'Easy jog / easy cycling', '#3f7f1f', '#fff'],
    ['Medium-high', 'Clear effort, I breathe a little faster.', 'Light run / moderate cycling', '#9aa40f', '#14181f'],
    ['Hard', 'I feel tired, talking gets harder.', 'Moderate-pace run', '#e3a612', '#14181f'],
    ['Very hard', 'Big effort, I breathe heavily.', 'Fast run', '#ee7d14', '#14181f'],
    ['Very, very hard', 'Intense effort, I can barely speak.', 'High-intensity run', '#d9481c', '#fff'],
    ['Near maximal', 'Almost all-out, I cannot keep this up for long.', 'Almost maximal effort', '#bf2420', '#fff'],
    ['Maximal', 'Everything I have, I cannot continue.', 'Maximal effort', '#8f1218', '#fff']
  ];
  var CR10 = RPE_SCALE.map(function (r) { return r[0]; });
  // Colour-coded 0-10 guide shown next to RPE inputs; a click on a level fills the form's RPE field.
  function rpeGuide(open) {
    return '<details class="rpe-guide wide"' + (open ? ' open' : '') + '><summary>RPE scale 0–10: how hard was the session?</summary>' +
      '<div class="rpe-head" aria-hidden="true"><span>Level</span><span>Description</span><span>How does it feel?</span><span>Example</span></div><ol class="rpe-scale">' +
      RPE_SCALE.map(function (r, i) {
        return '<li style="--c:' + r[3] + ';--ci:' + r[4] + '"><button type="button" data-rpe="' + i + '" title="Choose RPE ' + i + '">' +
          '<b>' + i + '</b><strong>' + r[0] + '</strong><span>' + r[1] + '</span><span class="ex">' + r[2] + '</span></button></li>';
      }).join('') + '</ol><p class="rpe-tip">Tap a level to fill in your RPE.</p></details>';
  }
  function bindRpeGuide(root) {
    $$('[data-rpe]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.closest('form'), v = b.getAttribute('data-rpe'); if (!f) return;
        var el = f.querySelector('input[name=rpe][value="' + v + '"]') || f.querySelector('input[name=rpe]:not([type=radio])');
        if (!el) return;
        if (el.type === 'radio') el.checked = true; else el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.focus();
      });
    });
  }
  function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDay(d); }
  // Daily totals and the usual indicators over the 7 and 28 days ending today.
  function loadMetrics(entries, ref) {
    var t = ref || today(), daily = {};
    entries.forEach(function (e) { daily[e.session_date] = (daily[e.session_date] || 0) + e.load_au; });
    function days(n) { var a = []; for (var i = n - 1; i >= 0; i--) { var d = addDays(t, -i); a.push({ date: d, value: daily[d] || 0 }); } return a; }
    var w = days(7), m = days(28);
    var acute = w.reduce(function (a, d) { return a + d.value; }, 0);
    var chronic = m.reduce(function (a, d) { return a + d.value; }, 0) / 4;
    var mean = acute / 7, sd = Math.sqrt(w.reduce(function (a, d) { return a + Math.pow(d.value - mean, 2); }, 0) / 6);
    var monotony = sd > 0 ? mean / sd : null;
    var first = entries.length ? entries.reduce(function (a, e) { return e.session_date < a ? e.session_date : a; }, t) : t;
    return { daily28: m, acute: acute, chronic: chronic, monotony: monotony, strain: monotony == null ? null : acute * monotony,
      acwr: chronic > 0 && first <= addDays(t, -21) ? acute / chronic : null, today: daily[t] || 0 };
  }
  // Session types a client can log; 'Programme' marks the coach's programme sessions, 'Training' older logs.
  var SESSION_TYPES = ['Team training', 'Self-training', 'Match', 'Gym', 'Conditioning', 'Recovery', 'Other'];
  function sessionLabel(e) { return e.title ? e.session_type + ' · ' + e.title : e.session_type; }
  function weekStart(iso) { var d = new Date(iso + 'T00:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); }
  function pct(v, prev) {
    if (!prev) return '—';
    var c = Math.round((v - prev) / prev * 100);
    return '<span class="' + (c > 30 ? 'delta-down' : '') + '">' + (c > 0 ? '+' : '') + c + '%</span>';
  }
  // Sums a list of sessions: load, count, minutes, distinct days and mean session RPE.
  function sumUp(list) {
    var days = {}, o = { load: 0, n: list.length, min: 0, rpe: 0 };
    list.forEach(function (e) { o.load += e.load_au; o.min += e.duration_min; o.rpe += e.rpe; days[e.session_date] = 1; });
    o.days = Object.keys(days).length; o.rpe = o.n ? o.rpe / o.n : null;
    return o;
  }
  // One row per day with sessions: what was done and the day's total load.
  function dailyReport(entries) {
    var by = {};
    entries.forEach(function (e) { (by[e.session_date] = by[e.session_date] || []).push(e); });
    var days = Object.keys(by).sort().reverse().slice(0, 31);
    return '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Sessions</th><th>Count</th><th>Minutes</th><th>Daily load (AU)</th></tr></thead><tbody>' +
      days.map(function (d) {
        var l = by[d].sort(function (a, b) { return a.id - b.id; }), t = sumUp(l);
        return '<tr><td class="num">' + esc(fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })) + '</td><td>' +
          l.map(function (e) { return esc(sessionLabel(e)) + ' <span class="muted">(RPE ' + esc(e.rpe) + ' × ' + esc(e.duration_min) + ')</span>'; }).join('<br>') +
          '</td><td class="num">' + t.n + '</td><td class="num">' + t.min + '</td><td class="num"><strong>' + t.load + '</strong></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  // Monday-to-Sunday weeks, newest first: load, sessions, days, mean RPE, monotony, strain, change.
  function weeklyReport(entries) {
    var t = today(), first = weekStart(entries.reduce(function (a, e) { return e.session_date < a ? e.session_date : a; }, t)), weeks = [];
    for (var w = weekStart(t); w >= first && weeks.length < 13; w = addDays(w, -7)) weeks.push(w);
    var rows = weeks.map(function (w) {
      var end = addDays(w, 6), l = entries.filter(function (e) { return e.session_date >= w && e.session_date <= end; }), o = sumUp(l), daily = [];
      for (var i = 0; i < 7; i++) { var d = addDays(w, i); daily.push(l.reduce(function (a, e) { return a + (e.session_date === d ? e.load_au : 0); }, 0)); }
      var mean = o.load / 7, sd = Math.sqrt(daily.reduce(function (a, v) { return a + Math.pow(v - mean, 2); }, 0) / 6);
      o.week = w; o.end = end; o.monotony = sd > 0 ? mean / sd : null; o.strain = o.monotony == null ? null : o.load * o.monotony;
      return o;
    });
    var chart = rows.length > 1 ? '<div class="card" style="margin-top:1rem"><span class="k">Weekly load (AU)</span>' +
      barChart(rows.slice().reverse().map(function (r) { return { label: fmtDate(r.week, { day: 'numeric', month: 'short' }), value: r.load }; }), 'AU') + '</div>' : '';
    return chart + '<div class="table-wrap"><table><thead><tr><th>Week</th><th>Load (AU)</th><th>Change</th><th>Sessions</th><th>Days trained</th><th>Minutes</th><th>Mean RPE</th><th>Monotony</th><th>Strain</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr><td class="num">' + esc(fmtDate(r.week, { day: 'numeric', month: 'short' }) + ' – ' + fmtDate(r.end, { day: 'numeric', month: 'short' })) + (r.end >= t ? ' <span class="tag">now</span>' : '') +
          '</td><td class="num"><strong>' + r.load + '</strong></td><td class="num">' + (rows[i + 1] ? pct(r.load, rows[i + 1].load) : '—') + '</td><td class="num">' + r.n + '</td><td class="num">' + r.days + ' / 7</td><td class="num">' + r.min +
          '</td><td class="num">' + (r.rpe == null ? '—' : r.rpe.toFixed(1)) + '</td><td class="num' + (r.monotony > 2 ? ' hi' : '') + '">' + (r.monotony == null ? '—' : r.monotony.toFixed(2)) +
          '</td><td class="num">' + (r.strain == null ? '—' : Math.round(r.strain)) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="muted" style="font-size:.85rem;margin-top:.5rem">Change above +30% on the previous week is shown in red. Monotony = mean ÷ SD of the 7 daily loads (red above 2); strain = weekly load × monotony.</p>';
  }
  // Calendar months, newest first; the current month's weekly average uses the days elapsed so far.
  function monthlyReport(entries) {
    var t = today(), first = entries.reduce(function (a, e) { return e.session_date < a ? e.session_date : a; }, t).slice(0, 7), months = [];
    for (var m = t.slice(0, 7); m >= first && months.length < 12;) {
      months.push(m);
      var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1; if (mo === 0) { y--; mo = 12; }
      m = y + '-' + String(mo).padStart(2, '0');
    }
    var rows = months.map(function (m) {
      var o = sumUp(entries.filter(function (e) { return e.session_date.slice(0, 7) === m; }));
      var len = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate(), elapsed = m === t.slice(0, 7) ? +t.slice(8, 10) : len;
      o.month = m; o.len = len; o.perWeek = o.load / elapsed * 7;
      return o;
    });
    return '<div class="table-wrap"><table><thead><tr><th>Month</th><th>Load (AU)</th><th>Change</th><th>Weekly average</th><th>Sessions</th><th>Days trained</th><th>Minutes</th><th>Mean RPE</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr><td>' + esc(new Date(r.month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })) + (r.month === t.slice(0, 7) ? ' <span class="tag">now</span>' : '') +
          '</td><td class="num"><strong>' + r.load + '</strong></td><td class="num">' + (rows[i + 1] ? pct(r.load, rows[i + 1].load) : '—') + '</td><td class="num">' + Math.round(r.perWeek) +
          '</td><td class="num">' + r.n + '</td><td class="num">' + r.days + ' / ' + r.len + '</td><td class="num">' + r.min + '</td><td class="num">' + (r.rpe == null ? '—' : r.rpe.toFixed(1)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  // Vertical bars (inline SVG), one per label.
  function barChart(points, unit) {
    var W = 560, H = 200, L = 44, R = 8, T = 14, B = 30, max = Math.max.apply(null, points.map(function (p) { return p.value; })) || 1;
    var bw = (W - L - R) / points.length, every = Math.ceil(points.length / 7);
    function Y(v) { return T + (1 - v / max) * (H - T - B); }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Bar chart">' +
      [0, max / 2, max].map(function (v) {
        return '<text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(v) + '</text><line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/>';
      }).join('') +
      points.map(function (p, i) {
        var x = L + i * bw + bw * 0.15;
        return '<rect class="bar" x="' + x.toFixed(1) + '" y="' + Y(p.value).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + (H - B - Y(p.value)).toFixed(1) + '"><title>' + esc(p.label) + ': ' + p.value + ' ' + esc(unit) + '</title></rect>' +
          (i % every === 0 ? '<text x="' + (x + bw * 0.35).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(p.label) + '</text>' : '');
      }).join('') + '</svg>';
  }
  function srpeHistory(entries, canDelete) {
    if (!entries.length) return '<p class="empty">No sessions logged yet.</p>';
    var k = loadMetrics(entries), t = today();
    function card(label, value, note) { return '<div class="card"><span class="k">' + label + '</span><span class="v">' + value + '</span>' + (note ? '<span class="muted" style="font-size:.85rem">' + note + '</span>' : '') + '</div>'; }
    var acwrNote = k.acwr == null ? 'Needs 3-4 weeks of logs'
      : k.acwr > 1.5 ? '<span class="delta-down">High: above 1.5</span>'
      : k.acwr > 1.3 ? 'Caution: 1.3-1.5'
      : k.acwr < 0.8 ? 'Low: below 0.8' : 'In the 0.8-1.3 range';
    var n = entries.filter(function (e) { return e.session_date === t; }).length;
    var cards = '<div class="cards">' + card('Today', k.today + ' AU', n + (n === 1 ? ' session' : ' sessions')) + card('Last 7 days (acute)', k.acute + ' AU') +
      card('28-day weekly average (chronic)', Math.round(k.chronic) + ' AU') +
      card('ACWR', k.acwr == null ? '—' : k.acwr.toFixed(2), acwrNote) +
      card('Monotony (7 days)', k.monotony == null ? '—' : k.monotony.toFixed(2), k.monotony != null && k.monotony > 2 ? '<span class="delta-down">High: above 2</span>' : 'Mean / SD of daily load') +
      card('Strain (7 days)', k.strain == null ? '—' : Math.round(k.strain) + ' AU', 'Weekly load × monotony') + '</div>';
    var chart = '<div class="card" style="margin-top:1rem"><span class="k">Daily load, last 28 days (AU)</span>' + lineChart(k.daily28, 'AU') + '</div>';
    var rows = entries.slice().sort(function (a, b) { return a.session_date < b.session_date ? 1 : a.session_date > b.session_date ? -1 : b.id - a.id; }).slice(0, 40);
    var minDate = addDays(t, -7);
    var table = '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Session</th><th>RPE</th><th>Minutes</th><th>Load (AU)</th><th>Notes</th><th></th></tr></thead><tbody>' +
      rows.map(function (e) {
        return '<tr><td class="num">' + esc(fmtDate(e.session_date, { weekday: 'short', day: 'numeric', month: 'short' })) + '</td><td>' + esc(sessionLabel(e)) + '</td><td class="num">' + esc(e.rpe) +
          '</td><td class="num">' + esc(e.duration_min) + '</td><td class="num"><strong>' + esc(e.load_au) + '</strong></td><td>' + esc(e.notes) + '</td><td>' +
          // Programme sessions are corrected from the session itself, so they have no Delete here for the client.
          (canDelete === 'all' || (canDelete && e.session_date >= minDate && !e.training_session_id) ? '<button class="link-btn danger" data-del-srpe="' + e.id + '">Delete</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var views = [['sessions', 'Sessions', table], ['daily', 'Daily', dailyReport(entries)], ['weekly', 'Weekly report', weeklyReport(entries)], ['monthly', 'Monthly report', monthlyReport(entries)]];
    return cards + chart + '<div class="seg" role="tablist" aria-label="Load reports" style="margin-top:1.5rem">' +
      views.map(function (v, i) { return '<button type="button" role="tab" data-view="' + v[0] + '" aria-selected="' + (i ? 'false' : 'true') + '">' + v[1] + '</button>'; }).join('') + '</div>' +
      views.map(function (v, i) { return '<div class="view" data-view-panel="' + v[0] + '"' + (i ? ' hidden' : '') + '>' + v[2] + '</div>'; }).join('');
  }
  // Switches between the Sessions / Daily / Weekly / Monthly views; remembers the choice while the page is open.
  var loadView = 'sessions';
  function bindLoadViews(root) {
    function show(name) {
      loadView = name;
      $$('[data-view]', root).forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-view') === name ? 'true' : 'false'); });
      $$('[data-view-panel]', root).forEach(function (p) { p.hidden = p.getAttribute('data-view-panel') !== name; });
    }
    $$('[data-view]', root).forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-view')); }); });
    if ($('[data-view="' + loadView + '"]', root)) show(loadView);
  }

  // ---- Client profile (intake form): one definition shared by the coach and client pages ----
  function opts(s) { return s.split('|').map(function (x) { var p = x.split(':'); return [p[0], p[1] || p[0]]; }); }
  var YESNO = opts('yes:Yes|no:No');
  var PROFILE = [
    ['Personal information', [
      { n: 'full_name', l: 'Full name' }, { n: 'email', l: 'Email', ro: true }, { n: 'birth_date', l: 'Date of birth', t: 'date' },
      { n: 'sex', l: 'Sex', t: 'select', o: opts('male:Male|female:Female') }, { n: 'phone', l: 'Phone', t: 'tel' },
      { n: 'city', l: 'City / country' }, { n: 'occupation', l: 'Occupation' }, { n: 'emergency_contact', l: 'Emergency contact (name and phone)', wide: true }]],
    ['Physical and sport profile', [
      { n: 'height_cm', l: 'Height (cm)', t: 'number', step: '0.1' }, { n: 'weight_kg', l: 'Weight (kg)', t: 'number', step: '0.1' },
      { n: 'sport', l: 'Main sport or activity' }, { n: 'club_position', l: 'Club / team and position' },
      { n: 'level', l: 'Current level', t: 'select', o: opts('beginner:Beginner|intermediate:Intermediate|advanced:Advanced|elite:Competitive / elite') },
      { n: 'dominant_side', l: 'Dominant side', t: 'select', o: opts('right:Right|left:Left') }]],
    ['Goals', [
      { n: 'main_goals', l: 'Main goals', t: 'multi', o: opts('fat_loss:Fat loss|muscle_gain:Muscle gain|strength:Strength|endurance:Endurance|speed_power:Speed / power|performance:Sport performance|return_injury:Return from injury|health:General health') },
      { n: 'goals', l: 'Specific goal and deadline', t: 'area' }, { n: 'next_competition', l: 'Next competition or event (and date)', wide: true },
      { n: 'success_definition', l: 'What would make this programme a success?', t: 'area' }]],
    ['Training history', [
      { n: 'training_since', l: 'Training regularly for' }, { n: 'sessions_per_week', l: 'Sessions per week now', t: 'number', step: '1' },
      { n: 'recent_training', l: 'Recent training', t: 'multi', o: opts('weights:Weight training|cardio:Running / cardio|team_sport:Team sport|combat:Combat sport|flexibility:Flexibility / yoga|none:None') },
      { n: 'previous_coach', l: 'Worked with a coach before? What worked, what did not?', t: 'area' },
      { n: 'best_results', l: 'Best recent results or tests (loads, run times, jumps…)', t: 'area' }]],
    ['Health, injuries and limits', [
      { n: 'current_pain', l: 'Current pain or injury (where?)', t: 'area' }, { n: 'injuries', l: 'Past injuries or surgery (with dates)', t: 'area' },
      { n: 'chronic_conditions', l: 'Chronic conditions (heart, blood pressure, asthma, diabetes…)', t: 'area' },
      { n: 'medications', l: 'Regular medication', t: 'area' }, { n: 'movements_to_avoid', l: 'Exercises or movements to avoid', t: 'area' },
      { n: 'doctor_no_exercise', l: 'Ever advised by a doctor not to exercise?', t: 'yesno' },
      { n: 'chest_pain', l: 'Chest pain, dizziness or fainting during effort?', t: 'yesno' },
      { n: 'pregnant', l: 'Pregnant or recently given birth?', t: 'select', o: opts('yes:Yes|no:No|na:Not applicable') }]],
    ['Availability and organisation', [
      { n: 'available_days', l: 'Available days', t: 'multi', o: opts('mon:Monday|tue:Tuesday|wed:Wednesday|thu:Thursday|fri:Friday|sat:Saturday|sun:Sunday') },
      { n: 'preferred_time', l: 'Preferred time', t: 'multi', o: opts('morning:Morning|midday:Midday|evening:Evening') },
      { n: 'session_minutes', l: 'Session length', t: 'select', num: true, o: opts('45:45 min|60:60 min|90:90 min') },
      { n: 'training_format', l: 'Format', t: 'select', o: opts('in_person:In person|online:Online|both:Both') },
      { n: 'training_location', l: 'Where will you train?', t: 'multi', o: opts('gym:Gym|home:Home|outdoors:Outdoors|club:Club') },
      { n: 'equipment', l: 'Equipment available', t: 'area' }]],
    ['Lifestyle', [
      { n: 'sleep_hours', l: 'Average sleep per night (hours)', t: 'number', step: '0.5' },
      { n: 'stress_level', l: 'Stress level', t: 'select', num: true, o: opts('1:1 (low)|2:2|3:3|4:4|5:5 (high)') },
      { n: 'work_activity', l: 'Physical activity at work', t: 'select', o: opts('low:Low|moderate:Moderate|high:High') },
      { n: 'smoker', l: 'Smoker', t: 'yesno' }, { n: 'diet_notes', l: 'Eating habits, diet or food allergies', t: 'area' }]],
    ['Declaration and consent', [
      { n: 'intake_date', l: 'Form filled in on', t: 'date' },
      { n: 'consent', l: 'Agreed', t: 'multi', o: opts('accurate:The information above is true and complete|report:I will tell my coach about any change in health, pain or injury|store:I agree this information is kept in my Client Space') }]]
  ];
  function profileFields(p) {
    function input(f) {
      var v = p[f.n], name = ' name="' + f.n + '"', cls = f.wide ? ' class="wide"' : '';
      if (f.ro) return '<label' + cls + '>' + f.l + '<input value="' + esc(v) + '" disabled></label>';
      if (f.t === 'area') return '<label class="wide">' + f.l + '<textarea' + name + ' rows="2">' + esc(v) + '</textarea></label>';
      if (f.t === 'multi') {
        var on = v || [];
        return '<fieldset class="wide choices"><legend>' + f.l + '</legend>' + f.o.map(function (o) {
          return '<label class="check"><input type="checkbox"' + name + ' value="' + o[0] + '"' + (on.indexOf(o[0]) >= 0 ? ' checked' : '') + '> ' + esc(o[1]) + '</label>';
        }).join('') + '</fieldset>';
      }
      if (f.t === 'select' || f.t === 'yesno') {
        var cur = f.t === 'yesno' ? (v === true ? 'yes' : v === false ? 'no' : '') : (v == null ? '' : String(v));
        return '<label' + cls + '>' + f.l + '<select' + name + '><option value="">—</option>' + (f.o || YESNO).map(function (o) {
          return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></label>';
      }
      return '<label' + cls + '>' + f.l + '<input' + name + ' type="' + (f.t || 'text') + '"' + (f.step ? ' step="' + f.step + '" min="0"' : '') + ' value="' + esc(v) + '"></label>';
    }
    return PROFILE.map(function (s) { return '<h3>' + esc(s[0]) + '</h3>' + s[1].map(input).join(''); }).join('');
  }
  // Reads the profile form into a row for public.profiles (empty means null).
  function readProfile(form) {
    var row = {};
    PROFILE.forEach(function (s) {
      s[1].forEach(function (f) {
        if (f.ro) return;
        if (f.t === 'multi') {
          var on = $$('input[name="' + f.n + '"]:checked', form).map(function (i) { return i.value; });
          row[f.n] = on.length ? on : null; return;
        }
        var v = form.elements[f.n].value.trim();
        row[f.n] = v === '' ? null : f.t === 'yesno' ? v === 'yes' : f.t === 'number' || f.num ? +v : v;
      });
    });
    row.full_name = row.full_name || '';
    row.birth_year = row.birth_date ? +row.birth_date.slice(0, 4) : null;
    return row;
  }
  // "Age 21 · BMI 19.0" from the saved profile.
  function profileSummary(p) {
    var bits = [];
    if (p.birth_date) {
      var b = new Date(p.birth_date + 'T00:00:00'), n = new Date(), age = n.getFullYear() - b.getFullYear();
      if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
      bits.push('Age ' + age);
    } else if (p.birth_year) bits.push('Age about ' + (new Date().getFullYear() - p.birth_year));
    if (p.height_cm && p.weight_kg) bits.push('BMI ' + (p.weight_kg / Math.pow(p.height_cm / 100, 2)).toFixed(1));
    return bits.length ? '<p class="muted">' + bits.join(' · ') + '</p>' : '';
  }

  // ---- Nutrition: shared by the coach and client pages ----
  var MEALS = opts('breakfast:Breakfast|lunch:Lunch|dinner:Dinner|snack:Snack|other:Other');
  var MOMENTS = { week_start: 'Start of week', week_end: 'End of week' };
  function label(list, v) { var o = list.find(function (x) { return x[0] === v; }); return o ? o[1] : v; }
  function nutritionPlans(list, canDelete) {
    if (!list.length) return '<p class="empty">No nutrition programme or recommendation yet.</p>';
    return '<ul class="list">' + list.map(function (n) {
      return '<li><div class="row"><span><span class="tag">' + (n.kind === 'recommendation' ? 'Recommendation' : 'Programme') + '</span> <strong>' + esc(n.title) + '</strong></span>' +
        '<span><span class="date">' + esc(fmtDate(n.created_at)) + '</span>' + (canDelete ? ' · <button class="link-btn danger" data-del-plan="' + n.id + '" data-path="' + esc(n.file_path || '') + '">Delete</button>' : '') + '</span></div>' +
        (n.body ? '<p class="pre" style="margin-top:.5rem">' + esc(n.body) + '</p>' : '') +
        (n.file_path ? '<p style="margin-top:.5rem"><a href="#" data-file="' + esc(n.file_path) + '">Open the attached file</a></p>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  // Weigh-ins sorted oldest first: summary cards, chart and table with the change since the previous weigh-in.
  function weightHistory(logs, canDelete) {
    if (!logs.length) return '<p class="empty">No weigh-ins yet.</p>';
    var first = logs[0], last = logs[logs.length - 1], d = last.weight_kg - first.weight_kg;
    var end = logs.slice().reverse().find(function (l) { return l.moment === 'week_end'; });
    var start = end && logs.slice().reverse().find(function (l) { return l.moment === 'week_start' && l.log_date <= end.log_date && l.log_date >= addDays(end.log_date, -7); });
    function sign(v) { return (v > 0 ? '+' : '') + (+v.toFixed(1)) + ' kg'; }
    var minDate = addDays(today(), -14);
    return '<div class="cards"><div class="card"><span class="k">Latest weight</span><span class="v">' + esc(last.weight_kg) + ' kg</span><span class="muted">' + esc(fmtDate(last.log_date)) + '</span></div>' +
      '<div class="card"><span class="k">Last full week</span><span class="v">' + (start ? sign(end.weight_kg - start.weight_kg) : '—') + '</span><span class="muted">' + (start ? esc(start.weight_kg) + ' → ' + esc(end.weight_kg) + ' kg' : 'Needs a start and an end weigh-in') + '</span></div>' +
      '<div class="card"><span class="k">Since first weigh-in</span><span class="v">' + (logs.length > 1 ? sign(d) : '—') + '</span><span class="muted">' + esc(fmtDate(first.log_date)) + '</span></div></div>' +
      '<div class="card" style="margin-top:1rem"><span class="k">Body weight (kg)</span>' + lineChart(logs.map(function (l) { return { date: l.log_date, value: l.weight_kg }; }), 'kg') + '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Weigh-in</th><th>Weight</th><th>Change</th><th>Notes</th><th></th></tr></thead><tbody>' +
      logs.map(function (l, i) {
        var ch = i ? l.weight_kg - logs[i - 1].weight_kg : null;
        return '<tr><td class="num">' + esc(fmtDate(l.log_date, { weekday: 'short', day: 'numeric', month: 'short' })) + '</td><td>' + MOMENTS[l.moment] + '</td><td class="num"><strong>' + esc(l.weight_kg) + ' kg</strong></td>' +
          '<td class="num">' + (ch == null ? '' : sign(ch)) + '</td><td>' + esc(l.notes) + '</td><td>' +
          (canDelete === 'all' || (canDelete && l.log_date >= minDate) ? '<button class="link-btn danger" data-del-weight="' + l.id + '">Delete</button>' : '') + '</td></tr>';
      }).reverse().join('') + '</tbody></table></div>';
  }
  function supplementList(list, canEdit) {
    if (!list.length) return '<p class="empty">No supplements listed.</p>';
    return '<ul class="list">' + list.map(function (s) {
      return '<li class="supp' + (s.active ? '' : ' muted') + '">' + (s.photo_path ? '<img alt="" data-photo="' + esc(s.photo_path) + '">' : '') + '<div><div class="row"><strong>' + esc(s.name) + '</strong><span>' +
        (s.active ? '<span class="tag done">Taking now</span>' : '<span class="tag">Stopped</span>') +
        (canEdit ? ' <button class="link-btn" data-supp-toggle="' + s.id + '" data-on="' + (s.active ? 1 : 0) + '">' + (s.active ? 'Mark stopped' : 'Taking again') + '</button> · <button class="link-btn danger" data-del-supp="' + s.id + '" data-path="' + esc(s.photo_path || '') + '">Delete</button>' : '') + '</span></div>' +
        '<p class="muted">' + [s.dose, s.timing].filter(Boolean).map(esc).join(' · ') + '</p>' + (s.notes ? '<p class="pre">' + esc(s.notes) + '</p>' : '') + '</div></li>';
    }).join('') + '</ul>';
  }
  // Meal photos grouped by day, newest first. who: 'client' (may delete recent ones) or 'coach' (comments).
  function mealGallery(meals, who) {
    if (!meals.length) return '<p class="empty">No meal photos yet.</p>';
    var days = {}, order = [], minDate = addDays(today(), -7);
    meals.forEach(function (m) { if (!days[m.meal_date]) { days[m.meal_date] = []; order.push(m.meal_date); } days[m.meal_date].push(m); });
    order.sort().reverse();
    return order.map(function (d) {
      return '<h4 class="date" style="margin:1.25rem 0 .5rem">' + esc(fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })) + '</h4><div class="meals">' +
        days[d].map(function (m) {
          return '<figure class="meal"><a href="#" data-file="' + esc(m.photo_path) + '"><img alt="' + esc(label(MEALS, m.meal)) + '" data-photo="' + esc(m.photo_path) + '"></a><figcaption><strong>' + esc(label(MEALS, m.meal)) + '</strong>' +
            (m.notes ? '<span class="pre">' + esc(m.notes) + '</span>' : '') +
            (who === 'coach'
              ? '<form class="meal-comment" data-id="' + m.id + '"><textarea name="c" rows="2" maxlength="1000" placeholder="Comment for the client" aria-label="Coach comment">' + esc(m.coach_comment) + '</textarea><button class="btn btn-line btn-small" type="submit">Save</button> <span class="status" role="status"></span></form>'
              : (m.coach_comment ? '<span class="coach-c"><b>Coach:</b> ' + esc(m.coach_comment) + '</span>' : '')) +
            (who === 'coach' || m.meal_date >= minDate ? '<button class="link-btn danger" data-del-meal="' + m.id + '" data-path="' + esc(m.photo_path) + '">Delete</button>' : '') +
            '</figcaption></figure>';
        }).join('') + '</div>';
    }).join('');
  }
  // Fills every <img data-photo> in root with a short-lived signed link (one request for all).
  async function loadPhotos(root) {
    var imgs = $$('img[data-photo]', root);
    if (!imgs.length) return;
    var paths = Array.from(new Set(imgs.map(function (i) { return i.getAttribute('data-photo'); })));
    var r = await sb.storage.from('client-files').createSignedUrls(paths, 3600);
    if (r.error) return;
    var url = {}; r.data.forEach(function (x) { if (x.signedUrl) url[x.path] = x.signedUrl; });
    imgs.forEach(function (i) { var u = url[i.getAttribute('data-photo')]; if (u) i.src = u; });
  }
  // Shrinks a phone photo to at most 1600 px (JPEG) before upload; returns the original if the browser cannot read it.
  function compressImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type)) return resolve(file);
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { resolve(b && b.size < file.size ? b : file); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(u); resolve(file); };
      img.src = u;
    });
  }

  window.Portal = {
    ready: ready, sb: sb, esc: esc, fmtDate: fmtDate, fmtDateTime: fmtDateTime, today: today,
    $: $, $$: $$, say: say, must: must, requireUser: requireUser, notConfigured: notConfigured,
    signedUrl: signedUrl, bindFileLinks: bindFileLinks, tabs: tabs, lineChart: lineChart, HOOPER: HOOPER, wellnessHistory: wellnessHistory, CR10: CR10, rpeGuide: rpeGuide, bindRpeGuide: bindRpeGuide, addDays: addDays, loadMetrics: loadMetrics, srpeHistory: srpeHistory, bindLoadViews: bindLoadViews, SESSION_TYPES: SESSION_TYPES,
    profileFields: profileFields, readProfile: readProfile, profileSummary: profileSummary,
    MEALS: MEALS, MOMENTS: MOMENTS, nutritionPlans: nutritionPlans, weightHistory: weightHistory, supplementList: supplementList,
    mealGallery: mealGallery, loadPhotos: loadPhotos, compressImage: compressImage
  };
})();
