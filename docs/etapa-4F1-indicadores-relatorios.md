# 4F.1 — Indicadores gerenciais e consultas para relatórios

## Dicionário e decisões anteriores à implementação

Somente leitura. Não há Dashboard, gráficos, exportações, novas regras comerciais,
schema, índices ou caches persistentes. Base inicial limpa: commit `9a9adba`.
A–E foram aprovadas manualmente conforme informado pelo proprietário. Fontes:
relatórios 3A–3D/4A–4E.2-E, migrações 0001–0005, serviços e consultas oficiais.

### Fluxo comercial

Intervalo inclusivo `dataInicio`/`dataFim`, ISO local `AAAA-MM-DD`, máximo 366 dias.
Usa `documentos.data_comercial`, nunca converte essa competência para UTC.
Documentos originais VENDA confirmados, inclusive posteriormente ESTORNADOS,
representam venda ocorrida. Rascunhos/descartados não entram.

- Quantidade de vendas: número de originais com confirmação, na data comercial.
- Bruto: soma dos valores brutos históricos dos itens antes dos descontos.
- Vendas após descontos: soma dos valores líquidos históricos dos itens vendidos.
- Devoluções registradas: DEV_VENDA, inclusive posteriormente estornadas, na data própria.
- Cancelamentos: ESTORNO cuja origem é VENDA, na data própria.
- Estornos de devoluções: ESTORNO cuja origem é DEV_VENDA, na data própria.
- Devoluções efetivas do período = devoluções registradas − estornos de devoluções.
  Pode ser negativo em período com apenas estorno de uma devolução antiga.
- Faturamento comercial líquido do período = vendas após descontos − devoluções
  registradas − cancelamentos + estornos de devoluções. Não é dinheiro recebido.
- Unidades vendidas/devolvidas/canceladas/estornadas seguem o mesmo sinal/data.
  `unidadesDevolvidas` é o bruto dos retornos; `unidadesDevolvidasEfetivas`
  desconta os estornos na própria data, sem exigir derivação na interface.
- Séries diárias/mensais preenchem intervalos vazios com zero; mês é `AAAA-MM`.
- Ranking de produtos usa fluxo líquido de unidades ou valor, com ID como desempate.
  Nomes/SKU são snapshots da última venda original dentro do conjunto, não nomes atuais.
  Se o intervalo contém somente correções, usa o snapshot da última correção.
- Ranking de clientes usa a coorte de vendas originais no intervalo com comercial
  líquido **atual**, com nome histórico da última venda da coorte. Não é fluxo.
  Vendas sem cliente identificado não entram nesse ranking.

### Coorte de vendas e ticket

`listarVendas` seleciona originais pela data comercial; cada linha mostra original
e líquido **atual**, considerando correções efetivas no estado consultado,
independentemente da data em que ocorreram. Filtro de produto restringe aos itens
daquele produto, sem atribuir todo o valor da venda ao item selecionado.
Ticket médio da coorte = soma comercial líquida atual das vendas da coorte /
quantidade de vendas da coorte com comercial líquido estritamente positivo.
Canceladas/devolvidas integralmente (e vendas de valor zero) não entram no
denominador. Zero elegíveis retorna null, não divisão por zero. Arredondamento
half-up em centavos. O resumo separa esse ticket do faturamento de fluxo.

### Fluxo financeiro

`movimentos_financeiros.data_efetiva`, inclusive entrada registrada na confirmação.
RECEBIMENTO_CLIENTE é recebido bruto; ESTORNO_FINANCEIRO ligado a ele é estorno
de recebimento na data do estorno. Recebido líquido = bruto − estornado.
REEMBOLSO_CLIENTE é pagamento bruto; seu estorno vinculado é estorno de pagamento.
Pago líquido = pagamentos − estornos. Pagamento não reduz faturamento novamente.
Alocações, abatimentos e parcelas técnicas não são dinheiro adicional.
Forma é identificada por ID; cada linha preserva o nome histórico do movimento.
Agregação por forma distingue snapshots históricos renomeados do mesmo ID.

### Posições atuais

Resumo identifica `dataReferencia` local e `consultadoEm` UTC (instante, não
competência). Não reconstrói saldo histórico no último dia do intervalo.
O período do resumo filtra apenas os fluxos e a coorte; posições são atuais e
consideram todo o histórico. Cliente, quando informado, restringe ambas as partes.

- Parcelas: recebimentos líquidos de alocações e abatimentos líquidos da 3D;
  saldo/status seguem `situacaoParcela`. Vencida significa vencimento < hoje,
  não inclui hoje. Exigível = vencido + a vencer. ENTRADA quitada não é recebimento novo.
- Obrigações: ativas quando documento gerador está CONFIRMADO; pendente é original
  menos pagamentos líquidos vinculados às origens. Anuladas preservam histórico,
  exigível zero. Quitadas/pendentes contam somente ativas.
- Estoque: `saldos_estoque` atual, inclusive produtos inativos; valor persistido,
  sem recalcular média. Estoque mínimo é o campo formal `produtos.estoque_minimo`.
  Baixo é quantidade < mínimo; sem estoque é quantidade = 0; grupos podem se sobrepor.
  Listagem separa identificação cadastral atual de snapshots comerciais históricos.
- Movimentação de estoque é fluxo separado por natureza na data efetiva, com
  quantidade/valor assinados. Compra, venda, retorno e perda continuam separados;
  estornos mantêm sua natureza e referência. Não são snapshots históricos de saldo.
- Ranking de movimentação usa número de movimentos por produto, com ID como
  desempate. Unidades movimentadas somam módulos dos deltas físicos: retorno e
  perda vinculada são dois movimentos, não duas unidades disponíveis para venda.
  Identificação é cadastral atual, explicitamente `nomeAtual`/`skuAtual`.

### Custo e resultado

CMV histórico líquido do fluxo = custo dos itens vendidos − custo dos retornos
de devolução/cancelamento + custo dos estornos de devolução. Componentes inteiros
persistidos respeitam os resíduos acumulados da 3D; não reavaliar pela média atual.
Perda de impróprios = valor absoluto dos movimentos PERDA_DEVOLUCAO, descontados
os movimentos que os estornam, na data de cada movimento. Não somar novamente
o retorno impróprio ao CMV: ele já foi subtraído como devolução.
Resultado bruto comercial estimado = faturamento líquido − CMV líquido − perdas
líquidas de impróprios. Margem = resultado / faturamento, em pontos base inteiros,
arredondamento half-up simétrico. Faturamento <= 0 retorna margem null.
Não é lucro líquido: impostos, salários e despesas operacionais não estão completos.
Perdas manuais/ajustes aparecem no fluxo de estoque, não nesse resultado comercial.

### Limites e segurança

Agregados em centavos inteiros, soma com BigInt e rejeição se fora do intervalo
seguro de Number; percentuais em pontos base e ticket por divisão inteira BigInt.
Consultas por lote/agregação SQL, sem SELECT \* nem consulta individual por linha.
Paginação de 1–200, deslocamento até 1.000.000; totais do conjunto inteiro.
Ordenações fechadas, ID como desempate, IDs existentes validados, campos extras
rejeitados. Cada endpoint aceita apenas seus filtros declarados. Nenhuma consulta
SQL ou nome de operação arbitrária é recebido pelo IPC. Leituras em transação
consistente, sem escrita provisória, auditoria ou cache persistente.

## Estado da execução

Implementação e verificações automatizadas concluídas. Aguardando validação manual
do proprietário, sem avanço para 4F.2/4F.3/4F.4, 4G ou Etapa 5. Sem commit ou push.

## Implementação e fronteiras

`electron/services/relatorios.ts` executa leituras em transações consistentes.
`relatorios-sql.ts` contém fragmentos fechados de CTEs, com parâmetros vinculados.
As agregações de parcelas, abatimentos e pagamentos são feitas por lote. As séries
agrupam em SQL e preenchem somente os até 366 buckets em memória. Teste conta as
instruções preparadas para impedir crescimento por linha/dia. Não há `SELECT *`
nem varredura de histórico inteiro no JavaScript antes de filtrar/paginar.

`situacaoParcela` é chamada por funções escalares da conexão para os saldos/status.
`saldoReembolsoApurado(original,pagoLiquido)` foi extraída da função oficial
`saldoReembolso` em `financeiro.ts`; a chamada legada e o relatório usam a mesma
subtração BigInt e `dinheiro`, sem mudar entrada, hash ou resposta de comandos.
O restante da 3D permanece intacto. Valores de estoque e custo são os persistidos.

`mnr_rel_soma` agrega BigInt e retorna INTEGER SQLite, com rejeição fora do limite
seguro. Não usa SUM em REAL ou arredondamento em ponto flutuante. Funções são
locais à conexão, não alteram schema e funcionam com `query_only=ON`. Datas de
referência e registro da consulta capturam um único instante por leitura, inclusive
ao cruzar meia-noite. O laço de preenchimento usa limite temporal numérico para
terminar também no ano 9999; não compara ISO expandido do ano 10000 lexicograficamente.

### Métodos públicos

Cada nome abaixo corresponde a canal literal `relatorios:<nome-em-kebab-case>`,
handler específico, método literal de preload e método de `RelatoriosService`.
O registro protegido existente verifica WebContents/frame/URL antes do handler.
Todos exigem exatamente um objeto; desconhecidos/tipos/limites inválidos são rejeitados.

| Método                       | Filtros e semântica                                                            |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `obterResumoGerencial`       | Período e cliente; fluxos, coorte e posições atuais em blocos separados        |
| `obterSeriesVendas`          | Período, cliente, produto, DIARIO/MENSAL; fluxo comercial/custo/perda          |
| `obterSeriesRecebimentos`    | Período, cliente, forma, DIARIO/MENSAL; fluxos financeiros                     |
| `listarVendas`               | Período da venda, cliente, produto, página, DATA_DESC/VALOR_DESC; coorte atual |
| `listarProdutos`             | Período, cliente, produto, página, UNIDADES_DESC/VALOR_DESC; fluxo líquido     |
| `listarClientes`             | Período da venda, cliente, página; ranking do valor atual da coorte            |
| `listarMovimentos`           | Período efetivo, cliente, forma, natureza, página, DATA_DESC/VALOR_DESC        |
| `listarTotaisPorForma`       | Período efetivo, cliente, forma, página; agrupamento por ID e snapshot         |
| `listarContasReceber`        | Cliente, venda, vencimento de/até, situação, página; posição atual             |
| `listarReembolsos`           | Cliente, venda, situação, página; posição atual                                |
| `obterResumoEstoque`         | Período e produto; posição atual + movimentos do período separados             |
| `listarSaldos`               | Produto, ativo, TODOS/SEM_ESTOQUE/BAIXO, página, ID/QUANTIDADE_DESC/VALOR_DESC |
| `listarMovimentacaoProdutos` | Período, produto, página; número de movimentos DESC, ID como desempate         |

São 13 canais novos estritamente de leitura. O teste do registrador geral confere
75 canais, sem injetar o serviço opcional de fotografias; no main real somam-se
os cinco canais específicos de fotos, preservados nesta etapa.
Totais são do conjunto filtrado completo, independentemente da página.
No ranking de clientes a ordem é valor DESC, ID; contas ordenam por vencimento,
venda/ID; reembolsos por ID DESC; totais por forma por ID/nome histórico.

Não há exportação, dispatcher por nome de consulta recebido, SQL arbitrário,
auditoria de escrita ao consultar ou exposição de caminhos/objetos internos.
Erros públicos usam códigos conhecidos e mensagens de consulta sanitizadas.
Angular somente encaminha DTOs e trata indisponibilidade; não calcula indicadores.

## Casos e evidências já executados

Dez testes de relatórios passaram no recorte específico. Incluem:

- Venda R$ 300, entrada R$ 100, posterior R$ 150, devolução mista R$ 200,
  obrigação R$ 150, pagamento R$ 100, estorno e estorno de devolução.
  Comercial/saldo/reembolso conferem com `financeiro.obterVenda` e os detalhes.
  Inclui também Pix R$ 90 + dinheiro R$ 60, quitação e estornos individuais,
  mantendo R$ 60 pagos/R$ 90 pendentes após estornar somente Pix.
- CMV histórico R$ 1 líquido após retorno misto, perda R$ 1, resultado R$ 98;
  estorno restaura CMV R$ 3, perda zero e venda R$ 300/saldo R$ 50.
- Soma independente em testes das consultas oficiais de cada venda/parcela/obrigação,
  com várias modalidades, devoluções sucessivas, cancelamento e estorno individual.
- Custos históricos cumulativos de 2 centavos em 3 unidades: CMV remanescente
  1/1/0 após retornos de uma unidade, sem recalcular custo unitário.
- Coorte totalmente devolvida com ticket null; filtro de produto em venda com
  dois produtos retorna apenas o valor do produto; totais não mudam ao paginar.
- Produto, cliente e forma renomeados/inativados preservam snapshots. Estoque
  expõe identificação atual separadamente. Cliente inativo não bloqueia leitura.
- Devolução em outro dia e estorno no seguinte: fluxo próprio −R$ 100/+R$ 100,
  coorte/saldos atuais preservados. Virada de dezembro/janeiro com registros reais,
  registro UTC próximo da meia-noite, períodos vazios e calendário 0000/9999.
- Todos os endpoints em `query_only=ON`, snapshot integral antes/depois, chamadas
  repetidas/erros sem escrita; estouro de soma é recusado com segurança.
- Preload expõe somente métodos aprovados; todos os canais rejeitam remetente,
  frame e URL inválidos. Testes cobrem aridade, campos, tipos, IDs, filtros,
  ordenação, intervalos, paginação e falha SQL sanitizada.
- Vencimento de hoje é a vencer; parcela de ontem é vencida. Recebimentos
  parciais/integrais atualizam os contadores oficialmente. Estoque mínimo formal
  é conferido, distinguindo saldo zero e abaixo do mínimo.
- Electron real `mnr://app`, HTTP de desenvolvimento e executável ASAR offline
  emulado: todos os métodos tipados e reabertura do mesmo banco isolado passaram,
  com snapshot integral inalterado. Não há tela de relatórios criada para o teste.

A primeira regressão geral encontrou uma expectativa cadastral aplicada aos novos
canais. O teste passou a conferir a mensagem específica de relatório, preservando
as asserções de origem/aridade e ausência de operações. O recorte afetado passou
com 17 testes; a bateria final foi reiniciada após a correção. O host cadastral
também precisava remover os canais novos entre suas duas origens. A limpeza
usa arrays de valores por namespace, pois espalhar objetos sobrescrevia chaves
homônimas como `listarMovimentos`. O smoke passou nas duas origens após a correção.
Nenhuma proteção do registro de produção foi relaxada. Erros iniciais de
fixtures (compra de produto inativo e venda abaixo do custo sem motivo por item)
foram corrigidos nos testes, sem mudar validações comerciais.

## Arquivos criados/modificados

- `shared/relatorios-ipc.ts`: DTOs, filtros e 13 canais/métodos públicos.
- `shared/contracts.ts`: namespace tipado em DesktopApi.
- `electron/services/relatorios.ts`: validação, transações e projeções gerenciais.
- `electron/services/relatorios-sql.ts`: CTEs fechadas de eventos, coortes e posições.
- `electron/services/financeiro.ts`: extração escalar de saldo, usada também pelo legado.
- `electron/ipc/relatorios.ts`, `electron/ipc/index.ts`, `electron/preload/index.ts`:
  handlers específicos, registro protegido e métodos literais.
- `src/app/core/relatorios.service.ts`, `src/app/core/desktop.service.ts`: ponte Angular.
- `tests/relatorios.test.cjs`, `tests/helpers/relatorios-fixture.cjs`: fixtures isoladas
  e testes de indicadores, temporalidade, centavos, leitura e segurança.
- `tests/cadastros-ipc.test.cjs`: expectativa explícita dos 75 canais e namespace novo,
  sem remoção das asserções de origem/arity/erros anteriores.
- `scripts/cadastros-desktop.cjs`: limpeza dos canais entre origens no harness.
- `scripts/relatorios-scenario.cjs`, `scripts/relatorios-smoke.mjs`: comunicação real
  pelos métodos públicos, nas três origens, com reabertura e snapshot integral.
- `scripts/benchmark-relatorios.cjs`: volumes reais, consultas, mediana/p95 e checkpoints.
- `package.json`: `test:relatorios` e `benchmark:relatorios`, sem dependências novas.
- `README.md` e este relatório: estado efetivo, dicionário e evidências.

Migrações, lockfile, `electron/main/index.ts` e `electron/ipc/trust.ts` conferidos
sem diff. A única refatoração compartilhada é a extração equivalente documentada;
não há mudanças em comandos, hashes, formatos persistidos ou movimentos comerciais.

## Verificações finais

Executadas após o fechamento do contrato, incluindo unidades efetivamente
devolvidas. Índice final: `.cache/4f1-final-results.json`, 25 verificações,
todas com exit code 0. Logs `.cache/4f1-final-*.log`; execuções anteriores e falhas
permanecem nos logs `.cache/4f1-*`. Pipelines/hosts temporários em `.cache` são
somente de teste e não entram no ASAR.

| Comando                                                        | Resultado real                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm.cmd run typecheck`                                        | Passou, incluindo contratos e serviço Angular                                              |
| `npm.cmd run lint`                                             | Passou                                                                                     |
| `npm.cmd run format:check`                                     | Passou; repetido no fechamento documental                                                  |
| `npm.cmd run build`                                            | Passou                                                                                     |
| `npm.cmd test`                                                 | 159 testes, 159 passaram, zero falhas; cadastros nas duas origens e smoke desktop passaram |
| `npm.cmd run test:ui`                                          | Passou, todos os módulos e consolidação completa, teclado, foco, tamanhos/zoom existentes  |
| `npm.cmd run test:vendas`                                      | 4 testes e cenário real passaram                                                           |
| `npm.cmd run test:financeiro`                                  | 45 testes e cenários reais passaram                                                        |
| `npm.cmd run test:correcoes`                                   | 8 testes e cenário/reabertura passaram                                                     |
| `npm.cmd run test:reembolsos`                                  | 11 testes e cenário/reabertura passaram                                                    |
| `npm.cmd run test:consolidacao`                                | 2 testes e ciclo integrado/reabertura passaram                                             |
| `npm.cmd run test:relatorios`                                  | 10 testes e todos os métodos no Electron real/reabertura passaram                          |
| `npm.cmd run pack`                                             | Pacote Windows x64/ASAR gerado                                                             |
| `node scripts/verify-package.mjs`                              | 45 bundles de produção; scripts, testes, fixtures e caches excluídos                       |
| `node scripts/relatorios-smoke.mjs --development`              | Todos os 13 métodos por HTTP e novo processo, sem escrita                                  |
| `node scripts/relatorios-smoke.mjs --package`                  | Todos os 13 métodos no executável real, offline CDP e novo processo, sem escrita           |
| Seis `*-package-smoke.mjs` anteriores                          | Compras, Vendas, Financeiro, Recebimentos, Correções e Reembolsos passaram                 |
| `node scripts/smoke.mjs --development`                         | Passou; novo processo Electron/Angular com preload atualizado e dados isolados             |
| `node scripts/smoke.mjs release/win-unpacked/MNR Perfumes.exe` | Passou, incluindo Perfumes/Pessoas/Estoque                                                 |
| `node scripts/benchmark-relatorios.cjs --checkpoints`          | 50/200/500 vendas, todos os métodos, filtros e paginação medidos com código final          |

Mensagens de falhas injetadas após commit nos testes anteriores são esperadas.
Não são falhas de relatórios nem nova escrita de consulta. Não foram removidas
asserções financeiras para obter aprovação. A regressão preservou hashes,
respostas históricas, idempotência, concorrência, rollbacks e segurança anteriores.

## Benchmark final e problema do harness

Windows 10 build 19045 x64, Intel Core i7-7700 3,60 GHz, Node 26.13.0 e
SQLite 3.53.4 (verificado com `sqlite_version()` no driver instalado).
Fixtures geradas por serviços reais com compras, modalidades de venda, recebimentos
e devoluções. Um produto e um cliente compartilham histórico crescente; não é
ensaio de grande diversidade de produtos ou de milhões de documentos.

50/200/500 vendas correspondem a 99/399/999 parcelas e 51/201/501 movimentos
financeiros armazenados. Esse último número inclui um pagamento de compra, que
é corretamente excluído das consultas financeiras de clientes. O volume é
conferido por contagem de vendas reais antes de medir cada checkpoint.

Resultados brutos finais: `.cache/benchmark-relatorios.json`, `reusedCheckpoints=true`.
Cada consulta executa aquecimento e 20 amostras; mediana é a amostra ordenada de
índice 10, p95 a de índice 18. Inclui validação, preparação SQL, transação e DTO no
serviço principal. Não inclui IPC/renderização, partida do Electron ou geração
das fixtures. Consultas medidas com `query_only=ON`; sem índices/migrações novos.
Cache do SO não esvaziado, GC/carga do sistema não controlados. A medição final
ocorreu após os smokes, sem executar outra suíte simultaneamente.

| Consulta                        | 50: mediana/p95 ms | 200: mediana/p95 ms | 500: mediana/p95 ms |
| ------------------------------- | -----------------: | ------------------: | ------------------: |
| Resumo gerencial                |      3,187 / 3,981 |       7,918 / 9,982 |     18,004 / 20,943 |
| Série de vendas diária, 92 dias |      1,425 / 2,186 |      4,767 / 10,623 |       5,076 / 5,668 |
| Série financeira mensal         |      0,673 / 1,493 |       1,972 / 2,184 |       1,972 / 2,629 |
| Vendas, página de 25            |      1,374 / 2,337 |       3,601 / 5,768 |       6,975 / 8,785 |
| Ranking de produtos             |      1,192 / 1,275 |       2,642 / 4,076 |       4,848 / 5,737 |
| Ranking de clientes             |      1,473 / 2,133 |       3,393 / 3,831 |       7,432 / 7,985 |
| Movimentos financeiros          |      0,711 / 0,998 |       1,231 / 1,777 |       2,377 / 2,968 |
| Totais por forma                |      0,873 / 0,938 |       1,922 / 2,757 |       3,401 / 4,450 |
| Contas a receber                |      1,477 / 2,147 |       3,636 / 4,561 |       7,848 / 9,549 |
| Obrigações de reembolso         |      0,573 / 0,928 |       0,792 / 1,182 |       1,012 / 1,341 |
| Resumo de estoque               |      0,301 / 0,460 |       0,396 / 0,436 |       0,716 / 0,797 |
| Saldos de produtos              |      0,221 / 0,285 |       0,196 / 0,319 |       0,218 / 0,311 |
| Ranking de movimentação         |      0,308 / 0,365 |       0,562 / 1,085 |       0,946 / 1,117 |
| Última página de vendas         |      1,661 / 2,877 |       2,963 / 3,647 |       6,747 / 7,967 |
| Cliente/produto e valor DESC    |      1,375 / 1,989 |       3,306 / 6,786 |       6,456 / 8,533 |

Maior amostra final: 71,943 ms na série diária com 200 vendas; maior p95: 20,943 ms
no resumo com 500. Variações não monotônicas não provam aceleração com mais dados.
RSS após cada volume: 73.986.048 / 98.320.384 / 142.340.096 bytes; pico do processo
139.008 KiB (135,75 MiB). Inclui abertura/reconciliação dos bancos e alocações do
runtime, não é memória isolada de uma consulta nem prova de ausência de vazamentos.
O resultado não exige mudança estrutural neste recorte; volumes maiores e hardware
mais lento precisam de medição própria.

Um ensaio exploratório anterior, antes do contrato final e durante outras
verificações, registrou resumo com 500 vendas de mediana 17,967 ms, p95 213,372 ms
e máximo 435,913 ms. Foi preservado em `.cache/benchmark-relatorios-exploratorio.json`;
não foi tratado como garantia nem descartado para esconder variação. A repetição
final foi necessária por alterações do contrato e abrangeu todas as consultas.

O harness de geração ficou retido na criação do checkpoint de 500 usando
`db.backup`, após gerar os dados e medir consultas, com consumo observado próximo
de 9 GB. O processo foi identificado e encerrado isoladamente. A causa nativa não
foi conclusivamente isolada; não é evidência de erro nas consultas de produção.
Após encerrar o processo, o banco isolado foi preservado e reaberto. As 500 vendas
estavam confirmadas; inspeção, integridade/FKs e reconciliações passaram.

Checkpoints do harness passaram a usar `serialize()` em arquivo novo, com limite
de 50 MiB, fora da medição. A cópia de 500 tem 5.591.040 bytes. Um ensaio adicional
após executar consultas gerenciais comparou snapshots completos da origem e da
cópia e reabriu esta com integridade/FKs válidas:
`.cache/4f1-serialization.log`, `RELATORIOS_SERIALIZED_CHECKPOINT_OK`.
Não foram alterados backup/migração de produção; suas regressões passaram.

Os checkpoints de 50/200 eram válidos; a cópia consistente de 500 foi obtida do
banco isolado já confirmado. `--checkpoints` reabre os três volumes e mede o código
atual sem repetir comandos comerciais. Não é cache usado pelo produto.
Geração fora das medições: 2,258 s e 26,790 s para os dois primeiros incrementos;
a duração desse incremento de 500 não foi recuperada e permanece null. Não foi
substituída pelo tempo de outro ensaio. Nenhum banco existente foi apagado/recriado.

## Limitações e recomendações futuras

Não há saldo histórico de estoque/parcelas/obrigações por data de corte. Leituras
de posições usam o histórico completo atual; correções retroativas alteram a
competência de fluxo escolhida pelo proprietário. Para auditoria, as linhas de
movimento mantêm também data UTC de registro. Nenhum registro é deslocado por
converter a data comercial para UTC.

Os fluxos financeiros apresentados são de clientes ligados a vendas. Pagamentos
de compras e reembolsos de fornecedores não entram nesses recebimentos/reembolsos.
Fluxos físicos de compras aparecem no estoque. Não há DRE contábil ou lucro líquido.
Referências inexistentes são rejeitadas; referências existentes sem ocorrências
retornam conjuntos vazios/zero. Limite de 366 dias exige consultas separadas para
intervalos maiores. Ranking por valor não implica disponibilidade de estoque.

Para 4F.2: identificar visualmente fluxo, posição e coorte, exibir período e
dataReferencia/consultadoEm; não recalcular saldos/margens/ticket no Angular; usar
null para métricas sem denominador, sinais negativos para reversões de outros
períodos e paginação/totais oficiais. Não rotular faturamento como caixa ou margem
como lucro líquido. Anônimos não são clientes identificados no ranking.

Para 4F.3: exportar as mesmas consultas/DTOs e critérios, sem outra regra de cálculo.
Não inferir totais pela página. Definir futuramente consistência entre múltiplas
páginas exportadas se houver operações entre chamadas; cada chamada atual tem seu
próprio snapshot consistente. Não existe sessão de snapshot persistente para exportação.

4F.2/4F.3/4F.4, 4G e Etapa 5 não foram implementadas. Windows 11 próprio,
instalador/atualização/desinstalação NSIS, máquina fisicamente desconectada, leitor
de tela e assinatura digital continuam sem validação específica. Offline do pacote
é emulado; a entrega técnica depende dos resultados finais e validação manual.
