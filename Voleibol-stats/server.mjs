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
import { createStorage } from './storage.mjs';

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
// Com as variáveis UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN, os dados ficam no Upstash;
// sem elas, em ficheiros JSON na pasta de dados.
const storage = createStorage({ dataDir: DATA, url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const BEHIND_PROXY = !!(process.env.RENDER || process.env.TRUST_PROXY); // a correr atrás de um proxy (ex.: Render)
if (process.env.RENDER && storage.files) {
  console.warn('Atenção: no Render os ficheiros perdem-se a cada reinício. Defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN.');
}

const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : []);

// migração: dados antigos em ./data passam para a pasta de dados (uma única vez)
if (storage.files && DATA !== OLD_DATA && jsonFiles(OLD_DATA).length) {
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
const matches = new Map();
for (const m of await storage.listMatches()) {
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
    storage.writeMatch(m);
  }
  matches.set(m.id, m);
}

const pendingWrites = new Map();
function save(m) {
  // agregada, para não gravar a cada clique em rajada
  clearTimeout(pendingWrites.get(m.id));
  pendingWrites.set(m.id, setTimeout(() => {
    pendingWrites.delete(m.id);
    storage.writeMatch(m);
  }, 150));
}

// ao desligar (ex.: o Render adormece ou reinicia o servidor), grava o que ainda está pendente
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    for (const [mid, t] of pendingWrites) {
      clearTimeout(t);
      if (matches.has(mid)) storage.writeMatch(matches.get(mid));
    }
    pendingWrites.clear();
    await storage.flush();
    process.exit(0);
  });
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
const publicMatch = ({ adminKey, pin, ...rest }) => ({ ...rest, hasPin: !!pin, categoryName: findCat(rest.category)?.name || '' });

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

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
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

const safeEqual = (x, y) => {
  const a = Buffer.from(String(x ?? ''));
  const b = Buffer.from(String(y ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// atrás de um proxy, o IP do dispositivo vem no cabeçalho X-Forwarded-For (senão todos teriam o IP do proxy)
const clientIp = (req) => (BEHIND_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;

// limita tentativas erradas (login e PIN) por IP: 5 falhas bloqueiam durante 5 minutos
const fails = new Map();
function guardTries(req, kind, ok) {
  const k = `${kind}:${clientIp(req)}`;
  const now = Date.now();
  const f = fails.get(k) || { n: 0, until: 0 };
  if (f.until > now) throw Object.assign(new Error('Demasiadas tentativas. Tente daqui a alguns minutos.'), { status: 429 });
  const res = ok();
  if (res) fails.delete(k);
  else {
    const n = (f.until ? 0 : f.n) + 1; // depois de um bloqueio, a contagem recomeça
    fails.set(k, { n, until: n >= 5 ? now + 5 * 60_000 : 0 });
  }
  return res;
}

// ---------- Utilizadores e sessões ----------
// admin: gere tudo (jogos, PIN dos jogos, escalões/plantel, utilizadores).
// user: vê e marca os jogos dos escalões a que pertence.
const SESSION_DAYS = 30;
let users = (await storage.readDoc('utilizadores')) || [];
const saveUsers = () => storage.writeDoc('utilizadores', users);

const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
};
const checkPassword = (u, pw) => safeEqual(crypto.scryptSync(String(pw), u.salt, 64).toString('hex'), u.hash);

// primeiro arranque (ou sem nenhum administrador): cria o administrador por omissão
// (num servidor público, defina ADMIN_PASSWORD para não usar a password que está no código)
if (!users.some((u) => u.role === 'admin')) {
  users.push({ id: crypto.randomBytes(4).toString('hex'), username: 'admin', name: 'Administrador', role: 'admin', categories: [], ...hashPassword(process.env.ADMIN_PASSWORD || 'Ac@mOwner') });
  saveUsers();
  console.log('Criado o utilizador administrador “admin”.');
}

// sessões: guarda-se só o hash do token, que fica num cookie HttpOnly
const sessions = new Map(); // sha256(token) -> { userId, exp }
for (const [k, v] of (await storage.readDoc('sessoes')) || []) if (v.exp > Date.now()) sessions.set(k, v);
const saveSessions = () => storage.writeDoc('sessoes', [...sessions]);
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function sessionToken(req) {
  const m = /(?:^|;\s*)vb_session=([a-f0-9]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function currentUser(req) {
  if ('user' in req) return req.user;
  const t = sessionToken(req);
  const s = t && sessions.get(sha(t));
  req.user = s && s.exp > Date.now() ? users.find((u) => u.id === s.userId) || null : null;
  return req.user;
}
// em HTTPS (atrás do proxy), o cookie só é enviado por ligações seguras
const sessionCookie = (req, token, maxAge) =>
  `vb_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${BEHIND_PROXY && req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;

const publicUser = ({ salt, hash, ...u }) => u;
const isAdmin = (u) => u?.role === 'admin';
/** O utilizador pode ver e marcar este jogo? */
const canAccess = (u, m) => isAdmin(u) || (!!u && u.categories.includes(m.category));

const needLogin = () => Object.assign(new Error('Inicie sessão'), { status: 401 });
const forbidden = (msg = 'Sem permissão') => Object.assign(new Error(msg), { status: 403 });
function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw needLogin();
  return u;
}
function requireAdmin(req) {
  const u = requireUser(req);
  if (!isAdmin(u)) throw forbidden('Só o administrador pode fazer isto');
  return u;
}

/** Pode marcar o jogo: utilizador com acesso, ou dispositivo com a chave do jogo (link ou PIN). */
function authorized(req, m) {
  return canAccess(currentUser(req), m) || safeEqual(req.headers['x-admin-key'] || '', m.adminKey);
}

function cleanPassword(pw) {
  const p = String(pw ?? '');
  if (p.length < 6) throw badRequest('A password deve ter pelo menos 6 caracteres');
  return p.slice(0, 200);
}
function cleanUser(body, prev = {}) {
  const username = str(body.username ?? prev.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) throw badRequest('O utilizador deve ter 2 a 40 letras, algarismos, “.”, “_” ou “-”, sem espaços');
  if (users.some((u) => u.id !== prev.id && u.username === username)) throw badRequest(`Já existe o utilizador “${username}”`);
  const role = (body.role ?? prev.role) === 'admin' ? 'admin' : 'user';
  const cats = Array.isArray(body.categories) ? body.categories : prev.categories || [];
  return {
    username,
    name: str(body.name ?? prev.name, 60) || username,
    role,
    categories: [...new Set(cats.map(String))].filter((c) => findCat(c)),
  };
}

function cleanPin(v) {
  const p = String(v ?? '').trim();
  if (p && !/^\d{4,8}$/.test(p)) throw badRequest('O PIN do jogo deve ter de 4 a 8 algarismos');
  return p;
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
const OLD_TEAM_FILE = path.join(DATA, '_team.json'); // versão antiga: um único plantel
let categories = (await storage.readDoc('escaloes')) || [];
const saveCategories = () => storage.writeDoc('escaloes', categories);

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
const hasOldTeam = storage.files && fs.existsSync(OLD_TEAM_FILE);
if (!categories.length && (hasOldTeam || matches.size)) {
  let old = { name: '', players: [] };
  try { if (hasOldTeam) old = JSON.parse(fs.readFileSync(OLD_TEAM_FILE, 'utf8')); } catch { /* sem plantel antigo */ }
  const cat = { id: newId(), name: 'Principal', teamName: old.name || '', players: old.players || [] };
  categories.push(cat);
  const recent = [...matches.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
  if (recent) mergeIntoCategory(cat, recent.teams.A);
  saveCategories();
  if (hasOldTeam) fs.renameSync(OLD_TEAM_FILE, `${OLD_TEAM_FILE}.bak`);
  console.log(`Plantel convertido no escalão “${cat.name}”`);
}
// jogos sem escalão (antigos) ficam no primeiro escalão
for (const m of matches.values()) {
  if (!m.category || !findCat(m.category)) {
    if (!categories.length) break;
    m.category = categories[0].id;
    storage.writeMatch(m);
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
  // ----- sessão -----
  if (parts[1] === 'login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = str(body.username, 40).toLowerCase();
    const u = users.find((x) => x.username === username);
    const ok = guardTries(req, 'login', () => !!u && checkPassword(u, String(body.password ?? '')));
    if (!ok) return send(res, 401, { error: 'Utilizador ou password errados' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(sha(token), { userId: u.id, exp: Date.now() + SESSION_DAYS * 86_400_000 });
    for (const [k, s] of sessions) if (s.exp <= Date.now()) sessions.delete(k);
    saveSessions();
    return send(res, 200, publicUser(u), { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86_400) });
  }
  if (parts[1] === 'logout' && req.method === 'POST') {
    const t = sessionToken(req);
    if (t && sessions.delete(sha(t))) saveSessions();
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (parts[1] === 'me') {
    const u = currentUser(req);
    if (req.method === 'GET') return send(res, 200, { user: u ? publicUser(u) : null });
    // mudar a própria password
    if (req.method === 'PUT' && id === 'password') {
      requireUser(req);
      const body = await readBody(req);
      if (!checkPassword(u, String(body.current ?? ''))) return send(res, 400, { error: 'A password atual está errada' });
      Object.assign(u, hashPassword(cleanPassword(body.password)));
      saveUsers();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Método não suportado' });
  }

  // ----- utilizadores (só administrador) -----
  if (parts[1] === 'users') {
    const me = requireAdmin(req);
    if (!id) {
      if (req.method === 'GET') return send(res, 200, users.map(publicUser));
      if (req.method === 'POST') {
        const body = await readBody(req);
        const u = { id: newId(), ...cleanUser(body), ...hashPassword(cleanPassword(body.password)) };
        users.push(u);
        saveUsers();
        return send(res, 201, publicUser(u));
      }
      return send(res, 405, { error: 'Método não suportado' });
    }
    const u = users.find((x) => x.id === id);
    if (!u) return send(res, 404, { error: 'Utilizador não encontrado' });
    const otherAdmins = users.some((x) => x.id !== u.id && x.role === 'admin');
    if (req.method === 'PUT') {
      const body = await readBody(req);
      const next = cleanUser(body, u);
      if (u.role === 'admin' && next.role !== 'admin' && !otherAdmins) throw badRequest('Tem de existir pelo menos um administrador');
      Object.assign(u, next);
      if (body.password) Object.assign(u, hashPassword(cleanPassword(body.password)));
      saveUsers();
      return send(res, 200, publicUser(u));
    }
    if (req.method === 'DELETE') {
      if (u.id === me.id) throw badRequest('Não pode apagar o seu próprio utilizador');
      users = users.filter((x) => x.id !== u.id);
      saveUsers();
      for (const [k, s] of sessions) if (s.userId === u.id) sessions.delete(k);
      saveSessions();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Método não suportado' });
  }

  if (parts[1] === 'categories') {
    const u = requireUser(req);
    if (!id) {
      // os utilizadores só veem os seus escalões, sem o plantel
      if (req.method === 'GET') {
        return send(res, 200, isAdmin(u) ? categories
          : categories.filter((c) => u.categories.includes(c.id)).map(({ id: cid, name, teamName }) => ({ id: cid, name, teamName, players: [] })));
      }
      requireAdmin(req);
      if (req.method === 'POST') {
        const cat = cleanCategory(await readBody(req));
        categories.push(cat);
        saveCategories();
        return send(res, 201, cat);
      }
      return send(res, 405, { error: 'Método não suportado' });
    }
    requireAdmin(req);
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
      for (const u of users) u.categories = u.categories.filter((c) => c !== id);
      saveUsers();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Método não suportado' });
  }
  if (parts[1] !== 'matches') return send(res, 404, { error: 'Não encontrado' });

  if (!id) {
    if (req.method === 'GET') {
      const u = requireUser(req);
      const list = [...matches.values()].filter((m) => canAccess(u, m)).map(summary).sort((a, b) => b.createdAt - a.createdAt);
      return send(res, 200, list);
    }
    if (req.method === 'POST') {
      requireAdmin(req);
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
        pin: cleanPin(body.pin),
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
    // dados do jogo: públicos (página do direto); o administrador vê também o PIN
    if (req.method === 'GET') return send(res, 200, isAdmin(currentUser(req)) ? { ...publicMatch(m), pin: m.pin || '' } : publicMatch(m));
    requireAdmin(req);
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (body.pin !== undefined) {
        const pin = cleanPin(body.pin);
        // PIN novo: renova a chave, para que os dispositivos já desbloqueados tenham de introduzir o novo PIN
        if (pin !== (m.pin || '')) m.adminKey = crypto.randomBytes(16).toString('hex');
        m.pin = pin;
      }
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
      pendingWrites.delete(id);
      await storage.deleteMatch(id);
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

  // PIN do jogo: dá a chave de marcador deste jogo a um dispositivo sem login
  if (sub === 'unlock' && req.method === 'POST') {
    const { pin } = await readBody(req);
    if (!m.pin) return send(res, 403, { error: 'Este jogo não tem PIN. Inicie sessão para marcar.' });
    const ok = guardTries(req, 'pin', () => safeEqual(str(pin, 20), m.pin));
    return ok ? send(res, 200, { key: m.adminKey }) : send(res, 403, { error: 'PIN errado' });
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
  console.log(`\n   Dados (escalões e jogos): ${storage.kind}\n`);
});
