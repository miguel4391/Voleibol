// Utilitários partilhados pelas páginas.

export const $ = (sel, el = document) => el.querySelector(sel);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const param = (name) => new URLSearchParams(location.search).get(name);

export function getKey(id) {
  return localStorage.getItem(`vb-key-${id}`);
}
export function setKey(id, key) {
  localStorage.setItem(`vb-key-${id}`, key);
}

export async function api(path, { method = 'GET', body, key } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['X-Admin-Key'] = key;
  const res = await fetch(`/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

/** Subscreve atualizações em direto de um jogo. Reconecta automaticamente. */
export function subscribe(id, onMatch, onStatus = () => {}) {
  const es = new EventSource(`/api/matches/${id}/stream`);
  es.addEventListener('match', (e) => onMatch(JSON.parse(e.data)));
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  return es;
}

let toastTimer;
export function toast(msg) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

export function fmtTime(t) {
  return new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

/** HTML do marcador (usado no marcador e na página de direto). */
export function scoreboardHTML(match, state, big = false) {
  const set = state.sets[state.currentSet];
  const side = (k) => `
    <div class="${k} ${!state.finished && state.serving === k ? 'serving' : ''}">
      <div class="team-name"><span class="dot ${k}"></span> ${esc(match.teams[k].name)}</div>
      <div class="pts">${set[k]}</div>
      <div class="sets">Sets: <b>${state.setsWon[k]}</b></div>
      <div class="serve">🏐 a servir</div>
    </div>`;
  const mid = state.finished
    ? '<span class="badge">Final</span>'
    : match.events.length
      ? `<span class="badge live">Direto</span><div>Set ${state.currentSet + 1}</div>`
      : '<span class="badge">Por começar</span>';
  return `
    <div class="scoreboard ${big ? 'big' : ''}">
      ${side('A')}
      <div class="mid">${mid}</div>
      ${side('B')}
    </div>
    ${setHistoryHTML(state)}`;
}

const ROLE_TAG = { S: 'P', OP: 'O', OH: 'Z4', MB: 'C', L: 'L' };

/**
 * Campo da nossa equipa (rede em cima): linha da frente 4-3-2, linha de trás 5-6-1.
 * Com `selectable`, cada jogador é um botão data-player.
 */
export function courtHTML(match, state, { selectable = false, selected } = {}) {
  const c = state.court;
  if (!c) return '';
  const cell = (z) => {
    const n = c.zones[z];
    const p = match.teams.A.players.find((x) => x.number === n);
    const role = c.role[n];
    const serving = z === 1 && state.serving === 'A' && !state.finished;
    const tag = selectable ? 'button' : 'div';
    return `<${tag} class="zone ${role === 'L' ? 'lib' : ''} ${selected === n ? 'active' : ''}" ${selectable ? `data-player="${n}"` : ''}>
      <span class="zn">P${z}${serving ? ' 🏐' : ''}</span>
      <span class="num">${n}</span>
      <span class="nm">${esc(p?.name || '')}</span>
      ${role ? `<span class="role" title="${esc(role)}">${ROLE_TAG[role] || ''}</span>` : ''}
    </${tag}>`;
  };
  return `<div class="court" aria-label="Formação em campo">
    <div class="net">rede</div>
    <div class="court-grid">${[4, 3, 2, 5, 6, 1].map(cell).join('')}</div>
  </div>`;
}

export function setHistoryHTML(state) {
  const done = state.sets.filter((s) => s.winner);
  if (!done.length) return '';
  return `<div class="set-history">${done
    .map((s, i) => `<span>S${i + 1} <b class="${s.winner === 'A' ? 'A' : ''}">${s.A}</b>-<b class="${s.winner === 'B' ? 'B' : ''}">${s.B}</b></span>`)
    .join('')}</div>`;
}

/** Lista de eventos (mais recentes primeiro). */
export function feedHTML(match, state, describe, limit = 200) {
  const evs = state.events.slice(-limit).reverse();
  if (!evs.length) return '<li class="muted">Ainda sem eventos.</li>';
  let html = '';
  let lastSet = null;
  for (const ev of evs) {
    if (ev.set !== lastSet) html += `<li class="set-sep">Set ${ev.set + 1}</li>`;
    lastSet = ev.set;
    html += `<li>
      <span class="sc">${ev.score.A}-${ev.score.B}</span>
      <span>${esc(describe(ev, match))}</span>
      ${ev.pointTo ? `<span class="pt ${ev.pointTo}">+1 ${esc(match.teams[ev.pointTo].name.slice(0, 10))}</span>` : '<span></span>'}
    </li>`;
  }
  return html;
}
