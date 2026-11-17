'use strict';

const fs = require('fs');

const TOPICS = [
  { prefix: 'PROG', name: 'Programación y Algoritmos', part: 1 },
  { prefix: 'BD',   name: 'Bases de Datos (SQL)', part: 1 },
  { prefix: 'MG',   name: 'Bases de Datos (MongoDB)', part: 1 },
  { prefix: 'WEB',  name: 'Desarrollo Web y Móvil', part: 1 },
  { prefix: 'ING',  name: 'Ingeniería de Software', part: 1 },
  { prefix: 'UX',   name: 'Experiencia de Usuario (UX)', part: 1 },
  { prefix: 'RED',  name: 'Redes y Comunicaciones', part: 2 },
  { prefix: 'IA',   name: 'IA y Machine Learning', part: 2 },
  { prefix: 'CIB',  name: 'Ciberseguridad', part: 2 },
  { prefix: 'BI',   name: 'BI y Gobierno de Datos', part: 2 },
  { prefix: 'SIG',  name: 'Sistemas de Información Gerencial', part: 2 },
  { prefix: 'CL',   name: 'Cloud', part: 2 },
  { prefix: 'QA',   name: 'Calidad de Software / QA', part: 2 },
  { prefix: 'NEG',  name: 'Negocios, S.O. y Tecnología', part: 2 },
];

const LETTERS = ['A', 'B', 'C', 'D'];

function resolveKeyPrefix(header, subsection) {
  const h = header.toUpperCase();
  if (h.includes('PROGRAMACION')) return 'PROG';
  if (h.includes('BASES DE DATOS')) return subsection === 'MONGODB' ? 'MG' : 'BD';
  if (h.includes('DESARROLLO WEB')) return 'WEB';
  if (h.includes('INGENIERIA DE SOFTWARE')) return 'ING';
  if (h.includes('REDES')) return 'RED';
  if (h.includes('IA Y MACHINE LEARNING')) return 'IA';
  if (h.includes('CIBERSEGURIDAD')) return 'CIB';
  if (h.includes('BI Y GOBIERNO')) return 'BI';
  if (h.includes('CLOUD')) return 'CL';
  if (h.includes('NEGOCIOS')) return 'NEG';
  if (h.includes('QA')) return 'QA';
  if (h.includes('UX')) return 'UX';
  if (h.includes('SIG')) return 'SIG';
  return null;
}

function parseQuestions(lines) {
  const questions = [];
  const sectionRe = /^\s*PARTE\s+([IVX]+)\s*-\s*SECCION\s+(\d+):\s*(.+?)\s*$/i;
  const questionRe = /^([A-Z]{2,4})-(\d+)\.\s*(.*)$/;
  const optionLineRe = /^\s+([A-D])\)/;
  const optionMarkerRe = /(?:^|\s)([A-D])\)\s+/g;

  let current = null;
  let currentContext = null;
  let lastOption = -1;

  const closeCurrent = () => {
    if (current) {
      current.stem = current.stemLines.join('\n').trim();
      delete current.stemLines;
      if (current.options.length !== 4) {
        throw new Error(`La pregunta ${current.id} tiene ${current.options.length} opciones (se esperaban 4)`);
      }
      questions.push(current);
      current = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    if (/^=+$/.test(line.trim()) || /#+$/.test(line.trim())) continue;

    const secMatch = line.match(sectionRe);
    if (secMatch) {
      closeCurrent();
      currentContext = null;
      lastOption = -1;
      continue;
    }

    const qMatch = line.match(questionRe);
    if (qMatch) {
      closeCurrent();
      current = {
        id: `${qMatch[1]}-${qMatch[2]}`,
        prefix: qMatch[1],
        number: parseInt(qMatch[2], 10),
        stemLines: qMatch[3] ? [qMatch[3]] : [],
        options: [],
        context: currentContext,
      };
      lastOption = -1;
      continue;
    }

    if (line.trim().startsWith('---')) {
      closeCurrent();
      currentContext = [line.trim()];
      continue;
    }

    if (current === null) {
      if (currentContext && line.trim()) currentContext.push(line.replace(/^ {1,3}(?=\S)/, ''));
      continue;
    }

    if (!line.trim()) continue;

    if (optionLineRe.test(line) && current.options.length < 4) {
      optionMarkerRe.lastIndex = 0;
      const markers = [];
      let m;
      while ((m = optionMarkerRe.exec(line)) !== null) {
        markers.push({ letter: m[1], start: m.index, textStart: optionMarkerRe.lastIndex });
      }
      for (let i = 0; i < markers.length; i++) {
        const end = i + 1 < markers.length ? markers[i + 1].start : line.length;
        const text = line.slice(markers[i].textStart, end).trim();
        const expected = LETTERS[current.options.length];
        if (markers[i].letter !== expected) {
          throw new Error(`Opción fuera de orden en ${current ? current.id : '?'}: se esperaba ${expected}) y llegó ${markers[i].letter})`);
        }
        current.options.push(text);
      }
      lastOption = current.options.length - 1;
      continue;
    }

    if (current.options.length > 0 && lastOption >= 0) {
      current.options[lastOption] = (current.options[lastOption] + ' ' + line.trim()).trim();
    } else if (/^ {4,}/.test(line)) {
      current.stemLines.push(line);
    } else {
      current.stemLines.push(line.trim());
    }
  }
  closeCurrent();
  return questions;
}

function parseKeys(lines) {
  const answers = {};
  let header = null;
  let subsection = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const hMatch = line.match(/^CLAVE\s*-\s*(.+)$/);
    if (hMatch) {
      header = hMatch[1];
      subsection = null;
      continue;
    }
    if (/^(SQL|MONGODB):$/i.test(line)) {
      subsection = line.toUpperCase().replace(':', '');
      continue;
    }

    const prefix = resolveKeyPrefix(header || '', subsection);
    if (!prefix) continue;

    for (const part of line.split('|')) {
      const p = part.trim();
      if (!p) continue;
      const m = p.match(/^(\d+)\s*-\s*([A-D])(?:\s*\((.*)\))?\s*$/);
      if (!m) continue;
      const id = `${prefix}-${m[1].padStart(2, '0')}`;
      answers[id] = {
        answer: LETTERS.indexOf(m[2]),
        justification: (m[3] || '').trim(),
      };
    }
  }
  return answers;
}

function loadBank(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);

  const keysIdx = lines.findIndex((l) => l.includes('CLAVES DE RESPUESTAS'));
  if (keysIdx === -1) throw new Error('No se encontró la sección de claves en el banco');

  const questions = parseQuestions(lines.slice(0, keysIdx));
  const answers = parseKeys(lines.slice(keysIdx));

  const topicByPrefix = new Map(TOPICS.map((t) => [t.prefix, t]));
  const counts = new Map();

  for (const q of questions) {
    const topic = topicByPrefix.get(q.prefix);
    if (!topic) throw new Error(`Prefijo de tema desconocido: ${q.prefix} (${q.id})`);
    q.topic = topic.prefix;
    q.topicName = topic.name;
    q.part = topic.part;

    const key = answers[q.id];
    if (!key) throw new Error(`Falta la clave de respuesta para ${q.id}`);
    q.answer = key.answer;
    q.justification = key.justification;

    if (q.context) q.context = q.context.join('\n');
    counts.set(q.prefix, (counts.get(q.prefix) || 0) + 1);
  }

  const topics = TOPICS
    .filter((t) => counts.has(t.prefix))
    .map((t) => ({ ...t, count: counts.get(t.prefix) }));

  return { topics, questions };
}

module.exports = { loadBank, TOPICS };
