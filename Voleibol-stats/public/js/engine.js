// Motor partilhado (servidor + browser): regras do jogo e cálculo de estatísticas.
// O jogo é guardado como uma lista de eventos; tudo o resto é derivado daqui.

// point: 'self' = ponto para a equipa que executou, 'opp' = ponto para o adversário
export const SKILLS = {
  serve: {
    label: 'Serviço',
    results: {
      ace: { label: 'Ás', point: 'self' },
      error: { label: 'Erro', point: 'opp' },
      in: { label: 'Em jogo' },
    },
  },
  attack: {
    label: 'Ataque',
    results: {
      kill: { label: 'Ponto', point: 'self' },
      error: { label: 'Erro', point: 'opp' },
      blocked: { label: 'Bloqueado' }, // a jogada continua: segue-se a defesa ao bloco (cobertura)
      in: { label: 'Em jogo' },
    },
  },
  block: {
    label: 'Bloco',
    results: {
      point: { label: 'Ponto', point: 'self' },
      touch: { label: 'Toque' },
      error: { label: 'Erro', point: 'opp' },
    },
  },
  // escala de receção: perfeita = 3, boa = 2, má = 1, erro (ás sofrido) = 0
  reception: {
    label: 'Receção',
    results: {
      perfect: { label: 'Perfeita' },
      good: { label: 'Boa' },
      poor: { label: 'Má' },
      error: { label: 'Erro / Ás', point: 'opp' },
    },
  },
  // boa = bola controlada (permite contra-ataque); má = defendida sem controlo
  dig: {
    label: 'Defesa',
    results: {
      good: { label: 'Boa' },
      poor: { label: 'Má' },
      error: { label: 'Erro', point: 'opp' },
    },
  },
  set: {
    label: 'Passe',
    results: {
      assist: { label: 'Assistência' },
      good: { label: 'Bom' },
      error: { label: 'Erro', point: 'opp' },
    },
  },
  fault: {
    label: 'Falta',
    results: {
      error: { label: 'Falta (rede, rotação…)', point: 'opp' },
    },
  },
};

export const other = (team) => (team === 'A' ? 'B' : 'A');

export function defaultConfig() {
  return { bestOf: 5, setPoints: 25, decidingSetPoints: 15, firstServe: null }; // null: decide-se no marcador, antes do 1.º ponto
}

/** Equipa que ganha o ponto com este evento (ou null). */
export function pointWinner(ev) {
  if (ev.type === 'point') return ev.team;
  if (ev.type !== 'action') return null;
  const res = SKILLS[ev.skill]?.results[ev.result];
  if (!res?.point) return null;
  return res.point === 'self' ? ev.team : other(ev.team);
}

// ---------- Plantel, formação e rotação (só da nossa equipa, “A”) ----------
export const ROLES = { S: 'Passador', OP: 'Oposto (Saída)', OH: 'Zona 4', MB: 'Central', L: 'Líbero' };
export const ROLE_SHORT = { S: 'P', OP: 'O', OH: 'Z4', MB: 'C', L: 'L' };
export const MAX_PLAYERS = 12; // sem contar os líberos
export const MAX_LIBEROS = 2;
export const MAX_SUBS = 6; // por set; trocas de líbero não contam
export const ZONES = [1, 2, 3, 4, 5, 6];
export const BACK_ROW = [1, 5, 6];

export const findPlayer = (match, n) => match.teams.A.players.find((p) => p.number === n);
export const isLibero = (match, n) => !!findPlayer(match, n)?.libero;
export const zoneOf = (court, n) => ZONES.find((z) => court.zones[z] === n) ?? null;
export const pname = (match, n) => {
  const p = findPlayer(match, n);
  return `#${n}${p?.name ? ' ' + p.name : ''}`;
};

function newCourt(ev) {
  const c = {
    zones: {},
    role: {},
    lineup: ev.slots,
    startLibero: ev.libero != null ? { libero: ev.libero, liberoFor: ev.liberoFor } : null,
    starters: ev.slots.map((s) => s.player),
    used: new Set(ev.slots.map((s) => s.player)), // quem já esteve em campo no set
    pair: {}, // titular -> { sub, back } (saiu uma vez / já regressou)
    subOf: {}, // suplente -> titular que substituiu
    subs: 0,
    libero: null, // { libero, replaced }
  };
  for (const s of ev.slots) { c.zones[s.zone] = s.player; c.role[s.player] = s.role; }
  if (ev.libero != null && ev.liberoFor != null) enterLibero(c, ev.libero, ev.liberoFor);
  return c;
}
function enterLibero(c, libero, player) {
  c.zones[zoneOf(c, player)] = libero;
  c.role[libero] = 'L';
  c.libero = { libero, replaced: player };
}
function exitLibero(c) {
  c.zones[zoneOf(c, c.libero.libero)] = c.libero.replaced;
  c.libero = null;
}
function applySub(c, ev) {
  c.zones[zoneOf(c, ev.out)] = ev.in;
  c.role[ev.in] = ev.role || c.role[ev.out];
  c.subs++;
  c.used.add(ev.in);
  const starter = c.subOf[ev.out];
  if (starter != null) c.pair[starter].back = true; // titular regressa
  else { c.pair[ev.out] = { sub: ev.in, back: false }; c.subOf[ev.in] = ev.out; }
}
/** Rotação no sentido dos ponteiros do relógio (2→1, 1→6, 6→5, 5→4, 4→3, 3→2). */
function rotate(c) {
  const z = {};
  for (const k of ZONES) z[k] = c.zones[(k % 6) + 1];
  c.zones = z;
  // o líbero não pode ir para a linha da frente: sai e volta o jogador que substituiu
  if (c.libero && zoneOf(c, c.libero.libero) === 4) {
    const out = { ...c.libero };
    exitLibero(c);
    return out;
  }
  return null;
}
/** Rotação atual identificada pela posição do passador (R1–R6 = passador em P1–P6), ou null. */
export function rotationOf(c) {
  if (!c) return null;
  return ZONES.find((z) => c.role[c.zones[z]] === 'S') ?? null;
}

/** Valida eventos de formação/substituição/líbero contra o estado atual. */
export function courtError(ev, match, state) {
  const c = state.court;
  const si = state.currentSet;
  const inSquad = (n) => !!findPlayer(match, n);
  if (ev.type === 'lineup') {
    if (state.sets[si].rallies.length) return 'A formação só pode ser definida antes do primeiro ponto do set — use substituições';
    const slots = Array.isArray(ev.slots) ? ev.slots : [];
    if (slots.length !== 6) return 'A formação precisa de 6 jogadores';
    if (new Set(slots.map((s) => s.zone)).size !== 6 || slots.some((s) => !ZONES.includes(s.zone))) return 'Zonas inválidas';
    if (new Set(slots.map((s) => s.player)).size !== 6) return 'Há jogadores repetidos na formação';
    for (const s of slots) {
      if (!inSquad(s.player)) return `#${s.player} não está convocado`;
      if (isLibero(match, s.player)) return `${pname(match, s.player)} é líbero — escolha-o no campo “Líbero”`;
      if (!ROLES[s.role] || s.role === 'L') return `Posição inválida para ${pname(match, s.player)}`;
    }
    if (ev.libero != null) {
      if (!isLibero(match, ev.libero)) return `#${ev.libero} não é líbero`;
      const slot = slots.find((s) => s.player === ev.liberoFor);
      if (!slot) return 'Escolha o jogador que o líbero substitui';
      if (!BACK_ROW.includes(slot.zone)) return 'O líbero só pode substituir um jogador da linha de trás (P1, P5, P6)';
    }
    if (ev.serve != null && !['A', 'B'].includes(ev.serve)) return 'Serviço inválido';
    return null;
  }
  if (!c) return `Defina primeiro a formação do set ${si + 1}`;
  if (ev.type === 'sub') {
    if (c.subs >= MAX_SUBS) return `Limite de ${MAX_SUBS} substituições atingido neste set`;
    if (c.libero?.libero === ev.out) return 'Para o líbero use a troca de líbero';
    if (c.libero?.replaced === ev.out) return `${pname(match, ev.out)} está fora por troca com o líbero — faça primeiro sair o líbero`;
    if (!zoneOf(c, ev.out)) return `${pname(match, ev.out)} não está em campo`;
    if (!inSquad(ev.in)) return 'Jogador que entra não está convocado';
    if (isLibero(match, ev.in)) return 'O líbero só entra por troca de líbero';
    if (zoneOf(c, ev.in) || c.libero?.replaced === ev.in) return `${pname(match, ev.in)} já está em jogo`;
    if (ev.role != null && (!ROLES[ev.role] || ev.role === 'L')) return 'Posição inválida';
    const starter = c.subOf[ev.out];
    if (starter != null) {
      if (c.pair[starter].back) return 'Substituição inválida';
      if (ev.in !== starter) return `${pname(match, ev.out)} só pode ser substituído por ${pname(match, starter)}, o titular que substituiu`;
      return null;
    }
    if (c.pair[ev.out]) return `${pname(match, ev.out)} já saiu e regressou neste set — não pode voltar a sair`;
    if (c.used.has(ev.in)) {
      const p = c.pair[ev.in];
      if (p && !p.back) return `${pname(match, ev.in)} só pode regressar no lugar de ${pname(match, p.sub)}`;
      return `${pname(match, ev.in)} já jogou neste set e não pode voltar a entrar`;
    }
    return null;
  }
  if (ev.type === 'libero') {
    if (ev.action === 'out') return c.libero ? null : 'Não há líbero em campo';
    if (!isLibero(match, ev.libero)) return `#${ev.libero} não é líbero`;
    // com um líbero em campo, a troca é direta: ele sai e o líbero (o mesmo ou o outro) entra pelo jogador escolhido
    if (c.libero && c.libero.libero === ev.libero && c.libero.replaced === ev.player) return 'O líbero já está em campo por esse jogador';
    const z = c.libero?.replaced === ev.player ? zoneOf(c, c.libero.libero) : zoneOf(c, ev.player);
    if (!z || c.role[ev.player] === 'L') return `${pname(match, ev.player)} não está em campo`;
    if (!BACK_ROW.includes(z)) return 'O líbero só pode substituir jogadores da linha de trás (P1, P5, P6)';
    return null;
  }
  return null;
}

export function validateEvent(ev, match, state = computeState(match)) {
  if (!ev || typeof ev !== 'object') return 'Evento inválido';
  if (!['A', 'B'].includes(ev.team)) return 'Equipa inválida';
  if (['lineup', 'sub', 'libero'].includes(ev.type)) return ev.team === 'A' ? courtError(ev, match, state) : 'Equipa inválida';
  if ((ev.type === 'action' || ev.type === 'point') && state.needServe) return 'Indique primeiro quem serve no início do set';
  if (ev.type === 'action') {
    const skill = SKILLS[ev.skill];
    if (!skill) return 'Ação inválida';
    if (!skill.results[ev.result]) return 'Resultado inválido';
    if (ev.player != null) {
      const ok = match.teams[ev.team].players.some((p) => p.number === ev.player);
      if (!ok) return 'Jogador inexistente';
    }
    return null;
  }
  if (ev.type === 'point') return ev.reason == null || ev.reason === 'oppError' ? null : 'Motivo inválido';
  if (ev.type === 'timeout') return null;
  if (ev.type === 'toss') return state.sets[state.currentSet].rallies.length ? 'O set já começou' : null;
  return 'Tipo de evento inválido';
}

export function describeEvent(ev, match) {
  const team = match.teams[ev.team];
  const auto = ev.autoLiberoOut
    ? ` · Líbero ${pname(match, ev.autoLiberoOut.libero)} sai na rotação, volta ${pname(match, ev.autoLiberoOut.replaced)}`
    : '';
  if (ev.type === 'timeout') return `Desconto de tempo — ${team.name}`;
  if (ev.type === 'toss') return `Set ${(ev.set ?? 0) + 1}: primeiro serviço — ${team.name}`;
  if (ev.type === 'lineup') return `Formação inicial do set ${(ev.set ?? 0) + 1} definida`;
  if (ev.type === 'sub') return `Substituição: entra ${pname(match, ev.in)}, sai ${pname(match, ev.out)}`;
  if (ev.type === 'libero') {
    if (ev.action === 'out') return `Líbero ${pname(match, ev.libero)} sai, volta ${pname(match, ev.player)}`;
    const b = ev.liberoBefore;
    const back = b && b.replaced !== ev.player ? `, volta ${pname(match, b.replaced)}` : '';
    const swap = b && b.libero !== ev.libero ? ` (sai o líbero ${pname(match, b.libero)})` : '';
    return `Líbero ${pname(match, ev.libero)} entra por ${pname(match, ev.player)}${back}${swap}`;
  }
  if (ev.type === 'point') {
    if (ev.reason === 'oppError') return `Erro de ${match.teams[other(ev.team)].name} — ponto ${team.name}${auto}`;
    return `Ponto — ${team.name}${auto}`;
  }
  const skill = SKILLS[ev.skill];
  const res = skill.results[ev.result];
  // ações da equipa sem jogador que correspondem a pontos diretos do adversário
  if (ev.player == null && ev.result === 'error') {
    const opp = match.teams[other(ev.team)].name;
    if (ev.skill === 'reception') return `Ás de ${opp} (sem toque)`;
    if (ev.skill === 'dig') return ev.cover ? `Ponto de bloco de ${opp} (sem toque)` : `Ponto de ataque de ${opp} (sem toque)`;
  }
  const label = ev.cover ? 'Defesa ao bloco' : skill.label;
  let who = team.name;
  if (ev.player != null) {
    const p = team.players.find((x) => x.number === ev.player);
    who = `#${ev.player}${p?.name ? ' ' + p.name : ''}`;
  }
  return `${label}: ${res.label} — ${who}${auto}`;
}

/**
 * Reproduz os eventos e devolve o estado do jogo:
 * parciais por set, sets ganhos, quem serve, e cada evento anotado com set/marcador.
 */
export function computeState(match) {
  const cfg = { ...defaultConfig(), ...match.config };
  const setsToWin = Math.ceil(cfg.bestOf / 2);
  // set 1 e set decisivo: quem serve decide-se no marcador (sorteio); nos outros sets alterna
  // a partir de quem serviu primeiro no set 1. Antes do 1.º ponto pode sempre ser corrigido.
  const deciding = (i) => i > 0 && i === cfg.bestOf - 1;
  let first1 = cfg.firstServe; // quem serviu primeiro no set 1
  const newSet = (i) => ({ A: 0, B: 0, winner: null, rallies: [], start: null, end: null,
    serveChosen: i === 0 ? !!cfg.firstServe : !deciding(i) });
  const firstServeOfSet = (i) => (i % 2 === 0 ? first1 || 'A' : other(first1 || 'A'));
  const target = (i) => (i === cfg.bestOf - 1 ? cfg.decidingSetPoints : cfg.setPoints);

  const sets = [newSet(0)];
  const setsWon = { A: 0, B: 0 };
  let serving = firstServeOfSet(0);
  let winner = null;
  const annotated = [];
  const courts = []; // formação em campo da nossa equipa, por set
  let prevA = null; // última ação nossa na jogada em curso
  function chooseServe(team) {
    const si = sets.length - 1;
    serving = team;
    sets[si].serveChosen = true;
    if (si === 0) first1 = team;
  }

  for (const ev of match.events) {
    // defesa logo a seguir a um remate nosso bloqueado = defesa ao bloco (cobertura)
    const cover = ev.type === 'action' && ev.team === 'A' && ev.skill === 'dig' &&
      prevA?.skill === 'attack' && prevA?.result === 'blocked';
    const si = sets.length - 1;
    const set = sets[si];
    let liberoBefore = null;
    // formação, substituições e líbero (nossa equipa)
    if (!winner && ev.team === 'A') {
      if (ev.type === 'lineup') {
        courts[si] = newCourt(ev);
        if (ev.serve && !set.rallies.length) chooseServe(ev.serve);
      } else if (ev.type === 'sub' && courts[si]) applySub(courts[si], ev);
      else if (ev.type === 'libero' && courts[si]) {
        if (courts[si].libero) { liberoBefore = { ...courts[si].libero }; exitLibero(courts[si]); } // sai sempre o líbero atual (troca direta)
        if (ev.action !== 'out') enterLibero(courts[si], ev.libero, ev.player);
      }
    }
    if (ev.type === 'toss' && !winner && !set.rallies.length) chooseServe(ev.team);
    const to = winner ? null : pointWinner(ev);
    const servedBy = serving; // quem serviu nesta jogada
    const rot = to ? rotationOf(courts[si]) : null; // rotação em que a jogada foi disputada
    let autoLiberoOut = null;
    if (set.start == null) set.start = ev.t;
    if (to) {
      set[to]++;
      serving = to;
      // side-out nosso: roda a equipa
      if (to === 'A' && servedBy === 'B' && courts[si]) autoLiberoOut = rotate(courts[si]);
      set.rallies.push({ A: set.A, B: set.B, to, id: ev.id });
      const t = target(si);
      if (set[to] >= t && set[to] - set[other(to)] >= 2) {
        set.winner = to;
        set.end = ev.t;
        setsWon[to]++;
        if (setsWon[to] >= setsToWin) {
          winner = to;
        } else {
          sets.push(newSet(sets.length));
          serving = firstServeOfSet(sets.length - 1);
        }
      }
    }
    // função do jogador nesta ação: a da formação do set; senão, a posição habitual
    const role = ev.type === 'action' && ev.team === 'A' && ev.player != null
      ? courts[si]?.role[ev.player] || findPlayer(match, ev.player)?.pos || null
      : null;
    annotated.push({ ...ev, set: si, servedBy, rot, role, autoLiberoOut, ...(liberoBefore && ev.action !== 'out' ? { liberoBefore } : {}), ...(cover ? { cover } : {}), pointTo: to, score: { A: set.A, B: set.B } });
    if (to) prevA = null;
    else if (ev.type === 'action' && ev.team === 'A') prevA = ev;
  }

  const finished = !!winner || !!match.closed;
  const needServe = !finished && !sets[sets.length - 1].serveChosen; // falta indicar quem serve
  return {
    courts,
    court: courts[sets.length - 1] || null,
    sets,
    setsWon,
    currentSet: sets.length - 1,
    serving: needServe ? null : serving,
    needServe,
    winner: winner || (match.closed ? leader(setsWon) : null),
    finished,
    events: annotated,
    setsToWin,
  };
}

function leader(sw) {
  if (sw.A === sw.B) return null;
  return sw.A > sw.B ? 'A' : 'B';
}

function emptyLine() {
  return {
    points: 0,
    serve: { tot: 0, ace: 0, err: 0 },
    attack: { tot: 0, kill: 0, err: 0, blk: 0 },
    block: { pts: 0, touch: 0, err: 0 },
    reception: { tot: 0, perfect: 0, good: 0, poor: 0, err: 0 },
    dig: { tot: 0, good: 0, poor: 0, err: 0 },
    cover: { tot: 0, good: 0, poor: 0, err: 0 }, // defesa ao bloco (após remate nosso bloqueado)
    set: { tot: 0, assist: 0, err: 0 },
    faults: 0,
    errors: 0, // pontos oferecidos ao adversário
  };
}

function addAction(line, ev) {
  const r = ev.result;
  switch (ev.skill) {
    case 'serve':
      line.serve.tot++;
      if (r === 'ace') { line.serve.ace++; line.points++; }
      if (r === 'error') { line.serve.err++; line.errors++; }
      break;
    case 'attack':
      line.attack.tot++;
      if (r === 'kill') { line.attack.kill++; line.points++; }
      if (r === 'error') { line.attack.err++; line.errors++; }
      if (r === 'blocked') line.attack.blk++; // o ponto só se perde se a defesa ao bloco falhar
      break;
    case 'block':
      if (r === 'point') { line.block.pts++; line.points++; }
      if (r === 'touch') line.block.touch++;
      if (r === 'error') { line.block.err++; line.errors++; }
      break;
    case 'reception':
      line.reception.tot++;
      line.reception[r === 'error' ? 'err' : r]++;
      if (r === 'error') line.errors++;
      break;
    case 'dig':
      if (ev.cover) { // defesa ao bloco: contada à parte das defesas ao ataque
        line.cover.tot++;
        line.cover[r === 'error' ? 'err' : r]++;
        if (r === 'error') line.errors++;
        break;
      }
      line.dig.tot++;
      if (r === 'good') line.dig.good++;
      if (r === 'poor') line.dig.poor++;
      if (r === 'error') { line.dig.err++; line.errors++; }
      break;
    case 'set':
      line.set.tot++;
      if (r === 'assist') line.set.assist++;
      if (r === 'error') { line.set.err++; line.errors++; }
      break;
    case 'fault':
      line.faults++;
      line.errors++;
      break;
  }
}

/** Percentagem segura (0–100, inteiro) ou null quando não há tentativas. */
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

export function derived(line) {
  const a = line.attack;
  const rc = line.reception;
  return {
    attackEff: pct(a.kill - a.err - a.blk, a.tot),
    killPct: pct(a.kill, a.tot),
    recPositive: pct(rc.perfect + rc.good, rc.tot),
    recPerfect: pct(rc.perfect, rc.tot),
    // média de receção numa escala 0–3 (1 casa decimal)
    recAvg: rc.tot ? Math.round(((3 * rc.perfect + 2 * rc.good + rc.poor) / rc.tot) * 10) / 10 : null,
    recErrPct: pct(rc.err, rc.tot),
    digPositive: pct(line.dig.good, line.dig.tot),
    digErrPct: pct(line.dig.err, line.dig.tot),
    serveErrPct: pct(line.serve.err, line.serve.tot),
  };
}

const ratio = () => ({ won: 0, tot: 0 });

/**
 * Estatísticas por equipa e por jogador. `setFilter` = índice do set ou null (todos).
 */
export function computeStats(match, state = computeState(match), setFilter = null) {
  const teams = {};
  const players = {};
  for (const k of ['A', 'B']) {
    teams[k] = {
      ...emptyLine(),
      totalPoints: 0,
      timeouts: 0,
      // origem dos pontos ganhos
      from: { attack: 0, block: 0, serve: 0, oppError: 0, other: 0 },
      // origem dos pontos sofridos
      conceded: { ace: 0, attack: 0, block: 0, ownError: 0, other: 0 },
      sideout: ratio(), // jogadas em que o adversário serviu
      breakpoint: ratio(), // jogadas em que esta equipa serviu
      // side-out consoante a qualidade da 1.ª receção da jogada
      afterReception: { perfect: ratio(), good: ratio(), poor: ratio(), error: ratio() },
      // por rotação (zona do passador): side-out e break-point
      byRotation: Object.fromEntries(ZONES.map((z) => [z, { so: ratio(), bp: ratio() }])),
      // por função em campo (Passador, Oposto, Zona 4, Central, Líbero); '?' = sem função conhecida
      byRole: Object.fromEntries([...Object.keys(ROLES), '?'].map((r) => [r, emptyLine()])),
      subs: 0,
      liberoSwaps: 0,
    };
    players[k] = match.teams[k].players.map((p) => ({ ...p, ...emptyLine() }));
  }

  let firstRec = null; // qualidade da 1.ª receção da jogada em curso
  for (const ev of state.events) {
    if (setFilter != null && ev.set !== setFilter) continue;
    const t = teams[ev.team];
    if (ev.type === 'timeout') { t.timeouts++; continue; }
    if (ev.type === 'sub') { t.subs++; continue; }
    if (ev.type === 'libero') { t.liberoSwaps++; continue; }
    if (ev.type === 'lineup') continue;
    if (ev.type === 'action' && ev.skill === 'reception' && !firstRec) firstRec = { team: ev.team, q: ev.result };
    if (ev.pointTo) {
      const w = teams[ev.pointTo];
      const loser = other(ev.pointTo);
      const l = teams[loser];
      w.totalPoints++;
      if (ev.type === 'point') {
        if (ev.reason === 'oppError') { w.from.oppError++; l.conceded.ownError++; }
        else { w.from.other++; l.conceded.other++; }
      } else if (ev.pointTo !== ev.team) {
        w.from.oppError++;
        if (ev.skill === 'reception') l.conceded.ace++;
        else if (ev.skill === 'dig') l.conceded[ev.cover ? 'block' : 'attack']++;
        else l.conceded.ownError++;
      } else {
        if (ev.skill === 'attack') { w.from.attack++; l.conceded.attack++; }
        else if (ev.skill === 'block') { w.from.block++; l.conceded.block++; }
        else if (ev.skill === 'serve') { w.from.serve++; l.conceded.ace++; }
      }
      // fases de jogo: side-out (receção) e break-point (serviço)
      const server = ev.servedBy;
      const receiver = other(server);
      teams[server].breakpoint.tot++;
      teams[receiver].sideout.tot++;
      if (ev.pointTo === server) teams[server].breakpoint.won++;
      else teams[receiver].sideout.won++;
      if (ev.rot != null) {
        const r = teams.A.byRotation[ev.rot][server === 'A' ? 'bp' : 'so'];
        r.tot++;
        if (ev.pointTo === 'A') r.won++;
      }
      if (firstRec && firstRec.team === receiver) {
        const r = teams[receiver].afterReception[firstRec.q];
        r.tot++;
        if (ev.pointTo === receiver) r.won++;
      }
      firstRec = null;
    }
    if (ev.type !== 'action') continue;
    addAction(t, ev);
    if (ev.player != null) {
      const p = players[ev.team].find((x) => x.number === ev.player);
      if (p) addAction(p, ev);
      if (ev.team === 'A') addAction(teams.A.byRole[ev.role || '?'], ev);
    }
  }
  return { teams, players };
}

// ---------- ações possíveis em cada momento da jogada ----------
const ALL_SKILLS = Object.keys(SKILLS);
const RALLY_FLOW = {
  'serve:in': ['block', 'dig'], // bola do lado deles
  'attack:in': ['block', 'dig'],
  'attack:blocked': ['dig'], // defesa ao bloco (cobertura)
  'reception:*': ['set', 'attack'], // bola do nosso lado
  'dig:*': ['set', 'attack'],
  'set:*': ['attack'],
  'block:touch': ['dig', 'block', 'set', 'attack'], // pode ficar do nosso lado ou passar
};

/**
 * Que ações da nossa equipa fazem sentido agora, a partir do que já aconteceu na jogada em curso.
 * A falta está sempre disponível. Devolve também a fase (texto) e que botões do adversário se aplicam.
 */
export function nextActions(state) {
  if (state.finished) return { skills: new Set(), phase: 'Jogo terminado', oppAce: false, oppKill: false };
  if (state.needServe) return { skills: new Set(), phase: `Quem serve primeiro no set ${state.currentSet + 1}?`, oppAce: false, oppKill: false };
  // última ação nossa na jogada em curso (desde o último ponto do set atual)
  let last = null;
  for (let i = state.events.length - 1; i >= 0; i--) {
    const ev = state.events[i];
    if (ev.set !== state.currentSet || ev.pointTo) break;
    if (ev.type === 'action' && ev.team === 'A') { last = ev; break; }
  }
  let skills;
  let phase;
  if (!last) {
    skills = state.serving === 'A' ? ['serve'] : ['reception'];
    phase = state.serving === 'A' ? 'Nós a servir' : 'Adversário a servir — receção';
  } else {
    skills = RALLY_FLOW[`${last.skill}:${last.result}`] || RALLY_FLOW[`${last.skill}:*`] || ALL_SKILLS;
    phase = skills.includes('dig') && !skills.includes('set')
      ? 'Bola do lado do adversário — defesa ou bloco'
      : skills.length === 1 ? 'Depois do passe — ataque' : 'Bola do nosso lado — passe ou ataque';
    if (last.skill === 'block' && last.result === 'touch') phase = 'Depois do toque de bloco';
  }
  const cover = last?.skill === 'attack' && last.result === 'blocked';
  if (cover) phase = 'Remate bloqueado — defesa ao bloco';
  const set = new Set([...skills, 'fault']);
  return {
    skills: set,
    phase,
    cover, // a próxima defesa é uma defesa ao bloco
    oppAce: !last && state.serving === 'B', // ás do adversário (sem toque nosso)
    oppKill: !!last && set.has('dig'), // ataque (ou bloco, se cover) do adversário sem toque nosso
  };
}
