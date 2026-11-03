# MNR Perfumes

## Etapa 4B — Cadastro e gestão de perfumes

Perfumes agora oferece catálogo real paginado, busca por nome/SKU, filtro de
situação, cadastro, edição, referências rápidas, inativação/reativação e uma
fotografia local opcional. Preços são editados em reais e volumes em mL, com
conversões inteiras para os contratos existentes. Intenções idempotentes e
mensagens de sucesso parcial protegem as gravações de cadastro e fotografia.

Schema v5 acrescenta somente a infraestrutura aprovada de fotografias. Imagens
normalizadas e miniaturas ficam fora da instalação; o renderer recebe bytes por
API limitada, sem paths ou acesso genérico ao filesystem. Backup completo com
manifesto e restauração isolada foram preparados; sua interface fica para etapa
posterior. `test:ui` agora utiliza banco, imagens e Chromium exclusivos por execução.

Fluxos, segurança, arquivos, testes e limitações no
[relatório da Etapa 4B](docs/etapa-4B-cadastro-perfumes.md). As seções anteriores
abaixo são históricas; suas referências a schema v4 e Perfumes reservado foram
superadas por esta entrega.

## Etapa 4A — Integração segura dos cadastros

Implementada a comunicação Angular → preload → IPC → serviços cadastrais existentes
para produtos, marcas, categorias, clientes e fornecedores. A API
`window.mnrApi.cadastros` oferece `listar`, `obter` e `salvar` para cada cadastro,
com 15 canais fixos, validação de remetente/frame/URL/argumentos e erros públicos
sanitizados. Não há IPC genérico, SQL, fotos, novos canais financeiros/de estoque
ou telas completas de cadastro. Migrações 0001–0004, serviços comerciais e Design
System foram preservados.

Os cinco serviços Angular ficam em `src/app/core/cadastros`. Cada intenção criada
por `novaGravacao(dados, motivo)` conserva uma cópia do comando e sua chave UUID;
`executar()` repetido reutiliza ambos. `novaConsulta()` mantém estados independentes,
ignora respostas antigas e usa paginação/busca/filtro de ativo sem carregar o catálogo
inteiro. As páginas atuais continuam reservadas, sem consultas cadastrais automáticas.

Validação em Windows 10 build 19045 em 02/11/2026: typecheck, lint, format:check,
build, **84 testes aprovados**, integração Angular real em HTTP local e `mnr://app`,
teste de interface existente e smoke do executável empacotado. UUID verificado
também no desenvolvimento real e no pacote. Inspeção do ASAR confirmou a exclusão
dos recursos exclusivos de teste. Nenhuma dependência nova, commit ou push.

`npm.cmd test` inclui a nova integração; `npm.cmd run test:cadastros` a executa
separadamente, após build do Electron. O renderer exclusivo de teste é compilado
em `.cache/cadastros-renderer` e usa bancos novos sob `.local-data/test`.
Após `npm.cmd run pack`, `node scripts/verify-package.mjs` inspeciona o isolamento
do pacote. Detalhes, contratos, arquivos e limitações no
[relatório da Etapa 4A](docs/etapa-4A-integracao-cadastros.md).

As seções anteriores abaixo registram o histórico das entregas; a API desktop já
não se limita ao diagnóstico descrito na fundação.

## Etapa 3 — Entregas 3A, 3B, 3C e 3D

O [modelo de dados e regras de negócio](docs/etapa-3-modelagem-dados.md) reúne o
dicionário de dados, custeio, operações financeiras, correções, migrações futuras e
critérios de aceitação. O desenho foi aprovado conceitualmente e dividido em 3A–3D.
A [entrega 3A](docs/etapa-3A-migracoes-cadastros.md) implementa migrações e cadastros
no processo principal, sem UI ou canais IPC novos. A [entrega 3B](docs/etapa-3B-estoque-custeio.md)
acrescenta estoque, custo médio inteiro, contagem física e reconciliação com falha segura.
A [entrega 3C](docs/etapa-3C-compras-vendas-parcelas.md) acrescenta rascunhos,
compras/vendas, pagamentos na confirmação, parcelas e integração atômica ao estoque,
sem UI ou novos canais IPC. A [entrega 3D](docs/etapa-3D-financeiro-correcoes.md)
acrescenta recebimentos posteriores/parciais, entrada a prazo, abatimentos, devoluções,
cancelamentos, obrigações e pagamentos de reembolso, além de estornos vinculados.
Schema versão 4, sem alterar migrações anteriores, dependências ou segurança Electron.
Movimentos registram dinheiro uma única vez; alocações apenas o distribuem entre parcelas.
Produtos impróprios retornam pelo custo histórico e geram perda vinculada de igual valor,
preservando o estoque anterior mesmo quando a média atual for diferente.

A 0004 foi exercitada com bancos populados v1/v2/v3 e falhas de reconstrução em WAL.
A implementação precisou reconstruir também tabelas dependentes (auditoria, parcelas e
vínculos) para evitar pendências de FK no commit, mantendo `foreign_keys=ON`.
Detalhes de serviços, verificações, resultados e limitações estão no relatório 3D.
Validação 3D em Windows 10 build 19045: typecheck, lint, formatação, build e **76 testes
aprovados**, incluindo novos fluxos no Electron real; teste visual existente aprovado.
Pacote Windows gerado e executado com `SMOKE_OK`; desenvolvimento reiniciado em modo
smoke sobre a base de teste. Windows 11 e instalação NSIS permanecem pendentes externos.
As seções da fundação e da Etapa 2 abaixo registram o estado histórico dessas entregas;
as afirmações antigas de ausência de tabelas/migrações foram superadas pelas entregas atuais.

Funda??o desktop local da MNR Software para Windows 10 (22H2) e Windows 11 x64. Sem m?dulos comerciais, servidor externo ou servi?os de internet em produ??o.

## Requisitos

- Node.js 26 LTS x64 e npm. Angular 22 requer TypeScript 6.0; vers?es exatas no package.json e package-lock.json.
- Internet durante instala??o de depend?ncias e primeiro empacotamento. O cliente n?o precisa de Node ou internet para usar o execut?vel.
- better-sqlite3 ? nativo: a vers?o 13 inclui bin?rios Node-API, sem reconstru??o por ABI. O postinstall baixa explicitamente o Electron e verifica o SQLite no Node; npm test verifica tamb?m no Electron. Se n?o houver bin?rio compat?vel, investigar a mensagem antes de instalar ferramentas C++/Python.

## Instala??o e execu??o

No PowerShell, na raiz:

```powershell
npm.cmd ci
npm.cmd run dev
```

Use npm.cmd para evitar bloqueio de npm.ps1. N?o ? necess?rio mudar a pol?tica do PowerShell. Angular CLI ? local. Angular usa recarregamento autom?tico; ap?s mudar Electron, preload ou contratos, encerre e reinicie dev.

## Comandos

| Comando                  | Finalidade                                                 |
| ------------------------ | ---------------------------------------------------------- |
| npm.cmd run dev          | Angular em 127.0.0.1:4200 e janela Electron                |
| npm.cmd run typecheck    | TypeScript do renderer, Electron e contratos               |
| npm.cmd run lint         | ESLint de TypeScript e templates                           |
| npm.cmd run format:check | Prettier sem escrita                                       |
| npm.cmd run format       | Aplicar formata??o                                         |
| npm.cmd run build        | Compilar Angular e Electron/preload                        |
| npm.cmd test             | Build e teste desktop de Angular, IPC, SQLite e isolamento |
| npm.cmd run pack         | Aplicativo descompactado em release/win-unpacked           |
| npm.cmd run dist         | Instalador NSIS x64 em release, sem publica??o             |

O teste abre uma janela e a fecha ap?s o diagn?stico. Empacotamento n?o assina o execut?vel nesta funda??o; assinatura e ?cone definitivo ficam para a distribui??o profissional.

## Arquitetura

- src/app/core: adaptador IPC Angular; shared e features reservam a organiza??o futura.
- electron/main: ciclo de vida, protocolo local e janela segura.
- electron/preload: API limitada via contextBridge, empacotada em CommonJS.
- electron/ipc: valida??o de remetente, frame, URL e argumentos.
- electron/infrastructure: paths e SQLite. migrations est? reservada, sem executor ou tabelas comerciais.
- shared: contratos sem depend?ncias de plataforma.
- scripts: desenvolvimento, build do preload, reconstru??o nativa e teste desktop.

A API inicial ? window.mnrApi.system.getStatus(). Ela n?o aceita argumentos e n?o exp?e SQL, filesystem ou IPC gen?rico. O renderer n?o tem Node; contextIsolation e sandbox permanecem habilitados. Conte?do local usa mnr://app em produ??o, com CSP e navega??o restritas.

## Dados

Produ??o usa %LOCALAPPDATA%/MNR Software/MNR Perfumes. Desenvolvimento usa .local-data/development e teste desktop usa .local-data/test. Cada ambiente tem data, images e logs; Chromium usa pasta pr?pria. N?o h? importa??o de imagens ou logging persistente nesta etapa.

SQLite abre apenas no processo principal, com WAL, foreign keys, synchronous FULL e timeout de 5 segundos. N?o h? tabelas comerciais. Dados n?o s?o gravados na instala??o e n?o s?o apagados por desinstala??o. N?o copiar apenas o .db aberto com WAL para fazer backup; backup/restaura??o e migra??es ser?o implementados em etapa futura.

Caches de npm, Electron, Builder e tempor?rios dos scripts ficam no reposit?rio. Para uma instala??o estritamente local de caches, configure antes de npm ci:

```powershell
$env:ELECTRON_CACHE = "$PWD/.cache/electron"
$env:TEMP = "$PWD/.cache/tmp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force .cache/tmp | Out-Null
npm.cmd ci
```

## Verifica??o manual de distribui??o

Em Windows 10 e 11 x64: executar o aplicativo empacotado, confirmar mensagem de conex?o, fechar e reabrir; repetir offline. Validar instala??o NSIS por usu?rio e preserva??o dos dados. N?o declarar Windows 11 validado sem execut?-lo nesse sistema.

## Refer?ncias de compatibilidade

- https://angular.dev/reference/versions
- https://github.com/electron/electron#platform-support
- https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- https://github.com/WiseLibs/better-sqlite3
- https://www.electron.build/v26/

## Valida??o desta funda??o

Validado em Windows 10 build 19045 x64, Node 26.13.0 e npm 12.2.1:

- TypeScript, ESLint, Prettier e build de produ??o aprovados.
- Dois testes automatizados aprovados: rejei??o de chamadas IPC inv?lidas e cria??o/reabertura do SQLite com pragmas de integridade, sem tabelas comerciais.
- Janela Electron abriu e carregou Angular, preload e SQLite, confirmando aus?ncia de Node no renderer.
- Comando dev iniciou Angular/Electron e encerrou ap?s diagn?stico.
- Pacote Windows descompactado gerado e executado com diagn?stico aprovado.
- Auditoria de produ??o: zero vulnerabilidades reportadas. Auditoria completa: 31 avisos moderados transitivos nas ferramentas. N?o foi aplicado audit fix --force; as sugest?es inclu?am regress?es incompat?veis de vers?o.
- Corrigida a falha alta do Vite por atualiza??o do Angular Build para 22.2.5. ESLint atualizado para a linha 10, aceita pelos plugins.

O Builder inicialmente tentou reconstruir better-sqlite3 via C++, mas a vers?o 13 inclui prebuilds Node-API. npmRebuild fica desativado para essa combina??o validada; reavaliar ao trocar vers?es nativas. Electron 43 exige download expl?cito do bin?rio, tratado pelo postinstall. Nenhuma ferramenta C++ foi instalada.

npm 12 pode avisar sobre scripts transitivos bloqueados. N?o aprovar scripts indiscriminadamente: a configura??o foi validada com o download expl?cito do Electron e os bin?rios presentes nos pacotes. Neste ambiente de automa??o, o esbuild precisou executar fora da sandbox por restri??es de leitura dos diret?rios ancestrais; n?o foi alterada configura??o de seguran?a do Windows.

Pendente: teste visual pelo usu?rio, Windows 11, instala??o/desinstala??o pelo NSIS e ensaio offline em m?quina limpa. O instalador est? configurado, mas n?o foi instalado neste computador. Sem commits ou push.

### Vers?es fixadas

- @angular/common: 22.2.4
- @angular/compiler: 22.2.4
- @angular/core: 22.2.4
- @angular/platform-browser: 22.2.4
- better-sqlite3: 13.0.3
- rxjs: 7.8.2
- tslib: 2.8.1
- @angular/build: 22.2.5
- @angular/cli: 22.2.4
- @angular/compiler-cli: 22.2.4
- @types/better-sqlite3: 7.6.13
- @types/node: 24.10.0
- angular-eslint: 22.6.0
- electron: 43.8.6
- electron-builder: 26.18.1
- esbuild: 0.25.12
- eslint: 10.14.0
- prettier: 3.6.2
- typescript: 6.0.2
- typescript-eslint: 8.62.0

### Arquivos criados ou modificados

README.md foi modificado; os demais arquivos abaixo foram criados. Depend?ncias, caches, bancos de teste e artefatos gerados est?o ignorados pelo Git.

```text
.editorconfig
.gitignore
.npmrc
.prettierignore
.prettierrc.json
AGENTS.md
README.md
angular.json
build\.gitkeep
electron-builder.yml
electron\infrastructure\database\index.ts
electron\infrastructure\database\migrations\.gitkeep
electron\infrastructure\paths\index.ts
electron\ipc\index.ts
electron\ipc\trust.ts
electron\main\index.ts
electron\preload\index.ts
eslint.config.mjs
package-lock.json
package.json
scripts\dev.mjs
scripts\env.mjs
scripts\native.mjs
scripts\package.mjs
scripts\preload.mjs
scripts\smoke.mjs
shared\contracts.ts
src\app\app.ts
src\app\core\desktop.service.ts
src\app\features\.gitkeep
src\app\shared\.gitkeep
src\index.html
src\main.ts
src\styles.scss
src\styles\_theme.scss
tests\database.test.cjs
tests\ipc.test.cjs
tsconfig.app.json
tsconfig.electron.json
tsconfig.json
```

## Etapa 2 — Design system e estrutura visual

Tema escuro único, sem fontes externas. Nove destinos com hash: Dashboard, Perfumes, Estoque, Vendas, Compras, Clientes, Fornecedores, Relatórios e Configurações. Os sete módulos comerciais apresentam “Disponível em uma próxima etapa”. Não há indicadores fictícios, operações comerciais, persistência nova ou migrações.

O Dashboard contém atalhos e demonstrações identificadas; seus campos e ações existem apenas em memória. Configurações consulta o diagnóstico real via DesktopService, com carregamento, falha, nova tentativa e atualização. Electron, preload, contratos IPC e bancos existentes foram preservados.

### Organização e componentes

- `src/app/core/navigation.ts`: metadados compartilhados, títulos e rotas sob demanda; caminhos vazios ou desconhecidos redirecionam ao Dashboard.
- `src/app/core/shell`: sidebar de 224px, cabeçalho, rolagem própria do conteúdo, link de salto e foco no título após renderizar a navegação. Abaixo de 900px, sidebar de 72px com nomes acessíveis; a expansão sobrepõe o conteúdo, com fechamento por botão, Escape, clique externo ou saída do foco.
- `src/app/features`: Dashboard, página compartilhada dos módulos com metadados próprios e Configurações; templates e SCSS separados.
- `src/app/shared/ui`: componentes standalone sem IPC ou regras comerciais.

| Componente          | Entradas e eventos principais                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `mnr-button`        | `variant`: primary/secondary; `type`; `disabled`; evento `pressed`. Botão nativo.                                                         |
| `mnr-icon`          | `name` tipado; SVG local decorativo. O controle que o contém fornece o nome acessível.                                                    |
| `mnr-card`          | Projeção de conteúdo; superfície e espaçamento consistentes.                                                                              |
| `mnr-badge`         | `tone`: neutral/success/warning/error; texto projetado.                                                                                   |
| `mnr-field`         | `controlId` único, `label`, `value`, `placeholder`, `hint`, `disabled`; evento `valueChanged`. Rótulo e ajuda associados ao input nativo. |
| `mnr-content-state` | `kind`: loading/empty/error/upcoming; `title`, `description`; ação opcional projetada. Status anunciado; erros usam alert.                |

### Tokens e contraste

`src/styles/_theme.scss` compõe `_tokens.scss`, que publica propriedades CSS semânticas. Segoe UI com fallback de sistema; corpo de 14px, subtítulos de 18px e títulos de 28px. Espaços em múltiplos de 4px, raios de 6/10px e controles de 40px. Hover, pressionado, desabilitado e foco visível compõem os estados; transições de 120ms são removidas com `prefers-reduced-motion`.

| Uso                                    | Tokens/cores                                                      | Contraste calculado                                                                |
| -------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Fundo e superfícies                    | background `#090B10`, surface `#171D2A`, surface-raised `#20293A` | Bordas decorativas discretas.                                                      |
| Texto principal sobre superfície       | text `#F7F9FC` / surface                                          | 15,98:1                                                                            |
| Texto secundário na superfície elevada | text-secondary `#C4CBD7` / surface-raised                         | 8,94:1                                                                             |
| Destaque institucional                 | accent `#1677FF`                                                  | Marca, seleção e detalhes.                                                         |
| Ação com texto branco                  | action `#0961DC` / `#FFFFFF`                                      | 5,59:1; o azul institucional daria 4,10:1, por isso o botão usa a variação escura. |
| Hover e pressionado                    | action-hover `#0754BF`, action-pressed `#06469F`                  | Mais escuros que a ação padrão.                                                    |
| Foco e links na seleção                | focus `#8FC1FF` / selection `#17365F`                             | 6,50:1                                                                             |
| Borda de campo sobre superfície        | control-border `#68788F` / surface                                | 3,75:1                                                                             |
| Erro no fundo                          | error `#FFB4B4` / background                                      | 11,66:1                                                                            |
| Sucesso na superfície elevada          | success `#8AE0B3` / surface-raised                                | 9,30:1                                                                             |
| Aviso na superfície elevada            | warning `#F5D28C` / surface-raised                                | 10,06:1                                                                            |

Contrastes calculados pela luminância relativa sRGB/WCAG: texto normal ≥ 4,5:1 e limites de controles/foco ≥ 3:1. Mensagens e seleção também têm texto/ícone, além da cor. Bordas decorativas usam `--border`; campos e botões secundários usam `--control-border`. Controles indisponíveis têm desabilitação nativa e explicação visível.

### Navegação e build

Única dependência acrescentada: `@angular/router` **22.2.4**, oficial e fixada no lockfile, para navegação declarativa, histórico e carregamento sob demanda. A base HTML vazia preserva `mnr://app/index.html` ao mudar o hash e funciona também na raiz do servidor de desenvolvimento. Não trocar por `./`: isso pode remover `index.html` da URL e fazer o IPC rejeitar o remetente.

O build de produção desativa somente `optimization.styles.inlineCritical`: a otimização padrão injeta um script inline para ativar a folha de estilos, bloqueado pela CSP existente. O CSS é carregado diretamente, sem afrouxar a CSP. A moldura nativa e as dimensões originais da janela foram preservadas.

### Verificação da etapa

Validado em **Windows 10 build 19045 x64**, em 31/10/2026. Windows 11 não foi executado nesta etapa.

- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run format:check`, `npm.cmd run build` e `npm.cmd test`: verificações de código, build, testes existentes de IPC/SQLite e smoke desktop.
- `npm.cmd run test:ui`: recompila e abre Electron com a entrada real do aplicativo e o renderer de produção. Verifica nove destinos, título do documento, seleção única, foco, histórico, rota desconhecida, recarga de Configurações e diagnóstico real.
- Falha e resposta atrasada do diagnóstico são simuladas **somente no processo de teste**, cobrindo erro, carregamento e nova tentativa. O teste exercita ações demonstrativas, rótulos nativos, desabilitação, Tab/Enter/Escape e redução de movimento.
- Tamanhos externos 1366×768, 1000×700 e 640×480 em zoom real de 100%, 125% e 150%, incluindo sidebar expandida: sem transbordamento horizontal da página ou conteúdo. A área útil é menor que a dimensão externa devido à moldura nativa.
- Recarga e abertura de módulo sob demanda no protocolo local com rede emulada offline. Isso não substitui o ensaio de instalação offline em máquina limpa.
- Capturas em `.cache/ui/`: Dashboard por tamanho/zoom, sidebar expandida, diagnóstico e componentes. Capturas inspecionadas visualmente; teste confirma CSS global sob CSP de produção e ausência de Node no renderer.

`test:ui` usa `.local-data/development`, sem apagar/recriar banco ou alterar schema. Feche outras instâncias antes de executá-lo. O smoke original continua usando `.local-data/test`. Capturas e artefatos ficam ignorados pelo Git. Neste ambiente, build/desktop podem exigir execução fora da sandbox por restrições de leitura e abertura de processos.

Pendentes: Windows 11, instalação NSIS e ensaio offline em máquina limpa. Nenhum commit ou push foi feito.
