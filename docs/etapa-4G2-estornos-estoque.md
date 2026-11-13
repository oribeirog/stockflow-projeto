# 4G.2 — Estornos de ajustes manuais de estoque

## Estado da execução

Implementação técnica e verificações automatizadas concluídas em 12/11/2026,
aguardando validação manual do proprietário. A bateria final executou 31 comandos
com saída 0: 191 testes gerais, dez específicos, regressões, três ambientes,
pack/ASAR e reabertura. Base inicial limpa em
`a839ff5` (4G.1), confirmada por status, diff e cinco commits recentes. A aprovação
manual anterior foi informada pelo proprietário. Nenhum trabalho não commitado
foi descartado; sem commit/push.

## Diagnóstico anterior às alterações

Lidos AGENTS e README, consultados relatórios 3A–3D, 4E.2-A–E e 4F.1–4F.4 e lido
integralmente o relatório da 4G.1. Conferidos serviços de estoque/custeio,
contagem, correções comerciais, financeiro/idempotência/auditoria, migrações e
triggers, contratos, handlers, preload, trust, Builder, telas e testes existentes.

Existem entradas manuais (`AJUSTE_ENTRADA`), saídas (`AJUSTE_SAIDA`), perdas
(`PERDA`) e contagem (`ESTOQUE_CONTAGEM`). Contagem gera ajuste positivo/negativo
somente pela diferença, com versão esperada; sobra exige custo total informado,
falta usa custeio oficial. Contagem sem diferença registra operação/auditoria,
sem movimento, mudança de saldo ou versão; não há movimento zero a estornar.
Portanto ajustes não são exclusivamente resultados de contagens.

A 3D já tem `createCorrectionService.estornarAjuste`, com tipo persistido
`CORRECAO_ESTORNAR_AJUSTE`. Ele usa movimento inverso histórico integral e não
cria documento comercial. Reutiliza `movimentacoes_estoque.movimentacao_origem_id`,
FK de produto/origem, operação e auditoria. O índice parcial único
`estoque_reversao_unica` impede segundo movimento de reversão da mesma origem.
Movimentos são imutáveis e os triggers atualizam saldo/versão atomicamente.
As estruturas existentes são suficientes: nenhuma migração nova é necessária.

## Regras e limite formal da persistência

Elegíveis: ajustes de entrada/saída e perda com operação manual correspondente
ou de contagem; sem estorno anterior e sem movimento posterior do mesmo produto.
Compras, vendas, devoluções, cancelamentos, perdas de devolução e reversões
comerciais não são ajustes elegíveis nesta API. Não há estorno de estorno nem
modalidade parcial. Produto inativo não impede o estorno elegível.

**A restrição de movimentos posteriores não é inventada na interface.** O serviço
3D, seu relatório e o trigger `estoque_correcao_validar` da migração 0004 exigem
ausência de movimentos posteriores do produto para reversões históricas, com
exceção específica de cancelamento de venda que não se aplica a ajustes.
Mesmo saldo físico suficiente não autoriza contornar essa proteção. Os casos C
e D do prompt são recusados no modelo vigente, sem restaurar o saldo antigo.
Movimentos de outros produtos não impedem o estorno. Permitir reversão após
movimento posterior exigiria revisão formal de custeio e autorização incremental
de schema; isso não é indispensável para entregar os estornos elegíveis atuais
e não foi implementado. Migrações 0001–0005 ficam intactas.

A reversão sempre usa quantidade/valor **opostos exatos do movimento original**:
entrada manual reverte por `REVERSAO_SAIDA`; saída/perda por `REVERSAO_ENTRADA`.
Não usa média atual ou valor arredondado da tela. O movimento soma seus deltas
ao saldo atual; não restaura um snapshot antigo. Preparação verifica quantidade,
valor, limites e saldo zero/valor zero usando BigInt. São preservados limites de
1 bilhão de unidades e 9 trilhões de centavos, resíduos, custos históricos de
vendas, compras, originais e auditoria. Não há movimento financeiro artificial.

| Exemplo                                                                   | Efeito oficial                                                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Base 10 unidades/R$ 10; contagem para 15 com custo total de sobra R$ 0,05 | Saldo 15/R$ 10,05; estorno −5/−R$ 0,05 resulta 10/R$ 10, sem usar a média corrente       |
| Base 10/R$ 10; perda de 4                                                 | Saída −4/−R$ 4; estorno +4/+R$ 4 restaura 10/R$ 10                                       |
| Entrada de 3 unidades por 1 centavo                                       | Reversão −3/−1 centavo termina exatamente em zero/zero                                   |
| Base 10, ajuste +5, saída posterior de 8                                  | Saldo 7 permanece 7; bloqueio formal por movimento posterior, nenhuma escrita            |
| Base 10, ajuste +5, saída posterior de 13                                 | Saldo 2 permanece 2; reversão recusada, sem negativo                                     |
| Ajuste negativo seguido de compra ou venda                                | Bloqueado pelo contrato vigente; custos de vendas e demais registros permanecem intactos |

## Preparação, revisão e confirmação

`prepararEstornoAjuste` e `normalizarEstornoAjuste` foram extraídos para
compartilhamento com o comando da 3D. Revisão somente leitura: não insere operação,
documento provisório, auditoria ou movimentos, nem simula escrita seguida de
rollback. Funciona com `query_only=ON`; os testes comparam todas as tabelas.

`estornos-estoque.ts` confere vínculo produto/movimento e proveniência manual,
projeta contexto, original, eventual inverso e até 20 movimentos posteriores,
com link para histórico completo paginado. Identificação do produto é **cadastral
atual**: ajustes manuais não persistem snapshot de nome/SKU. Não se reconstruiu
nome histórico por suposição. Quantidades, valores, datas e motivos são os
registros históricos persistidos.

Impressão SHA-256 cobre comando normalizado/motivo, produto, saldo/versão,
movimentos e operação original. Mudança do cadastro relevante ou estoque invalida
a revisão. Confirmação nova confere impressão e elegibilidade na transação
IMMEDIATE que delega à 3D. Escrita usa `aplicarMovimentoNaTransacao` e os triggers
existentes, com reconciliação, auditoria e resultado idempotente na mesma operação.

UUID já persistido passa pelo replay original antes de exigir elegibilidade atual:
retorna o mesmo resultado, mesmo depois de outros movimentos, sem duplicar nada.
Outro conteúdo na mesma chave conflita. O vínculo público produtoId é validado
e retirado antes de delegar ao comando legado. Tipo, forma normalizada, versão 1
do hash e resultado persistido da 3D permanecem compatíveis.

## IPC e segurança

Somente três métodos públicos em `window.mnrApi.estornosEstoque`:

| Método         | Canal                         | Entrada                                             |
| -------------- | ----------------------------- | --------------------------------------------------- |
| obterAjuste    | estornos-estoque:obter-ajuste | produtoId, movimentoId                              |
| revisarEstorno | estornos-estoque:revisar      | motivo, dados com produtoId/movimentoId/dataEfetiva |
| estornar       | estornos-estoque:estornar     | mesma entrada, UUID v4 e impressão SHA-256          |

A listagem reaproveita `estoque.listarMovimentacoes`, com identificação explícita
de ajuste manual e do original de uma reversão. Não há outra listagem redundante
ou dispatcher. Preload literal, aridade exata, objetos fechados, IDs/vínculos,
datas locais reais/não futuras, motivo, UUID/hash e erros sanitizados. Registro
protegido valida WebContents/frame principal/URL. Sem SQLite, Node ou filesystem
no Angular. CSP, sandbox, contextIsolation e nodeIntegration permanecem intactos.

## Angular e recuperação

Histórico de Estoque → Consultar ajuste/estorno → Motivo/data → Revisão oficial
→ Confirmação explícita → Resultado/inverso. Rota
`/estoque/:id/ajustes/:movimentoId`, recriada ao mudar registro, com guarda de saída.
Mostra original, contagem/origem manual, atual/previsto, impedimentos, inverso,
datas, motivo e movimentos posteriores; não expõe auditoria bruta ou SQL.

Reutiliza o Design System MNR, tema escuro, azul, Field, Button e Confirm.
Mudança relevante invalida revisão. Campos permanecem após erro corrigível.
Consulta após conflito preserva o preenchimento. Promessa compartilhada e UUID
por intenção evitam duplo clique; não há nova intenção automática após erro.
Resposta incerta conserva cópia privada e oferece repetir o mesmo comando,
bloqueando edição/navegação/fechamento normal. Replay consulta resultado
persistido sem nova gravação. Sucesso com falha de releitura continua sucesso.
Foco é restaurado após cancelar diálogo e conduzido à revisão/feedback.

Intenção fica em memória, como nas etapas anteriores. Encerramento forçado exige
consultar histórico persistido antes de criar outra intenção. Não se criou fila
persistente, backup ou recuperação automática de UUID após reinicialização.

## Testes e estado de retomada

Dez grupos específicos cobrem positivos/negativos/perdas/contagens, zero, centavos,
produto inativo/renomeado, bloqueio após movimento posterior inclusive compra/venda
reais, fontes comerciais recusadas, IDs cruzados, aridade/campos/datas/UUID/hash,
revisão obsoleta, compatibilidade legada, reabertura e concorrência com conexões
independentes. Falhas em inserção/vínculo do inverso, atualização do saldo,
auditoria e persistência da resposta comparam todas as tabelas e conferem rollback,
`integrity_check` e `foreign_key_check`. Não há documento comercial a inserir:
o corretivo formal é o próprio movimento com FK, operação e auditoria.

Smoke real cria contagem pela tela existente, entra pelo link do histórico,
valida motivo, revisa/confirma e consulta inverso. Inclui positivo/negativo,
duplo clique, perda de resposta após commit, falha de leitura após sucesso,
alteração oficial de estoque entre revisão/confirmação, bloqueio do ajuste
obsoleto e reabertura em processo novo. Injeções de falha são somente do harness
via debugger; nenhum hook é incluído no aplicativo.

Cada checkpoint compara estoque, resumo oficial 4F.1, quatro cartões de estoque
do Dashboard, XLSX e PDF de estoque gerados pelo aplicativo, incluindo situações
de falta/baixo, movimentos do período e ausência de faturamento/recebimento
artificial. Leitores independentes verificam arquivos após fechar o aplicativo.
Toda coleta de conferência compara snapshots integrais e usa query_only no host.

Dez testes específicos e a superfície de segurança passaram na bateria final,
incluindo os dois grupos acrescentados após a rodada inicial. A primeira tentativa encontrou erro
de ordem na expectativa do namespace; corrigido sem remover asserções. O primeiro
smoke falhou por redeclaração de `const ipc` no debugger; passou integralmente
após isolar o escopo da injeção. Logs em `.cache/4g2-*` preservam tentativas.

Executor `.cache/verify-4g2.ps1`, índice `.cache/4g2-final-results.json` e logs
`.cache/4g2-final-*.log`. Rodada de 23:22 a 23:41 (São Paulo), na versão final da
implementação. A comparação adicional dos movimentos do período foi executada
nos smokes específicos local/HTTP/pacote depois da última alteração do teste;
não houve alteração funcional depois do início da bateria. Não se usaram
resultados da 4G.1 para justificar a versão atual.

| Verificação                          | Resultado real                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| typecheck, lint, format:check, build | Passaram                                                                                         |
| npm.cmd test                         | 191/191, integração cadastral HTTP/local e smoke desktop passaram                                |
| test:ui                              | Passou integralmente, incluindo Compras e Estornos de Estoque                                    |
| test:vendas                          | 4/4 e UI passaram                                                                                |
| test:financeiro                      | 45/45 e fluxos visuais passaram                                                                  |
| test:correcoes                       | 8/8 e UI/reabertura passaram                                                                     |
| test:reembolsos                      | 11/11 e UI/reabertura passaram                                                                   |
| test:correcoes-compras               | 10/10 e UI/reabertura passaram                                                                   |
| test:consolidacao                    | 2/2 e ciclo integrado passaram                                                                   |
| test:relatorios                      | 10/10 e smoke passaram                                                                           |
| test:dashboard                       | 3/3 e smoke passaram                                                                             |
| test:exportacoes                     | 7/7 e 40 arquivos locais por leitores independentes passaram                                     |
| test:consolidacao-gerencial          | 9/9, checkpoints e 174 arquivos passaram                                                         |
| test:estornos-estoque                | 10/10, UI/reabertura, ledger, Dashboard e oito arquivos passaram                                 |
| pack                                 | Windows x64/unpacked com ASAR gerado                                                             |
| verify-package                       | PACKAGE_ISOLATION_OK: 50 bundles, bibliotecas/worker presentes e testes/scripts/caches excluídos |
| 4G.2 HTTP e pacote                   | Passaram, com reabertura e oito arquivos válidos por ambiente                                    |
| 4G.1 HTTP e pacote                   | Regressão passou, incluindo concorrência e reabertura                                            |
| Dashboard/Relatórios HTTP e pacote   | Passaram                                                                                         |
| Exportações HTTP e pacote            | 40 arquivos por ambiente passaram após fechar o aplicativo                                       |
| Smokes gerais HTTP e pacote          | Passaram                                                                                         |

Os três recortes 4G.2 finais validaram 24 arquivos de estoque (oito por ambiente)
com openpyxl, pypdf e pdfplumber. Não se considerou somente existência/tamanho.
O workbook/PDF refletem os mesmos DTOs oficiais, com precisão monetária e
histórico preservados. Não foram adicionados indicadores ou modelos de arquivo.

| Ambiente 4G.2                            | Banco/perfil isolado         | Evidências                                                         |
| ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| mnr://app                                | `ui-estornos-estoque-d0UXkl` | UI_OK, REOPEN_OK, quatro checkpoints e oito arquivos válidos       |
| HTTP Angular                             | `ui-estornos-estoque-spgwBF` | Mesmas verificações; erro de resposta/releitura somente no harness |
| Executável Windows/ASAR, offline emulado | `ui-estornos-estoque-aVAhmi` | UI_OK/REOPEN_OK, snapshots integrais, arquivos válidos após fechar |

Ambiente real: Windows 10 Pro x64, build 19045, Node 26.13.0, Electron 43.8.6.
Todos os bancos, perfis, imagens e arquivos de teste são novos/exclusivos sob
`.local-data/test`; LOCALAPPDATA é isolado apenas no processo filho empacotado.
Nenhum banco real foi fixture, apagado ou substituído. `query_only=ON` nas
conferências e snapshots completos demonstram ausência de escrita em consultas.

Tab, Shift+Tab, Enter, Escape, foco inicial/revisão/diálogo/retorno, motivo inválido,
estado de processamento e bloqueio após estorno foram testados. A matriz usa
1366×768, 1000×700 e 640×480 a 100%, 125% e 150%, com viewport/densidade CDP
equivalentes: não é teste de DPI físico. Não houve overflow horizontal da página.
Capturas representativas finais foram abertas para inspeção de textos, valores,
contraste e quebra dos nomes longos; tabelas mantêm rolagem própria.

- [Revisão oficial local](evidencias-4G2/revisao-local.png).
- [Formulário HTTP compacto](evidencias-4G2/formulario-http-compacto.png).
- [Original e regra de custeio no pacote](evidencias-4G2/ajuste-pacote.png).
- [Movimento inverso no pacote](evidencias-4G2/resultado-pacote.png).

Em interrupção, conferir índices/logs e timestamps, preservar arquivos e retomar
somente pendências. Logs sem código final não são aprovação. Resultados atuais
estão concluídos, sem dependência de processo de teste ainda aberto.

## Arquivos criados e modificados

Criados:

- `shared/estornos-estoque-ipc.ts`.
- `electron/services/estornos-estoque.ts`, `electron/ipc/estornos-estoque.ts`.
- `src/app/core/estornos-estoque.service.ts`.
- `src/app/features/estoque/estorno.ts` e `estorno.html`.
- `tests/estornos-estoque.test.cjs` e `tests/helpers/estornos-estoque-worker.cjs`.
- `scripts/estornos-estoque-smoke.mjs`.
- Este relatório e quatro capturas em `docs/evidencias-4G2`.

Modificados:

- `electron/services/correcoes.ts`: normalização/preparação compartilhadas;
  comando legado conserva tipo, hash e resposta.
- `electron/services/estoque-consulta.ts`: identificação de ajuste manual e
  origem da reversão, reutilizando uma leitura de operação por movimento.
- `shared/contracts.ts`, `shared/estoque-ipc.ts`, `electron/ipc/index.ts`,
  `electron/preload/index.ts`.
- `src/app/core/desktop.service.ts`, `src/app/core/navigation.ts`.
- `src/app/features/estoque/detalhe.html`: links no histórico existente.
- `tests/cadastros-ipc.test.cjs`, `scripts/cadastros-desktop.cjs`: superfície de
  87 handlers, três métodos novos literais e limpeza entre janelas de integração.
- `package.json`: recorte específico e inclusão do smoke em test:ui.
- `README.md`: funcionalidades efetivas e pendências futuras.

Sem diff em migrações 0001–0005, `domain/custeio.ts`, rateios, serviço financeiro,
trust, main, Builder ou lockfile. Sem dependências novas. Scripts, fixtures e
injeções de falha não entram no ASAR; índices e artefatos ignorados ficam em
`.cache`/`.local-data/test`, fora da instalação e do pacote.

## Limitações e checklist manual

- A proteção de movimentos posteriores é formal no schema existente; não foi
  flexibilizada nem mascarada como problema de automação.
- Produto mostra identidade cadastral atual, sem nome histórico inventado.
- Contagem sem diferença tem auditoria, sem movimento reversível nesta tela.
- Não há estorno parcial, estorno de estorno ou reversão comercial por esta API.
- Histórico entre chamadas não compartilha snapshot persistente.
- Testes usam bancos/perfis/arquivos isolados; offline emulado não equivale a
  máquina fisicamente sem rede. Windows 11, DPI físico e leitor de tela não foram
  validados nesta máquina. Pacote unpacked/ASAR não é instalador.

Homologar somente com dados fictícios: criar entrada/contagem, abrir ajuste,
conferir quantidade/custo original e previsto, cancelar diálogo e verificar foco,
confirmar, consultar inverso, tentar duplicidade, reabrir aplicativo, testar
produto inativo/renomeado, contagem sem diferença e bloqueio após compra/venda.
Conferir teclado, três tamanhos/zooms e valores em Dashboard/Excel/PDF.

4G.3 e Etapa 5 não implementadas. Sem novas dependências, contas a pagar,
pagamentos/reembolsos artificiais, alterações de snapshots ou commit/push.
