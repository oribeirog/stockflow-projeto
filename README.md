# MNR Perfumes

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
