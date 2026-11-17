'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadBank } = require('./lib/parser');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

const bank = loadBank(path.join(__dirname, 'banco_preguntas_examen_egreso.txt'));
const byId = new Map(bank.questions.map((q) => [q.id, q]));

const sessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expires < now) sessions.delete(id);
  }
}, 10 * 60 * 1000).unref();

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function publicQuestion(q, withAnswer) {
  const out = {
    id: q.id,
    topic: q.topic,
    topicName: q.topicName,
    part: q.part,
    stem: q.stem,
    options: q.options,
  };
  if (q.context) out.context = q.context;
  if (withAnswer) {
    out.answer = q.answer;
    out.justification = q.justification;
  }
  return out;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function sampleQuestions({ mode, topic, topics, count }) {
  if (mode === 'topic') {
    const t = bank.topics.find((x) => x.prefix === topic);
    if (!t) throw new Error('Tema no encontrado: ' + topic);
    return shuffle(bank.questions.filter((q) => q.topic === t.prefix));
  }

  let pool;
  if (Array.isArray(topics) && topics.length > 0) {
    const wanted = new Set(topics);
    pool = bank.questions.filter((q) => wanted.has(q.topic));
    if (pool.length === 0) throw new Error('Los temas seleccionados no existen');
  } else {
    pool = bank.questions;
  }

  const n = Math.max(1, Math.min(Number(count) || 100, pool.length));
  const byTopic = new Map();
  for (const q of pool) {
    if (!byTopic.has(q.topic)) byTopic.set(q.topic, []);
    byTopic.get(q.topic).push(q);
  }
  const picked = [];
  const quotas = [];
  let assigned = 0;
  for (const [prefix, qs] of byTopic) {
    const exact = (n * qs.length) / pool.length;
    const quota = Math.floor(exact);
    assigned += quota;
    quotas.push({ prefix, qs, quota, frac: exact - quota });
  }
  quotas.sort((a, b) => b.frac - a.frac);
  let i = 0;
  while (assigned < n) {
    quotas[i % quotas.length].quotaBump = (quotas[i % quotas.length].quotaBump || 0) + 1;
    assigned++;
    i++;
  }
  for (const { prefix, qs, quota, quotaBump } of quotas) {
    picked.push(...shuffle(qs).slice(0, (quota || 0) + (quotaBump || 0)));
  }
  return shuffle(picked).slice(0, n);
}

function startSession(body) {
  const mode = body.mode === 'topic' ? 'topic' : 'exam';
  const picked = sampleQuestions(body);
  if (picked.length === 0) throw new Error('No hay preguntas para el criterio dado');

  let minutes;
  const m = body.minutes;
  if (m === undefined || m === null) {
    minutes = Math.max(1, Math.round(picked.length * 1.2));
  } else if (Number(m) > 0) {
    minutes = Number(m);
  } else {
    minutes = 0;
  }

  const id = crypto.randomBytes(9).toString('base64url');
  sessions.set(id, {
    mode,
    expires: Date.now() + SESSION_TTL_MS,
    items: picked,
  });

  return {
    sessionId: id,
    mode,
    minutes,
    total: picked.length,
    questions: picked.map((q) => publicQuestion(q, false)),
  };
}

function gradeSession(id, answers) {
  const session = sessions.get(id);
  if (!session) throw Object.assign(new Error('Sesión no encontrada o expirada'), { status: 404 });
  sessions.delete(id);

  const results = session.items.map((q) => {
    const given = answers && answers[q.id];
    const givenIdx = Number.isInteger(given) ? given : -1;
    return {
      id: q.id,
      topic: q.topic,
      topicName: q.topicName,
      stem: q.stem,
      options: q.options,
      context: q.context || null,
      your: givenIdx,
      correct: q.answer,
      ok: givenIdx === q.answer,
      justification: q.justification,
    };
  });

  const correct = results.filter((r) => r.ok).length;
  const perTopic = {};
  for (const r of results) {
    if (!perTopic[r.topic]) perTopic[r.topic] = { topic: r.topic, name: r.topicName, total: 0, correct: 0 };
    perTopic[r.topic].total++;
    if (r.ok) perTopic[r.topic].correct++;
  }

  return {
    total: results.length,
    correct,
    score: Math.round((correct / results.length) * 1000) / 10,
    perTopic: Object.values(perTopic).sort((a, b) => a.topic.localeCompare(b.topic)),
    results,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/topics' && req.method === 'GET') {
      return sendJson(res, 200, {
        total: bank.questions.length,
        parts: [
          { n: 1, name: 'Parte I · Fundamentos de Software' },
          { n: 2, name: 'Parte II · Infraestructura y Tecnología' },
        ],
        topics: bank.topics,
      });
    }

    if (pathname === '/api/questions' && req.method === 'GET') {
      const topic = url.searchParams.get('topic');
      const idsParam = url.searchParams.get('ids');
      const withAnswer = url.searchParams.get('withAnswers') !== '0';
      let list;
      if (idsParam) {
        const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
        list = ids.map((id) => byId.get(id)).filter(Boolean);
      } else if (topic === '__all__') {
        list = bank.questions;
      } else if (topic) {
        list = bank.questions.filter((q) => q.topic === topic);
      } else {
        return sendJson(res, 400, { error: 'Indica ?topic= o ?ids=' });
      }
      return sendJson(res, 200, { total: list.length, questions: list.map((q) => publicQuestion(q, withAnswer)) });
    }

    if (pathname === '/api/search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      if (q.length < 2) return sendJson(res, 200, { total: 0, questions: [] });
      const matches = bank.questions
        .filter((x) => (x.stem + ' ' + x.options.join(' ') + ' ' + x.id).toLowerCase().includes(q))
        .slice(0, 60);
      return sendJson(res, 200, { total: matches.length, questions: matches.map((x) => publicQuestion(x, true)) });
    }

    if (pathname === '/api/session/start' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, startSession(body));
    }

    const gradeMatch = pathname.match(/^\/api\/session\/([^/]+)\/grade$/);
    if (gradeMatch && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, gradeSession(gradeMatch[1], body.answers || {}));
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Ruta de API no encontrada' });
    }

    if (req.method === 'GET') {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Método no permitido');
  } catch (err) {
    const status = err.status || 400;
    sendJson(res, status, { error: err.message || 'Error del servidor' });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor de estudio listo: http://localhost:${PORT}`);
  console.log(`Banco cargado: ${bank.questions.length} preguntas, ${bank.topics.length} temas.`);
});
