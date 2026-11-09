// Persistência: ficheiros JSON na pasta de dados ou, se houver as variáveis do Upstash,
// uma base de dados Redis no Upstash (para alojamentos sem disco permanente, como o Render gratuito).
// Usa a API REST do Upstash diretamente, para a aplicação continuar sem dependências externas.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Documentos: 'escaloes', 'utilizadores', 'sessoes' (ficheiros _<nome>.json; no Upstash, chaves vb:<nome>).
 * Jogos: um ficheiro <id>.json cada; no Upstash, campos do hash vb:jogos.
 * As gravações são assíncronas e, para a mesma chave, feitas pela ordem em que foram pedidas.
 */
export function createStorage({ dataDir, url, token }) {
  return url && token ? upstashStorage(url, token) : fileStorage(dataDir);
}

// fila por chave: a gravação seguinte só começa quando a anterior acaba (nunca chegam fora de ordem)
function writeQueue() {
  const tails = new Map();
  const q = {
    failures: 0,
    run(key, fn) {
      const p = (tails.get(key) || Promise.resolve()).then(fn).catch((e) => {
        q.failures++;
        console.error(`Erro a gravar ${key}:`, e.message);
      });
      tails.set(key, p);
      p.then(() => { if (tails.get(key) === p) tails.delete(key); });
      return p;
    },
    /** Espera que todas as gravações pendentes terminem. */
    flush: () => Promise.all(tails.values()),
  };
  return q;
}

function fileStorage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const q = writeQueue();
  const docFile = (name) => path.join(dir, `_${name}.json`);
  const writeAtomic = async (file, text) => {
    await fsp.writeFile(`${file}.tmp`, text);
    await fsp.rename(`${file}.tmp`, file);
  };
  return {
    files: true,
    kind: `ficheiros em ${dir}`,
    get failures() { return q.failures; },
    flush: q.flush,
    async readDoc(name) {
      try { return JSON.parse(await fsp.readFile(docFile(name), 'utf8')); } catch (e) {
        if (e.code === 'ENOENT') return null; // ainda não existe
        throw new Error(`Ficheiro ${docFile(name)} inválido: ${e.message}`);
      }
    },
    writeDoc(name, data) {
      const text = JSON.stringify(data);
      return q.run(name, () => writeAtomic(docFile(name), text));
    },
    async listMatches() {
      const list = [];
      for (const f of await fsp.readdir(dir)) {
        if (!f.endsWith('.json') || f.startsWith('_')) continue;
        try { list.push(JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'))); } catch (e) {
          console.error('Ficheiro de jogo inválido:', f, e.message);
        }
      }
      return list;
    },
    writeMatch(m) {
      const text = JSON.stringify(m);
      return q.run(m.id, () => writeAtomic(path.join(dir, `${m.id}.json`), text));
    },
    deleteMatch(id) {
      return q.run(id, () => fsp.rm(path.join(dir, `${id}.json`), { force: true }));
    },
  };
}

function upstashStorage(url, token) {
  const MATCHES = 'vb:jogos';
  const q = writeQueue();
  // cada comando Redis vai como um array JSON: ["SET", "chave", "valor"]
  async function call(...cmd) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error(`Upstash: ${body.error || `HTTP ${r.status}`}`);
    return body.result;
  }
  return {
    files: false,
    kind: 'Upstash (Redis)',
    get failures() { return q.failures; },
    flush: q.flush,
    async readDoc(name) {
      const v = await call('GET', `vb:${name}`);
      return v == null ? null : JSON.parse(v);
    },
    writeDoc(name, data) {
      const text = JSON.stringify(data);
      return q.run(`vb:${name}`, () => call('SET', `vb:${name}`, text));
    },
    async listMatches() {
      const ids = (await call('HKEYS', MATCHES)) || [];
      const list = [];
      // aos poucos, para nenhuma resposta ficar demasiado grande
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        const values = await call('HMGET', MATCHES, ...chunk);
        values.forEach((v, j) => {
          if (v == null) return;
          try { list.push(JSON.parse(v)); } catch (e) { console.error('Jogo inválido no Upstash:', chunk[j], e.message); }
        });
      }
      return list;
    },
    writeMatch(m) {
      const text = JSON.stringify(m);
      return q.run(`jogo:${m.id}`, () => call('HSET', MATCHES, m.id, text));
    },
    deleteMatch(id) {
      return q.run(`jogo:${id}`, () => call('HDEL', MATCHES, id));
    },
  };
}
