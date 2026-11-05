# Etapa 4E.2-C — Correções de Vendas

## Entrega e fronteiras

Implementação exclusiva de devoluções parciais, integrais dos itens restantes e
cancelamento integral de vendas. Rotas `/vendas/:id/devolver` e
`/vendas/:id/cancelar`, acessíveis pelo detalhe da venda quando elegíveis.
O original permanece histórico; cada correção gera documento vinculado.

Produto e cliente inativos podem participar da correção de uma venda existente.
Nomes, SKU, preços, quantidades, descontos e custos apresentados são históricos.
O proprietário informa quantidade, unidades impróprias, data efetiva e um motivo
por nova operação. Não há edição da venda confirmada nem motivo para consultas.

Não foram disponibilizados pagamentos de reembolso, estornos financeiros,
estornos de devolução, correções de compras ou estornos de ajustes. 4E.2-D/E,
4F e 4G permanecem separadas. Migrações 0001–0005, dependências e lockfile foram
preservados. Nenhum commit ou push automático.

## Serviços reutilizados e preparação compartilhada

`createCorrectionService` continua responsável pela gravação da 3D:
`devolverVenda` e `cancelarVenda`. Reutiliza `comandoFinanceiro` para transação
IMMEDIATE, idempotência persistida, auditoria e reconciliação. O estoque usa
`aplicarMovimentoNaTransacao` e os triggers existentes; não há escrita direta
pelo Angular nem chamadas de ajuste para simular retorno ou perda.

A refatoração extraiu `prepararAbatimento`, que prepara os abatimentos e as
origens da obrigação sem inserir registros. A aplicação usa esse plano.
`prepararVenda` valida elegibilidade, quantidades acumuladas, data, condição
física e limites intermediários de estoque. Usa `reversaoAcumulada` da 3D e
prepara os movimentos históricos que são consumidos também na gravação.
Não foi criado outro algoritmo de custo ou de distribuição no renderer.

A assinatura e a normalização dos comandos legados continuam preservadas.
Os tipos de operação, versão 1 do hash, motivo normalizado e respostas
persistidas da 3D permanecem compatíveis. Um teste confirma uma intenção pelo
serviço legado e a repete pelo novo adaptador após mudanças de estado.

`createSaleCorrectionService` é a fronteira de revisão/confirmação. As consultas
existentes de `createFinancialQueryService` continuam responsáveis por contexto,
documentos corretivos, financeiro, obrigações e seus vínculos. O contexto ganhou
SKU e líquido históricos, data comercial e elegibilidade para cancelamento.

## IPC e segurança

Foram adicionados somente quatro métodos em `correcoes`:

- `revisarDevolucaoVenda` / `correcoes:revisar-devolucao-venda`.
- `devolverVenda` / `correcoes:devolver-venda`.
- `revisarCancelamentoVenda` / `correcoes:revisar-cancelamento-venda`.
- `cancelarVenda` / `correcoes:cancelar-venda`.

Os três métodos de consulta existentes foram preservados. Os DTOs públicos
ficam em `shared/correcoes-ipc.ts`, sem dependências de plataforma. Preload usa
métodos literais e canais fixos. O registro protegido existente valida
WebContents, frame principal e URL antes de acessar os handlers. Aridade,
campos permitidos, IDs/vínculos, inteiros/limites, datas reais, motivo, UUID v4
e impressão SHA-256 são validados. Pagamentos são recusados no DTO público de
devolução. Erros nativos são sanitizados; SQL, paths e auditoria interna não
integram as respostas.

Sandbox, contextIsolation, nodeIntegration desabilitado e CSP permanecem.
Não foi criado dispatcher genérico nem canal de escrita reservado à 4E.2-D.

## Revisão, concorrência e recuperação

As revisões usam transação de leitura; não criam documento provisório,
operação, auditoria ou movimentos e não dependem de gravação seguida de rollback.
O teste executa revisões com `query_only=ON` e compara todas as tabelas.

A impressão cobre operação normalizada, motivo, venda/versão/estado, itens,
correções, parcelas, recebimentos, alocações, abatimentos, obrigações/pagamentos
de reembolso e saldos/movimentos dos produtos da venda. A abrangência é
conservadora: mudança no estoque de qualquer produto da venda exige nova revisão.

Uma operação nova confere a impressão dentro da mesma transação IMMEDIATE que
invoca a gravação da 3D. Recebimento posterior, nova devolução, mudança de versão
ou estoque invalidam a revisão antes de qualquer efeito. UUID persistido delega
primeiro à idempotência da 3D, retornando a resposta original mesmo após mudanças
posteriores. Conteúdo diferente no mesmo UUID produz conflito.

O serviço Angular conserva UUID, modalidade e cópia imutável do comando e
compartilha a promessa durante envio simultâneo. Resposta incerta bloqueia edição,
navegação e fechamento; a repetição explícita usa a mesma intenção. Erros
corrigíveis preservam o preenchimento. Sucesso com falha da consulta permanece
sucesso e oferece somente nova leitura. Outra devolução começa uma intenção nova.

## Efeitos comerciais, físicos e financeiros

Devolução admite seleção de itens e quantidades restantes, inclusive devoluções
sucessivas. A ação integral preenche todas as quantidades ainda disponíveis.
Unidades impróprias geram `DEV_VENDA` e `PERDA_DEVOLUCAO` vinculados, na mesma
transação, com custo histórico igual e oposto. Somente unidades aptas permanecem
no saldo disponível. Cancelamento retorna integralmente as mercadorias conforme
a 3D, exige ausência de devolução efetiva anterior e orienta usar devolução quando
houver perda. Não há cancelamento parcial nem desfazimento de correção nesta UI.

Abatimentos atendem primeiro os saldos abertos na ordem inversa oficial das
parcelas. O excedente cria obrigação de reembolso com origens reservadas.
Recebimentos e entrada técnica não são apagados ou somados novamente.

O cenário obrigatório foi comprovado em serviço e Angular real:

| Informação                                   | Antes  | Após devolução de R$ 200 |
| -------------------------------------------- | ------ | ------------------------ |
| Original                                     | R$ 300 | R$ 300                   |
| Recebido (entrada R$ 100 + posterior R$ 150) | R$ 250 | R$ 250                   |
| Comercial líquido                            | R$ 300 | R$ 100                   |
| Saldo exigível                               | R$ 50  | R$ 0                     |
| Obrigação pendente criada                    | —      | R$ 150                   |
| Reembolso pago pela correção                 | —      | R$ 0                     |

A fixture altera a média atual após a venda e inativa/renomeia o produto e o
cliente. O retorno de duas unidades, uma apta e uma imprópria, mostra movimentos
`+1/+10`, `+1/+10`, `-1/-10` em unidades/centavos. O saldo cresce somente uma
unidade e 10 centavos, preservando o valor das demais unidades de média divergente.
Outro teste de vários itens conserva custos/líquidos em 33/34/33 centavos.

## Testes, ambientes e evidências

Todos os testes usam bancos, imagens, arquivos e Chromium exclusivos sob
`.local-data/test`. O executável recebe LOCALAPPDATA isolado apenas no processo
filho. Fixtures e injeções de falha não integram o ASAR.

Oito grupos em `tests/correcoes-vendas.test.cjs` cobrem leitura sem escrita,
devoluções mistas/sucessivas/integrais, vários itens, cancelamento permitido e
bloqueado, entradas inválidas e cruzadas, referências inativas, histórico,
concorrência, versão, resposta perdida, replay após reabertura e compatibilidade
legada. As proteções de remetente e o preload são exercitados também pela suíte
existente de consultas financeiras, agora sobre os quatro novos canais.

Falhas injetadas antes de inserir documentos, itens, estoque, abatimentos,
obrigações, origens de reembolso e auditoria comparam snapshots completos e
comprovam rollback. Workers com conexões independentes disputam revisões do mesmo
estado: um confirma, outro recebe VERSION_CONFLICT; replay concorrente do mesmo
UUID conserva exatamente os efeitos. Reabertura confere integridade e FKs.

O cenário Angular compartilhado usa links reais da venda, erros com associação
acessível, correção do excesso sem sair, invalidação de revisão, retorno impróprio,
devolução dos restantes, cancelamento permitido/bloqueado, consulta ao documento
e obrigação sem ação de pagar. Local/HTTP injetam recebimento concorrente,
rollback, resposta perdida após commit e falha de consulta após sucesso.

Tab, Shift+Tab, Enter, Escape, foco no diálogo e restauração ao botão são
exercitados com eventos nativos no Electron e CDP no executável. Capturas em
`.cache/ui/correcoes-{local,http,offline}-{formulario,revisao,resultado,cancelamento}-*.png`:
1366×768, 1000×700 e 640×480, zoom 100%, 125% e 150%, sem transbordamento
horizontal da página. As tabelas mantêm rolagem própria. No pacote, dimensões/zoom
são emulados por viewport/densidade; local/HTTP usam zoom nativo.

## Verificações finais em 05/11/2026

Ambiente: Windows 10 x64 build 19045, Node 26.13.0 e Electron 43.8.6.

| Comando                                             | Resultado comprovado                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                             | Aprovado                                                                                                |
| `npm.cmd run lint`                                  | Aprovado                                                                                                |
| `npm.cmd run format:check`                          | Aprovado; repetido após a documentação final                                                            |
| `npm.cmd run build`                                 | Angular, Electron e preload aprovados, também nas suítes e no pack final                                |
| `npm.cmd test`                                      | 136/136; integração cadastral HTTP/local e smoke desktop aprovados                                      |
| `npm.cmd run test:ui`                               | Aprovado; regressões completas e correções/reabertura, repetido após os ajustes finais                  |
| `npm.cmd run test:vendas`                           | 4/4 e cenário Angular de Vendas aprovados                                                               |
| `npm.cmd run test:financeiro`                       | 32/32, consultas, recebimentos e correções/reabertura aprovados                                         |
| `node --test tests/correcoes-vendas.test.cjs`       | 8/8; repetido após a última alteração desse teste                                                       |
| `node scripts/correcoes-ui-smoke.mjs --development` | Aprovado, incluindo falhas, teclado, foco e estoque na reabertura                                       |
| `npm.cmd run pack`                                  | Pacote Windows x64 final gerado com ASAR                                                                |
| `node scripts/verify-package.mjs`                   | PACKAGE_ISOLATION_OK; 43 bundles de produção                                                            |
| `node scripts/correcoes-package-smoke.mjs`          | CORRECOES_PACKAGED_OFFLINE_OK, REOPEN_OK e PERSISTENCE_OK                                               |
| `node scripts/compras-package-smoke.mjs`            | COMPRAS_PACKAGED_OFFLINE_OK                                                                             |
| `node scripts/vendas-package-smoke.mjs`             | Offline e reabertura aprovados                                                                          |
| `node scripts/financeiro-package-smoke.mjs`         | Offline, reabertura e snapshot somente leitura aprovados                                                |
| `node scripts/recebimentos-package-smoke.mjs`       | Offline e persistência após reabertura aprovados                                                        |
| `node scripts/smoke.mjs --development`              | Reinício real de desenvolvimento aprovado, com SMOKE_OK e Perfumes/Pessoas/Estoque em diretório isolado |

O pacote de correções reabriu em novo processo usando o diretório isolado
`.local-data/test/correcoes-package-TMRTWm`. Conferiu obrigação pendente de R$ 150,
recebidos de R$ 250, saldo zero, duas devoluções da venda principal, quantidade e
valor do estoque iguais ao fechamento anterior. Capturas representativas locais e
o cancelamento compacto offline foram inspecionados visualmente.

## Problemas encontrados e resolvidos

- O esbuild foi bloqueado por ACL da sandbox de automação. Build e desktop foram
  executados com autorização externa, preservando a segurança do aplicativo.
- A primeira fixture tentou mudar um SKU imutável; foi corrigida para preservar
  o SKU e alterar somente nome/ativo. Não houve mudança nas regras cadastrais.
- O primeiro cenário sucessivo tentou navegar à mesma URL ainda na tela de
  resultado. A interface ganhou a ação explícita de nova devolução, sem reusar UUID.
- A inspeção visual encontrou cabeçalhos comprimidos. A nova folha de estilos
  preserva cabeçalhos legíveis e largura dos campos, com rolagem apenas da tabela.
- O erro sem itens selecionados passou a ter associação ao grupo de itens e foco
  explícito; o cenário real verifica ambos.
- O primeiro smoke empacotado ficou preso na captura compacta. Seu watchdog fechou
  o executável, mas deixou uma promessa CDP pendente, encerrando com código 1.
  O harness ganhou timeout por chamada, rejeição de chamadas pendentes ao fechar,
  intervalo de renderização após mudar métricas e captura limitada ao viewport.
  A repetição completa passou, incluindo as 36 capturas e a reabertura.
- Mensagens de respostas perdidas são injeções deliberadas dos hosts local/HTTP.
  Mensagens de GPU ao encerrar HTTP não impediram saída zero e marcadores aprovados.

Nenhuma correção desses testes exigiu enfraquecer a segurança ou alterar migrações.

## Arquivos

Novos:

- `electron/services/correcoes-vendas.ts`.
- `src/app/core/correcoes.service.ts`.
- `src/app/features/vendas/correcao.ts`, `correcao.html` e `correcao.scss`.
- `tests/correcoes-vendas.test.cjs`.
- `tests/helpers/correcoes-ui-fixture.cjs` e `correcoes-worker.cjs`.
- `scripts/correcoes-scenario.cjs`, `correcoes-ui-desktop.cjs`,
  `correcoes-ui-smoke.mjs` e `correcoes-package-smoke.mjs`.
- Este relatório.

Modificados:

- `shared/correcoes-ipc.ts`.
- `electron/services/correcoes.ts` e `financeiro-consulta.ts`.
- `electron/ipc/financeiro.ts` e `electron/preload/index.ts`.
- `src/app/core/navigation.ts`.
- `src/app/features/vendas/editor.ts` e `editor.html`.
- `tests/cadastros-ipc.test.cjs` e `tests/vendas-ipc.test.cjs`.
- `scripts/financeiro-scenario.cjs` e `scripts/vendas-scenario.cjs`.
- `package.json` e `README.md`.

`test:ui` e `test:financeiro` incluem o novo smoke; `npm test` inclui os testes de
serviço/IPC pelo padrão existente. `test:correcoes` oferece execução específica.
As expectativas antigas de ausência de correções foram ajustadas, preservando
verificações de ausência das operações da 4E.2-D e 4G.

## Limitações e continuidade

Validação manual do proprietário permanece necessária antes de avançar. Windows 11,
instalação NSIS, máquina limpa fisicamente offline e leitor de tela não foram
ensaiados nesta entrega. A emulação offline não substitui esses ensaios.

Intenções pendentes ficam em memória, como nas etapas anteriores. Depois de um
encerramento forçado, consultar o histórico persistido antes de criar outra
operação; não existe fila persistida no renderer. A revisão não reserva estoque.
A reconciliação completa continua crescendo com o histórico; não se validaram
milhões de documentos. Não há novas dependências ou alterações de migração.

O planejamento separado da 4E.2 não foi encontrado em arquivo próprio. As
fronteiras foram conferidas nos relatórios A/B e no prompt completo autorizado
para esta entrega. A validação manual e commits das etapas anteriores informados
pelo proprietário prevalecem sobre pendências históricas dos relatórios antigos.
