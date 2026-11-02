import { computeState, computeStats, derived, describeEvent, pct, ZONES, ROLES } from './engine.js';
import { esc, fmtDuration, setHistoryHTML } from './common.js';

// A equipa “A” é sempre a nossa; do adversário mostra-se apenas o marcador.
const US = 'A';

const fmtPct = (v) => (v == null ? '—' : `${v}%`);
const fmtRatio = (r) => (r.tot ? `${r.won}/${r.tot}` : '—');

// ---------- tooltip partilhada ----------
function tipFor(container) {
  let tip = container.querySelector(':scope > .tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    container.append(tip);
  }
  return tip;
}
function placeTip(tip, container, clientX, clientY, html) {
  tip.innerHTML = html;
  tip.classList.add('show');
  const r = container.getBoundingClientRect();
  const w = tip.offsetWidth;
  let x = clientX - r.left + 12;
  if (x + w > r.width) x = clientX - r.left - w - 12;
  tip.style.left = `${Math.max(0, x)}px`;
  tip.style.top = `${clientY - r.top - tip.offsetHeight - 10}px`;
}

// ---------- gráfico da evolução do marcador num set ----------
export function setChartHTML(match, set, idx, target) {
  const W = 320, H = 170, L = 24, R = 30, T = 10, B = 22;
  const n = set.rallies.length;
  const maxY = Math.max(target, set.A, set.B);
  const x = (i) => L + (n ? (i / n) * (W - L - R) : 0);
  const y = (v) => T + (1 - v / maxY) * (H - T - B);
  const pts = (k) => [[0, 0], ...set.rallies.map((r, i) => [i + 1, r[k]])].map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const grid = [];
  for (let v = 0; v <= maxY; v += 5) {
    grid.push(`<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`);
  }
  // rótulos finais diretos, afastados se colidirem
  let yA = y(set.A), yB = y(set.B);
  if (Math.abs(yA - yB) < 12) { const mid = (yA + yB) / 2; const up = set.A >= set.B; yA = mid + (up ? -6 : 6); yB = mid + (up ? 6 : -6); }
  const title = `Set ${idx + 1}: ${match.teams.A.name} ${set.A}–${set.B} ${match.teams.B.name}`;
  return `<div class="chart" data-set="${idx}" data-max="${maxY}">
    <h3>Set ${idx + 1} <span class="muted">· ${set.A}–${set.B}${set.winner ? '' : ' (em curso)'}</span></h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
      <g class="axis">${grid.join('')}
        <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">jogadas com ponto →</text></g>
      ${n ? `<polyline class="line A" points="${pts('A')}"/><polyline class="line B" points="${pts('B')}"/>
      <text class="endlbl" x="${x(n) + 5}" y="${yA + 4}">${set.A}</text>
      <text class="endlbl" x="${x(n) + 5}" y="${yB + 4}">${set.B}</text>` : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="muted" fill="currentColor">Sem pontos</text>`}
      <g class="hover" style="display:none">
        <line class="cross" y1="${T}" y2="${H - B}"/>
        <circle class="mk A" r="4.5"/><circle class="mk B" r="4.5"/>
      </g>
      <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>
    </svg>
  </div>`;
}

/** Liga crosshair + tooltip aos gráficos de sets dentro de `root`. */
export function wireSetCharts(root, match, state) {
  for (const ch of root.querySelectorAll('.chart[data-set]')) {
    const set = state.sets[Number(ch.dataset.set)];
    const svg = ch.querySelector('svg');
    const hit = ch.querySelector('.hit');
    const g = ch.querySelector('.hover');
    const tip = tipFor(ch);
    const n = set.rallies.length;
    if (!n || !hit) continue;
    const L = 24, W = 320, R = 30, T = 10, H = 170, B = 22;
    const maxY = Number(ch.dataset.max);
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.min(n, Math.max(1, Math.round(((sx - L) / (W - L - R)) * n)));
      const rally = set.rallies[i - 1];
      const px = L + (i / n) * (W - L - R);
      const py = (v) => T + (1 - v / maxY) * (H - T - B);
      g.style.display = '';
      g.querySelector('line').setAttribute('x1', px);
      g.querySelector('line').setAttribute('x2', px);
      g.querySelector('.mk.A').setAttribute('cx', px); g.querySelector('.mk.A').setAttribute('cy', py(rally.A));
      g.querySelector('.mk.B').setAttribute('cx', px); g.querySelector('.mk.B').setAttribute('cy', py(rally.B));
      const ev = state.events.find((x) => x.id === rally.id);
      placeTip(tip, ch, e.clientX, e.clientY,
        `<div class="small muted">Ponto ${i} · ganho por ${esc(match.teams[rally.to].name)}</div>
         <div><span class="dot A"></span> ${esc(match.teams.A.name)} <b>${rally.A}</b></div>
         <div><span class="dot B"></span> ${esc(match.teams.B.name)} <b>${rally.B}</b></div>
         ${ev ? `<div class="small muted">${esc(describeEvent(ev, match))}</div>` : ''}`);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { g.style.display = 'none'; tip.classList.remove('show'); });
  }
}

function setTarget(match, i) {
  const c = match.config;
  return i === c.bestOf - 1 ? c.decidingSetPoints : c.setPoints;
}

// ---------- tabelas de jogadores ----------
const ID_COLS = [
  { k: 'number', h: '#', get: (p) => p.number },
  { k: 'name', h: 'Nome', get: (p) => `${p.name || '—'}${p.libero ? ' (L)' : ''}`, text: true },
];
const TABLES = {
  rec: {
    title: 'Receção de serviço',
    sort: 'rTot',
    cols: [
      ...ID_COLS,
      { k: 'rTot', h: 'Total', get: (p) => p.reception.tot },
      { k: 'rPerf', h: 'Perfeita', get: (p) => p.reception.perfect },
      { k: 'rGood', h: 'Boa', get: (p) => p.reception.good },
      { k: 'rPoor', h: 'Má', get: (p) => p.reception.poor },
      { k: 'rErr', h: 'Erro/Ás', get: (p) => p.reception.err },
      { k: 'rAvg', h: 'Média', get: (p) => derived(p).recAvg, title: 'Escala 0–3: perfeita 3, boa 2, má 1, erro 0' },
      { k: 'rPos', h: 'Pos%', get: (p) => derived(p).recPositive, pct: true, title: 'Perfeita + Boa' },
      { k: 'rPerfPct', h: 'Perf%', get: (p) => derived(p).recPerfect, pct: true },
      { k: 'rErrPct', h: 'Erro%', get: (p) => derived(p).recErrPct, pct: true },
    ],
  },
  def: {
    title: 'Defesa e bloco',
    sort: 'dTot',
    cols: [
      ...ID_COLS,
      { k: 'dTot', h: 'Defesas', get: (p) => p.dig.tot },
      { k: 'dGood', h: 'Boa', get: (p) => p.dig.good, title: 'Bola controlada' },
      { k: 'dPoor', h: 'Má', get: (p) => p.dig.poor, title: 'Defendida sem controlo' },
      { k: 'dErr', h: 'Erro', get: (p) => p.dig.err },
      { k: 'dPos', h: 'Boa%', get: (p) => derived(p).digPositive, pct: true },
      { k: 'cTot', h: 'Def. bloco', get: (p) => p.cover.tot, title: 'Defesas ao bloco (após remate nosso bloqueado)' },
      { k: 'cGood', h: 'Def. bloco boa', get: (p) => p.cover.good },
      { k: 'cErr', h: 'Def. bloco erro', get: (p) => p.cover.err },
      { k: 'bPts', h: 'Bloco pts', get: (p) => p.block.pts },
      { k: 'bTouch', h: 'Bloco toq.', get: (p) => p.block.touch },
      { k: 'bErr', h: 'Bloco erro', get: (p) => p.block.err },
    ],
  },
  atk: {
    title: 'Ataque, serviço e passe',
    sort: 'points',
    cols: [
      ...ID_COLS,
      { k: 'points', h: 'Pts', get: (p) => p.points },
      { k: 'errors', h: 'Erros', get: (p) => p.errors, title: 'Pontos oferecidos ao adversário' },
      { k: 'aTot', h: 'Atq', get: (p) => p.attack.tot },
      { k: 'aKill', h: 'Atq pts', get: (p) => p.attack.kill },
      { k: 'aErr', h: 'Atq err', get: (p) => p.attack.err },
      { k: 'aBlk', h: 'Blq', get: (p) => p.attack.blk, title: 'Ataques bloqueados' },
      { k: 'aEff', h: 'Ef%', get: (p) => derived(p).attackEff, pct: true, title: '(Pontos − Erros − Bloqueados) / Total' },
      { k: 'sTot', h: 'Serv', get: (p) => p.serve.tot },
      { k: 'sAce', h: 'Ás', get: (p) => p.serve.ace },
      { k: 'sErr', h: 'Serv err', get: (p) => p.serve.err },
      { k: 'stAst', h: 'Assist', get: (p) => p.set.assist },
    ],
  },
};

function playerTableHTML(id, rows, total, sortKey) {
  const { cols } = TABLES[id];
  const col = cols.find((c) => c.k === sortKey) || cols[2];
  const sorted = [...rows].sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    if (col.text) return String(va).localeCompare(String(vb));
    return (vb ?? -1) - (va ?? -1) || a.number - b.number;
  });
  const cell = (c, p) => {
    const v = c.get(p);
    const s = c.pct ? fmtPct(v) : v == null ? '—' : esc(v);
    const zero = v === 0 || v == null;
    return `<td class="${c.k === 'name' ? 'name' : ''} ${zero && !c.text ? 'zero' : ''}">${s}</td>`;
  };
  return `<div class="table-wrap"><table class="stats" data-table="${id}">
    <thead><tr>${cols.map((c) => `<th data-sort="${c.k}" class="${c.k === col.k ? 'sorted' : ''}" ${c.title ? `title="${esc(c.title)}"` : ''}>${c.h}</th>`).join('')}</tr></thead>
    <tbody>
      ${sorted.map((p) => `<tr>${cols.map((c) => cell(c, p)).join('')}</tr>`).join('')}
      <tr class="total">${cols.map((c, i) => (i === 0 ? '<td></td>' : i === 1 ? '<td class="name">Equipa</td>' : cell(c, total))).join('')}</tr>
    </tbody>
  </table></div>
  ${id !== 'atk' ? '<p class="small muted" style="margin:.4rem 0 0">A linha “Equipa” inclui ases e ataques adversários sem toque (sem jogador atribuído).</p>' : ''}`;
}

// ---------- estatísticas por posição (função em campo) ----------
const ROLE_ORDER = ['S', 'OP', 'OH', 'MB', 'L', '?'];
const ROLE_COLS = [
  { h: 'Pts', get: (l) => l.points },
  { h: 'Erros', get: (l) => l.errors, title: 'Pontos oferecidos ao adversário' },
  { h: 'Atq', get: (l) => l.attack.tot },
  { h: 'Atq pts', get: (l) => l.attack.kill },
  { h: 'Atq err', get: (l) => l.attack.err + l.attack.blk, title: 'Erros + bloqueados' },
  { h: 'Ef%', get: (l) => derived(l).attackEff, pct: true },
  { h: 'Serv', get: (l) => l.serve.tot },
  { h: 'Ás', get: (l) => l.serve.ace },
  { h: 'Serv err', get: (l) => l.serve.err },
  { h: 'Bloco pts', get: (l) => l.block.pts },
  { h: 'Bloco toq.', get: (l) => l.block.touch },
  { h: 'Rec', get: (l) => l.reception.tot },
  { h: 'Rec média', get: (l) => derived(l).recAvg, title: 'Escala 0–3' },
  { h: 'Rec pos%', get: (l) => derived(l).recPositive, pct: true },
  { h: 'Def', get: (l) => l.dig.tot },
  { h: 'Def boa%', get: (l) => derived(l).digPositive, pct: true },
  { h: 'Assist', get: (l) => l.set.assist },
];
const active = (l) => l.attack.tot + l.serve.tot + l.reception.tot + l.dig.tot + l.block.pts + l.block.touch + l.block.err + l.set.tot + l.faults > 0;

function roleTableHTML(byRole) {
  const rows = ROLE_ORDER.filter((r) => active(byRole[r]));
  if (!rows.length) return '<p class="muted">Ainda sem ações registadas com jogador.</p>';
  const cell = (c, l) => {
    const v = c.get(l);
    return `<td class="${v === 0 || v == null ? 'zero' : ''}">${c.pct ? fmtPct(v) : v ?? '—'}</td>`;
  };
  return `<div class="table-wrap"><table class="stats roles">
    <thead><tr><th style="cursor:default">Posição</th>${ROLE_COLS.map((c) => `<th style="cursor:default" ${c.title ? `title="${esc(c.title)}"` : ''}>${c.h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="name">${r === '?' ? 'Sem posição' : ROLES[r]}</td>${ROLE_COLS.map((c) => cell(c, byRole[r])).join('')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="small muted" style="margin:.4rem 0 0">Cada ação conta para a função que o jogador tinha no set (definida na formação ou na substituição); sem formação, usa-se a posição habitual do plantel.</p>`;
}

// ---------- componentes ----------
function kpiHTML(label, value, sub, hint) {
  return `<div class="kpi" ${hint ? `title="${esc(hint)}"` : ''}>
    <div class="lbl">${label}</div>
    <div class="v">${value}</div>
    ${sub ? `<div class="small muted">${sub}</div>` : ''}
  </div>`;
}

/**
 * Barras horizontais de uma só cor (magnitude). rows: {label, value, of?, note?}
 * `of` = total para mostrar a percentagem; sem `of` mostra só o valor.
 */
function barsHTML(rows, team, { pctScale = false } = {}) {
  const max = pctScale ? 100 : Math.max(1, ...rows.map((r) => r.value ?? 0));
  return `<div class="bars">${rows.map((r) => {
    const v = r.value ?? 0;
    const share = r.of ? pct(v, r.of) : null;
    const shown = pctScale ? fmtPct(r.value) : `${v}${share != null ? ` <span class="muted">(${share}%)</span>` : ''}`;
    const tip = `<b>${esc(r.label)}</b><br>${pctScale ? fmtPct(r.value) : v}${share != null ? ` de ${r.of} (${share}%)` : ''}${r.note ? `<br><span class='muted'>${esc(r.note)}</span>` : ''}`;
    return `<div class="brow" data-tip="${esc(tip)}">
      <span class="lbl">${esc(r.label)}</span>
      <span class="track"><i class="${team}" style="width:${r.value == null ? 0 : (v / max) * 100}%"></i></span>
      <span class="num">${shown}</span>
    </div>`;
  }).join('')}</div>`;
}

function highlightsHTML(stats) {
  const all = stats.players[US];
  const best = (fn, min = () => true) => {
    const c = all.filter(min).filter((p) => (fn(p) ?? 0) > 0);
    if (!c.length) return null;
    return c.reduce((a, b) => (fn(b) > fn(a) ? b : a));
  };
  const items = [
    ['Melhor recetor (mín. 5)', best((p) => derived(p).recAvg, (p) => p.reception.tot >= 5), (p) => `${derived(p).recAvg} <small class="muted">média</small>`],
    ['Mais receções', best((p) => p.reception.tot), (p) => `${p.reception.tot}`],
    ['Mais defesas boas', best((p) => p.dig.good), (p) => `${p.dig.good}`],
    ['Mais blocos', best((p) => p.block.pts + p.block.touch / 100), (p) => `${p.block.pts} <small class="muted">pts · ${p.block.touch} toq.</small>`],
    ['Melhor marcador', best((p) => p.points), (p) => `${p.points} pts`],
  ].filter(([, p]) => p);
  if (!items.length) return '<p class="muted">Ainda sem estatísticas individuais.</p>';
  return `<div class="highlights">${items.map(([lbl, p, val]) => `<div class="hl">
    <div class="lbl">${lbl}</div>
    <div class="val">${val(p)}</div>
    <div class="who">#${p.number} ${esc(p.name || '')}</div>
  </div>`).join('')}</div>`;
}

/**
 * Cria um dashboard dentro de `root`. Devolve `update(match)` para re-renderizar
 * (mantém o filtro de set e a ordenação escolhidos).
 */
export function createDashboard(root) {
  root.style.position = 'relative';
  const ui = { set: null, sort: Object.fromEntries(Object.entries(TABLES).map(([k, t]) => [k, t.sort])) };
  let match, state;

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) { ui.set = chip.dataset.filter === 'all' ? null : Number(chip.dataset.filter); render(); return; }
    const th = e.target.closest('th[data-sort]');
    if (th) { ui.sort[th.closest('table').dataset.table] = th.dataset.sort; render(); }
  });
  root.addEventListener('pointerover', (e) => {
    const row = e.target.closest('[data-tip]');
    const tip = tipFor(root);
    if (!row) { tip.classList.remove('show'); return; }
    placeTip(tip, root, e.clientX, e.clientY, row.dataset.tip);
  });
  root.addEventListener('pointerleave', () => tipFor(root).classList.remove('show'));

  function render() {
    if (!match) return;
    const st = computeStats(match, state, ui.set);
    const T = st.teams[US];
    const d = derived(T);
    const rc = T.reception;
    const dg = T.dig;
    const evs = match.events;
    const duration = evs.length > 1 ? fmtDuration(evs.at(-1).t - evs[0].t) : null;
    const nSets = state.sets.filter((s) => s.rallies.length).length;
    const so = T.sideout, bp = T.breakpoint, ar = T.afterReception;
    const conceded = Object.values(T.conceded).reduce((a, b) => a + b, 0);

    const banner = state.finished && state.winner
      ? `<div class="winner-banner ${state.winner}">${state.winner === US ? '🏆 Vitória' : 'Derrota'} — ${esc(match.teams.A.name)} ${state.setsWon.A}–${state.setsWon.B} ${esc(match.teams.B.name)}</div>`
      : '';

    const chips = nSets > 1
      ? `<div class="chips" role="group" aria-label="Filtrar por set">
          <button data-filter="all" class="${ui.set === null ? 'active' : ''}">Jogo inteiro</button>
          ${state.sets.map((s, i) => (s.rallies.length ? `<button data-filter="${i}" class="${ui.set === i ? 'active' : ''}">Set ${i + 1}</button>` : '')).join('')}
        </div>`
      : '';

    const chartSets = state.sets.map((s, i) => [s, i]).filter(([s, i]) => (ui.set === null ? s.rallies.length || i === state.currentSet : i === ui.set));
    const scrollX = [...root.querySelectorAll('.table-wrap')].map((w) => w.scrollLeft);

    root.innerHTML = `
      ${banner}
      <section class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <h1><span class="dot A"></span> ${esc(match.teams.A.name)} ${state.setsWon.A} – ${state.setsWon.B} ${esc(match.teams.B.name)} <span class="dot B"></span></h1>
            <div class="small muted">${[match.categoryName, match.title, match.date, match.venue, duration && `Duração: ${duration}`].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          ${state.finished ? '<span class="badge">Final</span>' : evs.length ? '<span class="badge live">Direto</span>' : ''}
        </div>
        ${setHistoryHTML(state)}
        ${chips ? `<div style="margin-top:.75rem">${chips}</div>` : ''}
      </section>

      <section class="kpis" style="margin-bottom:1rem">
        ${kpiHTML('Side-out (em receção)', fmtPct(pct(so.won, so.tot)), `${fmtRatio(so)} pontos ganhos`, 'Pontos ganhos quando o adversário serve')}
        ${kpiHTML('Break-point (no serviço)', fmtPct(pct(bp.won, bp.tot)), `${fmtRatio(bp)} pontos ganhos`, 'Pontos ganhos quando nós servimos')}
        ${kpiHTML('Média de receção', d.recAvg ?? '—', `escala 0–3 · ${rc.tot} receções`)}
        ${kpiHTML('Receção positiva', fmtPct(d.recPositive), `perfeita ${fmtPct(d.recPerfect)}`)}
        ${kpiHTML('Ases sofridos', rc.err, `${fmtPct(d.recErrPct)} das receções`)}
        ${kpiHTML('Defesas boas', fmtPct(d.digPositive), `${dg.good} de ${dg.tot} defesas`)}
        ${kpiHTML('Bloco', T.block.pts, `pontos · ${T.block.touch} toques`)}
        ${kpiHTML('Eficácia de ataque', fmtPct(d.attackEff), `${T.attack.kill} pontos em ${T.attack.tot}`)}
      </section>

      <div class="grid2">
        <section class="card">
          <h2>Receção de serviço</h2>
          <h3>Qualidade das receções</h3>
          ${barsHTML([
            { label: 'Perfeita', value: rc.perfect, of: rc.tot },
            { label: 'Boa', value: rc.good, of: rc.tot },
            { label: 'Má', value: rc.poor, of: rc.tot },
            { label: 'Erro / Ás', value: rc.err, of: rc.tot },
          ], 'A')}
          <h3 style="margin-top:1rem">Side-out conforme a receção</h3>
          ${barsHTML([
            { label: 'Após perfeita', value: pct(ar.perfect.won, ar.perfect.tot), note: `${fmtRatio(ar.perfect)} pontos ganhos` },
            { label: 'Após boa', value: pct(ar.good.won, ar.good.tot), note: `${fmtRatio(ar.good)} pontos ganhos` },
            { label: 'Após má', value: pct(ar.poor.won, ar.poor.tot), note: `${fmtRatio(ar.poor)} pontos ganhos` },
          ], 'A', { pctScale: true })}
          <p class="small muted" style="margin:.5rem 0 0">Percentagem de jogadas ganhas quando o adversário serviu, consoante a qualidade da primeira receção.</p>
        </section>

        <section class="card">
          <h2>Defesa</h2>
          <h3>Defesas</h3>
          ${barsHTML([
            { label: 'Boa', value: dg.good, of: dg.tot, note: 'Bola controlada' },
            { label: 'Má', value: dg.poor, of: dg.tot, note: 'Defendida sem controlo' },
            { label: 'Erro / sem toque', value: dg.err, of: dg.tot, note: 'Ataque adversário que deu ponto' },
          ], 'A')}
          <h3 style="margin-top:1rem">Defesa ao bloco <span class="muted small">(após remate nosso bloqueado · ${T.attack.blk} bloqueados)</span></h3>
          ${barsHTML([
            { label: 'Boa', value: T.cover.good, of: T.cover.tot },
            { label: 'Má', value: T.cover.poor, of: T.cover.tot },
            { label: 'Erro / sem toque', value: T.cover.err, of: T.cover.tot, note: 'Ponto de bloco do adversário' },
          ], 'A')}
          <h3 style="margin-top:1rem">Bloco</h3>
          ${barsHTML([
            { label: 'Ponto', value: T.block.pts },
            { label: 'Toque', value: T.block.touch, note: 'Bloco que amorteceu a bola' },
            { label: 'Erro (rede…)', value: T.block.err },
          ], 'A')}
        </section>
      </div>

      ${Object.values(T.byRotation).some((r) => r.so.tot + r.bp.tot) ? `<div class="grid2">
        <section class="card">
          <h2>Side-out por rotação</h2>
          ${barsHTML(ZONES.map((z) => ({ label: `R${z}`, value: pct(T.byRotation[z].so.won, T.byRotation[z].so.tot), note: `Passador em P${z} · ${fmtRatio(T.byRotation[z].so)} pontos ganhos em receção` })), 'A', { pctScale: true })}
          <p class="small muted" style="margin:.5rem 0 0">R1–R6 = rotação com o passador em P1–P6. Pontos ganhos quando o adversário serve.</p>
        </section>
        <section class="card">
          <h2>Break-point por rotação</h2>
          ${barsHTML(ZONES.map((z) => ({ label: `R${z}`, value: pct(T.byRotation[z].bp.won, T.byRotation[z].bp.tot), note: `Passador em P${z} · ${fmtRatio(T.byRotation[z].bp)} pontos ganhos no serviço` })), 'A', { pctScale: true })}
          <p class="small muted" style="margin:.5rem 0 0">Pontos ganhos quando nós servimos. Substituições: ${T.subs} · trocas de líbero: ${T.liberoSwaps}.</p>
        </section>
      </div>` : ''}

      <div class="grid2">
        <section class="card">
          <h2>Pontos sofridos <span class="muted small">(${conceded})</span></h2>
          ${barsHTML([
            { label: 'Ataque adversário', value: T.conceded.attack, of: conceded },
            { label: 'Ás', value: T.conceded.ace, of: conceded },
            { label: 'Bloco adversário', value: T.conceded.block, of: conceded },
            { label: 'Erros nossos', value: T.conceded.ownError, of: conceded, note: 'Serviço, ataque, passe, faltas…' },
            { label: 'Outros', value: T.conceded.other, of: conceded },
          ], 'B')}
        </section>
        <section class="card">
          <h2>Pontos ganhos <span class="muted small">(${T.totalPoints})</span></h2>
          ${barsHTML([
            { label: 'Ataque', value: T.from.attack, of: T.totalPoints },
            { label: 'Bloco', value: T.from.block, of: T.totalPoints },
            { label: 'Ás', value: T.from.serve, of: T.totalPoints },
            { label: 'Erros adversário', value: T.from.oppError, of: T.totalPoints },
            { label: 'Outros', value: T.from.other, of: T.totalPoints },
          ], 'A')}
        </section>
      </div>

      <section class="card">
        <h2>Destaques</h2>
        ${highlightsHTML(st)}
      </section>

      <section class="card">
        <h2>Por posição</h2>
        ${roleTableHTML(T.byRole)}
      </section>

      ${['rec', 'def', 'atk'].map((id) => `<section class="card">
        <h2>${TABLES[id].title}</h2>
        ${st.players[US].length ? playerTableHTML(id, st.players[US], T, ui.sort[id]) : '<p class="muted">Sem jogadores registados.</p>'}
      </section>`).join('')}

      <section class="card">
        <h2>Evolução do marcador</h2>
        <div class="legend"><span><i class="A"></i>${esc(match.teams.A.name)}</span><span><i class="B"></i>${esc(match.teams.B.name)}</span></div>
        <div class="multiples">${chartSets.map(([s, i]) => setChartHTML(match, s, i, setTarget(match, i))).join('')}</div>
      </section>
      <p class="small muted">Toque no cabeçalho de uma coluna para ordenar.</p>
    `;
    root.querySelectorAll('.table-wrap').forEach((w, i) => { w.scrollLeft = scrollX[i] || 0; });
    wireSetCharts(root, match, state);
  }

  return {
    update(m) {
      match = m;
      state = computeState(m);
      if (ui.set != null && !state.sets[ui.set]) ui.set = null;
      render();
    },
  };
}
