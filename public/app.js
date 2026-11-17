'use strict';

/* ================= utilidades ================= */
const LETTERS = ['A', 'B', 'C', 'D'];
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

/* ================= estado global ================= */
let bank = null;
let topics = [];
const topicByPrefix = new Map();

/* ---------- progreso persistente ---------- */
const PKEY = 'egreso.v1';
let progress = loadProgress();

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(PKEY));
    if (raw && typeof raw === 'object') {
      return { q: raw.q || {}, wrong: Array.isArray(raw.wrong) ? raw.wrong : [], exams: Array.isArray(raw.exams) ? raw.exams : [] };
    }
  } catch { /* corrupto: reiniciar */ }
  return { q: {}, wrong: [], exams: [] };
}

function saveProgress() {
  localStorage.setItem(PKEY, JSON.stringify(progress));
  updateWrongBadge();
}

function recordAnswer(id, ok) {
  const s = progress.q[id] || { seen: 0, ok: 0, bad: 0 };
  s.seen++;
  if (ok) s.ok++; else s.bad++;
  progress.q[id] = s;
  const wi = progress.wrong.indexOf(id);
  if (!ok && wi === -1) progress.wrong.push(id);
  if (ok && wi !== -1) progress.wrong.splice(wi, 1);
  saveProgress();
}

function topicStats(prefix) {
  let seen = 0, ok = 0, bad = 0;
  for (const [id, s] of Object.entries(progress.q)) {
    if (id.startsWith(prefix + '-')) { seen += s.seen; ok += s.ok; bad += s.bad; }
  }
  return { seen, ok, bad, accuracy: seen ? Math.round((ok / (ok + bad || 1)) * 100) : null };
}

function updateWrongBadge() {
  const badge = document.getElementById('wrongBadge');
  if (progress.wrong.length > 0) {
    badge.textContent = progress.wrong.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* ================= componentes ================= */
function stemHTML(q) {
  const lines = q.stem.split('\n');
  let html = '';
  let codeBuf = [];
  const flush = () => {
    if (codeBuf.length) {
      html += `<pre class="code-line">${esc(codeBuf.join('\n'))}</pre>`;
      codeBuf = [];
    }
  };
  for (const line of lines) {
    if (/^ {4}/.test(line)) codeBuf.push(line);
    else { flush(); html += `<div>${esc(line)}</div>`; }
  }
  flush();
  return html;
}

function contextHTML(q) {
  if (!q.context) return '';
  return `<details class="q-context"><summary>📋 Contexto del tema (esquema/colección de datos)</summary>${esc(q.context)}</details>`;
}

function questionHTML(q, { selected = -1, locked = false, reveal = false } = {}) {
  const opts = q.options.map((text, i) => {
    let cls = 'option';
    if (locked) cls += ' disabled';
    if (reveal && i === q.answer) cls += ' correct';
    else if (reveal && i === selected) cls += ' wrong';
    else if (!reveal && i === selected) cls += ' selected';
    return `<button class="${cls}" data-opt="${i}" ${locked ? 'disabled' : ''}>
      <span class="letter">${LETTERS[i]}</span><span>${esc(text)}</span>
    </button>`;
  }).join('');
  return `
    <div class="q-head">
      <span class="q-id">${esc(q.id)}</span>
      <span class="q-topic">${esc(q.topicName || '')}</span>
    </div>
    ${contextHTML(q)}
    <div class="q-stem">${stemHTML(q)}</div>
    <div class="options">${opts}</div>`;
}

function topicCards({ topics: list, onClick, showProgress = true }) {
  const parts = new Map();
  for (const t of list) {
    if (!parts.has(t.part)) parts.set(t.part, []);
    parts.get(t.part).push(t);
  }
  let html = '';
  for (const [part, ts] of [...parts.entries()].sort((a, b) => a[0] - b[0])) {
    const partName = bank.parts.find((p) => p.n === part)?.name || `Parte ${part}`;
    html += `<h3 class="part-title">${esc(partName)}</h3>`;
    for (const t of ts) {
      const st = showProgress ? topicStats(t.prefix) : null;
      const pct = st && st.seen ? Math.min(100, Math.round((st.seen / (t.count * 2)) * 100)) : 0;
      html += `
      <div class="card topic-card" data-topic="${t.prefix}" data-click="${onClick}">
        <div class="t-name">${esc(t.name)}</div>
        <div class="t-meta"><span>${t.count} reactivos</span><span>${t.prefix}</span></div>
        ${showProgress ? `<div class="bar"><i style="width:${pct}%"></i></div>
        <div class="t-progress">${st.seen ? `Contestadas ${st.seen} · aciertos ${st.ok} · ${st.accuracy}% bien` : 'Sin practicar aún'}</div>` : ''}
      </div>`;
    }
  }
  return `<div class="grid topics">${html}</div>`;
}

function bindTopicCards(container, handler) {
  container.querySelectorAll('.topic-card').forEach((card) => {
    card.addEventListener('click', () => handler(card.dataset.topic));
  });
}

function topicSelectHTML(id, withAll = false) {
  let html = `<select id="${id}">`;
  if (withAll) html += `<option value="__all__">Todos los temas (mezclado)</option>`;
  for (const t of topics) html += `<option value="${t.prefix}">${esc(t.name)} (${t.count})</option>`;
  html += '</select>';
  return html;
}

/* ================= router ================= */
const routes = {
  home: renderHome,
  study: renderStudy,
  quiz: renderQuiz,
  exam: renderExam,
  flash: renderFlash,
  review: renderReview,
  search: renderSearch,
};

function route() {
  stopTimer();
  document.removeEventListener('keydown', testKeys);
  document.removeEventListener('keydown', studyKeys);
  const hash = location.hash.replace(/^#\//, '') || 'home';
  const [name] = hash.split('/');
  const fn = routes[name] || renderHome;
  document.querySelectorAll('.main-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });
  app.innerHTML = '<div class="loading">Cargando…</div>';
  Promise.resolve(fn()).catch((err) => {
    app.innerHTML = `<div class="card"><h2>Error</h2><p>${esc(err.message)}</p></div>`;
  });
}

/* ================= inicio ================= */
async function renderHome() {
  const answered = Object.keys(progress.q).length;
  const totals = Object.values(progress.q).reduce((a, s) => ({ ok: a.ok + s.ok, bad: a.bad + s.bad }), { ok: 0, bad: 0 });
  const acc = (totals.ok + totals.bad) ? Math.round((totals.ok / (totals.ok + totals.bad)) * 100) : null;
  const best = progress.exams.length ? Math.max(...progress.exams.map((e) => e.score)) : null;

  app.innerHTML = `
    <div class="grid stats">
      <div class="stat"><b>${answered}</b><span>reactivos distintos vistos</span></div>
      <div class="stat"><b>${acc === null ? '—' : acc + '%'}</b><span>aciertos globales</span></div>
      <div class="stat"><b>${progress.wrong.length}</b><span>en repaso de fallos</span></div>
      <div class="stat"><b>${progress.exams.length}</b><span>simulacros realizados</span></div>
      <div class="stat"><b>${best === null ? '—' : best + '%'}</b><span>mejor simulacro</span></div>
    </div>

    <div class="btn-row" style="margin: 20px 0">
      <a class="btn primary" href="#/exam">📝 Simulacro de examen</a>
      <a class="btn" href="#/study">📖 Modo estudio</a>
      <a class="btn" href="#/flash">🃏 Flashcards</a>
      <a class="btn" href="#/review" ${progress.wrong.length ? '' : 'disabled'}>🔁 Repasar fallos (${progress.wrong.length})</a>
    </div>

    <h3>Progreso por tema <span class="sub" style="display:inline">· haz clic para estudiar</span></h3>
    ${topicCards({ topics, onClick: 'study' })}
    ${progress.exams.length ? `
      <h3>Historial de simulacros</h3>
      <div class="card">${progress.exams.slice(-8).reverse().map((e) => `
        <div class="history-item">
          <span>${new Date(e.date).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          <span>${e.correct}/${e.total} correctas</span>
          <b style="color:${e.score >= 60 ? 'var(--ok)' : 'var(--bad)'}">${e.score}%</b>
        </div>`).join('')}
      </div>` : ''}
  `;
  bindTopicCards(app, (prefix) => { location.hash = '#/study'; sessionStorage.setItem('studyTopic', prefix); });
}

/* ================= estudio ================= */
let studyState = null;

async function renderStudy() {
  const pre = sessionStorage.getItem('studyTopic');
  sessionStorage.removeItem('studyTopic');
  app.innerHTML = `
    <h2>Modo estudio</h2>
    <p class="sub">Practica con retroalimentación inmediata y justificación. Tus aciertos y errores se guardan para el repaso.</p>
    <label class="field"><span>Tema</span>${topicSelectHTML('studyTopic')}</label>
    <label class="field" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="studyShuffle" checked> <span style="margin:0">Aleatorizar el orden</span>
    </label>
    <button class="btn primary" id="studyStart">Empezar a estudiar</button>
    <div id="studyArea" style="margin-top:20px"></div>
  `;
  const sel = document.getElementById('studyTopic');
  if (pre && topicByPrefix.has(pre)) sel.value = pre;
  document.getElementById('studyStart').addEventListener('click', () => startStudy(sel.value));
  if (pre && topicByPrefix.has(pre)) startStudy(pre);
}

async function startStudy(prefix) {
  const data = await api(`/api/questions?topic=${encodeURIComponent(prefix)}`);
  let qs = data.questions;
  if (document.getElementById('studyShuffle').checked) {
    qs = qs.map((q) => [Math.random(), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }
  studyState = { qs, idx: 0, correct: 0 };
  document.getElementById('studyArea').innerHTML = `<div class="card" id="studyCard"></div>`;
  document.addEventListener('keydown', studyKeys);
  renderStudyQuestion();
}

function renderStudyQuestion() {
  const { qs, idx } = studyState;
  if (idx >= qs.length) {
    document.removeEventListener('keydown', studyKeys);
    const pct = Math.round((studyState.correct / qs.length) * 100);
    document.getElementById('studyCard').innerHTML = `
      <h2>Sesión terminada 🏁</h2>
      <p>Respondiste <b>${qs.length}</b> reactivos con <b>${studyState.correct}</b> aciertos (<b>${pct}%</b>).</p>
      <div class="btn-row">
        <button class="btn primary" onclick="location.reload()">Elegir otro tema</button>
        <a class="btn" href="#/review">Repasar fallos (${progress.wrong.length})</a>
      </div>`;
    return;
  }
  const q = qs[idx];
  const card = document.getElementById('studyCard');
  card.innerHTML = `
    ${questionHTML(q)}
    <div class="q-nav">
      <span class="q-counter">Pregunta ${idx + 1} de ${qs.length} · aciertos: ${studyState.correct}</span>
      <span><span class="kbd">A</span>–<span class="kbd">D</span> responder · <span class="kbd">Enter</span> siguiente</span>
    </div>
    <div id="studyFeedback"></div>`;
  card.querySelectorAll('.option').forEach((btn) => {
    btn.addEventListener('click', () => answerStudy(Number(btn.dataset.opt)));
  });
}

function answerStudy(i) {
  const { qs, idx } = studyState;
  const q = qs[idx];
  if (document.getElementById('studyNext')) return; // ya respondida
  const ok = i === q.answer;
  if (ok) studyState.correct++;
  recordAnswer(q.id, ok);
  const card = document.getElementById('studyCard');
  card.querySelectorAll('.option').forEach((btn) => {
    btn.disabled = true;
    btn.classList.add('disabled');
    const oi = Number(btn.dataset.opt);
    if (oi === q.answer) btn.classList.add('correct');
    else if (oi === i) btn.classList.add('wrong');
  });
  document.getElementById('studyFeedback').innerHTML = `
    <div class="feedback ${ok ? 'ok' : 'bad'}">
      <b>${ok ? '✔ Correcto' : `✘ Incorrecto — la respuesta es ${LETTERS[q.answer]}`}</b>
      ${q.justification ? `<span class="just">💡 ${esc(q.justification)}</span>` : ''}
      <div class="btn-row"><button class="btn primary" id="studyNext">${studyState.idx + 1 >= qs.length ? 'Ver resumen' : 'Siguiente →'}</button></div>
    </div>`;
  document.getElementById('studyNext').addEventListener('click', nextStudy);
}

function nextStudy() {
  studyState.idx++;
  renderStudyQuestion();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function studyKeys(e) {
  if (!studyState || studyState.idx >= studyState.qs.length) return;
  if (document.getElementById('studyNext')) {
    if (e.key === 'Enter') { e.preventDefault(); nextStudy(); }
    return;
  }
  const map = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };
  if (e.key.toLowerCase() in map) answerStudy(map[e.key.toLowerCase()]);
}

/* ================= pruebas (por tema / simulacro) ================= */
let testState = null;
let timerId = null;

function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}

async function renderQuiz() {
  app.innerHTML = `
    <h2>Prueba por tema</h2>
    <p class="sub">Evaluación sin retroalimentación: respondes todas las preguntas del tema (en orden aleatorio) y al final ves tu calificación con revisión pregunta por pregunta.</p>
    <div class="card">
      <label class="field"><span>Tema</span>${topicSelectHTML('quizTopic')}</label>
      <label class="field"><span>Tiempo (minutos, 0 = sin límite)</span>
        <input type="number" id="quizMinutes" value="0" min="0" max="240">
      </label>
      <button class="btn primary" id="quizStart">Comenzar prueba</button>
    </div>`;
  document.getElementById('quizStart').addEventListener('click', async () => {
    const topic = document.getElementById('quizTopic').value;
    const minutes = Number(document.getElementById('quizMinutes').value) || 0;
    const data = await api('/api/session/start', {
      method: 'POST',
      body: JSON.stringify({ mode: 'topic', topic, minutes }),
    });
    startTest(data, 'quiz');
  });
}

async function renderExam() {
  app.innerHTML = `
    <h2>Simulacro de examen real</h2>
    <p class="sub">Muestra proporcional de todos los temas, temporizador, sin pistas: así se siente el examen de egreso. La calificación se revela solo al terminar.</p>
    <div class="card">
      <label class="field"><span>Número de reactivos</span>
        <select id="examCount">
          <option value="50">50 (exprés)</option>
          <option value="100" selected>100 (estándar)</option>
          <option value="172">172 (mitad del banco)</option>
          <option value="344">344 (examen completo)</option>
        </select>
      </label>
      <label class="field"><span>Alcance</span>
        <div class="check-grid" id="examScope">
          <label class="check-chip"><input type="checkbox" id="scopeAll" checked> Todos los temas</label>
          ${topics.map((t) => `<label class="check-chip"><input type="checkbox" class="scopeTopic" value="${t.prefix}" disabled> ${esc(t.name)}</label>`).join('')}
        </div>
      </label>
      <label class="field"><span>Tiempo (0 = usar 1.2 min/reactivo · -1 = sin límite)</span>
        <input type="number" id="examMinutes" value="0" min="-1" max="600">
      </label>
      <button class="btn primary" id="examStart">Iniciar simulacro</button>
    </div>`;

  const scopeAll = document.getElementById('scopeAll');
  scopeAll.addEventListener('change', () => {
    document.querySelectorAll('.scopeTopic').forEach((c) => { c.disabled = scopeAll.checked; });
  });

  document.getElementById('examStart').addEventListener('click', async () => {
    const count = Number(document.getElementById('examCount').value);
    let topicsSel = [];
    if (!scopeAll.checked) {
      topicsSel = [...document.querySelectorAll('.scopeTopic:checked')].map((c) => c.value);
      if (!topicsSel.length) return toast('Selecciona al menos un tema');
    }
    const rawMinutes = Number(document.getElementById('examMinutes').value);
    const minutes = rawMinutes <= -1 ? 0 : rawMinutes; // 0 min = sin límite; enviar null = automático (1.2 min/reactivo)
    const data = await api('/api/session/start', {
      method: 'POST',
      body: JSON.stringify({ mode: 'exam', count, topics: topicsSel, minutes: rawMinutes === 0 ? null : minutes }),
    });
    startTest(data, 'exam');
  });
}

function startTest(data, kind) {
  testState = {
    sessionId: data.sessionId,
    kind,
    qs: data.questions,
    answers: {},
    flags: new Set(),
    idx: 0,
    minutes: data.minutes,
    left: data.minutes * 60,
  };
  renderTestQuestion();
  startTimer();
  document.addEventListener('keydown', testKeys);
}

function startTimer() {
  stopTimer();
  if (!testState || !testState.minutes) return;
  timerId = setInterval(() => {
    if (!testState) return stopTimer();
    testState.left--;
    const t = document.getElementById('timer');
    if (t) {
      const m = Math.floor(testState.left / 60);
      const s = String(testState.left % 60).padStart(2, '0');
      t.textContent = `⏱ ${m}:${s}`;
      t.classList.toggle('low', testState.left <= 60);
    }
    if (testState.left <= 0) {
      stopTimer();
      toast('⏰ ¡Tiempo agotado! Se envía tu examen.');
      submitTest();
    }
  }, 1000);
}

function renderTestQuestion() {
  const st = testState;
  const q = st.qs[st.idx];
  const answeredCount = Object.keys(st.answers).length;
  app.innerHTML = `
    <div class="exam-layout">
      <div class="card" id="testCard">
        ${questionHTML(q, { selected: st.answers[q.id] ?? -1 })}
        <div class="q-nav">
          <button class="btn small" id="testPrev" ${st.idx === 0 ? 'disabled' : ''}>← Anterior</button>
          <span class="q-counter">
            <button class="btn small ghost" id="testFlag">${st.flags.has(q.id) ? '🚩 Marcada' : '🏳 Marcar para revisar'}</button>
          </span>
          <button class="btn small" id="testNext" ${st.idx === st.qs.length - 1 ? 'disabled' : ''}>Siguiente →</button>
        </div>
      </div>
      <aside class="exam-side">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <b style="font-size:14px">${st.kind === 'exam' ? 'Simulacro' : 'Prueba'}</b>
            ${st.minutes ? `<span class="timer" id="timer">${Math.floor(st.left / 60)}:${String(st.left % 60).padStart(2, '0')}</span>` : '<span class="timer">sin límite</span>'}
          </div>
          <div style="margin:12px 0 6px;color:var(--muted);font-size:12.5px">${answeredCount}/${st.qs.length} respondidas</div>
          <div class="palette">
            ${st.qs.map((x, i) => `<button data-i="${i}" class="${i === st.idx ? 'current' : ''} ${st.answers[x.id] !== undefined ? 'answered' : ''} ${st.flags.has(x.id) ? 'flagged' : ''}">${i + 1}</button>`).join('')}
          </div>
          <div class="palette-legend">
            <span><i style="background:#14532d"></i>Respondida</span>
            <span><i style="background:#7c2d12"></i>Marcada</span>
          </div>
          <div class="btn-row">
            <button class="btn primary" id="testSubmit" style="width:100%;justify-content:center">Terminar y calificar</button>
          </div>
        </div>
      </aside>
    </div>`;

  document.querySelectorAll('#testCard .option').forEach((btn) => {
    btn.addEventListener('click', () => {
      st.answers[q.id] = Number(btn.dataset.opt);
      renderTestQuestion();
    });
  });
  document.getElementById('testPrev').addEventListener('click', () => { st.idx--; renderTestQuestion(); });
  document.getElementById('testNext').addEventListener('click', () => { st.idx++; renderTestQuestion(); });
  document.getElementById('testFlag').addEventListener('click', () => {
    if (st.flags.has(q.id)) st.flags.delete(q.id); else st.flags.add(q.id);
    renderTestQuestion();
  });
  document.querySelectorAll('.palette button').forEach((b) => {
    b.addEventListener('click', () => { st.idx = Number(b.dataset.i); renderTestQuestion(); });
  });
  document.getElementById('testSubmit').addEventListener('click', () => submitTest(true));
}

function testKeys(e) {
  if (!testState) return;
  const map = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };
  const k = e.key.toLowerCase();
  if (k in map) {
    testState.answers[testState.qs[testState.idx].id] = map[k];
    renderTestQuestion();
  } else if (e.key === 'ArrowRight' && testState.idx < testState.qs.length - 1) {
    testState.idx++; renderTestQuestion();
  } else if (e.key === 'ArrowLeft' && testState.idx > 0) {
    testState.idx--; renderTestQuestion();
  } else if (k === 'f') {
    const q = testState.qs[testState.idx];
    if (testState.flags.has(q.id)) testState.flags.delete(q.id); else testState.flags.add(q.id);
    renderTestQuestion();
  }
}

async function submitTest(askConfirm = false) {
  const st = testState;
  if (!st) return;
  const missing = st.qs.length - Object.keys(st.answers).length;
  if (askConfirm && missing > 0) {
    if (!confirm(`Te faltan ${missing} pregunta(s) sin responder. ¿Enviar de todos modos?`)) return;
  }
  stopTimer();
  document.removeEventListener('keydown', testKeys);
  app.innerHTML = '<div class="loading">Calificando…</div>';
  try {
    const data = await api(`/api/session/${st.sessionId}/grade`, {
      method: 'POST',
      body: JSON.stringify({ answers: st.answers }),
    });
    for (const r of data.results) recordAnswer(r.id, r.ok);
    if (st.kind === 'exam') {
      progress.exams.push({ date: Date.now(), score: data.score, correct: data.correct, total: data.total });
      if (progress.exams.length > 30) progress.exams = progress.exams.slice(-30);
      saveProgress();
    }
    renderResults(data, st.kind);
  } catch (err) {
    toast(err.message);
    route();
  }
}

function renderResults(data, kind) {
  const pass = data.score >= 60;
  const wrong = data.results.filter((r) => !r.ok);
  app.innerHTML = `
    <div class="card score-hero">
      <div class="score-num ${pass ? 'pass' : 'fail'}">${data.score}%</div>
      <div class="verdict">${pass ? '✅ Aprobado (mínimo 60%)' : '❌ No aprobado — sigue practicando'}</div>
      <p class="sub" style="margin-top:8px">${data.correct} de ${data.total} reactivos correctos${kind === 'exam' ? ' · simulacro guardado en tu historial' : ''}</p>
      <div class="btn-row" style="justify-content:center">
        <a class="btn primary" href="#/${kind === 'exam' ? 'exam' : 'quiz'}">${kind === 'exam' ? 'Nuevo simulacro' : 'Otra prueba'}</a>
        <a class="btn" href="#/home">Ir al inicio</a>
      </div>
    </div>

    <h3>Desempeño por tema</h3>
    <div class="card" style="overflow-x:auto">
      <table class="table">
        <thead><tr><th>Tema</th><th class="num">Correctas</th><th class="num">Total</th><th class="num">%</th></tr></thead>
        <tbody>
          ${data.perTopic.map((t) => {
            const p = Math.round((t.correct / t.total) * 100);
            return `<tr><td>${esc(t.name)}</td><td class="num">${t.correct}</td><td class="num">${t.total}</td>
              <td class="num" style="color:${p >= 60 ? 'var(--ok)' : 'var(--bad)'}">${p}%</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <h3>Revisión ${wrong.length ? `· ${wrong.length} para reforzar` : '· perfecto 🎯'}</h3>
    ${data.results.map((r) => `
      <div class="review-item ${r.ok ? 'ok' : 'bad'}">
        <div class="q-head"><span class="q-id">${esc(r.id)}</span><span class="q-topic">${esc(r.topicName)}</span></div>
        ${r.context ? `<details class="q-context"><summary>📋 Contexto</summary>${esc(r.context)}</details>` : ''}
        <div class="q-stem">${stemHTML(r)}</div>
        <div class="options">
          ${r.options.map((text, i) => {
            let cls = 'option disabled';
            if (i === r.correct) cls += ' correct';
            else if (i === r.your) cls += ' wrong';
            return `<button class="${cls}" disabled><span class="letter">${LETTERS[i]}</span><span>${esc(text)}</span></button>`;
          }).join('')}
        </div>
        <div class="review-verdict">
          ${r.ok
            ? `<span style="color:var(--ok)">✔ Tu respuesta: ${LETTERS[r.your]}</span>`
            : `<span style="color:var(--bad)">✘ Tu respuesta: ${r.your >= 0 ? LETTERS[r.your] : 'sin responder'} · Correcta: ${LETTERS[r.correct]}</span>`}
          ${r.justification ? `<div class="feedback ok" style="margin-top:8px"><span class="just">💡 ${esc(r.justification)}</span></div>` : ''}
        </div>
      </div>`).join('')}
  `;
  window.scrollTo({ top: 0 });
}

/* ================= flashcards ================= */
let flashState = null;

async function renderFlash() {
  app.innerHTML = `
    <h2>Flashcards</h2>
    <p class="sub">Lee la pregunta, intenta responder de memoria y voltea la tarjeta para comprobar. Marca si la sabías.</p>
    <div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label class="field" style="flex:1;min-width:220px;margin:0"><span>Tema</span>${topicSelectHTML('flashTopic', true)}</label>
        <button class="btn primary" id="flashStart">Comenzar</button>
      </div>
    </div>
    <div id="flashArea" style="margin-top:20px"></div>`;
  document.getElementById('flashStart').addEventListener('click', startFlash);
}

async function startFlash() {
  const sel = document.getElementById('flashTopic').value;
  const url = sel === '__all__' ? '/api/questions?topic=__all__' : `/api/questions?topic=${sel}`;
  const data = await api(url);
  let qs = data.questions;
  qs = qs.map((q) => [Math.random(), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  if (sel === '__all__' && qs.length > 60) qs = qs.slice(0, 60);
  flashState = { qs, idx: 0, knew: 0, flipped: false };
  renderFlashCard();
}

function renderFlashCard() {
  const st = flashState;
  const area = document.getElementById('flashArea');
  if (st.idx >= st.qs.length) {
    area.innerHTML = `<div class="card score-hero">
      <div class="score-num pass">${Math.round((st.knew / st.qs.length) * 100)}%</div>
      <div class="verdict">Sabías ${st.knew} de ${st.qs.length} tarjetas</div>
      <div class="btn-row" style="justify-content:center"><button class="btn primary" onclick="location.reload()">Nueva ronda</button></div>
    </div>`;
    return;
  }
  const q = st.qs[st.idx];
  area.innerHTML = `
    <div class="flashcard" id="flashCard">
      <div class="flash-inner">
        <div class="q-head"><span class="q-id">${esc(q.id)} · ${st.idx + 1}/${st.qs.length}</span><span class="q-topic">${esc(q.topicName)}</span></div>
        ${contextHTML(q)}
        <div class="q-stem">${stemHTML(q)}</div>
        ${st.flipped ? `
          <div class="options">
            ${q.options.map((text, i) => `<div class="option disabled ${i === q.answer ? 'correct' : ''}"><span class="letter">${LETTERS[i]}</span><span>${esc(text)}</span></div>`).join('')}
          </div>
          ${q.justification ? `<div class="feedback ok"><span class="just">💡 ${esc(q.justification)}</span></div>` : ''}
          <div class="btn-row" style="justify-content:center">
            <button class="btn" id="flashNo">✘ No la sabía</button>
            <button class="btn primary" id="flashYes">✔ La sabía</button>
          </div>` : `
          <div class="flash-hint">🤔 Piensa tu respuesta y haz clic para voltear…</div>
          <div class="btn-row" style="justify-content:center"><button class="btn" id="flipBtn">Voltear tarjeta</button></div>`}
      </div>
    </div>`;
  if (!st.flipped) {
    document.getElementById('flashCard').addEventListener('click', flip);
    document.getElementById('flipBtn').addEventListener('click', flip);
  } else {
    document.getElementById('flashYes').addEventListener('click', () => gradeFlash(true));
    document.getElementById('flashNo').addEventListener('click', () => gradeFlash(false));
  }
}

function flip() {
  flashState.flipped = true;
  renderFlashCard();
}

function gradeFlash(knew) {
  const q = flashState.qs[flashState.idx];
  if (knew) flashState.knew++;
  recordAnswer(q.id, knew);
  flashState.idx++;
  flashState.flipped = false;
  renderFlashCard();
}

/* ================= repaso de fallos ================= */
let reviewState = null;

async function renderReview() {
  if (!progress.wrong.length) {
    app.innerHTML = `<div class="empty card">
      <h2>🎉 Sin fallos pendientes</h2>
      <p>Cuando falles preguntas en cualquier modo, aparecerán aquí para repasarlas hasta dominarlas.</p>
      <a class="btn primary" href="#/study">Ir a estudiar</a>
    </div>`;
    return;
  }
  const data = await api(`/api/questions?ids=${progress.wrong.join(',')}`);
  reviewState = { qs: data.questions, idx: 0, fixed: 0 };
  app.innerHTML = `
    <h2>Repaso de fallos</h2>
    <p class="sub">${data.questions.length} reactivos que has fallado. Acertar los quita de la lista; fallar los mantiene.</p>
    <div class="card" id="reviewCard"></div>`;
  renderReviewQuestion();
}

function renderReviewQuestion() {
  const st = reviewState;
  if (st.idx >= st.qs.length) {
    document.getElementById('reviewCard').innerHTML = `
      <h2>Repaso completado 🔁</h2>
      <p>Acertaste <b>${st.fixed}</b> de <b>${st.qs.length}</b>. ${progress.wrong.length ? `Quedan <b>${progress.wrong.length}</b> en tu lista de fallos.` : '¡Lista de fallos vacía! 🎯'}</p>
      <div class="btn-row">
        ${progress.wrong.length ? '<button class="btn primary" onclick="location.reload()">Otra ronda</button>' : ''}
        <a class="btn" href="#/home">Inicio</a>
      </div>`;
    return;
  }
  const q = st.qs[st.idx];
  const card = document.getElementById('reviewCard');
  card.innerHTML = `
    ${questionHTML(q)}
    <div class="q-nav"><span class="q-counter">Fallo ${st.idx + 1} de ${st.qs.length} · recuperados: ${st.fixed}</span></div>
    <div id="reviewFeedback"></div>`;
  card.querySelectorAll('.option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.opt);
      const ok = i === q.answer;
      recordAnswer(q.id, ok);
      if (ok) st.fixed++;
      card.querySelectorAll('.option').forEach((b) => {
        b.disabled = true; b.classList.add('disabled');
        const oi = Number(b.dataset.opt);
        if (oi === q.answer) b.classList.add('correct');
        else if (oi === i) b.classList.add('wrong');
      });
      document.getElementById('reviewFeedback').innerHTML = `
        <div class="feedback ${ok ? 'ok' : 'bad'}">
          <b>${ok ? '✔ Recuperada — sale de tus fallos' : '✘ Sigue en tus fallos'}</b>
          ${q.justification ? `<span class="just">💡 ${esc(q.justification)}</span>` : ''}
          <div class="btn-row"><button class="btn primary" id="reviewNext">Siguiente →</button></div>
        </div>`;
      document.getElementById('reviewNext').addEventListener('click', () => {
        st.idx++; renderReviewQuestion(); window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  });
}

/* ================= buscador ================= */
let searchTimer = null;

async function renderSearch() {
  app.innerHTML = `
    <h2>Buscar reactivos</h2>
    <p class="sub">Encuentra preguntas por palabra clave (p. ej. "subnetting", " INNER JOIN ", "heurística").</p>
    <label class="field"><input type="text" id="searchInput" placeholder="Escribe al menos 2 caracteres…" autocomplete="off"></label>
    <div id="searchResults"></div>`;
  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = input.value.trim();
      const box = document.getElementById('searchResults');
      if (q.length < 2) { box.innerHTML = ''; return; }
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (!data.total) { box.innerHTML = '<div class="empty">Sin resultados.</div>'; return; }
      box.innerHTML = `<p class="sub">${data.total} resultado(s)</p>` + data.questions.map((x) => `
        <details class="review-item">
          <summary>
            <span class="q-id">${esc(x.id)}</span> · ${esc(x.topicName)}<br>
            <span style="font-size:13.5px">${esc(x.stem.split('\n')[0].slice(0, 140))}${x.stem.length > 140 ? '…' : ''}</span>
          </summary>
          ${contextHTML(x)}
          <div class="q-stem">${stemHTML(x)}</div>
          <div class="options">
            ${x.options.map((text, i) => `<div class="option disabled ${i === x.answer ? 'correct' : ''}"><span class="letter">${LETTERS[i]}</span><span>${esc(text)}</span></div>`).join('')}
          </div>
          ${x.justification ? `<div class="feedback ok"><span class="just">💡 ${esc(x.justification)}</span></div>` : ''}
        </details>`).join('');
    }, 250);
  });
}

/* ================= arranque ================= */
(async function init() {
  try {
    bank = await api('/api/topics');
    topics = bank.topics;
    topicByPrefix.clear();
    for (const t of topics) topicByPrefix.set(t.prefix, t);
    document.getElementById('bankCount').textContent = bank.total;
    updateWrongBadge();
    route();
    window.addEventListener('hashchange', route);
  } catch (err) {
    app.innerHTML = `<div class="card"><h2>No se pudo cargar el banco</h2><p>${esc(err.message)}</p></div>`;
  }
})();
