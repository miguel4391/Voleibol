import { computeState, computeStats, describeEvent, derived, pct, pname, rotationOf, MAX_SUBS } from './engine.js';
import { $, esc, param, getKey, subscribe, scoreboardHTML, feedHTML, courtHTML } from './common.js';
import { createDashboard, setChartHTML, wireSetCharts } from './dashboard.js';

const id = param('id');
if (!id) location.href = '/';
if (getKey(id)) { $('#lnk-score').hidden = false; $('#lnk-score').href = `/score.html?id=${id}`; }

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

  // resumo da nossa equipa (A) no set em curso e no jogo
  $('#us-name').textContent = match.teams.A.name;
  const row = (st) => {
    const t = st.teams.A, d = derived(t);
    return [pct(t.sideout.won, t.sideout.tot), d.recAvg, d.recPositive, t.reception.err, d.digPositive, t.block.pts];
  };
  const cur = row(computeStats(match, state, si));
  const all = row(computeStats(match, state));
  const f = (v, isPct) => (v == null ? '—' : isPct ? `${v}%` : v);
  const labels = [['Side-out', true], ['Média receção (0–3)', false], ['Receção positiva', true], ['Ases sofridos', false], ['Defesas boas', true], ['Pontos de bloco', false]];
  $('#top').innerHTML = `<table class="stats top-scorers"><thead><tr><th></th><th style="text-align:right">Set ${si + 1}</th><th style="text-align:right">Jogo</th></tr></thead><tbody>
    ${labels.map(([l, p], i) => `<tr><td>${l}</td><td style="text-align:right"><b>${f(cur[i], p)}</b></td><td style="text-align:right">${f(all[i], p)}</td></tr>`).join('')}
    </tbody></table>`;

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
