# Etapa 4E.2-D — Reembolsos e Estornos

## Estado e autorização

Entrega exclusiva da 4E.2-D. Pagamento parcial/integral de reembolsos, estorno
individual de recebimentos e pagamentos, e estorno de devoluções de venda.
Não há novas operações de compras, estorno de ajustes, cancelamento parcial,
desfazimento de cancelamento integral, dashboard, relatórios ou 4E.2-E/4F/4G.

A sessão foi reconstruída por AGENTS.md, README, relatórios 3C/3D, 4E.1/A/B/C,
serviços, contratos, preload, handlers e componentes existentes. Não foi encontrado
planejamento separado em arquivo próprio; as fronteiras estão nos relatórios e no
prompt autorizado. Git inicialmente limpo, HEAD `e368459` (4E.2-C), precedido pelos
commits de Recebimentos e Consultas. A validação manual e os commits anteriores
foram informados pelo proprietário. Nenhum trabalho não commitado foi sobrescrito.

A implementação e as verificações automatizadas foram concluídas. A etapa aguarda
validação manual do proprietário. Migrações 0001–0005, lockfile e dependências permanecem intactos.
Não há novas tabelas, migrações, commit ou push.

## Funcionalidades e navegação

- `/financeiro/reembolsos/:id/pagar?vendaId=…`: obrigação ativa com saldo,
  valores originais/pagos/pendentes oficiais, cliente e correção históricos,
  múltiplas formas ativas com busca/paginação, data e motivo.
- `/financeiro/vendas/:vendaId/movimentos/:id/estornar`: estorno integral de um
  recebimento ou pagamento de reembolso. Exibe valor e forma históricos, datas,
  alocações, vínculos de original/estorno e elegibilidade.
- `/vendas/correcoes/:id/estornar?vendaId=…`: somente devoluções de venda.
  Apresenta itens históricos, efeitos físicos e financeiros, abatimentos,
  obrigações e dependências. Cancelamentos integrais não são estornáveis.

As ações partem dos detalhes existentes. Obrigações anuladas/quitadas não oferecem
pagamento. Documentos/movimentos bloqueados continuam visíveis e apresentam motivo
e links, sem botão operacional inválido. Resolver pagamentos dependentes é uma
sequência explícita de estornos individuais, nunca uma cascata automática.
Movimentações posteriores de estoque incompatíveis bloqueiam o estorno da devolução.

O fluxo é preenchimento → revisão oficial → diálogo explícito → resultado.
Campos e erros possuem associação acessível, foco no diálogo e retorno ao botão.
Alterações invalidam a revisão; falhas corrigíveis conservam os campos. Há proteção
de navegação/fechamento durante resultado incerto. Novo pagamento recebe outra
intenção, e uma consulta após sucesso nunca reexecuta gravação.

## Serviços, regras e refatorações

Os comandos da 3D continuam responsáveis pela gravação:
`createFinancialService.pagarReembolso`, `estornarRecebimento`,
`estornarReembolso` e `createCorrectionService.estornarDevolucao`.

Em `financeiro.ts` foram extraídas as normalizações de pagamento e estorno,
`prepararPagamentoReembolso`, `prepararEstornoFinanceiro` e `validarFormaAtiva`.
A distribuição por origens continua na ordem original; a preparação retorna o
plano de alocações consumido também pelo comando legado. A validação de natureza,
repetição, data e recebimento que sustenta correção é a mesma da 3D.

`resumoFinanceiro` passou a aceitar deltas internos de projeção, conservando sua
aritmética oficial. As chamadas existentes usam deltas zero. Acumulação/limites
seguros continuam inteiros com BigInt, sem REAL financeiro ou cálculo no Angular.
Parcelas previstas usam `situacaoParcela` existente.

Em `correcoes.ts`, `prepararEstornoDevolucao` compartilha validação de estado,
data, ausência de movimentos posteriores, pagamentos dependentes líquidos zero
e limites intermediários. A gravação usa sua sequência reversa dos movimentos
originais, com quantidade/custo opostos exatos. Não há ajuste manual para simular
estorno nem uso da média atual para substituir o custo histórico.

`estornos-elegibilidade.ts` usa essas preparações somente de leitura e projeta
motivos públicos conhecidos e vínculos de documentos, movimentos e estoque.
As consultas existentes de movimento/documento incluem esse resultado.
`reembolsos-estornos.ts` é a fronteira de revisão/revalidação e delegação tipada.

Tipos de operação, formato normalizado, versão/hash e respostas persistidas dos
comandos legados foram preservados. O vínculo público `vendaId` é validado contra
o alvo e removido antes de delegar à entrada legada. Testes confirmam pelo serviço
legado e repetem pelo novo IPC, inclusive após outras operações e reabertura.

## IPC e segurança

Foram adicionados exclusivamente oito métodos/canais fixos:

| Método                                   | Canal                                       |
| ---------------------------------------- | ------------------------------------------- |
| `financeiro.revisarPagamentoReembolso`   | `financeiro:revisar-pagamento-reembolso`    |
| `financeiro.pagarReembolso`              | `financeiro:pagar-reembolso`                |
| `financeiro.revisarEstornoRecebimento`   | `financeiro:revisar-estorno-recebimento`    |
| `financeiro.estornarRecebimento`         | `financeiro:estornar-recebimento`           |
| `financeiro.revisarEstornoReembolso`     | `financeiro:revisar-estorno-reembolso`      |
| `financeiro.estornarReembolso`           | `financeiro:estornar-reembolso`             |
| `correcoes.revisarEstornoDevolucaoVenda` | `correcoes:revisar-estorno-devolucao-venda` |
| `correcoes.estornarDevolucaoVenda`       | `correcoes:estornar-devolucao-venda`        |

DTOs públicos em `shared/financeiro-ipc.ts` e `shared/correcoes-ipc.ts`.
Preload possui métodos literais. Não há dispatcher genérico por operação recebida,
SQL, paths ou objetos internos de auditoria disponíveis ao renderer.

O registro protegido conserva WebContents, frame principal e URL autorizada antes
de acessar os handlers. Há validação de aridade, campos, IDs/vínculos, tipos de
movimento/documento, motivo, datas reais/não futuras, inteiros/limites, UUID v4 e
impressão SHA-256. Erros nativos são sanitizados. Angular continua usando somente
a API tipada, sem Electron, Node, SQLite ou filesystem. Sandbox, contextIsolation,
CSP e nodeIntegration desabilitado permanecem.

## Revisão, concorrência e idempotência

As quatro revisões usam transação de leitura. Não inserem operações, movimentos,
documentos provisórios ou auditoria e não simulam por gravação/rollback.
Foram exercitadas com `query_only=ON` e comparação integral das tabelas.

A impressão inclui comando normalizado, motivo, modalidade fixa, venda/versão,
correções, parcelas, movimentos, alocações, abatimentos, obrigações/origens,
pagamentos/estornos e saldos/movimentos dos produtos da venda. Pagamentos também
incluem formas atuais e seu estado. Essa abrangência é conservadora: uma mudança
no estoque de um produto da venda pode exigir revisar novamente mesmo um pagamento.

UUID novo confere a impressão e refaz a preparação dentro da mesma transação
IMMEDIATE da gravação legada. Alterações concorrentes de recebimentos,
pagamentos, correções, formas ou estoque rejeitam a revisão antes de gravar.
UUID persistido delega à idempotência da 3D, sem exigir que o saldo atual ainda
seja o da revisão. Conteúdo diferente no mesmo UUID é rejeitado.

O Angular conserva UUID, modalidade e cópia imutável do comando, compartilha a
promessa em envio simultâneo e exige repetição explícita após resposta incerta.
Os testes com duas conexões independentes comprovam um pagamento vencedor e um
VERSION_CONFLICT para revisões do mesmo estado, e resposta igual no replay
concorrente de um único UUID, sem novos efeitos.

## Evidências financeiras e físicas

Cenário obrigatório, usando serviços oficiais e Angular real:

| Momento                                                             | Comercial líquido | Recebido bruto | Pago líquido da obrigação | Pendente da obrigação |
| ------------------------------------------------------------------- | ----------------- | -------------- | ------------------------- | --------------------- |
| Venda R$ 300, entrada R$ 100 + recebimento R$ 150, devolução R$ 200 | R$ 100            | R$ 250         | R$ 0                      | R$ 150                |
| Pagamento parcial R$ 100                                            | R$ 100            | R$ 250         | R$ 100                    | R$ 50                 |
| Estorno desse movimento R$ 100                                      | R$ 100            | R$ 250         | R$ 0                      | R$ 150                |
| Pagamento em Pix R$ 90 + dinheiro R$ 60                             | R$ 100            | R$ 250         | R$ 150                    | R$ 0                  |
| Estorno apenas do Pix de R$ 90                                      | R$ 100            | R$ 250         | R$ 60                     | R$ 90                 |
| Estorno do pagamento restante de R$ 60                              | R$ 100            | R$ 250         | R$ 0                      | R$ 150                |
| Estorno permitido da devolução                                      | R$ 300            | R$ 250         | R$ 0 (obrigação anulada)  | R$ 0                  |

O último passo restaura saldo exigível da venda em R$ 50. Pagamentos e seus
estornos permanecem históricos. Nenhum pagamento altera preço, abatimento ou
parcela original, nem duplica entrada.

Um recebimento posterior de R$ 100 dividido em R$ 60/R$ 40 é estornado somente
pelo movimento de R$ 60. O outro permanece íntegro e o saldo da venda cresce de
R$ 100 para R$ 160. A forma histórica do movimento foi renomeada/inativada na
fixture; a interface conserva seu nome original e o estorno continua permitido.

Devoluções aptas, mistas e integralmente impróprias são desfeitas pelos movimentos
originais, incluindo o par de retorno/perda em ordem reversa. A fixture usa custo
histórico de R$ 1 por unidade e entrada posterior de média divergente antes
da devolução. No retorno misto de duas unidades, o estorno remove exatamente uma
unidade apta e R$ 1, preservando os demais saldos. Produtos e cliente estão inativos.

## Testes e integridade

Onze grupos novos verificam o exemplo financeiro, parcial/integral/múltiplas
formas, obrigação quitada/anulada e originada por cancelamento, referências
inativas, datas/valores/vínculos inválidos, natureza errada, estorno duplicado e
de estorno, leitura sem escrita, dependências, estoque posterior, concorrência,
compatibilidade legada, resposta perdida/replay e reabertura.

A suíte existente de consultas/IPC valida preload e rejeição de remetentes,
frames, URLs, aridade e campos também nos oito canais novos. A contagem protegida
passou de 54 para 62 canais. As expectativas antigas de ausência das operações
4E.2-D foram atualizadas; ausência de compras/ajustes continua verificada.

Falhas injetadas em movimentos financeiros, alocações de recebimento/reembolso,
documentos, itens, estoque, abatimentos e auditoria comparam snapshots integrais.
Não há alteração direta da obrigação imutável: o estado do documento controla
sua vigência, e as alocações controlam os pagamentos. Rollback preserva ambos.
Não foram criadas parcelas novas para simular reversão.

O cenário Angular compartilhado percorre links reais, erros corrigíveis, revisão,
confirmação, dependências e históricos. Local/HTTP injetam pagamento concorrente,
rollback em alocação, perda de resposta após commit e falha de consulta após
sucesso. As intenções repetidas são comparadas integralmente e o contador de
escritas comprova que repetir consulta após sucesso não grava novamente.

## Verificações finais em 05/11/2026

Ambiente: Windows 10 x64 build 19045, Node 26.13.0, Electron 43.8.6.
Todos os resultados aprovados abaixo correspondem às versões finais dos cenários
afetados. Após as falhas da suíte visual, ela foi repetida integralmente.

| Comando                                              | Resultado real                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                              | Aprovado                                                                                |
| `npm.cmd run lint`                                   | Aprovado                                                                                |
| `npm.cmd run format:check`                           | Aprovado; repetido após o relatório final                                               |
| `npm.cmd run build`                                  | Angular, Electron e preload aprovados, também nas suítes e pack finais                  |
| `npm.cmd test`                                       | 147/147; integração cadastral HTTP/local e smoke desktop aprovados                      |
| `npm.cmd run test:ui`                                | Aprovado após sincronização do harness; todos os módulos e reaberturas                  |
| `npm.cmd run test:vendas`                            | 4/4 e VENDAS_UI_OK                                                                      |
| `npm.cmd run test:financeiro`                        | 43/43; consultas, recebimentos, correções e novos reembolsos/estornos com UI/reabertura |
| `npm.cmd run test:correcoes`                         | 8/8 e CORRECOES_UI_OK/REOPEN_OK                                                         |
| `node --test tests/reembolsos-estornos.test.cjs`     | 11/11 após a última edição do teste                                                     |
| `node scripts/reembolsos-ui-smoke.mjs --development` | REEMBOLSOS_SCENARIO_OK, UI_OK e REOPEN_OK                                               |
| `npm.cmd run pack`                                   | Pacote Windows x64 com ASAR gerado                                                      |
| `node scripts/verify-package.mjs`                    | PACKAGE_ISOLATION_OK; 45 bundles de produção, sem scripts/fixtures de teste             |
| `node scripts/reembolsos-package-smoke.mjs`          | OFFLINE_OK, REOPEN_OK e PERSISTENCE_OK                                                  |
| `node scripts/compras-package-smoke.mjs`             | COMPRAS_PACKAGED_OFFLINE_OK                                                             |
| `node scripts/vendas-package-smoke.mjs`              | Offline e reabertura aprovados                                                          |
| `node scripts/financeiro-package-smoke.mjs`          | Offline, reabertura e snapshot somente leitura aprovados                                |
| `node scripts/recebimentos-package-smoke.mjs`        | Offline e persistência/reabertura aprovados                                             |
| `node scripts/correcoes-package-smoke.mjs`           | Offline e persistência/reabertura aprovados                                             |
| `node scripts/smoke.mjs --development`               | Reinício real de desenvolvimento, SMOKE_OK e Perfumes/Pessoas/Estoque aprovados         |

O pacote de reembolsos reabriu em novo processo no diretório isolado
`.local-data/test/reembolsos-package-FqSApk`. Conferiu comercial líquido R$ 300,
saldo a receber R$ 50, reembolso pendente zero, obrigação original anulada pelo
estorno da devolução, dois documentos vinculados e quantidade/valor de estoque
iguais ao fechamento anterior. Os testes de serviço conferem integridade e FKs;
os hosts locais comparam o snapshot integral durante reabertura sem escrita.

Capturas reais em `.cache/ui/reembolsos-{local,http,offline}-*.png`:
36 por ambiente (pagamento, estorno financeiro, estorno de devolução e resultado),
totalizando 108. Foram exercitados 1366×768, 1000×700 e 640×480, zoom 100%, 125%
e 150%, sem transbordamento horizontal da página. Tabelas possuem rolagem própria.
Local/HTTP usam zoom nativo; o pacote usa emulação de viewport/densidade por CDP,
com rede emulada offline. Capturas representativas foram inspecionadas visualmente.
Tab, Shift+Tab, Enter, Escape, foco inicial e restaurado no diálogo, proteção de
saída e associação de erro ao campo foram exercitados nos cenários reais.

As execuções usam bancos, fotos/arquivos e Chromium exclusivos em
`.local-data/test`. O executável recebe LOCALAPPDATA isolado somente no processo
filho. Nenhuma base de produção/desenvolvimento foi usada como fixture. O ASAR
não contém os hosts de falha, workers ou scripts de cenário.

Mensagens de GPU ao encerrar alguns smokes não impediram saída zero e marcadores
aprovados. Não foram alteradas preferências gráficas ou de segurança para suprimi-las.

## Ocorrências durante a execução

As três primeiras execuções de `test:ui` pararam em pontos da suíte antiga:
`UnknownVizError` após Estoque, timeout ao aguardar a confirmação de situação em
Pessoas e timeout de diálogo de saída em Perfumes. O harness clicava sem aguardar
habilitação e avançava entre eventos antes da renderização/fechamento de diálogos.
A causa exata do erro nativo do compositor não foi determinada.

Somente `scripts/ui-desktop.cjs` foi estabilizado: aguarda botão habilitado,
sincroniza dois frames após eventos, acrescenta estado da tela aos timeouts e
repete apenas capturas com `UnknownVizError`, no máximo três vezes. Não repete
gravações, cliques comerciais ou asserções. Nenhuma regra cadastral ou segurança
do aplicativo foi alterada. A regressão completa foi executada novamente.

Mensagens de respostas perdidas nos novos hosts são injeções deliberadas após
commit, para comprovar recuperação idempotente. Não são erros reais da aplicação.
As execuções desktop/build usam autorização externa à sandbox de automação quando
necessário, preservando sandbox e isolamento do aplicativo.

## Arquivos

Novos:

- `electron/services/reembolsos-estornos.ts` e `estornos-elegibilidade.ts`.
- `src/app/core/reembolsos-estornos.service.ts`.
- `src/app/features/financeiro/operacao.ts` e `operacao.html`.
- `src/app/shared/ui/estorno-elegibilidade.ts`.
- `tests/reembolsos-estornos.test.cjs`.
- `tests/helpers/reembolsos-ui-fixture.cjs` e `reembolsos-worker.cjs`.
- `scripts/reembolsos-scenario.cjs`, `reembolsos-ui-desktop.cjs`,
  `reembolsos-ui-smoke.mjs` e `reembolsos-package-smoke.mjs`.
- Este relatório.

Modificados:

- `electron/services/financeiro.ts`, `correcoes.ts` e `financeiro-consulta.ts`.
- `electron/ipc/financeiro.ts` e `electron/preload/index.ts`.
- `shared/financeiro-ipc.ts` e `shared/correcoes-ipc.ts`.
- `src/app/core/navigation.ts`.
- `src/app/features/financeiro/detalhe.ts` e `detalhe.html`.
- `src/app/features/vendas/correcao.html` (orientação de pagamento atualizada).
- `tests/cadastros-ipc.test.cjs`.
- `scripts/financeiro-scenario.cjs`, `scripts/vendas-scenario.cjs` e `scripts/ui-desktop.cjs`.
- `package.json` e `README.md`.

`npm test` inclui os novos testes pelo padrão existente. `test:financeiro` e
`test:ui` incluem o recorte/cenário novo, em sequência. `test:reembolsos` oferece
execução específica. Não houve novas dependências.

## Limitações e continuidade

Obrigações da 3D não possuem vencimento/plano de parcelas de pagamento.
Antecipação não é uma modalidade distinta aplicável ao reembolso: pode-se pagar
uma obrigação existente a partir da data da correção, nunca em data efetiva futura.

As rotas de obrigação/correção mantêm o vínculo `vendaId` nos links, conforme a
arquitetura das consultas anteriores. URLs cruzadas são recusadas pelo backend.
Intenções incertas ficam em memória; após encerrar à força, consultar o histórico
persistido antes de criar outra operação. Não há fila de comandos no renderer.

A reconciliação completa e as verificações de dependências crescem com o histórico.
Não foi validada escala de milhões de documentos. A revisão não reserva recursos.
Windows 11, NSIS, máquina limpa fisicamente offline e leitor de tela dependem de
ensaios próprios. A emulação offline não substitui essas verificações.

Não avançar para 4E.2-E/4F/4G sem nova autorização. Aguardar validação manual do
proprietário após a entrega da 4E.2-D.
