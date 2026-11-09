// Copia os dados locais (escalões, utilizadores, sessões e jogos) para o Upstash, uma única vez,
// antes de pôr a aplicação online. Ver “Pôr online (Render + Upstash)” no README.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStorage } from './storage.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, '..', 'Voleibol-dados'));
const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
if (!url || !token) {
  console.error('Defina primeiro UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN (ver README).');
  process.exit(1);
}

// (sem process.exit depois de usar a rede: no Windows o Node pode terminar com um erro interno)
async function main() {
  const from = createStorage({ dataDir });
  const to = createStorage({ url, token });

  // não estragar dados que já estejam online, a não ser que se peça
  const online = (await to.listMatches()).length;
  if ((online || await to.readDoc('utilizadores')) && !process.argv.includes('--substituir')) {
    console.error(`O Upstash já tem dados (${online} jogo${online === 1 ? '' : 's'}). Para os substituir pelos locais, corra com --substituir`);
    return 1;
  }

  const docs = [];
  for (const name of ['escaloes', 'utilizadores', 'sessoes']) {
    const d = await from.readDoc(name);
    if (d) { to.writeDoc(name, d); docs.push(name); }
  }
  const matches = await from.listMatches();
  for (const m of matches) to.writeMatch(m);
  await to.flush();

  if (to.failures) {
    console.error(`Houve ${to.failures} erro${to.failures === 1 ? '' : 's'} a gravar (ver acima). Corrija e corra de novo com --substituir.`);
    return 1;
  }
  console.log(`Copiado de ${dataDir} para o Upstash: ${docs.join(', ') || 'nenhum documento'} e ${matches.length} jogo${matches.length === 1 ? '' : 's'}.`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  console.error('Erro:', e.message);
  process.exitCode = 1;
}
