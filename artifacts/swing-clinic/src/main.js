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
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
    window.scrollTo(0, 0);
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
  const body = {
    frames,
    goal: state.goal,
    handicap: state.handicap,
    years: state.years,
    coach: state.coach,
  };

  const response = await fetch('/.netlify/functions/analyse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);
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

  const handicapEstimates = {
    'Backswing Plane':     { range: '18–24', reason: 'Steep backswing plane and timing issues are consistent with mid-to-high handicap play.' },
    'Downswing Plane':     { range: '16–22', reason: 'Over-the-top move and shallow path suggest a mid-handicap player still developing sequencing.' },
    'Club Face at Impact': { range: '20–28', reason: 'Open face at impact and resulting ball flight pattern indicate a higher handicap range.' },
    'Weight Transfer':     { range: '18–26', reason: 'Hanging back through the shot is a common trait in mid-to-high handicap golfers.' },
  };

  const handicapEstimate = handicapEstimates[biggestKillerKey] || {
    range: '14–20',
    reason: 'Your rotation and weight transfer scores suggest a mid-handicap player with a solid base to build on.',
  };

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

async function runAnalysis() {
  const stepsPromise = animateSteps();
  let frames = [];

  try {
    frames = await extractFrames(state.file);
    state.results = await callAPI(frames);
  } catch {
    state.results = getMockResults();
  }

  await stepsPromise;
  await wait(400);
  showScreen('screen-results');
  renderResults(state.results);
}

// ── Results Rendering ─────────────────────────────
function getBarColor(score) {
  if (score >= 75) return '#00C46A';
  if (score >= 55) return '#f59e0b';
  return '#ef4444';
}

function renderResults(data) {
  // Score Ring
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

  // Handicap Estimate
  if (data.handicapEstimate) {
    document.getElementById('hc-range').textContent  = data.handicapEstimate.range + ' handicap';
    document.getElementById('hc-reason').textContent = data.handicapEstimate.reason;
  }

  // Biggest Killer
  document.getElementById('killer-title').textContent = data.biggestKiller;
  document.getElementById('killer-desc').textContent  = data.biggestKillerDesc || '';

  // Variables
  const varList = document.getElementById('variables-list');
  varList.innerHTML = '';
  Object.entries(data.variables).forEach(([name, score]) => {
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

  // Animate bars after paint
  setTimeout(() => {
    varList.querySelectorAll('.variable-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.score + '%';
    });
  }, 100);

  // Drills
  const drillsList = document.getElementById('drills-list');
  drillsList.innerHTML = '';
  (data.drills || []).forEach((drill, i) => {
    const card = document.createElement('div');
    card.className = 'drill-card';
    card.innerHTML = `
      <span class="drill-number">Drill ${i + 1}</span>
      <span class="drill-name">${drill.name}</span>
      <p class="drill-desc">${drill.desc}</p>
      <span class="drill-reps">📅 ${drill.reps}</span>`;
    drillsList.appendChild(card);
  });

  // Coach Message
  document.getElementById('coach-message-text').textContent = '"' + data.coachMessage + '"';
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
