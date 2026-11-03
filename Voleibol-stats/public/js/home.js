import { $, esc, api, param, toast, requireLogin, isAdmin } from './common.js';
import { ROLES, MAX_PLAYERS, MAX_LIBEROS } from './engine.js';

let cats = []; // escalões, cada um com o seu plantel
let catId = null; // escalão escolhido no formulário do jogo
let rosterCat = null; // escalão aberto no editor de plantel (null = novo)
const team = () => cats.find((c) => c.id === catId) || { name: '', teamName: '', players: [] };
const catName = (id) => cats.find((c) => c.id === id)?.name || '';
let editing = null; // { id, match } quando o formulário está a editar um jogo

// sem sessão vai para o login; só o administrador gere jogos, escalões e plantel
const user = await requireLogin();
const admin = isAdmin(user);
if (!admin) {
  $('#roster-summary').classList.add('hidden');
  $('#btn-new').classList.add('hidden');
}

async function loadList() {
  const list = $('#list');
  try {
    const all = await api('matches');
    const filter = $('#list-filter').value;
    const matches = filter ? all.filter((m) => m.category === filter) : all;
    if (!matches.length) {
      list.innerHTML = all.length
        ? '<li class="muted">Não há jogos deste escalão.</li>'
        : admin
          ? '<li class="muted">Ainda não há jogos. Crie o escalão com o seu plantel e depois o primeiro jogo com “+ Novo jogo”.</li>'
          : `<li class="muted">${user.categories.length ? 'Ainda não há jogos dos seus escalões.' : 'Ainda não pertence a nenhum escalão. Peça acesso ao administrador.'}</li>`;
      return;
    }
    list.innerHTML = matches
      .map((m) => {
        const status = m.finished
          ? '<span class="badge">Final</span>'
          : m.started ? '<span class="badge live">Direto</span>' : '<span class="badge">Por começar</span>';
        const score = `${m.setsWon.A} - ${m.setsWon.B}`;
        const cur = m.current && m.started ? `<div class="small muted">(${m.current.A}-${m.current.B})</div>` : '';
        return `<li>
          <div class="teams">
            <div><span class="dot A"></span> <b>${esc(m.teams.A)}</b> vs <span class="dot B"></span> <b>${esc(m.teams.B)}</b></div>
            <div class="small muted">${status} ${m.categoryName ? `<span class="badge cat">${esc(m.categoryName)}</span>` : ''} ${esc(m.title || '')} ${m.date ? '· ' + esc(m.date) : ''} ${m.venue ? '· ' + esc(m.venue) : ''}</div>
          </div>
          <div class="score">${score}${cur}</div>
          <div class="row">
            <a class="btn btn-sm btn-primary" href="/score.html?id=${m.id}">Marcar</a>
            <a class="btn btn-sm" href="/live.html?id=${m.id}">Direto</a>
            <a class="btn btn-sm" href="/dashboard.html?id=${m.id}">Dashboard</a>
            ${admin ? `<button class="btn-sm" data-edit="${m.id}">Editar</button>
              <button class="btn-sm btn-danger" data-del="${m.id}" data-label="${esc(`${m.teams.A} vs ${m.teams.B}`)}">Apagar</button>` : ''}
          </div>
        </li>`;
      })
      .join('');
  } catch (e) {
    list.innerHTML = `<li class="muted">Erro a carregar jogos: ${esc(e.message)}</li>`;
  }
}

$('#list').addEventListener('click', (e) => {
  const ed = e.target.closest('[data-edit]');
  if (ed) { openEdit(ed.dataset.edit); return; }
  const del = e.target.closest('[data-del]');
  if (del) deleteMatch(del.dataset.del, del.dataset.label);
});

async function deleteMatch(id, label) {
  if (!confirm(`Apagar o jogo “${label}”?\n\nTodas as estatísticas deste jogo serão perdidas. Esta ação não pode ser desfeita.`)) return;
  try {
    await api(`matches/${id}`, { method: 'DELETE' });
    localStorage.removeItem(`vb-key-${id}`);
    if (editing?.id === id) closeForm();
    toast('Jogo apagado');
    loadList();
  } catch (e) { toast(e.message); }
}

// ---------- Plantel ----------
const roleOptions = (sel) =>
  `<option value="">—</option>` + Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

function rosterRow(p = {}) {
  const div = document.createElement('div');
  div.className = 'roster-row';
  div.innerHTML = `
    <input type="number" min="0" max="99" class="r-num" value="${p.number ?? ''}" aria-label="Número">
    <input class="r-name" value="${esc(p.name || '')}" placeholder="Nome" aria-label="Nome">
    <select class="r-pos" aria-label="Posição">${roleOptions(p.pos || (p.libero ? 'L' : ''))}</select>
    <button type="button" class="btn-sm r-del" title="Remover" aria-label="Remover">✕</button>`;
  div.querySelector('.r-del').onclick = () => div.remove();
  return div;
}

/** Abre o editor do plantel de um escalão (sem `cat`: novo escalão). */
function openRoster(cat = null) {
  rosterCat = cat;
  $('#roster-title').textContent = cat ? `Escalão ${cat.name}` : 'Novo escalão';
  $('#cat-name').value = cat?.name || '';
  $('#team-name').value = cat ? cat.teamName || '' : cats[0]?.teamName || '';
  $('#btn-cat-delete').classList.toggle('hidden', !cat);
  const rows = $('#roster-rows');
  rows.innerHTML = '';
  for (const p of cat?.players || []) rows.append(rosterRow(p));
  if (!cat?.players.length) for (let i = 0; i < 6; i++) rows.append(rosterRow());
  $('#roster-card').classList.remove('hidden');
  $('#new-card').classList.add('hidden');
  $('#roster-card').scrollIntoView({ behavior: 'smooth' });
  if (!cat) $('#cat-name').focus();
}

function renderCategories() {
  const sel = $('#list-filter');
  const cur = sel.value || localStorage.getItem('vb-filter') || '';
  sel.innerHTML = '<option value="">Todos os escalões</option>' +
    cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  sel.value = cats.some((c) => c.id === cur) ? cur : '';
  sel.classList.toggle('hidden', cats.length < 2);

  $('#cat-list').innerHTML = cats.length
    ? cats.map((c) => {
      const lib = c.players.filter((p) => p.libero || p.pos === 'L').length;
      return `<li>
        <div><b>${esc(c.name)}</b> <span class="muted small">· ${esc(c.teamName || 'sem nome de equipa')} · ${c.players.length - lib} jogadores e ${lib} líbero${lib === 1 ? '' : 's'}</span></div>
        <button class="btn-sm" data-cat="${c.id}">Plantel</button>
      </li>`;
    }).join('')
    : `<li><div><b>Ainda não há escalões.</b> <span class="muted small">Crie um escalão (por exemplo Sub-16 ou Seniores) com o plantel; em cada jogo escolhe o escalão e os convocados.</span></div>
        <button class="btn-sm btn-primary" data-cat="">Criar escalão</button></li>`;
}

$('#cat-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (b) openRoster(cats.find((c) => c.id === b.dataset.cat) || null);
});
$('#btn-new-cat').onclick = () => openRoster(null);
$('#list-filter').onchange = () => { localStorage.setItem('vb-filter', $('#list-filter').value); loadList(); };
$('#btn-add-row').onclick = () => $('#roster-rows').append(rosterRow());
$('#btn-roster-cancel').onclick = () => $('#roster-card').classList.add('hidden');
$('#btn-roster-save').onclick = async () => {
  const players = [...document.querySelectorAll('#roster-rows .roster-row')]
    .map((r) => ({ number: r.querySelector('.r-num').value, name: r.querySelector('.r-name').value.trim(), pos: r.querySelector('.r-pos').value }))
    .filter((p) => p.number !== '');
  const nums = players.map((p) => Number(p.number));
  if (new Set(nums).size !== nums.length) { toast('Há números repetidos'); return; }
  const body = { name: $('#cat-name').value, teamName: $('#team-name').value, players };
  try {
    const saved = rosterCat
      ? await api(`categories/${rosterCat.id}`, { method: 'PUT', body })
      : await api('categories', { method: 'POST', body });
    await loadCategories();
    toast(rosterCat ? 'Escalão guardado' : `Escalão ${saved.name} criado`);
    $('#roster-card').classList.add('hidden');
    loadList();
  } catch (e) { toast(e.message); }
};
$('#btn-cat-delete').onclick = async () => {
  if (!rosterCat || !confirm(`Apagar o escalão “${rosterCat.name}” e o seu plantel?`)) return;
  try {
    await api(`categories/${rosterCat.id}`, { method: 'DELETE' });
    await loadCategories();
    toast('Escalão apagado');
    $('#roster-card').classList.add('hidden');
  } catch (e) { toast(e.message); }
};

async function loadCategories() {
  cats = await api('categories').catch(() => cats);
  renderCategories();
}

// ---------- Convocatória ----------
function renderCategorySelect(locked) {
  $('#category').innerHTML = (catId ? '' : '<option value="">— escolha o escalão —</option>') +
    cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#category').value = catId || '';
  $('#category').disabled = locked;
}

// mudar de escalão mostra o plantel desse escalão (os convocados recomeçam)
$('#category').onchange = () => {
  catId = $('#category').value || null;
  localStorage.setItem('vb-cat', catId || '');
  renderCategorySelect(false);
  const back = editing && editing.match.category === catId;
  renderSquad(back ? new Map(editing.match.teams.A.players.map((p) => [p.number, p])) : new Map());
};

/** `chosen`: Map número -> jogador do jogo (convocados já escolhidos ao editar). */
function renderSquad(chosen = new Map()) {
  const sameCat = editing && editing.match.category === catId;
  $('#our-name').textContent = (sameCat && editing.match.teams.A.name) || team().teamName || 'a nossa equipa';
  if (!catId) {
    $('#squad-list').innerHTML = cats.length
      ? '<p class="muted small" style="margin:.3rem">Escolha o escalão para ver o plantel.</p>'
      : '<p class="muted small" style="margin:.3rem">Ainda não há escalões. <a href="#" id="go-roster">Crie o primeiro escalão</a> com o plantel.</p>';
    $('#squad-list').dataset.pool = '[]';
    $('#go-roster')?.addEventListener('click', (e) => { e.preventDefault(); openRoster(null); });
    $('#squad-count').textContent = '';
    $('#quick-add').classList.add('hidden');
    $('#qa-label').classList.add('hidden');
    return;
  }
  $('#quick-add').classList.remove('hidden');
  $('#qa-label').classList.remove('hidden');
  // plantel do escalão + convocados do jogo que entretanto saíram do plantel
  const pool = [...team().players];
  for (const p of chosen.values()) if (!pool.some((x) => x.number === p.number)) pool.push(p);
  pool.sort((a, b) => a.number - b.number);
  if (!pool.length) {
    $('#squad-list').innerHTML = '<p class="muted small" style="margin:.3rem">O plantel deste escalão está vazio. Acrescente os jogadores aqui em baixo (ficam guardados no plantel) ou <a href="#" id="go-roster">defina o plantel completo</a>.</p>';
    $('#squad-list').dataset.pool = '[]';
    $('#go-roster').onclick = (e) => { e.preventDefault(); openRoster(team()); };
    $('#squad-count').textContent = '';
    return;
  }
  $('#squad-list').innerHTML = pool.map((p) => {
    const c = chosen.get(p.number);
    const lib = c ? c.libero : p.pos === 'L';
    return `<label class="squad-row">
      <input type="checkbox" class="sq-in" data-n="${p.number}" ${c ? 'checked' : ''}>
      <b>#${p.number}</b>
      <span>${esc(p.name)} <span class="muted small">${ROLES[p.pos] && p.pos !== 'L' ? ROLES[p.pos] : ''}</span></span>
      <span class="lib"><input type="checkbox" class="sq-lib" data-n="${p.number}" ${lib ? 'checked' : ''}> Líbero</span>
    </label>`;
  }).join('');
  $('#squad-list').dataset.pool = JSON.stringify(pool);
  updateCount();
}

function squadSelection() {
  const pool = JSON.parse($('#squad-list').dataset.pool || '[]');
  return pool
    .filter((p) => document.querySelector(`.sq-in[data-n="${p.number}"]`)?.checked)
    .map((p) => ({ number: p.number, name: p.name, pos: p.pos, libero: document.querySelector(`.sq-lib[data-n="${p.number}"]`).checked }));
}

function updateCount() {
  const sel = squadSelection();
  const lib = sel.filter((p) => p.libero).length;
  const pl = sel.length - lib;
  $('#squad-count').innerHTML = `<span class="${pl > MAX_PLAYERS ? 'bad' : ''}">${pl}/${MAX_PLAYERS} jogadores</span> · <span class="${lib > MAX_LIBEROS ? 'bad' : ''}">${lib}/${MAX_LIBEROS} líberos</span>`;
}
$('#squad-list').addEventListener('change', updateCount);

const chosenNow = () => new Map(squadSelection().map((p) => [p.number, p]));
$('#sq-all').onclick = () => { document.querySelectorAll('.sq-in').forEach((c) => { c.checked = true; }); updateCount(); };
$('#sq-none').onclick = () => { document.querySelectorAll('.sq-in').forEach((c) => { c.checked = false; }); updateCount(); };

// acrescentar um jogador ao plantel sem sair do formulário (fica logo convocado)
$('#qa-pos').innerHTML = roleOptions('');
$('#qa-add').onclick = async () => {
  const number = Number.parseInt($('#qa-num').value, 10);
  const name = $('#qa-name').value.trim();
  if (!Number.isInteger(number)) { toast('Indique o número'); return; }
  const cat = team();
  if (cat.players.some((p) => p.number === number)) { toast(`O #${number} já está no plantel`); return; }
  const pos = $('#qa-pos').value;
  const chosen = chosenNow();
  try {
    const saved = await api(`categories/${cat.id}`, { method: 'PUT', body: { ...cat, players: [...cat.players, { number, name, pos }] } });
    cats = cats.map((c) => (c.id === saved.id ? saved : c));
    renderCategories();
    chosen.set(number, { number, name, pos, libero: pos === 'L' });
    renderSquad(chosen);
    $('#qa-num').value = ''; $('#qa-name').value = ''; $('#qa-pos').value = '';
    toast(`#${number} acrescentado ao plantel e convocado`);
  } catch (e) { toast(e.message); }
};

// ---------- Formulário: novo jogo / editar ----------
function setConfigLocked(locked) {
  for (const sel of ['#bestOf', '#setPoints', '#decidingSetPoints']) $(sel).disabled = locked;
  if (!locked) $('#decidingSetPoints').disabled = $('#bestOf').value === '1';
  $('#edit-note').classList.toggle('hidden', !locked);
}

function showForm() {
  $('#new-card').classList.remove('hidden');
  $('#roster-card').classList.add('hidden');
  $('#new-card').scrollIntoView({ behavior: 'smooth' });
}

function closeForm() {
  editing = null;
  $('#new-card').classList.add('hidden');
  if (param('edit')) history.replaceState(null, '', '/');
}

$('#btn-new').onclick = async () => {
  await loadCategories();
  editing = null;
  // sugere o escalão do filtro da lista, senão o último usado (ou o único que existe)
  const pref = $('#list-filter').value || localStorage.getItem('vb-cat');
  catId = cats.some((c) => c.id === pref) ? pref : cats.length === 1 ? cats[0].id : null;
  $('#form').reset();
  $('#form-title').textContent = 'Novo jogo';
  $('#btn-submit').textContent = 'Criar jogo e começar a marcar';
  $('#btn-delete').classList.add('hidden');
  $('#date').value = new Date().toISOString().slice(0, 10);
  setConfigLocked(false);
  renderCategorySelect(false);
  renderSquad();
  showForm();
};

async function openEdit(id) {
  if (!admin) { toast('Só o administrador pode editar jogos'); return; }
  try {
    const m = await api(`matches/${id}`);
    await loadCategories();
    editing = { id, match: m };
    catId = m.category || null;
    $('#form-title').textContent = 'Editar jogo';
    $('#btn-submit').textContent = 'Guardar alterações';
    $('#btn-delete').classList.remove('hidden');
    $('#title').value = m.title || '';
    $('#date').value = m.date || '';
    $('#venue').value = m.venue || '';
    $('#bestOf').value = String(m.config.bestOf);
    $('#setPoints').value = m.config.setPoints;
    $('#decidingSetPoints').value = m.config.decidingSetPoints;
    $('#nameB').value = m.teams.B.name;
    $('#pin').value = m.pin || '';
    setConfigLocked(m.events.length > 0);
    renderCategorySelect(m.events.length > 0);
    renderSquad(new Map(m.teams.A.players.map((p) => [p.number, p])));
    showForm();
  } catch (e) { toast(e.message); }
}

$('#btn-cancel').onclick = closeForm;
$('#btn-delete').onclick = () => {
  const m = editing.match;
  deleteMatch(editing.id, `${m.teams.A.name} vs ${m.teams.B.name}`);
};

$('#bestOf').onchange = () => {
  $('#decidingSetPoints').disabled = $('#bestOf').value === '1';
};

$('#form').onsubmit = async (e) => {
  e.preventDefault();
  if (!catId) { toast('Escolha o escalão'); return; }
  const squad = squadSelection();
  if (squad.filter((p) => !p.libero).length < 6) { toast('Convoque pelo menos 6 jogadores (além dos líberos)'); return; }
  const config = {
    bestOf: Number($('#bestOf').value),
    setPoints: Number($('#setPoints').value),
    decidingSetPoints: Number($('#bestOf').value === '1' ? $('#setPoints').value : $('#decidingSetPoints').value),
  };
  const base = { title: $('#title').value, date: $('#date').value, venue: $('#venue').value, category: catId, pin: $('#pin').value.trim() };
  const ourName = team().teamName || 'A nossa equipa';
  try {
    if (editing) {
      const started = editing.match.events.length > 0;
      await api(`matches/${editing.id}`, {
        method: 'PUT',
        body: {
          ...base,
          ...(started ? {} : { config }),
          teams: { A: { name: editing.match.category === catId ? editing.match.teams.A.name : ourName, players: squad }, B: { name: $('#nameB').value, players: [] } },
        },
      });
      toast('Jogo atualizado');
      closeForm();
      loadList();
      return;
    }
    const { id } = await api('matches', {
      method: 'POST',
      body: {
        ...base,
        config,
        teams: { A: { name: ourName, players: squad }, B: { name: $('#nameB').value, players: [] } },
      },
    });
    location.href = `/score.html?id=${id}`;
  } catch (err) {
    toast(err.message);
  }
};

loadCategories().finally(() => {
  if (param('edit')) openEdit(param('edit'));
  loadList();
});
setInterval(loadList, 15000);
