// Servidor de estatísticas de voleibol — sem dependências externas.
// API REST + Server-Sent Events para acompanhar os jogos em direto.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { computeState, validateEvent, defaultConfig, ROLES, MAX_PLAYERS, MAX_LIBEROS } from './public/js/engine.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
// Os dados (plantel e jogos) ficam numa pasta FORA da aplicação, ao lado dela, para que a pasta
// da aplicação possa ser substituída por inteiro numa atualização sem perder nada.
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, '..', 'Voleibol-dados'));
const OLD_DATA = path.join(ROOT, 'data'); // localização antiga (dentro da aplicação)
const PORT = Number(process.env.PORT) || 3080;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------- Persistência ----------
const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : []);

// migração: dados antigos em ./data passam para a pasta de dados (uma única vez)
if (DATA !== OLD_DATA && jsonFiles(OLD_DATA).length) {
  if (!jsonFiles(DATA).length) {
    fs.mkdirSync(DATA, { recursive: true });
    for (const f of jsonFiles(OLD_DATA)) fs.copyFileSync(path.join(OLD_DATA, f), path.join(DATA, f));
    // a cópia correu bem: retira os ficheiros antigos para não haver duas versões dos dados
    for (const f of jsonFiles(OLD_DATA)) fs.rmSync(path.join(OLD_DATA, f));
    fs.writeFileSync(path.join(OLD_DATA, 'LEIA-ME.txt'),
      `Os dados (plantel e jogos) foram movidos para:\r\n${DATA}\r\n\r\nEsta pasta já não é usada e pode ser apagada.\r\n`);
    console.log(`Dados movidos de ${OLD_DATA} para ${DATA}`);
  } else {
    console.warn(`Atenção: há dados antigos em ${OLD_DATA} que NÃO foram usados, porque ${DATA} já tem dados.`);
  }
}
fs.mkdirSync(DATA, { recursive: true });
const matches = new Map();
for (const f of fs.readdirSync(DATA)) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue; // _escaloes.json = escalões e planteis
  try {
    const m = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
    // v2: “Ataque bloqueado” deixou de dar ponto direto; nos jogos antigos acrescenta-se
    // a defesa ao bloco falhada (sem toque) para manter os resultados registados
    if ((m.v || 1) < 2) {
      const evs = [];
      for (const ev of m.events) {
        evs.push(ev);
        if (ev.type === 'action' && ev.skill === 'attack' && ev.result === 'blocked') {
          evs.push({ type: 'action', team: ev.team, skill: 'dig', result: 'error', player: null, id: ++m.seq, t: ev.t });
        }
      }
      m.events = evs;
      m.v = 2;
      fs.writeFileSync(path.join(DATA, f), JSON.stringify(m));
    }
    matches.set(m.id, m);
  } catch (e) {
    console.error('Ficheiro de jogo inválido:', f, e.message);
  }
}

const pendingWrites = new Map();
function save(m) {
  // escrita atómica, agregada para não escrever a cada clique em rajada
  clearTimeout(pendingWrites.get(m.id));
  pendingWrites.set(m.id, setTimeout(async () => {
    pendingWrites.delete(m.id);
    const file = path.join(DATA, `${m.id}.json`);
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(m));
    await fsp.rename(tmp, file);
  }, 150));
}

// ---------- Subscritores em direto (SSE) ----------
const subscribers = new Map(); // id -> Set<res>
function broadcast(m) {
  const subs = subscribers.get(m.id);
  if (!subs) return;
  const payload = `event: match\ndata: ${JSON.stringify(publicMatch(m))}\n\n`;
  for (const res of subs) res.write(payload);
}
setInterval(() => {
  for (const subs of subscribers.values()) for (const res of subs) res.write(': ping\n\n');
}, 25000).unref();

// ---------- Helpers ----------
const publicMatch = ({ adminKey, ...rest }) => ({ ...rest, categoryName: findCat(rest.category)?.name || '' });

function summary(m) {
  const s = computeState(m);
  return {
    id: m.id,
    title: m.title,
    date: m.date,
    venue: m.venue,
    category: m.category,
    categoryName: findCat(m.category)?.name || '',
    createdAt: m.createdAt,
    teams: { A: m.teams.A.name, B: m.teams.B.name },
    setsWon: s.setsWon,
    current: s.finished ? null : { A: s.sets[s.currentSet].A, B: s.sets[s.currentSet].B },
    finished: s.finished,
    winner: s.winner,
    started: m.events.length > 0,
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error('Pedido demasiado grande'), { status: 413 });
    chunks.push(c);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw Object.assign(new Error('JSON inválido'), { status: 400 });
  }
}

/** Pedido feito no próprio computador onde corre o servidor (gestor de todos os jogos). */
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

function authorized(req, m) {
  if (isLocal(req)) return true;
  const key = String(req.headers['x-admin-key'] || '');
  const a = Buffer.from(key);
  const b = Buffer.from(m.adminKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const str = (v, max = 80) => String(v ?? '').trim().slice(0, max);

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

/** `squad` = convocatória de jogo: aplica os limites de 12 jogadores + 2 líberos. */
function cleanTeam(t, fallback, { squad = false } = {}) {
  const players = [];
  const seen = new Set();
  for (const p of Array.isArray(t?.players) ? t.players : []) {
    const number = Number.parseInt(p?.number, 10);
    if (!Number.isInteger(number) || number < 0 || number > 99 || seen.has(number)) continue;
    seen.add(number);
    const pos = ROLES[p.pos] ? p.pos : '';
    players.push({ number, name: str(p.name, 40), pos, libero: !!p.libero || pos === 'L' });
  }
  players.sort((x, y) => x.number - y.number);
  if (squad) {
    const lib = players.filter((p) => p.libero).length;
    if (players.length - lib > MAX_PLAYERS) throw badRequest(`Máximo de ${MAX_PLAYERS} jogadores convocados (além dos líberos)`);
    if (lib > MAX_LIBEROS) throw badRequest(`Máximo de ${MAX_LIBEROS} líberos`);
  }
  return { name: str(t?.name, 40) || fallback, players };
}

// ---------- Escalões (cada um com o seu plantel) ----------
const CATS_FILE = path.join(DATA, '_escaloes.json');
const OLD_TEAM_FILE = path.join(DATA, '_team.json'); // versão antiga: um único plantel
let categories = [];
try { categories = JSON.parse(fs.readFileSync(CATS_FILE, 'utf8')); } catch { /* ainda não existe */ }

function saveCategories() {
  fs.writeFileSync(`${CATS_FILE}.tmp`, JSON.stringify(categories));
  fs.renameSync(`${CATS_FILE}.tmp`, CATS_FILE);
}

const newId = () => crypto.randomBytes(4).toString('hex');
const findCat = (id) => categories.find((c) => c.id === id);

/** Acrescenta ao plantel do escalão os convocados que ainda não estão lá (não altera os existentes). */
function mergeIntoCategory(cat, squad) {
  if (!cat) return;
  let changed = false;
  if (!cat.teamName && squad.name) { cat.teamName = squad.name; changed = true; }
  for (const p of squad.players) {
    if (cat.players.some((x) => x.number === p.number)) continue;
    cat.players.push({ number: p.number, name: p.name, pos: p.pos || (p.libero ? 'L' : ''), libero: !!p.libero });
    changed = true;
  }
  if (changed) {
    cat.players.sort((x, y) => x.number - y.number);
    saveCategories();
  }
}

// migração: o plantel único (_team.json) passa a ser o primeiro escalão, com todos os jogos existentes
if (!categories.length && (fs.existsSync(OLD_TEAM_FILE) || matches.size)) {
  let old = { name: '', players: [] };
  try { old = JSON.parse(fs.readFileSync(OLD_TEAM_FILE, 'utf8')); } catch { /* sem plantel antigo */ }
  const cat = { id: newId(), name: 'Principal', teamName: old.name || '', players: old.players || [] };
  categories.push(cat);
  const recent = [...matches.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
  if (recent) mergeIntoCategory(cat, recent.teams.A);
  saveCategories();
  if (fs.existsSync(OLD_TEAM_FILE)) fs.renameSync(OLD_TEAM_FILE, `${OLD_TEAM_FILE}.bak`);
  console.log(`Plantel convertido no escalão “${cat.name}”`);
}
// jogos sem escalão (antigos) ficam no primeiro escalão
for (const m of matches.values()) {
  if (!m.category || !findCat(m.category)) {
    if (!categories.length) break;
    m.category = categories[0].id;
    fs.writeFileSync(path.join(DATA, `${m.id}.json`), JSON.stringify(m));
  }
}

function cleanCategory(body, prev = {}) {
  const name = str(body.name ?? prev.name, 40);
  if (!name) throw badRequest('Indique o nome do escalão');
  if (categories.some((c) => c.id !== prev.id && c.name.toLowerCase() === name.toLowerCase())) throw badRequest(`Já existe o escalão “${name}”`);
  const t = cleanTeam({ name: body.teamName ?? prev.teamName, players: body.players ?? prev.players }, '');
  return { id: prev.id || newId(), name, teamName: t.name, players: t.players };
}

function cleanConfig(c = {}) {
  const d = defaultConfig();
  const bestOf = [1, 3, 5].includes(Number(c.bestOf)) ? Number(c.bestOf) : d.bestOf;
  const clampPts = (v, def) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= 5 && n <= 50 ? n : def;
  };
  return {
    bestOf,
    setPoints: clampPts(c.setPoints, d.setPoints),
    decidingSetPoints: clampPts(c.decidingSetPoints, d.decidingSetPoints),
    firstServe: c.firstServe === 'A' || c.firstServe === 'B' ? c.firstServe : null, // normalmente decide-se no marcador
  };
}

// ---------- API ----------
async function api(req, res, parts) {
  const [, , id, sub, extra] = parts; // ['', 'api', 'matches', id?, sub?]
  if (parts[1] === 'whoami' && req.method === 'GET') return send(res, 200, { local: isLocal(req) });
  if (parts[1] === 'categories') {
    if (!id) {
      if (req.method === 'GET') return send(res, 200, categories);
      if (req.method === 'POST') {
        const cat = cleanCategory(await readBody(req));
        categories.push(cat);
        saveCategories();
        return send(res, 201, cat);
      }
      return send(res, 405, { error: 'Método não suportado' });
    }
    const i = categories.findIndex((c) => c.id === id);
    if (i < 0) return send(res, 404, { error: 'Escalão não encontrado' });
    if (req.method === 'GET') return send(res, 200, categories[i]);
    if (req.method === 'PUT') {
      categories[i] = cleanCategory(await readBody(req), categories[i]);
      saveCategories();
      return send(res, 200, categories[i]);
    }
    if (req.method === 'DELETE') {
      const n = [...matches.values()].filter((m) => m.category === id).length;
      if (n) return send(res, 409, { error: `Este escalão tem ${n} jogo${n === 1 ? '' : 's'}. Apague-os primeiro ou mude-os de escalão.` });
      categories.splice(i, 1);
      saveCategories();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Método não suportado' });
  }
  if (parts[1] !== 'matches') return send(res, 404, { error: 'Não encontrado' });

  if (!id) {
    if (req.method === 'GET') {
      const list = [...matches.values()].map(summary).sort((a, b) => b.createdAt - a.createdAt);
      return send(res, 200, list);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const cat = findCat(body.category);
      if (!cat) throw badRequest('Escolha o escalão do jogo');
      const m = {
        id: crypto.randomBytes(5).toString('hex'),
        adminKey: crypto.randomBytes(16).toString('hex'),
        createdAt: Date.now(),
        title: str(body.title, 80),
        date: str(body.date, 20),
        venue: str(body.venue, 80),
        category: cat.id,
        config: cleanConfig(body.config),
        teams: { A: cleanTeam(body.teams?.A, 'Equipa A', { squad: true }), B: cleanTeam(body.teams?.B, 'Equipa B') },
        events: [],
        closed: false,
        seq: 0,
        v: 2,
      };
      matches.set(m.id, m);
      save(m);
      mergeIntoCategory(cat, m.teams.A);
      return send(res, 201, { id: m.id, key: m.adminKey });
    }
    return send(res, 405, { error: 'Método não suportado' });
  }

  const m = matches.get(id);
  if (!m) return send(res, 404, { error: 'Jogo não encontrado' });

  if (!sub) {
    if (req.method === 'GET') return send(res, 200, publicMatch(m));
    if (!authorized(req, m)) return send(res, 403, { error: 'Chave de marcador inválida' });
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (body.title !== undefined) m.title = str(body.title, 80);
      if (body.venue !== undefined) m.venue = str(body.venue, 80);
      if (body.date !== undefined) m.date = str(body.date, 20);
      if (body.category !== undefined && body.category !== m.category) {
        if (!findCat(body.category)) throw badRequest('Escalão desconhecido');
        if (m.events.length) throw badRequest('O jogo já começou: o escalão já não pode ser alterado');
        m.category = body.category;
      }
      if (body.teams) {
        for (const k of ['A', 'B']) {
          if (!body.teams[k]) continue;
          const t = cleanTeam(body.teams[k], m.teams[k].name, { squad: k === 'A' });
          // não permitir remover jogadores que já têm eventos registados
          const used = new Set(m.events.filter((e) => e.team === k).flatMap((e) =>
            [e.player, e.in, e.out, e.libero, e.liberoFor, ...(e.slots || []).map((s) => s.player)]).filter((n) => n != null));
          for (const n of used) {
            const old = m.teams[k].players.find((p) => p.number === n);
            const now = t.players.find((p) => p.number === n);
            if (!now && old) t.players.push(old);
            // quem já tem eventos mantém o estatuto de líbero (não estraga formações e trocas já feitas)
            if (now && old && !!now.libero !== !!old.libero) {
              throw badRequest(`#${n} já tem jogadas registadas — não é possível alterar se é líbero`);
            }
          }
          cleanTeam(t, t.name, { squad: k === 'A' }); // revalida os limites depois de repor jogadores
          t.players.sort((x, y) => x.number - y.number);
          if (k === 'A') mergeIntoCategory(findCat(m.category), t);
          m.teams[k] = t;
        }
      }
      if (body.config && m.events.length === 0) m.config = cleanConfig(body.config);
      save(m); broadcast(m);
      return send(res, 200, publicMatch(m));
    }
    if (req.method === 'DELETE') {
      matches.delete(id);
      clearTimeout(pendingWrites.get(id));
      await fsp.rm(path.join(DATA, `${id}.json`), { force: true });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Método não suportado' });
  }

  if (sub === 'stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\nevent: match\ndata: ${JSON.stringify(publicMatch(m))}\n\n`);
    if (!subscribers.has(id)) subscribers.set(id, new Set());
    subscribers.get(id).add(res);
    req.on('close', () => subscribers.get(id)?.delete(res));
    return;
  }

  if (sub === 'check' && req.method === 'GET') {
    return send(res, authorized(req, m) ? 200 : 403, { ok: authorized(req, m) });
  }

  // só no computador do servidor: devolve a chave, para gerar o link de marcador para outros dispositivos
  if (sub === 'key' && req.method === 'GET') {
    return isLocal(req) ? send(res, 200, { key: m.adminKey }) : send(res, 403, { error: 'Só disponível no computador do servidor' });
  }

  if (!authorized(req, m)) return send(res, 403, { error: 'Chave de marcador inválida' });

  if (sub === 'events' && req.method === 'POST') {
    const body = await readBody(req);
    const num = (v) => (v == null || v === '' ? null : Number(v));
    const ev = { type: body.type, team: body.team };
    if (body.type === 'action') Object.assign(ev, { skill: body.skill, result: body.result, player: num(body.player) });
    if (body.type === 'point' && body.reason) ev.reason = body.reason;
    // toss: quem serve primeiro no set (team = equipa que serve)
    if (body.type === 'lineup') {
      Object.assign(ev, {
        slots: (Array.isArray(body.slots) ? body.slots : []).slice(0, 6)
          .map((s) => ({ zone: num(s.zone), player: num(s.player), role: str(s.role, 4) })),
        libero: num(body.libero),
        liberoFor: num(body.libero) == null ? null : num(body.liberoFor),
        serve: body.serve === 'A' || body.serve === 'B' ? body.serve : null,
      });
    }
    if (body.type === 'sub') Object.assign(ev, { out: num(body.out), in: num(body.in), ...(body.role ? { role: str(body.role, 4) } : {}) });
    if (body.type === 'libero') Object.assign(ev, { action: body.action === 'out' ? 'out' : 'in', libero: num(body.libero), player: num(body.player) });

    const state = computeState(m);
    if (state.finished) return send(res, 409, { error: 'O jogo já terminou' });
    const err = validateEvent(ev, m, state);
    if (err) return send(res, 400, { error: err });
    // na saída do líbero, regista quem estava em campo e quem volta
    if (ev.type === 'libero' && ev.action === 'out') Object.assign(ev, state.court.libero && { libero: state.court.libero.libero, player: state.court.libero.replaced });
    ev.id = ++m.seq;
    ev.t = Date.now();
    m.events.push(ev);
    save(m); broadcast(m);
    return send(res, 201, ev);
  }

  if (sub === 'events' && extra === 'last' && req.method === 'DELETE') {
    const removed = m.events.pop();
    if (!removed) return send(res, 409, { error: 'Não há eventos para anular' });
    save(m); broadcast(m);
    return send(res, 200, removed);
  }

  if (sub === 'close' && req.method === 'POST') {
    const body = await readBody(req);
    m.closed = !!body.closed;
    save(m); broadcast(m);
    return send(res, 200, publicMatch(m));
  }

  return send(res, 404, { error: 'Não encontrado' });
}

// ---------- Ficheiros estáticos ----------
async function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Proibido' });
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname.startsWith('/api/')) return await api(req, res, pathname.split('/').slice(1));
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não suportado' });
    return await serveStatic(req, res, pathname);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Erro interno' });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n🏐 Estatísticas de Voleibol a correr na porta ${PORT}\n`);
  console.log(`   Neste computador:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`   Na rede local (telemóvel): http://${n.address}:${PORT}`);
    }
  }
  console.log(`\n   Dados (escalões e jogos): ${DATA}\n`);
});
