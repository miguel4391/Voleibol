import { SKILLS, ROLES, MAX_SUBS, ZONES, BACK_ROW, computeState, describeEvent, courtError, zoneOf, pname, nextActions } from './engine.js';
import { $, esc, api, param, getKey, setKey, me, isAdmin, loginUrl, subscribe, toast, scoreboardHTML, feedHTML, courtHTML } from './common.js';

const id = param('id');
// links antigos traziam a chave no fragmento (#k=...): já não dá acesso, o PIN é obrigatório
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
const key = getKey(id);

for (const a of ['#lnk-live', '#lnk-live2']) $(a).href = `/live.html?id=${id}`;
$('#lnk-dash').href = `/dashboard.html?id=${id}`;
$('#lnk-edit').href = `/?edit=${id}`;

let match = null;
let state = null;
const sel = { player: undefined, auto: false, hold: false }; // player: undefined = nenhum, null = equipa
let busy = false;
let showAll = false; // mostrar todas as ações (situações fora do normal)

// sem acesso: o PIN do jogo dá a chave de marcador deste jogo a este dispositivo
$('#pin-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await api(`matches/${id}/unlock`, { method: 'POST', body: { pin: $('#pin').value.trim() } });
    setKey(id, r.key);
    location.reload();
  } catch (err) { toast(err.message); }
};
$('#lnk-login').href = loginUrl();

async function init() {
  if (!id) { location.href = '/'; return; }
  // acesso: sessão de um utilizador do escalão (ou administrador), ou a chave do jogo (link ou PIN)
  const user = await me();
  try {
    await api(`matches/${id}/check`, { key });
  } catch {
    $('#no-key').classList.remove('hidden');
    $('#login-hint').classList.toggle('hidden', !!user);
    $('#pin').focus();
    return;
  }
  if (!isAdmin(user)) $('#lnk-edit').classList.add('hidden');
  $('#app').classList.remove('hidden');
  subscribe(id, (m) => { match = m; state = computeState(m); sel.hold = false; render(); }, (ok) => {
    $('#conn').textContent = ok ? '● ligado' : '● sem ligação';
    $('#conn').classList.toggle('off', !ok);
  });
}

const squad = () => match.teams.A.players;
const nonLiberos = () => squad().filter((p) => !p.libero);
const liberos = () => squad().filter((p) => p.libero);
const setHasPoints = () => state.sets[state.currentSet].rallies.length > 0;

function render() {
  $('#board').innerHTML = scoreboardHTML(match, state);
  document.title = `${match.teams.A.name} ${state.setsWon.A}-${state.setsWon.B} ${match.teams.B.name} — Marcador`;
  for (const el of document.querySelectorAll('.nmA')) el.textContent = match.teams.A.name;
  $('#set-lbl').textContent = `Set ${state.currentSet + 1}`;

  const c = state.court;
  const next = nextActions(state);
  // a servir: seleciona automaticamente o jogador em P1
  const serveOnly = !showAll && next.skills.has('serve') && next.skills.size === 2;
  if (serveOnly && c && sel.player === undefined && !sel.hold) { sel.player = c.zones[1]; sel.auto = true; }
  if (!serveOnly && sel.auto) { sel.player = undefined; sel.auto = false; }

  $('#lineup-warn').innerHTML = !c && !state.finished
    ? `<div class="warn small">Defina a <b>formação do set ${state.currentSet + 1}</b> antes do primeiro ponto (P1–P6, posições e líbero) para ativar a rotação automática.
        <button class="btn-sm btn-primary" id="warn-lineup" style="margin-left:.4rem">Definir formação</button></div>`
    : '';
  $('#court').innerHTML = courtHTML(match, state, { selectable: true, selected: sel.player });
  $('#court-status').innerHTML = c
    ? `Substituições: <b>${c.subs}/${MAX_SUBS}</b>${c.libero ? ` · Líbero ${pname(match, c.libero.libero)} por #${c.libero.replaced}` : ''}`
    : '';

  // banco (ou todos os convocados, se ainda não houver formação)
  const onCourt = new Set(c ? Object.values(c.zones) : []);
  const bench = squad().filter((p) => !onCourt.has(p.number));
  $('#bench').innerHTML = `<span class="lbl">${c ? 'Banco:' : 'Jogadores:'}</span>` +
    bench.map((p) => `<button data-player="${p.number}" class="${sel.player === p.number ? 'active' : ''}" title="${esc(p.name)}">
      <b>${p.number}</b>${p.libero ? ' <span class="small" style="color:var(--team-b)">L</span>' : ''} <span class="small muted">${esc((p.name || '').split(' ')[0])}</span></button>`).join('') +
    `<button data-player="team" class="${sel.player === null ? 'active' : ''}">⚑ Equipa</button>`;

  $('#sel-info').innerHTML =
    sel.player === undefined
      ? 'Toque num jogador (no campo ou no banco) e depois na ação.'
      : `Selecionado: <b>${sel.player === null ? 'Equipa' : esc(pname(match, sel.player))}</b>`;

  $('#btn-lineup').disabled = state.finished || setHasPoints();
  $('#btn-sub').disabled = state.finished || !c;
  $('#btn-libero').disabled = state.finished || !c || !liberos().length;
  $('#btn-libero').textContent = c?.libero ? 'Líbero (trocar / sair)' : 'Líbero entra';

  // só as ações possíveis neste momento da jogada (a falta está sempre disponível)
  const noPlayer = sel.player === undefined;
  const visible = Object.entries(SKILLS).filter(([sk]) => showAll || next.skills.has(sk));
  // antes do 1.º ponto do set ainda se pode trocar quem serve
  const canToss = !state.finished && !state.needServe && !setHasPoints();
  $('#phase').innerHTML = state.finished ? '' : `<b>${esc(next.phase)}</b>` +
    (canToss ? ` <button class="btn-sm" data-toss="${state.serving === 'A' ? 'B' : 'A'}">Trocar quem serve</button>` : '');
  $('#btn-all').textContent = showAll ? 'Só as ações do momento' : 'Mostrar todas as ações';
  $('#btn-all').classList.toggle('hidden', state.finished || state.needServe);
  $('#skills').innerHTML = state.needServe
    ? `<div class="quick">
        <button class="btn-primary" data-toss="A">🏐 ${esc(match.teams.A.name)}</button>
        <button data-toss="B">🏐 ${esc(match.teams.B.name)}</button>
      </div>`
    : visible
    .map(([sk, def]) => `<div class="skill-row ${sk === 'fault' ? 'fault-row' : ''}"><div class="sk">${sk === 'dig' && next.cover ? 'Defesa ao bloco' : def.label}</div><div class="res">${Object.entries(def.results)
      .map(([r, rd]) => `<button data-skill="${sk}" data-result="${r}" class="${rd.point === 'self' ? 'pt-self' : rd.point === 'opp' ? 'pt-opp' : ''}" ${noPlayer || state.finished ? 'disabled' : ''}>${rd.label}</button>`)
      .join('')}</div></div>`)
    .join('');

  for (const b of document.querySelectorAll('.quick button:not([data-toss])')) b.disabled = state.finished;
  for (const b of ['#pt-opp-err', '#pt-A', '#pt-B']) $(b).disabled = state.finished || state.needServe;
  $('#opp-ace').disabled = state.finished || !(showAll || next.oppAce);
  $('#opp-kill').disabled = state.finished || !(showAll || next.oppKill);
  $('#opp-kill').textContent = next.cover ? 'Bloco' : 'Ataque';
  $('#btn-undo').disabled = !match.events.length;
  $('#btn-close').textContent = match.closed ? 'Reabrir jogo' : 'Terminar jogo';
  $('#btn-close').classList.toggle('hidden', state.finished && !match.closed);

  $('#feed').innerHTML = feedHTML(match, state, describeEvent, 60);
}

async function post(ev) {
  if (busy) return;
  busy = true;
  const prev = sel.player;
  sel.player = undefined;
  sel.auto = false;
  sel.hold = true; // não auto-selecionar com o estado antigo; liberta quando chegar a atualização
  showAll = false;
  render();
  try {
    await api(`matches/${id}/events`, { method: 'POST', body: ev, key });
    if (navigator.vibrate) navigator.vibrate(15);
  } catch (e) {
    sel.player = prev;
    sel.hold = false;
    render();
    toast(e.message);
  } finally {
    busy = false;
  }
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t || !match || t.closest('dialog')) return;
  if (t.id === 'warn-lineup') { openLineup(); return; }
  if (t.dataset.player) {
    sel.player = t.dataset.player === 'team' ? null : Number(t.dataset.player);
    sel.auto = false;
    render();
    return;
  }
  if (t.id === 'btn-all') { showAll = !showAll; render(); return; }
  if (t.dataset.toss) { await post({ type: 'toss', team: t.dataset.toss }); return; }
  if (t.dataset.skill) {
    await post({ type: 'action', team: 'A', player: sel.player, skill: t.dataset.skill, result: t.dataset.result });
  }
});

$('#pt-opp-err').onclick = () => post({ type: 'point', team: 'A', reason: 'oppError' });
$('#pt-A').onclick = () => post({ type: 'point', team: 'A' });
$('#pt-B').onclick = () => post({ type: 'point', team: 'B' });
// pontos diretos do adversário sem toque nosso: ficam como erro da equipa (sem jogador)
$('#opp-ace').onclick = () => post({ type: 'action', team: 'A', player: null, skill: 'reception', result: 'error' });
$('#opp-kill').onclick = () => post({ type: 'action', team: 'A', player: null, skill: 'dig', result: 'error' });
$('#to-A').onclick = () => post({ type: 'timeout', team: 'A' });
$('#to-B').onclick = () => post({ type: 'timeout', team: 'B' });

$('#btn-undo').onclick = async () => {
  const last = state.events.at(-1);
  if (!last) return;
  try {
    await api(`matches/${id}/events/last`, { method: 'DELETE', key });
    toast(`Anulado: ${describeEvent(last, match)}`);
  } catch (e) { toast(e.message); }
};

$('#btn-close').onclick = async () => {
  const closing = !match.closed;
  if (closing && !confirm('Terminar o jogo agora? (Pode reabrir depois.)')) return;
  try { await api(`matches/${id}/close`, { method: 'POST', body: { closed: closing }, key }); } catch (e) { toast(e.message); }
};

// ---------- diálogos: formação, substituição, líbero ----------
const dlg = $('#dlg');
const form = $('#dlg-form');
const opt = (v, label, selected, disabled) => `<option value="${v}" ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</option>`;
const roleSelect = (cls, value) => `<select class="${cls}">${Object.entries(ROLES).filter(([k]) => k !== 'L').map(([k, v]) => opt(k, v, k === value)).join('')}</select>`;

function openDialog(html, onSubmit) {
  form.innerHTML = `${html}<p class="dlg-err" id="dlg-err"></p>
    <div class="dlg-actions"><button value="cancel" formnovalidate>Cancelar</button><button class="btn-primary" id="dlg-ok" value="ok">Confirmar</button></div>`;
  form.onsubmit = async (e) => {
    if (e.submitter?.value !== 'ok') return; // cancelar fecha normalmente
    e.preventDefault();
    const ev = onSubmit();
    if (typeof ev === 'string') { $('#dlg-err').textContent = ev; return; }
    const err = courtError(ev, match, state);
    if (err) { $('#dlg-err').textContent = err; return; }
    try {
      await api(`matches/${id}/events`, { method: 'POST', body: ev, key });
      dlg.close();
    } catch (er) { $('#dlg-err').textContent = er.message; }
  };
  dlg.showModal();
}

function openLineup() {
  if (setHasPoints()) { toast('O set já começou — use substituições'); return; }
  const si = state.currentSet;
  // proposta: a formação já definida para este set ou a do set anterior
  const base = state.courts[si] || state.courts[si - 1];
  const at = (z) => base?.lineup.find((s) => s.zone === z);
  const pos = (n) => squad().find((p) => p.number === n)?.pos;
  const zoneName = { 1: 'P1 (serviço)', 2: 'P2', 3: 'P3', 4: 'P4', 5: 'P5', 6: 'P6' };
  const rows = ZONES.map((z) => {
    const s = at(z);
    return `<span class="zl">P${z}${z === 1 ? ' 🏐' : ''}</span>
      <select class="lp" data-zone="${z}">${opt('', '—', !s)}${nonLiberos().map((p) => opt(p.number, `#${p.number} ${p.name}`, s?.player === p.number)).join('')}</select>
      ${roleSelect(`lr lr-${z}`, s?.role || pos(s?.player) || 'OH')}`;
  }).join('');
  const lib = base?.startLibero;
  const libZone = lib ? base.lineup.find((s) => s.player === lib.liberoFor)?.zone : 6;
  openDialog(`
    <h2>Formação inicial — Set ${si + 1}</h2>
    <div class="lineup-grid"><span class="small muted">Posição</span><span class="small muted">Jogador</span><span class="small muted">Função</span>${rows}</div>
    <div class="grid2" style="gap:.5rem;margin-top:.6rem">
      <div><label>Líbero inicial</label>
        <select id="l-lib">${opt('', 'Sem líbero', !lib)}${liberos().map((p) => opt(p.number, `#${p.number} ${p.name}`, lib?.libero === p.number)).join('')}</select></div>
      <div><label>Líbero substitui o jogador da</label>
        <select id="l-zone">${BACK_ROW.map((z) => opt(z, zoneName[z], z === libZone)).join('')}</select></div>
    </div>
    <label>Primeiro serviço do set</label>
    <select id="l-serve">${state.needServe ? opt('', '— escolher —', true) : ''}${opt('A', match.teams.A.name, state.serving === 'A')}${opt('B', match.teams.B.name, state.serving === 'B')}</select>
    <p class="small muted">Rede em cima: linha da frente 4-3-2, linha de trás 5-6-1. A rotação é automática sempre que ganhamos o serviço.</p>`,
  () => {
    const slots = ZONES.map((z) => ({ zone: z, player: Number(form.querySelector(`.lp[data-zone="${z}"]`).value) || null, role: form.querySelector(`.lr-${z}`).value }));
    if (slots.some((s) => s.player == null)) return 'Escolha um jogador para cada posição (P1–P6)';
    const libero = Number($('#l-lib').value) || null;
    const liberoFor = libero ? slots.find((s) => s.zone === Number($('#l-zone').value)).player : null;
    if (!$('#l-serve').value) return 'Indique quem serve primeiro';
    return { type: 'lineup', team: 'A', slots, libero, liberoFor, serve: $('#l-serve').value };
  });
  // ao escolher um jogador, propõe a sua posição habitual
  form.querySelectorAll('.lp').forEach((s) => s.addEventListener('change', () => {
    const p = pos(Number(s.value));
    if (p && p !== 'L') form.querySelector(`.lr-${s.dataset.zone}`).value = p;
  }));
}

function openSub() {
  const c = state.court;
  if (c.subs >= MAX_SUBS) { toast(`Limite de ${MAX_SUBS} substituições atingido neste set`); return; }
  const out = ZONES.map((z) => c.zones[z]).filter((n) => c.role[n] !== 'L');
  const defaultOut = out.includes(sel.player) ? sel.player : out[0];
  openDialog(`
    <h2>Substituição — Set ${state.currentSet + 1}</h2>
    <p class="small muted">Substituições usadas: <b>${c.subs}/${MAX_SUBS}</b>. As trocas de líbero não contam.</p>
    <label>Sai</label>
    <select id="s-out">${out.map((n) => opt(n, `${pname(match, n)} — P${zoneOf(c, n)} (${ROLES[c.role[n]] || '—'})`, n === defaultOut)).join('')}</select>
    <label>Entra</label>
    <select id="s-in"></select>
    <label>Posição de quem entra</label>
    ${roleSelect('s-role', 'OH')}`,
  () => {
    const ev = { type: 'sub', team: 'A', out: Number($('#s-out').value), in: Number($('#s-in').value), role: form.querySelector('.s-role').value };
    return ev.in ? ev : 'Não há jogadores que possam entrar por este jogador';
  });
  const fill = () => {
    const o = Number($('#s-out').value);
    const onCourt = new Set(Object.values(c.zones));
    const cands = nonLiberos().filter((p) => !onCourt.has(p.number) && p.number !== c.libero?.replaced);
    const rows = cands.map((p) => ({ p, err: courtError({ type: 'sub', team: 'A', out: o, in: p.number }, match, state) }));
    const firstOk = rows.find((r) => !r.err);
    $('#s-in').innerHTML = rows.length
      ? rows.map(({ p, err }) => opt(p.number, `#${p.number} ${p.name}${err ? ' — não permitido' : ''}`, p === firstOk?.p, !!err)).join('')
      : opt('', 'Sem jogadores no banco', true);
    form.querySelector('.s-role').value = c.role[o] || 'OH';
    $('#dlg-err').textContent = firstOk ? '' : rows[0]?.err || '';
  };
  $('#s-out').addEventListener('change', fill);
  fill();
}

function openLibero() {
  const c = state.court;
  const cur = c.libero;
  // jogador “dono” de cada posição da linha de trás (se lá estiver o líbero, é quem ele substituiu)
  const back = BACK_ROW.map((z) => ({ z, n: cur && c.zones[z] === cur.libero ? cur.replaced : c.zones[z] }));
  // sugestão: uma central da linha de trás (diferente do jogador que o líbero já substitui)
  const options = back.filter(({ n }) => n !== cur?.replaced);
  const suggested = (options.find(({ n }) => c.role[n] === 'MB') ?? options[0] ?? back[0]).n;
  // o outro líbero pode entrar diretamente para o lugar do que está em campo
  const others = cur ? liberos().filter((p) => p.number !== cur.libero) : [];
  openDialog(`<h2>Líbero</h2>
    ${cur
      ? `<p>Em campo: líbero <b>${esc(pname(match, cur.libero))}</b> por <b>${esc(pname(match, cur.replaced))}</b> (P${zoneOf(c, cur.libero)}).</p>
         ${others.map((p) => `<button type="button" class="btn-primary lb-swap" data-lib="${p.number}" style="width:100%;margin-bottom:.4rem">
           Trocar de líbero: entra ${esc(pname(match, p.number))}, sai ${esc(pname(match, cur.libero))}</button>`).join('')}
         <button type="button" id="lb-out" style="width:100%">Líbero sai — volta ${esc(pname(match, cur.replaced))}</button>
         <h3 style="margin-top:1rem">Ou passar para o lugar de outro jogador</h3>`
      : ''}
    <label>Líbero</label>
    <select id="lb-lib">${liberos().map((p) => opt(p.number, `#${p.number} ${p.name}`, p.number === cur?.libero)).join('')}</select>
    <label>Entra para o lugar de (linha de trás)</label>
    <select id="lb-for">${back.map(({ z, n }) => opt(n, `P${z} — ${pname(match, n)} (${ROLES[c.role[n]] || '—'})`, n === suggested)).join('')}</select>
    <p class="small muted">O líbero pode substituir qualquer jogador da linha de trás (P1, P5, P6), sempre que necessário. Se já estiver em campo, sai e volta o jogador que ele tinha substituído. Quando a rotação o levar para P4 (junto à rede), troca automaticamente com esse jogador. As trocas de líbero não contam para o limite de substituições.</p>`,
  () => ({ type: 'libero', team: 'A', action: 'in', libero: Number($('#lb-lib').value), player: Number($('#lb-for').value) }));
  const quick = async (body) => {
    try {
      await api(`matches/${id}/events`, { method: 'POST', body: { type: 'libero', team: 'A', ...body }, key });
      dlg.close();
    } catch (er) { $('#dlg-err').textContent = er.message; }
  };
  $('#lb-out')?.addEventListener('click', () => quick({ action: 'out' }));
  form.querySelectorAll('.lb-swap').forEach((b) => b.addEventListener('click', () =>
    quick({ action: 'in', libero: Number(b.dataset.lib), player: cur.replaced })));
}

$('#btn-lineup').onclick = openLineup;
$('#btn-sub').onclick = openSub;
$('#btn-libero').onclick = openLibero;

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt('Copie o link:', text); }
}
$('#copy-live').onclick = () => copy(`${location.origin}/live.html?id=${id}`, 'Link do direto copiado');
// o link de marcador não dá acesso por si: quem o abre sem sessão tem de introduzir o PIN do jogo
$('#copy-score').onclick = () => copy(`${location.origin}/score.html?id=${id}`,
  match?.hasPin === false ? 'Link copiado — este jogo não tem PIN: só marcam utilizadores com sessão' : 'Link de marcador copiado (pede o PIN do jogo)');

init();
