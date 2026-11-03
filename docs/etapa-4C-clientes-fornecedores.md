# Etapa 4C — Gestão visual de clientes e fornecedores

Implementação das seis fases aprovadas, sem migrações, novos canais IPC,
dependências, alteração de regras comerciais/financeiras, commit ou push.

## Telas e contratos

- Listagem e editor compartilhados em `src/app/features/pessoas`, com contexto
  definido pela rota e uso exclusivo de ClientesService/FornecedoresService.
- Rotas de listagem, novo e `:id/editar` para os dois cadastros, carregadas sob
  demanda. Após criar, a URL é substituída pela edição do ID confirmado. O editor
  permanece aberto, com mensagem de sucesso e nova leitura dos dados.
- Busca somente por nome, com as normalizações existentes e limite de 200
  caracteres; debounce de 300 ms, Enter e botão Pesquisar. Não há filtros de
  documento, contato ou referências inexistentes no contrato.
- Ativos como padrão, Inativos e Todos. Páginas de 25, consultando 26 para
  identificar a próxima página. Não há total fictício. Filtros reiniciam a página;
  página esvaziada retorna à anterior. Respostas ultrapassadas são ignoradas.
- Campos reais: nome obrigatório (200), tipoPessoa opcional PF/PJ/nulo, documento
  opcional (40 na entrada), telefone (40), e-mail (254), endereço e observações
  (4.000 cada). Edição e situação exigem justificativa de até 4.000 caracteres;
  cadastro usa motivo automático. Datas e ID não são editáveis.
- CPF, CNPJ numérico e alfanumérico usam a mesma regra pura, extraída para shared.
  O main mantém sua validação de entrada e os mesmos erros. Documento exige
  tipoPessoa quando preenchido; trocar o tipo não apaga o documento.
- Nome repetido é permitido. Documento é único por tabela, inclusive em registros
  inativos; não foi criada restrição entre clientes e fornecedores.
- Atualizações completas incluem explicitamente todos os opcionais. Campo vazio
  é enviado como null; campos não alterados conservam o conteúdo carregado.

## Fluxos, integridade e experiência

- Inativação/reativação abre confirmação com justificativa, relê os dados e envia
  EntradaPessoa completo, alterando apenas ativo. Alterações não salvas bloqueiam
  essa ação. Se o alvo já foi aplicado, a releitura atualiza a tela sem inverter
  novamente nem criar uma gravação.
- Cada envio válido cria uma intenção imutável. Duplo envio é bloqueado. Falhas
  IPC_UNAVAILABLE, DATABASE_BUSY e INTERNAL_ERROR conservam UUID, motivo e dados;
  a repetição depende de ação explícita. Não há retry automático.
- Conflitos de idempotência bloqueiam criação automática de outra intenção.
  Erros públicos não revelam SQL, paths ou stack. Falha de leitura depois de
  salvar informa o sucesso já confirmado e oferece somente nova consulta.
- Guardas protegem dados não salvos e intenções pendentes. Editores são recriados
  ao mudar de ID ou entidade. Leituras da tela destruída são ignoradas. Há
  proteção adicional no fechamento/recarregamento normal.
- Reuso de Field, Button, Badge, ContentState e Confirm. Confirm recebeu somente
  um input opcional de erro, sem mudança do comportamento padrão de Perfumes.
- Os estilos originais de catálogo/editor da 4B foram movidos para parciais SCSS,
  importados por Perfumes e Pessoas. Nenhum template ou fluxo de Perfumes foi
  reimplementado. Tema escuro, azul, foco visível e redução de movimento mantidos.
- Formulários com labels, legendas, erros associados e foco no primeiro inválido;
  diálogos nativos, Escape, contenção e restauração de foco. Tabela compacta em
  dimensões menores, sem perda de controles.

## Validação incremental

1. Validação pura extraída com testes de paridade de documentos. Teste cadastral
   muda nome, documento, telefone, e-mail, endereço e observações individualmente,
   verificando todos os outros campos; limpa cada opcional explicitamente e
   rejeita nome vazio. Build Electron e 18 testes direcionados aprovados.
2. Rotas/listagens e extração SCSS validadas por typecheck, build e suíte desktop
   preexistente, incluindo Perfumes, fotografia e 3 dimensões × 3 zooms.
3. Cadastro/edição pela interface real, com verificação individual dos campos no
   SQLite e mudança para a rota de edição. Typecheck, lint e teste desktop
   aprovados antes de avançar.
4. Situação, justificativas, navegação protegida e intenções testadas no Electron.
   Resposta perdida após commit reutiliza exatamente o comando original.
5. Fixtures criam compra e venda confirmadas, duas parcelas e recebimento parcial
   pelos serviços existentes, exclusivamente no host de teste. Snapshots conferem
   documentos, itens, parcelas, movimentos/alocações financeiros, estoque,
   histórico de preços e as operações/auditorias anteriores. Edição, inativação e
   reativação cadastrais não alteram esses registros ou vínculos.
6. Regressão completa e pacote Windows: resultados finais registrados abaixo.

Testes visuais adicionais cobrem pesquisa com acentos, paginação, filtros,
carregamento/erro/nova tentativa, respostas atrasadas de listar/obter, troca de ID
e entidade, descarte, IDs inválidos e foco por teclado. Falha de releitura após
sucesso não repete gravação; banco ocupado e resposta perdida na mudança de
situação reutilizam a intenção sem duplicar auditoria.

Capturas ficam em `.cache/ui`, incluindo listagem/linha compacta e editor/ações
dos dois cadastros. Matriz: 1366×768, 1000×700 e 640×480, zoom 100%, 125% e 150%.
As capturas de Perfumes continuam sendo geradas pela suíte anterior.

## Isolamento e distribuição

`test:ui` conserva banco, imagens e Chromium exclusivos e compara o hash do banco
de desenvolvimento. Fixtures e interceptações ficam em scripts/testes, excluídos
do ASAR. Produção mantém a API tipada, contextIsolation e sandbox habilitados,
nodeIntegration desabilitado e os dados fora da instalação.

O runner de smoke cria um diretório novo sob `.local-data/test`, prepara fixtures,
fecha o banco e inicia o Electron ou executável por caminho absoluto, com cwd
isolado. Após encerrar, reabre a base e compara os vínculos comerciais com o
snapshot anterior. O modo `--development` reinicia `scripts/dev.mjs`, a mesma
entrada de `npm.cmd run dev`, com raiz exclusiva permitida pelo mecanismo de
teste existente. Nenhum banco de desenvolvimento/produção é utilizado.

O smoke do executável usa a interface real para cadastro, edição, limpeza de
opcional e situação. Rede indisponível é emulada pelo mecanismo anterior; não
substitui instalação e ensaio offline em máquina limpa.

## Problemas encontrados e corrigidos

- O esbuild encontrou a restrição ACL conhecida da sandbox ao ler ancestrais.
  O build foi repetido com execução autorizada, sem alterar ACL ou segurança do app.
- A verificação TypeScript identificou a necessidade de testar a existência do
  registro confirmado antes de recuperar o estado da navegação; corrigido.
- Os novos executores precisaram de correções na asserção de rota/mensagem,
  criação explícita do diretório SQLite e espera pela renderização dos botões
  Angular. As rodadas finais repetem os cenários após essas correções.
- O cenário de leitura atrasada inicialmente tentava reabrir a mesma URL, que o
  Router corretamente ignora. O teste passou a sair da tela antes de atrasar sua
  próxima leitura, e confere também a troca de entidade com descarte protegido.
- Mensagens de resposta perdida no terminal são falhas deliberadamente injetadas
  no processo de teste. O resultado é validado pela repetição idempotente e pela
  conferência dos registros e da auditoria.

## Resultados finais

Validação em 02/11/2026, Windows 10 build 19045 x64, Node 26.13.0 e Electron 43.8.6:

| Verificação                                                      | Resultado                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                          | Aprovado                                                                                                |
| `npm.cmd run lint`                                               | Aprovado                                                                                                |
| `npm.cmd run format:check`                                       | Aprovado                                                                                                |
| `npm.cmd run build`                                              | Aprovado, Angular e Electron/preload                                                                    |
| `npm.cmd test`                                                   | 105 testes aprovados, integração e smoke desktop aprovados                                              |
| `npm.cmd run test:cadastros`                                     | Aprovado isoladamente e na suíte final, HTTP e mnr://app                                                |
| `npm.cmd run test:ui`                                            | DESKTOP_UI_OK, PESSOAS_EDITOR_OK e PESSOAS_LINKS_UI_OK                                                  |
| `npm.cmd run pack`                                               | Pacote Windows x64 gerado                                                                               |
| `node scripts/verify-package.mjs`                                | PACKAGE_ISOLATION_OK, 18 bundles de produção                                                            |
| `node scripts/smoke.mjs "release/win-unpacked/MNR Perfumes.exe"` | SMOKE_OK, PERFUMES_OFFLINE_OK, PESSOAS_OFFLINE_OK e PESSOAS_ISOLATED_OK                                 |
| `node scripts/smoke.mjs --development`                           | Entrada dev reiniciada; SMOKE_OK, PERFUMES_DEVELOPMENT_OK, PESSOAS_DEVELOPMENT_OK e PESSOAS_ISOLATED_OK |
| `git diff --check`                                               | Aprovado                                                                                                |

O pacote testado está em `release/win-unpacked/MNR Perfumes.exe`. A inspeção
confirmou a exclusão de scripts, testes e caches do ASAR. Capturas de Pessoas e
Perfumes foram inspecionadas visualmente; a matriz de overflow e teclado passou.

As comparações finais confirmaram ausência de alterações nas migrações, serviços
comerciais/financeiros/estoque, IPC, preload, DTOs cadastrais, package.json e
lockfile. A extração documental mantém a normalização dos comandos e, portanto,
a compatibilidade dos hashes idempotentes existentes.

## Arquivos criados e modificados

Criados:

- `shared/pessoa-values.ts`.
- `src/app/features/pessoas/contexto.ts`, `formulario.ts`, `pessoas.ts`,
  `pessoas.html`, `pessoas.scss`, `editor.ts`, `editor.html`, `editor.scss`.
- `src/styles/_catalog.scss`, `src/styles/_cadastro-editor.scss`.
- `scripts/pessoas-fixture.cjs`, `scripts/pessoas-ui.cjs`.
- `tests/pessoa-values.test.cjs`, `tests/pessoas-integridade.test.cjs`.
- Este relatório.

Modificados:

- `electron/services/catalog-validation.ts`: adaptação para a regra pura extraída.
- `electron/main/index.ts`: somente a ampliação do smoke existente.
- `src/app/core/navigation.ts`, `route-reuse.ts`: rotas, metadados e guardas.
- `src/app/shared/ui/confirm.ts`: mensagem opcional de erro na justificativa.
- SCSS de listagem/editor de Perfumes: importação dos parciais originais.
- `scripts/ui-desktop.cjs`, `scripts/smoke.mjs`: integração dos cenários e isolamento.
- `tests/catalogos.test.cjs`, `tests/angular/main.ts`: opcionais, validação e limites.
- `README.md`.

## Limites preservados

Não há controle otimista de versão cadastral; a releitura não garante exclusão
de atualizações concorrentes. OFFSET não oferece snapshot entre páginas.
Rascunhos e intenções do formulário permanecem em memória, sem recuperação após
encerramento abrupto; resultados idempotentes confirmados persistem no SQLite.

Windows 11, instalação/atualização NSIS e máquina limpa offline exigem ambiente
próprio. Não são declarados validados por esta entrega. Nenhum banco é recriado
como tratamento de erro. Não há exclusão física, autenticação ou serviço externo.
