# 🏐 Estatísticas de Voleibol

Aplicação web para registar estatísticas de jogos de voleibol, com acompanhamento **em direto** e **dashboard** final por equipa e por jogador. Funciona em browsers de PC e telemóvel.

Não tem dependências: basta o [Node.js](https://nodejs.org) 18 ou superior.

## Arrancar

```bash
npm start          # ou: node server.mjs
```

O servidor mostra os endereços de acesso:

- `http://localhost:3080` neste computador
- `http://<ip-do-pc>:3080` para os telemóveis na **mesma rede Wi-Fi**

## Páginas

| Página | Para quem | O que faz |
|---|---|---|
| `/login.html` | todos | Entrar com utilizador e password |
| `/` | com sessão | Escalões e planteis, lista de jogos (com filtro por escalão) e criação de um novo jogo com a convocatória |
| `/score.html?id=…` | marcador | Formação, substituições, líbero e registo das ações. Para o administrador, para os utilizadores do escalão do jogo ou com o PIN do jogo |
| `/live.html?id=…` | espectadores | Marcador, formação em campo, jogada a jogada, evolução do set e resumos da receção e defesa e do ataque, atualizados em tempo real. No fim do jogo muda sozinho para as estatísticas |
| `/dashboard.html?id=…` | com sessão | Dashboard completo, com filtro por set, exportação para Excel e relatório para PDF |
| `/report.html?id=…` | com sessão | Relatório do jogo em A4, pronto a imprimir ou guardar como PDF |
| `/users.html` | com sessão | Mudar a própria password; o administrador cria e gere os utilizadores |

Em todas as páginas, o botão **← Jogos** (canto superior esquerdo) volta à lista de jogos.

### Editar e apagar jogos

Na lista de jogos, os botões **Editar** e **Apagar** só aparecem ao administrador. No marcador, o administrador também tem o link **Editar** no topo.

- **Editar:** permite mudar escalão (só antes do primeiro evento), descrição, data, local, adversário e convocados. O formato (sets e pontos) só se pode mudar antes do primeiro evento. Jogadores que já têm jogadas registadas não podem sair da convocatória nem mudar o estatuto de líbero.
- **Apagar:** pede confirmação e remove o jogo e todas as estatísticas. Não pode ser desfeito.

### Utilizadores e permissões

A aplicação exige **login** (página `/login.html`). Há dois tipos de conta:

| | Administrador | Utilizador |
|---|---|---|
| Ver a lista de jogos, marcar e ver o dashboard | todos os jogos | só os jogos dos seus escalões |
| Criar, editar e apagar jogos, e definir o PIN de cada jogo | sim | não |
| Criar e editar escalões e plantel | sim | não |
| Criar e gerir utilizadores (página **Utilizadores**) | sim | não |

- **Primeiro arranque:** é criado o administrador `admin` com a password `Ac@mOwner`. **Mude-a** logo em **Utilizadores → A minha conta** (ou clicando no seu nome, no topo).
- **Criar utilizadores:** em **Utilizadores → + Utilizador**, indique o utilizador (para entrar), o nome, a password (mínimo 6 caracteres), o tipo e os escalões a que pertence. Um administrador tem acesso a todos os escalões.
- Tem de existir sempre pelo menos um administrador, e ninguém pode apagar o próprio utilizador.
- **Esqueceu a password do administrador?** Pare o servidor, apague o ficheiro `Voleibol-dados/_utilizadores.json` e arranque de novo. O administrador `admin` é recriado com a password inicial, mas os outros utilizadores perdem-se e têm de ser criados outra vez.
- A sessão dura 30 dias, mesmo que o servidor seja reiniciado. O botão **Sair** termina a sessão.
- Depois de 5 tentativas erradas (login ou PIN), o dispositivo fica bloqueado durante 5 minutos.

**PIN do jogo (marcar sem conta):** ao criar ou editar um jogo, o administrador pode definir um PIN de 4 a 8 algarismos. Num tablet ou telemóvel sem sessão, o botão **Marcar** pede esse PIN, que só é preciso uma vez nesse dispositivo. O PIN só dá acesso ao marcador desse jogo. Sem PIN definido, só marcam o administrador e os utilizadores do escalão.

**Link de marcador:** no marcador, “Copiar link de marcador” copia o link do marcador desse jogo. O link não dá acesso por si: quem o abrir sem sessão tem de introduzir o PIN do jogo. Se o administrador mudar o PIN, os dispositivos já desbloqueados voltam a ter de o introduzir.

**Direto:** o link do direto é público e só permite ver. Inclui também as estatísticas do jogo, que aparecem quando o jogo termina.

## Escalões, plantel e convocatória

- **Escalões** (no topo da página inicial): por exemplo Sub-14, Sub-16, Juniores ou Seniores. Cada escalão tem nome, nome da equipa e o **seu plantel**: número, nome e posição habitual (Passador, Oposto/Saída, Zona 4, Central ou Líbero) de cada jogador. Crie-os com **+ Escalão** e altere-os com **Plantel**. Ficam guardados em `Voleibol-dados/_escaloes.json`.
- Um escalão só pode ser apagado quando não tem jogos.
- **Cada jogo pertence a um escalão.** No novo jogo, escolha primeiro o escalão: os convocados escolhem-se do plantel desse escalão. A lista de jogos pode ser filtrada por escalão, e o escalão aparece na lista e no dashboard.
- **Convocatória:** marcam-se os convocados da lista do plantel (com os botões “Todos” e “Nenhum”), no máximo **12 jogadores + 2 líberos**. O servidor rejeita convocatórias acima destes limites. Um jogador que ainda não esteja no plantel pode ser acrescentado no próprio formulário: fica guardado no plantel do escalão e já convocado.
- **O plantel mantém-se sozinho:** os convocados de um jogo que ainda não estejam no plantel do escalão são acrescentados automaticamente.
- **Versões antigas:** o plantel único que existia (`_team.json`) passa, ao arrancar, para um escalão chamado **Principal**, com todos os jogos já existentes. Basta mudar-lhe o nome em **Plantel**. O ficheiro antigo fica como `_team.json.bak`.

## Formação, rotação, líbero e substituições

- **Quem serve primeiro** não se indica ao criar o jogo, só no marcador, quando o jogo vai mesmo começar:
  - no set 1 e no set decisivo (novo sorteio), o marcador pergunta **“Quem serve primeiro?”** antes do primeiro ponto, e as ações ficam bloqueadas até se responder;
  - nos outros sets, o serviço alterna automaticamente a partir de quem serviu primeiro no set 1;
  - antes do primeiro ponto de qualquer set, pode corrigir-se com **Trocar quem serve** ou na **Formação**.
- **Formação de cada set:** antes do primeiro ponto do set, carregue em **Formação** e indique:
  - o jogador e a função de cada posição do campo (P1 a P6);
  - o líbero inicial e o jogador da linha de trás que ele substitui;
  - quem serve primeiro.

  A formação do set anterior aparece como proposta. Depois do primeiro ponto, só se mudam jogadores com substituições.
- **Posições do campo:** P1 a P6. A linha da frente (junto à rede) é P4, P3 e P2; a linha de trás é P5, P6 e P1. Quem está em P1 serve.
- **Rotação automática:** sempre que ganhamos um ponto no serviço do adversário, a equipa roda no sentido dos ponteiros do relógio (P2→P1, P1→P6, P6→P5, P5→P4, P4→P3, P3→P2).
- **Líbero:**
  - Pode substituir **qualquer** jogador da linha de trás (P1, P5 ou P6), sempre que necessário. A central é só a sugestão.
  - Se já estiver em campo, pode passar diretamente para o lugar de outro jogador da linha de trás (volta o que ele tinha substituído), ou ser trocado pelo outro líbero.
  - Nunca vai para a linha da frente: quando a rotação o levaria para P4, troca automaticamente com o jogador que ele tinha substituído.
  - As trocas de líbero não contam como substituições.
- **Substituições:** no máximo **6 por set**, com a regra oficial:
  - um titular só sai uma vez e só pode voltar no lugar de quem o substituiu;
  - o suplente só pode ser substituído por esse titular;
  - quem já jogou no set não pode entrar por outro jogador.

  No diálogo, as substituições que as regras não permitem aparecem desativadas.

## Como marcar

Só se registam estatísticas da **nossa equipa**. Do adversário guarda-se apenas o nome e o marcador.

O marcador só mostra as ações possíveis em cada momento da jogada:

| Momento | Ações disponíveis |
|---|---|
| Nós a servir (início da jogada) | Serviço. O jogador em P1 fica selecionado automaticamente |
| Adversário a servir (início da jogada) | Receção, e o botão “Ás” do adversário |
| Depois do nosso serviço, ou de um ataque nosso que não foi ponto | Defesa e Bloco, e o botão “Ataque” do adversário |
| Depois de um remate nosso **bloqueado** | Defesa ao bloco (cobertura), e o botão “Bloco” do adversário se a bola cair sem toque nosso |
| Depois de receção ou defesa | Passe e Ataque |
| Depois do passe | Ataque |
| Depois de um toque de bloco | Defesa, Bloco, Passe e Ataque |
| Sempre | Falta |

Depois de um ponto, a jogada recomeça: se ganhámos, Serviço; se perdemos, Receção. Para situações fora do normal, o botão **Mostrar todas as ações** mostra tudo até à ação seguinte.

1. Toque no jogador (no campo ou no banco), ou em “Equipa” se a ação não tiver um jogador atribuído.
2. Toque no resultado da ação: verde dá ponto a nós, vermelho dá ponto ao adversário, neutro não altera o marcador.
3. Pontos do adversário:
   - se um jogador nosso tocou na bola, registe no jogador: **Receção → Erro / Ás** (ás sofrido), **Defesa → Erro** (ataque adversário) ou **Ataque → Bloqueado**;
   - sem toque nosso, use os botões **Ás**, **Ataque** ou **Outro** da secção “Ponto do adversário”.
4. Quando o adversário falha (serviço, ataque, rede…), use **Erro do adversário**.
5. Registe **só uma ação de ponto por jogada**. Use “Anular último” para corrigir enganos e “Terminar jogo” se o jogo acabar antes do tempo.

Receção: **Perfeita** (o distribuidor tem todas as opções), **Boa** (bola jogável), **Má** (sem opções de ataque) e **Erro / Ás**.
Defesa: **Boa** (bola controlada, permite contra-ataque), **Má** (defendida sem controlo) e **Erro**.

O marcador, os sets (25 pontos e 15 no set decisivo, com 2 de diferença) e a equipa que serve ao longo do set são calculados automaticamente.

## Estatísticas da nossa equipa

- **Fases de jogo:**
  - **Side-out:** percentagem de pontos ganhos quando o adversário serve.
  - **Break-point:** percentagem de pontos ganhos quando nós servimos.
- **Receção de serviço:**
  - média numa escala de 0 a 3 (perfeita 3, boa 2, má 1, erro 0), receção positiva e perfeita, ases sofridos;
  - side-out conforme a qualidade da receção (após perfeita, boa ou má).
- **Por posição:** pontos, ataque, serviço, bloco, receção, defesa e assistências de Passador, Oposto (Saída), Zona 4, Central e Líbero. Cada ação conta para a função que o jogador tinha no set (definida na formação ou na substituição); sem formação, usa-se a posição habitual do plantel.
- **Por rotação:** side-out e break-point em cada rotação (R1–R6 = rotação com o passador em P1–P6). Só aparece quando há formações definidas.
- **Defesa:** defesas boas, más e falhadas; **defesa ao bloco** (cobertura depois de um remate nosso bloqueado: boa, má, erro), contada à parte das defesas ao ataque; bloco (pontos, toques, erros) e pontos sofridos por origem (ataque, ás, bloco, erros nossos). Um remate bloqueado conta sempre contra a eficácia do atacante, mas só dá ponto ao adversário se a defesa ao bloco falhar.
- **Jogos antigos:** antes, “Bloqueado” dava logo ponto ao adversário. Ao arrancar, o servidor converte esses jogos, acrescentando a cada bloqueio uma defesa ao bloco falhada sem toque, para manter os resultados.
- **Por jogador:** tabelas de receção, defesa e bloco, e ataque, serviço e passe. Todas podem ser ordenadas por qualquer coluna e estão no Excel exportado.
- **Eficácia de ataque** = (pontos − erros − bloqueados) / total de ataques.

### Excel e relatório PDF

No topo do dashboard:

- **Excel:** descarrega um ficheiro `.xlsx` com as folhas Resumo (parciais e indicadores do jogo e de cada set), Receção de serviço, Defesa e bloco, Ataque, serviço e passe, Por posição e Jogada a jogada.
- **Relatório PDF:** abre o relatório do jogo em A4. Inclui resultado, indicadores, pontos ganhos e sofridos, receção, ataque e defesa, rotações, destaques, evolução do marcador e tabelas por jogador. Carregue em **Imprimir / Guardar como PDF** e escolha “Guardar como PDF” no diálogo de impressão. As jogadoras sem nenhuma ação registada não entram nas tabelas: aparecem só numa linha no fim.

## Dados e atualização

Os escalões (com os planteis) e os jogos ficam numa pasta **fora** da aplicação, ao lado dela:

```
(pasta-mãe)\
├── <pasta da aplicação>\   ← código: pode ser substituída por inteiro
└── Voleibol-dados\         ← escalões e planteis (_escaloes.json) e jogos (<id>.json)
```

O servidor mostra ao arrancar o caminho exato da pasta de dados.

**Para atualizar a aplicação:**
1. Feche o servidor (`Ctrl+C`).
2. Substitua a pasta da aplicação pela versão nova. Não toque em `Voleibol-dados`.
3. Arranque de novo com `npm start`.

**Cópia de segurança:** basta copiar a pasta `Voleibol-dados`.

Nas versões antigas os dados ficavam em `data/`, dentro da aplicação. Na primeira vez que esta versão arranca, eles passam automaticamente para `Voleibol-dados`, e fica em `data/` um `LEIA-ME.txt` a indicar o novo local.

Para usar outra pasta de dados, defina `DATA_DIR` (por exemplo, em PowerShell: `$env:DATA_DIR='D:\Voleibol'; npm start`). Para mudar a porta, defina `PORT`.

Para acesso fora da rede local, publique num serviço que corra Node.js (por exemplo Render, Railway ou Fly.io, ou um VPS) com um disco persistente para a pasta de dados (`DATA_DIR`), ou guarde os dados no Upstash (ver abaixo). O servidor usa Server-Sent Events, por isso um proxy à frente não pode guardar as respostas em buffer.

## Pôr online (Render + Upstash)

O plano gratuito do Render não tem disco permanente: os ficheiros perdem-se sempre que o servidor reinicia ou adormece. Por isso, online, os dados ficam numa base de dados Redis gratuita no [Upstash](https://upstash.com). Quando as variáveis `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` estão definidas, o servidor usa o Upstash; sem elas, usa a pasta `Voleibol-dados` como até aqui.

**1. Criar a base de dados no Upstash**
1. Crie uma conta e uma base de dados **Redis**, numa região na Europa (por exemplo Frankfurt).
2. Na secção **REST API** da base de dados, copie `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`. O token dá acesso total aos dados: não o ponha no código nem no GitHub.

**2. Copiar os dados atuais para o Upstash** (uma única vez, neste computador, em PowerShell, na pasta da aplicação):

```powershell
$env:UPSTASH_REDIS_REST_URL='https://...upstash.io'
$env:UPSTASH_REDIS_REST_TOKEN='...'
npm run importar
```

Copia escalões, utilizadores, sessões e jogos de `Voleibol-dados`. Se o Upstash já tiver dados, recusa; para os substituir pelos locais, use `npm run importar -- --substituir`.

**3. Criar o serviço no Render**
1. **New → Web Service**, e ligue o repositório do GitHub.
2. **Root Directory:** `Voleibol-stats` · **Build Command:** `npm install` · **Start Command:** `npm start` · **Instance Type:** Free.
3. Em **Environment**, acrescente `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`. Se o Upstash ainda não tiver utilizadores, acrescente também `ADMIN_PASSWORD`: é a password do `admin` criado no primeiro arranque (sem ela, é a password por omissão, que está no código público).

A cada `git push` para o GitHub, o Render publica a versão nova sozinho.

**Notas**
- No plano gratuito, o servidor adormece ao fim de algum tempo sem visitas e demora cerca de um minuto a acordar. Abra o site uns minutos antes do jogo.
- Atrás do proxy do Render, o servidor usa o IP do dispositivo (cabeçalho `X-Forwarded-For`) para limitar as tentativas erradas, e o cookie de sessão só segue por HTTPS. Noutro serviço com proxy, defina `TRUST_PROXY=1` para o mesmo efeito.
- Com o Upstash, os dados online deixam de estar na pasta `Voleibol-dados`. A partir daí, o servidor local e o online não partilham os dados.
