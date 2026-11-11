import { $, esc, api, toast, requireLogin, isAdmin, storageNotice } from './common.js';

const me = await requireLogin();
let users = [];
let cats = [];
let editing = null; // utilizador em edição (null = novo)

$('#me-info').textContent = `${me.name} (${me.username}) · ${isAdmin(me) ? 'Administrador' : 'Utilizador'}`;

$('#pw-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('me/password', { method: 'PUT', body: { current: $('#pw-cur').value, password: $('#pw-new').value } });
    $('#pw-form').reset();
    toast('Password alterada');
  } catch (err) { toast(err.message); }
};

// ---------- gestão de utilizadores (só administrador) ----------
const catName = (id) => cats.find((c) => c.id === id)?.name;

function renderList() {
  $('#list').innerHTML = users.map((u) => {
    const scope = u.role === 'admin'
      ? '<span class="badge">Administrador</span>'
      : u.categories.map(catName).filter(Boolean).map((n) => `<span class="badge cat">${esc(n)}</span>`).join(' ') || '<span class="muted small">sem escalões</span>';
    return `<li>
      <div><b>${esc(u.name)}</b> <span class="muted small">· ${esc(u.username)}</span><div class="small" style="margin-top:.2rem">${scope}</div></div>
      <div class="row">
        <button class="btn-sm" data-edit="${u.id}">Editar</button>
        ${u.id === me.id ? '' : `<button class="btn-sm btn-danger" data-del="${u.id}">Apagar</button>`}
      </div>
    </li>`;
  }).join('');
}

async function load() {
  [users, cats] = await Promise.all([api('users'), api('categories')]);
  renderList();
}

function syncRole() {
  $('#u-cats-wrap').classList.toggle('hidden', $('#u-role').value === 'admin');
}

function openForm(u = null) {
  editing = u;
  $('#form').reset();
  $('#form-title').textContent = u ? `Editar ${u.name}` : 'Novo utilizador';
  $('#btn-save').textContent = u ? 'Guardar' : 'Criar utilizador';
  $('#u-username').value = u?.username || '';
  $('#u-name').value = u?.name || '';
  $('#u-role').value = u?.role || 'user';
  $('#u-password').required = !u;
  $('#u-password-lbl').textContent = u ? 'Nova password (vazio = manter)' : 'Password (mín. 6 caracteres)';
  $('#u-cats').innerHTML = cats.length
    ? cats.map((c) => `<label><input type="checkbox" value="${c.id}" ${u?.categories.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')
    : '<span class="muted small">Ainda não há escalões.</span>';
  syncRole();
  $('#form-card').classList.remove('hidden');
  $('#form-card').scrollIntoView({ behavior: 'smooth' });
  $('#u-username').focus();
}

if (isAdmin(me)) {
  storageNotice($('#storage-notice'), { always: true });
  $('#users-card').classList.remove('hidden');
  $('#u-role').onchange = syncRole;
  $('#btn-new').onclick = () => openForm(null);
  $('#btn-cancel').onclick = () => $('#form-card').classList.add('hidden');
  $('#list').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { openForm(users.find((u) => u.id === ed.dataset.edit)); return; }
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const u = users.find((x) => x.id === del.dataset.del);
    if (!confirm(`Apagar o utilizador “${u.name}”?`)) return;
    try {
      await api(`users/${u.id}`, { method: 'DELETE' });
      toast('Utilizador apagado');
      load();
    } catch (err) { toast(err.message); }
  });
  $('#form').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      username: $('#u-username').value.trim(),
      name: $('#u-name').value.trim(),
      role: $('#u-role').value,
      categories: [...document.querySelectorAll('#u-cats input:checked')].map((c) => c.value),
    };
    if ($('#u-password').value) body.password = $('#u-password').value;
    try {
      if (editing) await api(`users/${editing.id}`, { method: 'PUT', body });
      else await api('users', { method: 'POST', body });
      toast(editing ? 'Utilizador guardado' : 'Utilizador criado');
      $('#form-card').classList.add('hidden');
      load();
    } catch (err) { toast(err.message); }
  };
  load().catch((err) => toast(err.message));
}

if (location.hash === '#me') $('#me').scrollIntoView();
