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
  var CR10 = ['Rest', 'Very, very easy', 'Easy', 'Moderate', 'Somewhat hard', 'Hard', 'Hard +', 'Very hard', 'Very hard +', 'Very hard ++', 'Maximal'];
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
  function srpeHistory(entries, canDelete) {
    if (!entries.length) return '<p class="empty">No sessions logged yet.</p>';
    var k = loadMetrics(entries);
    function card(label, value, note) { return '<div class="card"><span class="k">' + label + '</span><span class="v">' + value + '</span>' + (note ? '<span class="muted" style="font-size:.85rem">' + note + '</span>' : '') + '</div>'; }
    var acwrNote = k.acwr == null ? 'Needs 3-4 weeks of logs'
      : k.acwr > 1.5 ? '<span class="delta-down">High: above 1.5</span>'
      : k.acwr > 1.3 ? 'Caution: 1.3-1.5'
      : k.acwr < 0.8 ? 'Low: below 0.8' : 'In the 0.8-1.3 range';
    var cards = '<div class="cards">' + card('Today', k.today + ' AU') + card('Last 7 days (acute)', k.acute + ' AU') +
      card('28-day weekly average (chronic)', Math.round(k.chronic) + ' AU') +
      card('ACWR', k.acwr == null ? '—' : k.acwr.toFixed(2), acwrNote) +
      card('Monotony (7 days)', k.monotony == null ? '—' : k.monotony.toFixed(2), k.monotony != null && k.monotony > 2 ? '<span class="delta-down">High: above 2</span>' : 'Mean / SD of daily load') +
      card('Strain (7 days)', k.strain == null ? '—' : Math.round(k.strain) + ' AU', 'Weekly load × monotony') + '</div>';
    var chart = '<div class="card" style="margin-top:1rem"><span class="k">Daily load, last 28 days (AU)</span>' + lineChart(k.daily28, 'AU') + '</div>';
    var rows = entries.slice().sort(function (a, b) { return a.session_date < b.session_date ? 1 : a.session_date > b.session_date ? -1 : b.id - a.id; }).slice(0, 40);
    var minDate = addDays(today(), -7);
    var table = '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Session</th><th>RPE</th><th>Minutes</th><th>Load (AU)</th><th>Notes</th><th></th></tr></thead><tbody>' +
      rows.map(function (e) {
        return '<tr><td class="num">' + esc(fmtDate(e.session_date, { weekday: 'short', day: 'numeric', month: 'short' })) + '</td><td>' + esc(e.session_type) + '</td><td class="num">' + esc(e.rpe) +
          '</td><td class="num">' + esc(e.duration_min) + '</td><td class="num"><strong>' + esc(e.load_au) + '</strong></td><td>' + esc(e.notes) + '</td><td>' +
          (canDelete === 'all' || (canDelete && e.session_date >= minDate) ? '<button class="link-btn danger" data-del-srpe="' + e.id + '">Delete</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return cards + chart + '<h3>Sessions</h3>' + table;
  }

  window.Portal = {
    ready: ready, sb: sb, esc: esc, fmtDate: fmtDate, fmtDateTime: fmtDateTime, today: today,
    $: $, $$: $$, say: say, must: must, requireUser: requireUser, notConfigured: notConfigured,
    signedUrl: signedUrl, bindFileLinks: bindFileLinks, tabs: tabs, lineChart: lineChart, HOOPER: HOOPER, wellnessHistory: wellnessHistory, CR10: CR10, addDays: addDays, loadMetrics: loadMetrics, srpeHistory: srpeHistory
  };
})();
