// Admin dashboard — only accessible to zacharykhan894@gmail.com
const ADMIN_EMAIL = 'zacharykhan894@gmail.com';

function show(id) { document.getElementById(id)?.classList.add('active'); }
function hide(id) { document.getElementById(id)?.classList.remove('active'); }

function showDenied(msg) {
  hide('gate-loading');
  const el = document.getElementById('gate-denied-msg');
  if (el && msg) el.textContent = msg;
  show('gate-denied');
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function scoreClass(n) {
  if (n >= 70) return 'high';
  if (n >= 50) return 'mid';
  return 'low';
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function renderStats(data) {
  // Analyses
  setText('s-all-time', data.analyses.allTime.toLocaleString());
  setText('s-today',    data.analyses.today.toLocaleString());
  setText('s-week',     data.analyses.thisWeek.toLocaleString());
  setText('s-avg',      data.avgScore ?? '—');

  // Users
  setText('s-users',  data.users.total.toLocaleString());
  setText('s-free',   data.users.free.toLocaleString());
  setText('s-report', data.users.report.toLocaleString());
  setText('s-pro',    data.users.pro.toLocaleString());

  // Conversion
  setText('s-conv',     data.users.conversionRate + '%');
  setText('s-conv-sub', `${data.users.paidTotal} paid of ${data.users.total} total`);

  // Conversion bar
  const total = data.users.total || 1;
  const reportPct = (data.users.report / total * 100).toFixed(1);
  const proPct    = (data.users.pro    / total * 100).toFixed(1);
  const freePct   = Math.max(0, 100 - parseFloat(reportPct) - parseFloat(proPct));
  const reportEl  = document.getElementById('conv-bar-report');
  const proEl     = document.getElementById('conv-bar-pro');
  const freeEl    = document.getElementById('conv-bar-free');
  if (freeEl)   freeEl.style.width   = freePct + '%';
  if (reportEl) { reportEl.style.left = freePct + '%'; reportEl.style.width = reportPct + '%'; }
  if (proEl)    { proEl.style.left = (freePct + parseFloat(reportPct)) + '%'; proEl.style.width = proPct + '%'; }

  // Top killers
  const killerEl = document.getElementById('killers-list');
  if (killerEl && data.topKillers.length > 0) {
    const maxCount = data.topKillers[0].count;
    killerEl.innerHTML = data.topKillers.map(k => `
      <div class="killer-row">
        <span class="killer-name">${k.killer || 'Unknown'}</span>
        <div class="killer-bar-wrap">
          <div class="killer-bar" style="width:${Math.round((k.count / maxCount) * 100)}%"></div>
        </div>
        <span class="killer-count">${k.count}</span>
      </div>`).join('');
  } else if (killerEl) {
    killerEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No data yet</p>';
  }

  // Recent analyses table
  const tbody = document.getElementById('recent-tbody');
  if (tbody) {
    if (data.recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;color:var(--text-muted);text-align:center">No analyses yet</td></tr>';
    } else {
      tbody.innerHTML = data.recent.map(r => `
        <tr>
          <td class="ts-cell">${relativeTime(r.timestamp)}</td>
          <td class="email-cell" title="${r.email}">${r.email}</td>
          <td><span class="score-badge ${scoreClass(r.overallScore)}">${r.overallScore}</span></td>
          <td style="font-size:0.83rem">${r.biggestKiller || '—'}</td>
          <td>${r.goal ? `<span class="goal-pill">${r.goal}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
        </tr>`).join('');
    }
  }

  // Last updated
  setText('last-updated', 'Updated ' + new Date().toLocaleTimeString());
}

async function loadStats(clerk) {
  const token = await clerk.session?.getToken();
  const res = await fetch('/api/admin/stats', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function init() {
  // Wait for Clerk to be available
  let attempts = 0;
  while (!window.Clerk && attempts < 30) {
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }

  if (!window.Clerk) {
    showDenied('Could not load authentication. Please refresh.');
    return;
  }

  // Fetch Clerk publishable key from config API
  let publishableKey;
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    publishableKey = cfg.clerkPublishableKey;
  } catch { /* use env var fallback */ }

  const clerk = window.Clerk;
  try {
    await clerk.load({ publishableKey });
  } catch (err) {
    showDenied('Authentication failed to load. Please refresh.');
    return;
  }

  if (!clerk.user) {
    showDenied('You need to be logged in to access this page.');
    return;
  }

  const email = clerk.user.primaryEmailAddress?.emailAddress || '';
  if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    showDenied(`Access denied. This dashboard is restricted to admin users.`);
    return;
  }

  // Load and render stats
  hide('gate-loading');
  const dash = document.getElementById('dashboard');
  if (dash) dash.classList.add('active');

  try {
    const stats = await loadStats(clerk);
    renderStats(stats);
  } catch (err) {
    document.getElementById('recent-tbody').innerHTML =
      `<tr><td colspan="5" style="padding:20px;color:var(--red);text-align:center">Failed to load stats: ${err.message}</td></tr>`;
  }

  // Refresh button
  document.getElementById('refresh-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      const stats = await loadStats(clerk);
      renderStats(stats);
    } catch { /* silent */ }
    if (btn) { btn.disabled = false; btn.textContent = '↺ Refresh'; }
  });
}

init();
