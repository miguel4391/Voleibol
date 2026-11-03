import { computeState, computeStats, describeEvent, derived, pct, pname, rotationOf, MAX_SUBS } from './engine.js';
import { $, esc, param, getKey, me, isAdmin, subscribe, scoreboardHTML, feedHTML, courtHTML } from './common.js';
import { createDashboard, setChartHTML, wireSetCharts } from './dashboard.js';

const id = param('id');
if (!id) location.href = '/';
$('#lnk-score').href = `/score.html?id=${id}`;
// página pública; o link Marcar aparece a quem pode marcar este jogo
const showScore = async (match) => {
  const u = await me();
  $('#lnk-score').hidden = !(getKey(id) || isAdmin(u) || u?.categories.includes(match.category));
};

const dash = createDashboard($('#tab-stats'));
let tab = 'live';
let wasFinished = null;

function showTab(t) {
  tab = t;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === t);
  $('#tab-live').classList.toggle('hidden', t !== 'live');
  $('#tab-stats').classList.toggle('hidden', t !== 'stats');
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => showTab(b.dataset.tab);

function render(match) {
  if (wasFinished === null) showScore(match);
  const state = computeState(match);
  document.title = `${match.teams.A.name} ${state.setsWon.A}-${state.setsWon.B} ${match.teams.B.name} — Direto`;
  $('#board').innerHTML = scoreboardHTML(match, state, true);

  const last = [...state.events].reverse().find((e) => e.type !== 'timeout') || state.events.at(-1);
  $('#last-play').innerHTML = last ? esc(describeEvent(last, match)) : '<span class="muted">À espera do início do jogo…</span>';

  const si = state.currentSet;
  const c = state.court;
  $('#court-card').classList.toggle('hidden', !c);
  if (c) {
    $('#court-card').innerHTML = `<h2>Em campo — ${esc(match.teams.A.name)}</h2>${courtHTML(match, state)}
      <div class="court-status">Substituições: <b>${c.subs}/${MAX_SUBS}</b>${c.libero ? ` · Líbero ${esc(pname(match, c.libero.libero))} por #${c.libero.replaced}` : ''}${rotationOf(c) ? ` · Rotação R${rotationOf(c)}` : ''}</div>`;
  }
  const set = state.sets[si];
  const target = si === match.config.bestOf - 1 ? match.config.decidingSetPoints : match.config.setPoints;
  $('#current-chart').innerHTML = `<h2>Evolução do set</h2>
    <div class="legend"><span><i class="A"></i>${esc(match.teams.A.name)}</span><span><i class="B"></i>${esc(match.teams.B.name)}</span></div>
    ${setChartHTML(match, set, si, target)}`;
  wireSetCharts($('#current-chart'), match, state);

  // resumos da nossa equipa (A) no set em curso e no jogo
  for (const el of document.querySelectorAll('.us-name')) el.textContent = match.teams.A.name;
  const cur = computeStats(match, state, si).teams.A;
  const all = computeStats(match, state).teams.A;
  const f = (v, isPct) => (v == null ? '—' : isPct ? `${v}%` : v);
  // linhas: [rótulo, (equipa) => valor, é percentagem?, dica]
  const table = (rows) => `<table class="stats top-scorers"><thead><tr><th></th><th style="text-align:right">Set ${si + 1}</th><th style="text-align:right">Jogo</th></tr></thead><tbody>
    ${rows.map(([l, get, p, hint]) => `<tr${hint ? ` title="${esc(hint)}"` : ''}><td>${l}</td><td style="text-align:right"><b>${f(get(cur), p)}</b></td><td style="text-align:right">${f(get(all), p)}</td></tr>`).join('')}
    </tbody></table>`;
  $('#sum-rec').innerHTML = table([
    ['Side-out', (t) => pct(t.sideout.won, t.sideout.tot), true, 'Pontos ganhos quando o adversário serve'],
    ['Média receção (0–3)', (t) => derived(t).recAvg, false],
    ['Receção positiva', (t) => derived(t).recPositive, true, 'Perfeita + boa'],
    ['Ases sofridos', (t) => t.reception.err, false],
    ['Defesas boas', (t) => derived(t).digPositive, true],
    ['Pontos de bloco', (t) => t.block.pts, false],
  ]);
  $('#sum-atk').innerHTML = table([
    ['Ataques', (t) => t.attack.tot, false],
    ['Pontos de ataque', (t) => t.attack.kill, false],
    ['% de pontos', (t) => derived(t).killPct, true, 'Pontos de ataque / ataques'],
    ['Erros de ataque', (t) => t.attack.err, false],
    ['Bloqueados', (t) => t.attack.blk, false, 'Ataques nossos bloqueados pelo adversário'],
    ['Eficácia', (t) => derived(t).attackEff, true, '(Pontos − erros − bloqueados) / ataques'],
  ]);

  $('#feed').innerHTML = feedHTML(match, state, describeEvent);

  dash.update(match);

  // quando o jogo termina, passa automaticamente para o dashboard
  if (state.finished && wasFinished !== true) showTab('stats');
  wasFinished = state.finished;
}

subscribe(id, render, (ok) => {
  $('#conn').textContent = ok ? '● em direto' : '● a religar…';
  $('#conn').classList.toggle('off', !ok);
});
