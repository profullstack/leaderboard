/**
 * The embeddable widget, served by the leaderboard at `${basePath}/embed.js`.
 * One script tag on any page, ours or a partner's:
 *
 *   <div data-leaderboard></div>
 *   <script src="https://nichedb.dev/leaderboard/embed.js"
 *           data-board="earnings" data-period="week" data-limit="10"
 *           data-me="u_42" data-sticky="bottom-right" data-theme="dark"></script>
 *
 * Attributes: board, period, limit, me (highlight and show my standing),
 * sticky (bottom-right | bottom-left | top-right | top-left: a corner pill
 * that opens the board), theme (light | dark | auto), title, refresh (seconds,
 * 0 to disable), target (a CSS selector for the container), base (the
 * leaderboard path when the script is served from somewhere else).
 *
 * Kept as a string so the package has no build step and runs at the edge.
 */
export function widgetSource() {
  return WIDGET;
}

const WIDGET = String.raw`(function () {
  var script = document.currentScript;
  if (!script) return;
  var d = script.dataset;
  var src = new URL(script.src, location.href);
  var base = d.base || src.pathname.replace(/\/embed\.js$/, '');
  var origin = src.origin;
  var board = d.board || '';
  var period = d.period || '';
  var limit = d.limit || '10';
  var me = d.me || '';
  var sticky = d.sticky || '';
  var theme = d.theme || 'auto';
  var refresh = d.refresh === undefined ? 60 : Number(d.refresh) || 0;
  var periods = null;

  var CSS = '.pflb{--bg:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#2563eb;--gold:#b45309;--hi:#eff6ff;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-sizing:border-box}' +
    '.pflb.dark{--bg:#0f1219;--fg:#e8eaf0;--muted:#8b93a7;--line:#242a38;--accent:#7cc4ff;--gold:#fbbf24;--hi:#172033}' +
    '@media (prefers-color-scheme:dark){.pflb.auto{--bg:#0f1219;--fg:#e8eaf0;--muted:#8b93a7;--line:#242a38;--accent:#7cc4ff;--gold:#fbbf24;--hi:#172033}}' +
    '.pflb *{box-sizing:border-box}.pflb a{color:inherit;text-decoration:none}' +
    '.pflb-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}' +
    '.pflb-title{font-weight:700;font-size:15px;margin:0}.pflb-tabs{display:flex;gap:4px;flex-wrap:wrap}' +
    '.pflb-tabs button{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer}' +
    '.pflb-tabs button.on{background:var(--accent);border-color:var(--accent);color:#fff}' +
    '.pflb table{width:100%;border-collapse:collapse}.pflb td,.pflb th{padding:9px 14px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}' +
    '.pflb th{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:600}' +
    '.pflb tr.me td{background:var(--hi)}.pflb td.rank{font-weight:800;color:var(--muted);width:44px}.pflb td.rank.top{color:var(--gold)}' +
    '.pflb td.name{font-weight:600;white-space:normal}.pflb td.val{font-weight:700;text-align:right}.pflb td.streak{color:var(--muted);text-align:right}' +
    '.pflb .badges{margin-left:6px;font-size:13px;letter-spacing:1px}.pflb .share{margin-left:8px;font-size:11px;color:var(--muted);cursor:pointer;opacity:0;transition:opacity .15s}.pflb tr:hover .share{opacity:1}' +
    '.pflb-foot{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;font-size:12px;color:var(--muted);flex-wrap:wrap}.pflb-foot a{color:var(--accent)}' +
    '.pflb-empty{padding:24px 14px;color:var(--muted);text-align:center}' +
    '.pflb-pill{position:fixed;z-index:2147483000;font:13px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#111827;color:#fff;border-radius:999px;padding:10px 14px;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer;border:0;display:flex;align-items:center;gap:8px}' +
    '.pflb-panel{position:fixed;z-index:2147483000;width:min(420px,calc(100vw - 24px));max-height:min(70vh,640px);overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
    '.pflb-panel .pflb-close{font:inherit;background:transparent;border:0;color:var(--muted);cursor:pointer;font-size:18px;line-height:1}';

  function ensureStyle() {
    if (document.getElementById('pflb-style')) return;
    var s = document.createElement('style');
    s.id = 'pflb-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function findTarget() {
    if (d.target) { var t = document.querySelector(d.target); if (t) return t; }
    var prev = script.previousElementSibling;
    while (prev) { if (prev.hasAttribute('data-leaderboard')) return prev; prev = prev.previousElementSibling; }
    var any = document.querySelector('[data-leaderboard]:empty');
    if (any) return any;
    var div = document.createElement('div');
    script.parentNode.insertBefore(div, script);
    return div;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function label(p) { return { all: 'All time', day: 'Today', week: 'Week', month: 'Month' }[p] || p; }

  function url(kind) {
    var u = origin + base + '/' + board + '.' + kind + '?period=' + encodeURIComponent(period) + '&limit=' + encodeURIComponent(limit);
    if (me && kind === 'json') u += '&me=' + encodeURIComponent(me);
    return u;
  }

  function copy(text, el) {
    var done = function () { var was = el.textContent; el.textContent = 'copied'; setTimeout(function () { el.textContent = was; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt('Share link', text); });
    else prompt('Share link', text);
  }

  function render(root, data) {
    var rows = data.rows || [];
    if (!board) board = data.board.id;
    if (!periods) periods = data.periods || ['all'];
    period = data.period;
    var title = d.title || data.board.label;
    var tabs = periods.map(function (p) { return '<button type="button" data-p="' + esc(p) + '" class="' + (p === period ? 'on' : '') + '">' + esc(label(p)) + '</button>'; }).join('');
    var body = rows.length ? rows.map(function (r) {
      var isMe = me && r.id === me;
      var badges = (r.badges || []).map(function (b) { return '<span title="' + esc(b.label) + '">' + esc(b.emoji) + '</span>'; }).join('');
      var share = origin + base + '/u/' + encodeURIComponent(r.id);
      return '<tr class="' + (isMe ? 'me' : '') + '">' +
        '<td class="rank ' + (r.rank <= 3 ? 'top' : '') + '">' + (r.rank < 10 ? '0' : '') + r.rank + '</td>' +
        '<td class="name"><a href="' + esc(origin + r.url) + '">' + esc(r.name) + '</a>' + (badges ? '<span class="badges">' + badges + '</span>' : '') +
          (r.commission != null ? ' <span style="color:var(--muted);font-weight:400;font-size:12px">' + r.commission + '%</span>' : '') +
          '<span class="share" data-share="' + esc(share) + '">share</span></td>' +
        '<td class="val">' + esc(r.display) + '</td>' +
        '<td class="streak" title="streak">' + (r.streak ? '🔥' + r.streak : '') + '</td></tr>';
    }).join('') : '';
    var meRow = '';
    if (data.me && !rows.some(function (r) { return r.id === me; })) {
      var m = data.me;
      meRow = '<tr class="me"><td class="rank">' + (m.rank ? (m.rank < 10 ? '0' : '') + m.rank : '–') + '</td><td class="name">' + esc(m.name) + ' <span style="color:var(--muted);font-weight:400">(you)</span></td><td class="val">' + esc(m.display) + '</td><td class="streak">' + (m.streak ? '🔥' + m.streak : '') + '</td></tr>';
    }
    root.innerHTML =
      '<div class="pflb-head"><h3 class="pflb-title">' + esc(title) + '</h3><div class="pflb-tabs">' + tabs + '</div>' + (root.classList.contains('pflb-panel') ? '<button class="pflb-close" aria-label="Close">×</button>' : '') + '</div>' +
      (rows.length || meRow
        ? '<table><thead><tr><th>#</th><th>Name</th><th style="text-align:right">' + esc(data.board.unit || data.board.label) + '</th><th></th></tr></thead><tbody>' + body + meRow + '</tbody></table>'
        : '<div class="pflb-empty">Nobody on the board yet. Be first.</div>') +
      '<div class="pflb-foot"><span>' + esc(label(period)) + ' · ' + esc(String(data.total || rows.length)) + ' ranked</span><span><a href="' + esc(url('xml')) + '">RSS</a> · <a href="' + esc(origin + base + '?board=' + encodeURIComponent(board) + '&period=' + encodeURIComponent(period)) + '">Full board</a></span></div>';
    root.querySelectorAll('.pflb-tabs button').forEach(function (b) { b.addEventListener('click', function () { period = b.dataset.p; load(root); }); });
    root.querySelectorAll('.share').forEach(function (s) { s.addEventListener('click', function (e) { e.preventDefault(); copy(s.dataset.share, s); }); });
    var close = root.querySelector('.pflb-close');
    if (close) close.addEventListener('click', function () { root.hidden = true; });
    root.dispatchEvent(new CustomEvent('leaderboard:render', { bubbles: true, detail: data }));
    return data;
  }

  function load(root) {
    if (!board) {
      return fetch(origin + base + '.json').then(function (r) { return r.json(); }).then(function (idx) {
        board = (idx.boards[0] || {}).id; periods = idx.periods; period = period || idx.defaultPeriod; return load(root);
      });
    }
    return fetch(url('json')).then(function (r) { return r.json(); }).then(function (data) { return render(root, data); }).catch(function () {
      root.innerHTML = '<div class="pflb-empty">Leaderboard unavailable.</div>';
    });
  }

  ensureStyle();
  var root;
  if (sticky) {
    var pos = sticky.split('-');
    var v = pos[0] === 'top' ? 'top' : 'bottom', h = pos[1] === 'left' ? 'left' : 'right';
    var pill = document.createElement('button');
    pill.className = 'pflb-pill';
    pill.style[v] = '16px'; pill.style[h] = '16px';
    pill.innerHTML = '🏆 <span>Leaderboard</span>';
    root = document.createElement('div');
    root.className = 'pflb pflb-panel ' + theme;
    root.hidden = true;
    root.style[v] = '64px'; root.style[h] = '16px';
    document.body.appendChild(pill); document.body.appendChild(root);
    pill.addEventListener('click', function () { root.hidden = !root.hidden; if (!root.hidden) load(root); });
    root.addEventListener('leaderboard:render', function (e) {
      var data = e.detail; var m = data.me; var top = (data.rows || [])[0];
      pill.querySelector('span').textContent = m && m.rank ? 'You are #' + m.rank + ' ' + label(data.period).toLowerCase() : top ? '#1 ' + top.name : 'Leaderboard';
    });
    load(root);
  } else {
    root = findTarget();
    root.classList.add('pflb', theme);
    load(root);
  }
  if (refresh > 0) setInterval(function () { if (!document.hidden && !root.hidden) load(root); }, refresh * 1000);
})();
`;
