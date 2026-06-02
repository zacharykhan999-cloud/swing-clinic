// Clerk is loaded via <script> tag in index.html → window.Clerk

// ── State ────────────────────────────────────────
const state = {
  goal: null,
  handicap: null,
  years: null,
  coach: null,
  file: null,
  results: null,
};

// ── Screen Router ─────────────────────────────────
const NAV_SCREENS = new Set(['screen-results', 'screen-progress', 'screen-compare']);
const NAV_TAB_MAP = { 'screen-results': 'home', 'screen-progress': 'progress', 'screen-compare': 'compare' };

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
    window.scrollTo(0, 0);
  }
  const nav = document.getElementById('bottom-nav');
  if (nav) {
    const show = NAV_SCREENS.has(id);
    nav.classList.toggle('visible', show);
    if (show) {
      document.querySelectorAll('.nav-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === NAV_TAB_MAP[id])
      );
    }
  }
}

// ── Splash ────────────────────────────────────────
document.getElementById('splash-cta').addEventListener('click', () => showScreen('screen-goal'));

// ── Goal Selection ────────────────────────────────
const goalGrid = document.getElementById('goal-grid');
const goalNext = document.getElementById('goal-next');

goalGrid.querySelectorAll('.goal-card').forEach(btn => {
  btn.addEventListener('click', () => {
    goalGrid.querySelectorAll('.goal-card').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.goal = btn.dataset.goal;
    goalNext.disabled = false;
  });
});

goalNext.addEventListener('click', () => showScreen('screen-profile'));

// ── Profile ───────────────────────────────────────
const handicapEl  = document.getElementById('handicap');
const yearsEl     = document.getElementById('years');
const coachGrid   = document.getElementById('coach-grid');
const profileNext = document.getElementById('profile-next');

function checkProfileComplete() {
  profileNext.disabled = !(state.handicap && state.years && state.coach);
}

handicapEl.addEventListener('change', () => { state.handicap = handicapEl.value; checkProfileComplete(); });
yearsEl.addEventListener('change',    () => { state.years = yearsEl.value; checkProfileComplete(); });

coachGrid.querySelectorAll('.coach-card').forEach(btn => {
  btn.addEventListener('click', () => {
    coachGrid.querySelectorAll('.coach-card').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.coach = btn.dataset.coach;
    checkProfileComplete();
  });
});

profileNext.addEventListener('click', () => showScreen('screen-upload'));

// ── Video Upload ──────────────────────────────────
const uploadZone    = document.getElementById('upload-zone');
const fileInput     = document.getElementById('file-input');
const uploadBrowse  = document.getElementById('upload-browse');
const uploadAnalyse = document.getElementById('upload-analyse');
const fileInfo      = document.getElementById('upload-file-info');
const fileNameEl    = document.getElementById('file-name');
const fileSizeEl    = document.getElementById('file-size');
const fileRemove    = document.getElementById('file-remove');

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function setFile(file) {
  if (!file || !file.type.startsWith('video/')) return;
  state.file = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  fileInfo.classList.remove('hidden');
  uploadZone.style.display = 'none';
  uploadAnalyse.disabled = false;
}

uploadBrowse.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

fileRemove.addEventListener('click', () => {
  state.file = null;
  fileInfo.classList.add('hidden');
  uploadZone.style.display = '';
  uploadAnalyse.disabled = true;
  fileInput.value = '';
});

uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragging'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragging'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

uploadAnalyse.addEventListener('click', () => {
  showScreen('screen-analysing');
  runAnalysis();
});

// ── Analysis ──────────────────────────────────────
const STEP_DURATIONS = [800, 1200, 1500, 1200, 1000];

async function animateSteps() {
  const items = document.querySelectorAll('.step-item');
  for (let i = 0; i < items.length; i++) {
    items[i].classList.add('active');
    await wait(STEP_DURATIONS[i]);
    items[i].classList.remove('active');
    items[i].classList.add('done');
  }
}

async function extractFrames(file, count = 6) {
  return new Promise((resolve) => {
    const video  = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    const frames = [];

    video.src = URL.createObjectURL(file);
    video.muted = true;

    video.addEventListener('loadedmetadata', async () => {
      canvas.width  = 320;
      canvas.height = 180;
      const step = video.duration / (count + 1);

      for (let i = 1; i <= count; i++) {
        video.currentTime = step * i;
        await new Promise(r => video.addEventListener('seeked', r, { once: true }));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', 0.6).split(',')[1]);
      }
      URL.revokeObjectURL(video.src);
      resolve(frames);
    });

    video.addEventListener('error', () => resolve([]));
    video.load();
  });
}

async function callAPI(frames) {
  const response = await fetch('/api/analyse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frames,
      goal: state.goal,
      averageScore: state.handicap,
      years: state.years,
      coach: state.coach,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || `Server error ${response.status}`);
  }

  return response.json();
}

function getMockResults() {
  const scores = {
    'Backswing Plane':       62,
    'Downswing Plane':       58,
    'Hip Rotation':          71,
    'Shoulder Turn':         75,
    'Weight Transfer':       54,
    'Club Face at Impact':   49,
    'Ball Position':         80,
    'Grip':                  85,
    'Follow Through':        66,
    'Head Stability':        60,
    'Tempo & Rhythm':        73,
  };

  const avg = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 11);

  const biggestKillerKey = Object.entries(scores).sort((a, b) => a[1] - b[1])[0][0];

  const killerDescriptions = {
    'Club Face at Impact': 'Your club face is arriving open at impact, causing a consistent left-to-right ball flight. This single fault is costing you distance and accuracy on almost every shot.',
    'Weight Transfer': 'You\'re hanging back on your rear foot through impact, robbing you of power and causing thin or fat contact.',
    'Downswing Plane': 'Your downswing is too steep, causing an over-the-top move that produces slices and pull-hooks.',
  };

  const drillsByGoal = {
    'Fix my slice': [
      { name: 'Gate Drill', desc: 'Place two tees just outside the ball on both sides and practice swinging through without hitting them. Encourages an inside-out path.', reps: '20 reps · Daily' },
      { name: 'Towel Under Arm', desc: 'Place a towel under your trail arm and keep it connected through impact. Eliminates the chicken-wing that opens the face.', reps: '15 swings · 3×/week' },
    ],
    'Hit longer drives': [
      { name: 'Step-Through Drill', desc: 'Start with feet together, step forward with your lead foot as you swing. Forces weight shift and hip drive through impact.', reps: '15 reps · Daily' },
      { name: 'Pause at Top', desc: 'Take the club to the top and pause for 2 seconds before swinging. Builds sequence awareness and lag retention.', reps: '10 reps · Daily' },
    ],
    default: [
      { name: 'Impact Bag Work', desc: 'Strike an impact bag or folded towel 20 times focusing on leading with the hands and a flat lead wrist at impact.', reps: '20 reps · 3×/week' },
      { name: 'Split-Grip Drill', desc: 'Choke down so your hands are 6 inches apart. Make slow swings — this instantly reveals swing path faults and builds awareness.', reps: '10 swings · Daily' },
    ],
  };

  const coachMessages = {
    Technician: `Your data shows a ${avg}/100 swing score with your primary fault being ${biggestKillerKey}. Mechanically, your grip and ball position are solid foundations — the issue is sequencing. Focus on the two drills and you should see measurable improvement within 3–4 weeks.`,
    Competitor: `${avg} out of 100. That's where you are right now — and it's not where you're going. Your ${biggestKillerKey} is costing you shots every single round. Fix that one thing and you'll be competing at a completely different level within a month. Get after it.`,
    Motivator: `Great job getting your swing on camera — that's already more than most golfers do! Your score of ${avg}/100 shows real potential. Your grip and ball position are genuinely strong. Work on the two drills below and you'll be amazed how quickly your ball-striking improves. You've got this!`,
  };

  const drills = drillsByGoal[state.goal] || drillsByGoal.default;
  const coachMsg = coachMessages[state.coach] || coachMessages.Technician;
  const killerDesc = killerDescriptions[biggestKillerKey] || `Your ${biggestKillerKey} is the area with the most room for improvement. Addressing this will have the biggest impact on your overall game.`;

  function handicapFromScore(score) {
    if (score >= 85) return { range: '+4 to +6',  reason: 'Your tempo, rotation, and impact position are consistent with a tour-level player.' };
    if (score >= 72) return { range: '0 to 9',    reason: 'Your swing mechanics and sequencing indicate a single-figure handicap golfer.' };
    if (score >= 55) return { range: '10 to 18',  reason: 'Your rotation and weight transfer scores suggest a mid-handicap player with a solid base to build on.' };
    if (score >= 38) return { range: '19 to 28',  reason: 'Key sequencing and impact issues are typical of a high-handicap player still developing consistency.' };
    return              { range: '28 to 36',  reason: 'Fundamental movement patterns suggest a beginner still building core swing mechanics.' };
  }

  const handicapEstimate = handicapFromScore(avg);

  return {
    overallScore: avg,
    variables: scores,
    biggestKiller: biggestKillerKey,
    biggestKillerDesc: killerDesc,
    drills,
    coachMessage: coachMsg,
    handicapEstimate,
  };
}

async function showError(message) {
  const el = document.getElementById('screen-analysing');
  el.innerHTML = `
    <div class="screen-inner analysing-inner" style="gap:24px">
      <div style="font-size:3rem">⚠️</div>
      <h1 class="heading" style="font-size:2rem;color:#ff4d4d">ANALYSIS FAILED</h1>
      <p class="subtext" style="color:#ff9999;max-width:320px;text-align:center">${message}</p>
      <button class="btn-primary" style="max-width:280px" onclick="location.reload()">Try Again</button>
    </div>`;
}

async function runAnalysis() {
  const stepsPromise = animateSteps();
  let frames = [];

  try {
    frames = await extractFrames(state.file);
    state.results = await callAPI(frames);
    await stepsPromise;
    await wait(400);
    showScreen('screen-results');
    renderResults(state.results);
  } catch (err) {
    await stepsPromise;
    showError(err.message || 'Unknown error. Check the console for details.');
    console.error('Analysis error:', err);
  }
}

// ── Results Rendering ─────────────────────────────
function getBarColor(score) {
  if (score >= 75) return '#00C46A';
  if (score >= 55) return '#f59e0b';
  return '#ef4444';
}

function gateCard(html) {
  return `<div class="upgrade-gate-card">${html}</div>`;
}

function renderResults(data) {
  const hasReport = hasReportAccess();
  const hasPro    = hasProAccess();

  // ── Score Ring (always) ─────────────────────────
  const circumference = 2 * Math.PI * 85;
  const offset = circumference - (data.overallScore / 100) * circumference;
  const ring = document.getElementById('ring-fill');
  const scoreNum = document.getElementById('score-number');
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ring.style.strokeDashoffset = offset;
      animateCounter(scoreNum, 0, data.overallScore, 1800);
    });
  });

  // ── Handicap Estimate (Report+) ─────────────────
  const hcCard = document.getElementById('handicap-estimate-card');
  if (hasReport && data.handicapEstimate) {
    hcCard.removeAttribute('data-locked');
    hcCard.innerHTML = `
      <div class="hc-badge">🏌️ ESTIMATED HANDICAP RANGE</div>
      <h2 class="hc-range">${data.handicapEstimate.range} handicap</h2>
      <p class="hc-reason">${data.handicapEstimate.reason}</p>`;
    hcCard.classList.remove('hidden');
  } else if (!hasReport) {
    hcCard.setAttribute('data-locked', '');
    hcCard.innerHTML = gateCard(`
      <div class="gate-icon">🏌️</div>
      <div class="gate-title">ESTIMATED HANDICAP RANGE</div>
      <p class="gate-text">Unlock your handicap estimate, full variable breakdown, and improvement forecast.</p>
      <a class="gate-btn gate-btn--report" href="${WHOP_REPORT}" target="_blank" rel="noopener">Get Report — £7.99</a>
      <div class="gate-or">or</div>
      <a class="gate-btn gate-btn--pro" href="${WHOP_PRO}" target="_blank" rel="noopener">Go Pro — £14.99/mo</a>`);
    hcCard.classList.remove('hidden');
  }

  // ── Biggest Killer (always) ─────────────────────
  document.getElementById('killer-title').textContent = data.biggestKiller;
  document.getElementById('killer-desc').textContent  = data.biggestKillerDesc || '';
  if (data.potentialGain) {
    document.getElementById('killer-gain-value').textContent = data.potentialGain;
    document.getElementById('killer-gain').classList.remove('hidden');
  }

  // ── Variables (Report+ = all 11, Free = first 3 + gate) ──
  const varList = document.getElementById('variables-list');
  varList.innerHTML = '';
  const varEntries = Object.entries(data.variables);
  const visibleVars = hasReport ? varEntries : varEntries.slice(0, 3);

  visibleVars.forEach(([name, score]) => {
    const item = document.createElement('div');
    item.className = 'variable-item';
    item.innerHTML = `
      <div class="variable-header">
        <span class="variable-name">${name}</span>
        <span class="variable-score" style="color:${getBarColor(score)}">${score}</span>
      </div>
      <div class="variable-bar-track">
        <div class="variable-bar-fill" data-score="${score}" style="background:${getBarColor(score)}"></div>
      </div>`;
    varList.appendChild(item);
  });

  if (!hasReport) {
    const lock = document.createElement('div');
    lock.innerHTML = gateCard(`
      <div class="gate-icon">📊</div>
      <div class="gate-title">+ ${varEntries.length - 3} MORE VARIABLES</div>
      <p class="gate-text">See the full 11-variable breakdown with coaching notes on every area of your swing.</p>
      <a class="gate-btn gate-btn--report" href="${WHOP_REPORT}" target="_blank" rel="noopener">Get Report — £7.99</a>
      <div class="gate-or">or</div>
      <a class="gate-btn gate-btn--pro" href="${WHOP_PRO}" target="_blank" rel="noopener">Go Pro — £14.99/mo</a>`);
    varList.appendChild(lock.firstElementChild);
  }

  setTimeout(() => {
    varList.querySelectorAll('.variable-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.score + '%';
    });
  }, 100);

  // ── Drills (Free = 2, Report+ = all) ───────────
  const drillsList = document.getElementById('drills-list');
  drillsList.innerHTML = '';
  const allDrills = data.drills || [];
  const drillsToShow = hasReport ? allDrills : allDrills.slice(0, 2);

  drillsToShow.forEach((drill, i) => {
    const card = document.createElement('div');
    card.className = 'drill-card';
    card.innerHTML = `
      <span class="drill-number">Drill ${i + 1}</span>
      <span class="drill-name">${drill.name}</span>
      <p class="drill-desc">${drill.desc}</p>
      <span class="drill-reps">📅 ${drill.reps}</span>`;
    drillsList.appendChild(card);
  });

  if (!hasReport && allDrills.length > 2) {
    const lock = document.createElement('div');
    lock.innerHTML = gateCard(`
      <div class="gate-icon">🏋️</div>
      <div class="gate-title">+ ${allDrills.length - 2} MORE DRILLS</div>
      <p class="gate-text">Get your full personalised drill programme and 2-week improvement plan.</p>
      <a class="gate-btn gate-btn--report" href="${WHOP_REPORT}" target="_blank" rel="noopener">Get Report — £7.99</a>`);
    drillsList.appendChild(lock.firstElementChild);
  }

  // ── Improvement Forecast (Report+) ─────────────
  const forecastCard = document.getElementById('improvement-forecast-card');
  if (hasReport) {
    renderImprovementForecast(data);
    forecastCard.classList.remove('hidden');
  } else {
    forecastCard.classList.add('hidden');
  }

  // ── PDF Download (Report+) ──────────────────────
  const pdfSection = document.getElementById('pdf-download-section');
  if (pdfSection) pdfSection.classList.toggle('hidden', !hasReport);

  // ── Coach Message (always) ──────────────────────
  document.getElementById('coach-message-text').textContent = '"' + data.coachMessage + '"';

  // ── Coaching History (Pro+) ─────────────────────
  const historySection = document.getElementById('coaching-history-section');
  if (hasPro) {
    renderCoachingHistory();
    historySection.classList.remove('hidden');
  } else {
    historySection.classList.add('hidden');
  }

  // ── Upgrade Cards ────────────────────────────────
  const reportCard = document.querySelector('.upgrade-card--report');
  const proCard    = document.querySelector('.upgrade-card--pro');
  if (reportCard) reportCard.style.display = hasReport ? 'none' : '';
  if (proCard)    proCard.style.display    = hasPro    ? 'none' : '';

  saveAnalysis(data);
}

function renderImprovementForecast(data) {
  const el = document.getElementById('forecast-timeline');
  if (!el) return;
  const score = data.overallScore;
  const headroom = 100 - score;
  const w4  = Math.min(score + Math.round(headroom * 0.12), 99);
  const w8  = Math.min(score + Math.round(headroom * 0.22), 99);
  const w12 = Math.min(score + Math.round(headroom * 0.32), 99);

  el.innerHTML = [
    { label: '4 weeks',  val: w4  },
    { label: '8 weeks',  val: w8  },
    { label: '12 weeks', val: w12 },
  ].map(({ label, val }) => `
    <div class="forecast-row">
      <span class="forecast-week">${label}</span>
      <div class="forecast-bar-wrap">
        <div class="forecast-bar-track">
          <div class="forecast-bar-base" style="width:${score}%"></div>
          <div class="forecast-bar-gain" style="width:${val}%"></div>
        </div>
      </div>
      <span class="forecast-score">${val}<span class="forecast-delta">+${val - score}</span></span>
    </div>`).join('');
}

function renderCoachingHistory() {
  const el = document.getElementById('coaching-history-list');
  if (!el) return;
  const analyses = getAnalyses();
  if (analyses.length === 0) {
    el.innerHTML = '<p class="coaching-history-empty">Complete your first analysis to start building your coaching history.</p>';
    return;
  }
  const fmt = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  el.innerHTML = analyses.slice().reverse().slice(0, 10).map(a => `
    <div class="coaching-history-item">
      <div class="coaching-history-left">
        <span class="coaching-history-date">${fmt(a.timestamp)}</span>
        <span class="coaching-history-goal">${a.goal || 'Analysis'}</span>
        <span class="coaching-history-killer">⚡ ${a.biggestKiller}</span>
      </div>
      <div class="coaching-history-right">
        <span class="coaching-history-score" style="color:${getBarColor(a.overallScore)}">${a.overallScore}</span>
        <span class="coaching-history-label">score</span>
      </div>
    </div>`).join('');
}

// ── Restart ───────────────────────────────────────
document.getElementById('results-restart').addEventListener('click', () => {
  // Reset state
  state.goal = null; state.handicap = null; state.years = null;
  state.coach = null; state.file = null; state.results = null;

  // Reset UI
  document.querySelectorAll('.goal-card, .coach-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('goal-next').disabled = true;
  document.getElementById('profile-next').disabled = true;
  document.getElementById('handicap').selectedIndex = 0;
  document.getElementById('years').selectedIndex = 0;
  fileInfo.classList.add('hidden');
  uploadZone.style.display = '';
  uploadAnalyse.disabled = true;
  fileInput.value = '';
  document.querySelectorAll('.step-item').forEach(s => { s.classList.remove('active', 'done'); });

  showScreen('screen-splash');
});

// ── Utilities ─────────────────────────────────────
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function animateCounter(el, from, to, duration) {
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * ease);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Subscription & Tier ───────────────────────────
const SUB_KEY = 'swingclinic_sub';
const TIER_LEVELS = { free: 0, report: 1, pro: 2 };
const WHOP_REPORT = 'https://whop.com/swingclinic/swing-analysis-report/';
const WHOP_PRO    = 'https://whop.com/swingclinic/swing-clinic-pro/';
const TIER_LABELS = { free: 'FREE', report: 'REPORT', pro: 'PRO' };
const TIER_DESC   = { free: 'Basic access', report: 'Full report access', pro: 'Unlimited pro coaching' };

function getTier() {
  // Clerk publicMetadata wins (synced on login)
  const clerkTier = window._swingClinicTier;
  if (clerkTier && TIER_LEVELS[clerkTier] !== undefined) return clerkTier;
  try {
    const sub = JSON.parse(localStorage.getItem(SUB_KEY) || '{}');
    if (sub.tier && TIER_LEVELS[sub.tier] !== undefined) return sub.tier;
  } catch {}
  return 'free';
}

function syncTierFromClerk(user) {
  const clerkTier = user?.publicMetadata?.tier;
  if (clerkTier && TIER_LEVELS[clerkTier] !== undefined) {
    window._swingClinicTier = clerkTier;
    try {
      const sub = JSON.parse(localStorage.getItem(SUB_KEY) || '{}');
      sub.tier = clerkTier;
      localStorage.setItem(SUB_KEY, JSON.stringify(sub));
    } catch {}
  }
}

function hasReportAccess() { return TIER_LEVELS[getTier()] >= TIER_LEVELS.report; }
function hasProAccess()    { return TIER_LEVELS[getTier()] >= TIER_LEVELS.pro; }
function isPro()           { return hasProAccess(); }

function updateUserBadge() {
  const tier = getTier();
  const emailEl = document.getElementById('user-badge-email');
  if (emailEl && state.userEmail) emailEl.textContent = state.userEmail;
  const planEl = document.getElementById('user-badge-plan');
  if (planEl) {
    planEl.textContent = TIER_LABELS[tier] || 'FREE';
    planEl.className = 'plan-badge plan-badge--' + tier;
  }
}

// ── Clerk Auth ────────────────────────────────────
let clerkInstance = null;

async function initClerk() {
  try {
    // Fetch publishable key from API server (which has access to Replit secrets)
    let publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) {
      const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
      publishableKey = cfg.clerkPublishableKey;
    }

    // In Clerk 6.x, the browser bundle exposes window.Clerk as a singleton instance.
    // Call .load() on it (do NOT use new window.Clerk()).
    clerkInstance = window.Clerk;
    await clerkInstance.load({
      publishableKey,
      proxyUrl: import.meta.env.VITE_CLERK_PROXY_URL || undefined,
      appearance: {
        variables: {
          colorPrimary: '#00C46A',
          colorBackground: '#111111',
          colorForeground: '#ffffff',
          colorMutedForeground: '#888888',
          colorDanger: '#ef4444',
          colorInput: '#1a1a1a',
          colorInputForeground: '#ffffff',
          colorNeutral: '#333333',
          fontFamily: '"DM Sans", sans-serif',
          borderRadius: '12px',
        },
      },
    });

    if (clerkInstance.user) {
      syncTierFromClerk(clerkInstance.user);
      state.userEmail = clerkInstance.user.primaryEmailAddress?.emailAddress;
      updateUserBadge();
      showScreen('screen-splash');
    } else {
      showScreen('screen-auth');
    }

    clerkInstance.addListener(({ user }) => {
      if (user) {
        syncTierFromClerk(user);
        if (document.getElementById('screen-auth')?.classList.contains('active')) {
          state.userEmail = user.primaryEmailAddress?.emailAddress;
          updateUserBadge();
          showScreen('screen-splash');
        }
      }
    });
  } catch (err) {
    const msg = err?.errors?.[0]?.message || err?.message || JSON.stringify(err) || String(err);
    console.error('Clerk init error:', msg, err);
    // Do NOT bypass auth on Clerk load failure — show auth screen so the user can retry
    showScreen('screen-auth');
  }
}

document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
  if (clerkInstance) {
    await clerkInstance.signOut();
    resetAuthForm();
    showScreen('screen-auth');
  }
});

// ── Custom headless auth form ──────────────────────
let pendingSignIn = null;
let pendingSignUp = null;

function authError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function authErrorClear(elId) {
  const el = document.getElementById(elId);
  if (el) el.classList.add('hidden');
}
function setAuthLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : (btnId === 'auth-email-btn' ? 'Continue' : 'Verify');
}
function showAuthStep(step) {
  document.getElementById('auth-step-email')?.classList.toggle('hidden', step !== 'email');
  document.getElementById('auth-step-code')?.classList.toggle('hidden', step !== 'code');
}
function resetAuthForm() {
  pendingSignIn = null;
  pendingSignUp = null;
  if (document.getElementById('auth-email')) document.getElementById('auth-email').value = '';
  if (document.getElementById('auth-code')) document.getElementById('auth-code').value = '';
  authErrorClear('auth-email-error');
  authErrorClear('auth-code-error');
  showAuthStep('email');
}

document.getElementById('auth-email-btn')?.addEventListener('click', async () => {
  if (!clerkInstance) return;
  const email = document.getElementById('auth-email')?.value?.trim();
  if (!email) return authError('auth-email-error', 'Please enter your email address.');
  authErrorClear('auth-email-error');
  setAuthLoading('auth-email-btn', true);

  try {
    // Try sign-in first (existing user)
    const si = await clerkInstance.client.signIn.create({ identifier: email });
    pendingSignIn = si;
    const factor = si.supportedFirstFactors?.find(f => f.strategy === 'email_code');
    if (factor) await si.prepareFirstFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
    document.getElementById('auth-step-email-preview').textContent = email;
    showAuthStep('code');
  } catch (err) {
    const errCode = err?.errors?.[0]?.code;
    if (errCode === 'form_identifier_not_found' || errCode === 'form_param_format_invalid') {
      // New user → sign up
      try {
        const su = await clerkInstance.client.signUp.create({ emailAddress: email });
        await su.prepareEmailAddressVerification({ strategy: 'email_code' });
        pendingSignUp = su;
        document.getElementById('auth-step-email-preview').textContent = email;
        showAuthStep('code');
      } catch (suErr) {
        authError('auth-email-error', suErr?.errors?.[0]?.longMessage || suErr?.message || 'Could not create account.');
      }
    } else {
      authError('auth-email-error', err?.errors?.[0]?.longMessage || err?.message || 'Something went wrong.');
    }
  } finally {
    setAuthLoading('auth-email-btn', false);
  }
});

document.getElementById('auth-code-btn')?.addEventListener('click', async () => {
  if (!clerkInstance) return;
  const code = document.getElementById('auth-code')?.value?.trim();
  if (!code || code.length < 6) return authError('auth-code-error', 'Enter the 6-digit code.');
  authErrorClear('auth-code-error');
  setAuthLoading('auth-code-btn', true);
  try {
    let result;
    if (pendingSignUp) {
      result = await pendingSignUp.attemptEmailAddressVerification({ code });
      await clerkInstance.setActive({ session: result.createdSessionId });
    } else if (pendingSignIn) {
      result = await pendingSignIn.attemptFirstFactor({ strategy: 'email_code', code });
      await clerkInstance.setActive({ session: result.createdSessionId });
    } else {
      return;
    }
    // setActive() resolved — navigate directly, don't rely on listener timing
    const user = clerkInstance.user;
    syncTierFromClerk(user);
    state.userEmail = user?.primaryEmailAddress?.emailAddress;
    updateUserBadge();
    resetAuthForm();
    showScreen('screen-splash');
  } catch (err) {
    authError('auth-code-error', err?.errors?.[0]?.longMessage || err?.message || 'Invalid code. Try again.');
  } finally {
    setAuthLoading('auth-code-btn', false);
  }
});

document.getElementById('auth-back-btn')?.addEventListener('click', () => {
  pendingSignIn = null;
  pendingSignUp = null;
  authErrorClear('auth-code-error');
  showAuthStep('email');
});


initClerk();

// ── localStorage ──────────────────────────────────
const STORAGE_KEY = 'swingclinic_analyses';

function saveAnalysis(data) {
  const all = getAnalyses();
  all.push({
    timestamp: new Date().toISOString(),
    overallScore: data.overallScore,
    variables: { ...data.variables },
    biggestKiller: data.biggestKiller,
    goal: state.goal,
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch {}
}

function getAnalyses() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function filterByPeriod(analyses, period) {
  if (period === 'all') return analyses;
  const now = Date.now();
  const ms = period === 'week' ? 7 * 86400000 : 30 * 86400000;
  return analyses.filter(a => now - new Date(a.timestamp).getTime() <= ms);
}

// ── SVG Charts ────────────────────────────────────
function buildLineChartSVG(analyses) {
  const W = 300, H = 140;
  const pL = 28, pR = 12, pT = 18, pB = 24;
  const pw = W - pL - pR, ph = H - pT - pB;
  const n = analyses.length;
  const toX = i => pL + (n === 1 ? pw / 2 : i * pw / (n - 1));
  const toY = s => pT + ph - (s / 100) * ph;
  const pts = analyses.map((a, i) => ({ x: toX(i), y: toY(a.overallScore), s: a.overallScore, t: a.timestamp }));

  const grids = [25, 50, 75].map(v => {
    const y = toY(v);
    return `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${W - pR}" y2="${y.toFixed(1)}" stroke="#222" stroke-width="1" stroke-dasharray="3,3"/>
            <text x="${pL - 4}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="#444">${v}</text>`;
  }).join('');

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fillD = `${pathD} L${pts[n-1].x.toFixed(1)},${(pT+ph).toFixed(1)} L${pts[0].x.toFixed(1)},${(pT+ph).toFixed(1)} Z`;

  const dots = pts.map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#00C46A" stroke="#0a0a0a" stroke-width="2"/>
     <text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" font-size="8" fill="#00C46A" font-weight="bold">${p.s}</text>`
  ).join('');

  const step = Math.max(1, Math.ceil(n / 5));
  const dateLabels = pts.filter((_, i) => i % step === 0 || i === n - 1).map(p => {
    const d = new Date(p.t);
    return `<text x="${p.x.toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="#555">${d.getDate()}/${d.getMonth() + 1}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
    ${grids}
    <path d="${fillD}" fill="#00C46A0d"/>
    <path d="${pathD}" fill="none" stroke="#00C46A" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${dateLabels}
  </svg>`;
}

function buildCompareChartSVG(prev, curr) {
  const vars = Object.keys(curr.variables);
  const rowH = 38, pL = 104, pR = 36, W = 320;
  const H = vars.length * rowH + 24;
  const maxW = W - pL - pR;

  const rows = vars.map((v, i) => {
    const pScore = prev?.variables?.[v] ?? 0;
    const cScore = curr.variables[v] ?? 0;
    const pW = (pScore / 100) * maxW;
    const cW = (cScore / 100) * maxW;
    const delta = cScore - pScore;
    const dCol = delta > 0 ? '#00C46A' : delta < 0 ? '#ef4444' : '#555';
    const dStr = delta > 0 ? `+${delta}` : `${delta}`;
    const y = 24 + i * rowH;
    const name = v.length > 14 ? v.slice(0, 13) + '…' : v;
    return `
      <text x="${pL - 6}" y="${y + 11}" text-anchor="end" font-size="9" fill="#777">${name}</text>
      <rect x="${pL}" y="${y}" width="${pW.toFixed(1)}" height="12" rx="3" fill="#2a2a2a"/>
      <text x="${Math.min(pL + pW + 4, W - pR - 2).toFixed(1)}" y="${y + 10}" font-size="8" fill="#555">${pScore}</text>
      <rect x="${pL}" y="${y + 15}" width="${cW.toFixed(1)}" height="12" rx="3" fill="#00C46A"/>
      <text x="${Math.min(pL + cW + 4, W - pR - 2).toFixed(1)}" y="${(y + 25).toFixed(1)}" font-size="8" fill="#00C46A" font-weight="bold">${cScore}</text>
      ${prev ? `<text x="${W - 2}" y="${y + 14}" text-anchor="end" font-size="10" fill="${dCol}" font-weight="bold">${dStr}</text>` : ''}`;
  }).join('');

  const legend = prev
    ? `<rect x="${pL}" y="6" width="10" height="6" rx="2" fill="#2a2a2a"/>
       <text x="${pL + 14}" y="12" font-size="8" fill="#555">Previous</text>
       <rect x="${pL + 72}" y="6" width="10" height="6" rx="2" fill="#00C46A"/>
       <text x="${pL + 86}" y="12" font-size="8" fill="#00C46A">Current</text>`
    : `<text x="${pL}" y="12" font-size="8" fill="#00C46A">Latest session</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${legend}${rows}</svg>`;
}

// ── Render Progress ───────────────────────────────
function renderProgress() {
  const analyses = getAnalyses();
  const container = document.getElementById('progress-content');

  if (analyses.length === 0) {
    container.innerHTML = `
      <div class="progress-empty">
        <div class="progress-empty-icon">📊</div>
        <p class="progress-empty-text">Upload your first swing to start tracking your progress over time.</p>
      </div>`;
    return;
  }

  const fmt = ts => {
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const listHTML = analyses.slice().reverse().map(a => `
    <div class="past-analysis-item">
      <div class="past-analysis-left">
        <span class="past-analysis-date">${fmt(a.timestamp)}</span>
        <span class="past-analysis-killer">⚡ ${a.biggestKiller}</span>
      </div>
      <span class="past-analysis-score">${a.overallScore}</span>
    </div>`).join('');

  container.innerHTML = `
    <div class="chart-card">
      <div class="chart-title">Swing score over time</div>
      ${buildLineChartSVG(analyses)}
    </div>
    <div class="section-heading" style="margin-top:8px">PAST ANALYSES</div>
    <div class="past-analyses-list">${listHTML}</div>`;
}

// ── Render Compare ────────────────────────────────
function renderCompare(period) {
  const container = document.getElementById('compare-content');

  if (!hasProAccess()) {
    container.innerHTML = `
      <div class="compare-locked">
        <div class="compare-locked-icon">📊</div>
        <p class="compare-locked-text">Session comparison charts are a Pro exclusive. Upgrade to visualise your improvement across every swing session.</p>
        <a class="btn-upgrade" style="display:block;text-align:center;margin-top:8px" href="${WHOP_PRO}" target="_blank" rel="noopener">Get Pro — £14.99/month</a>
      </div>`;
    return;
  }

  const all = getAnalyses();
  const filtered = filterByPeriod(all, period);

  if (filtered.length < 2) {
    const msg = all.length < 2
      ? 'Complete 2 analyses to unlock comparisons.'
      : 'Not enough sessions in this period. Try a wider time range.';
    container.innerHTML = `
      <div class="compare-locked">
        <div class="compare-locked-icon">🔒</div>
        <p class="compare-locked-text">${msg}</p>
      </div>`;
    return;
  }

  const prev = filtered[filtered.length - 2];
  const curr = filtered[filtered.length - 1];
  const vars = Object.keys(curr.variables);

  // Biggest improvement
  let bestVar = '', bestDelta = -Infinity;
  vars.forEach(v => {
    const delta = (curr.variables[v] ?? 0) - (prev.variables[v] ?? 0);
    if (delta > bestDelta) { bestDelta = delta; bestVar = v; }
  });

  // This-week count
  const weekCount = filterByPeriod(all, 'week').length;

  const improvementHTML = bestDelta > 0
    ? `<div class="compare-best-improvement">
        <span class="compare-best-label">🏆 Biggest improvement</span>
        <span class="compare-best-value">${bestVar}</span>
        <span class="compare-best-sub">+${bestDelta} points since last session</span>
       </div>`
    : '';

  container.innerHTML = `
    <div class="compare-summary">
      <div class="compare-stat">
        <span class="compare-stat-label">Total</span>
        <span class="compare-stat-value">${all.length}</span>
      </div>
      <div class="compare-stat">
        <span class="compare-stat-label">This week</span>
        <span class="compare-stat-value">${weekCount}</span>
      </div>
      <div class="compare-stat">
        <span class="compare-stat-label">Score Δ</span>
        <span class="compare-stat-value" style="color:${curr.overallScore >= prev.overallScore ? 'var(--green)' : '#ef4444'}">${curr.overallScore >= prev.overallScore ? '+' : ''}${curr.overallScore - prev.overallScore}</span>
      </div>
    </div>
    ${improvementHTML}
    <div class="chart-card">
      <div class="chart-title">Variable comparison — previous vs current</div>
      ${buildCompareChartSVG(prev, curr)}
    </div>`;
}

// ── Bottom Nav ────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const t = tab.dataset.tab;
    if (t === 'home') {
      showScreen('screen-results');
    } else if (t === 'progress') {
      showScreen('screen-progress');
      renderProgress();
    } else if (t === 'compare') {
      showScreen('screen-compare');
      renderCompare(document.querySelector('.filter-btn.active')?.dataset.filter || 'all');
    }
  });
});

// Compare filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCompare(btn.dataset.filter);
  });
});

// ── Profile Modal ──────────────────────────────────
function openProfileModal() {
  const tier = getTier();
  const overlay = document.getElementById('profile-overlay');
  const emailEl = document.getElementById('profile-sheet-email');
  const planBadge = document.getElementById('profile-sheet-plan-badge');
  const planLabel = document.getElementById('profile-sheet-plan-label');
  const manageLink = document.getElementById('profile-manage-link');

  if (emailEl) emailEl.textContent = state.userEmail || '—';
  if (planBadge) {
    planBadge.textContent = TIER_LABELS[tier] || 'FREE';
    planBadge.className = 'plan-badge plan-badge--' + tier;
  }
  if (planLabel) planLabel.textContent = TIER_DESC[tier] || 'Basic access';

  if (manageLink) {
    if (tier === 'pro') {
      manageLink.href = 'https://whop.com/hub/';
      manageLink.textContent = 'Manage Pro subscription →';
    } else if (tier === 'report') {
      manageLink.href = WHOP_PRO;
      manageLink.textContent = 'Upgrade to Pro — £14.99/mo →';
    } else {
      manageLink.href = WHOP_REPORT;
      manageLink.textContent = 'Unlock Report — £7.99 →';
    }
  }

  overlay?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeProfileModal() {
  document.getElementById('profile-overlay')?.classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('profile-btn')?.addEventListener('click', openProfileModal);

document.getElementById('profile-overlay')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeProfileModal();
});

document.getElementById('profile-signout-btn')?.addEventListener('click', async () => {
  closeProfileModal();
  if (clerkInstance) {
    await clerkInstance.signOut();
    window._swingClinicTier = null;
    resetAuthForm();
    showScreen('screen-auth');
  }
});

// ── PDF Download ───────────────────────────────────
document.getElementById('pdf-download-btn')?.addEventListener('click', () => {
  const btn = document.getElementById('pdf-download-btn');
  if (!btn) return;
  btn.textContent = 'Preparing your report…';
  btn.disabled = true;
  setTimeout(() => {
    window.print();
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Full Report PDF`;
    btn.disabled = false;
  }, 500);
});
