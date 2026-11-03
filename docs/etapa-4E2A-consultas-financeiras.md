# Etapa 4E.2-A — Consultas financeiras

## Escopo

Área Financeiro com contas a receber, detalhes de parcelas, resumo financeiro da
venda, movimentos/alocações, obrigações de reembolso e documentos corretivos.
Somente leitura. Não há recebimentos, pagamentos, devoluções, cancelamentos,
estornos, revisões operacionais ou hashes de novos comandos.

Migrações 0001–0005, contratos e serviços de escrita da 3D, dependências e lockfile
permaneceram intactos. Não houve commit ou push.

## Navegação

- `/financeiro` redireciona para `/financeiro/parcelas`.
- `/financeiro/parcelas` e `/financeiro/reembolsos`: filtros e páginas.
- `/financeiro/parcelas/:id`: saldo e histórico de abatimentos/alocações.
- `/financeiro/vendas/:id`: resumo oficial, movimentos e documentos vinculados.
- `/financeiro/vendas/:vendaId/movimentos/:id`: forma histórica, motivo,
  alocações e vínculos de estorno.
- `/financeiro/reembolsos/:id?vendaId=…`: obrigação e seus pagamentos/origens.
- `/vendas/correcoes/:id?vendaId=…`: devolução, cancelamento ou estorno de devolução
  já persistidos, com efeitos históricos no estoque e nas parcelas.

A venda confirmada possui link para o Financeiro. Há navegação para a venda
original, cadastro de cliente, parcelas, reembolsos e documentos de origem.
Os detalhes com IDs de venda e registro conferem o vínculo no processo principal;
URLs cruzadas são rejeitadas. A estratégia de rotas recria consultas quando muda
o registro e descarta respostas de componentes destruídos.

Clientes inativos continuam consultáveis. Nome do cliente, produto/SKU e forma
de pagamento usam snapshots históricos; a situação atual do cliente é indicada
separadamente. Venda cancelada continua visível com seus efeitos financeiros.

## IPC público

Todos os métodos recebem exatamente um argumento e retornam resultado tipado.

| Namespace    | Métodos exclusivamente de leitura                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `financeiro` | `listarParcelas`, `obterParcela`, `obterVenda`, `listarMovimentos`, `obterMovimento`, `listarReembolsos`, `obterReembolso` |
| `correcoes`  | `obterContextoVenda`, `listarDocumentos`, `obterDocumento`                                                                 |

São dez canais literais, sem SQL/dispatcher genérico no preload. Tipos públicos
independentes de plataforma ficam em `shared/financeiro-ipc.ts` e
`shared/correcoes-ipc.ts`. A projeção é `electron/services/financeiro-consulta.ts`;
os handlers de leitura são `electron/ipc/financeiro.ts`.

O registro existente valida WebContents, frame principal e URL/origem antes de
chamar handlers. Estes validam aridade, objetos, campos permitidos, IDs inteiros
seguros, enums, intervalos, datas reais e vínculos. Erros são sanitizados; não
expõem SQL, caminhos ou stacks. As mensagens de falha são de consulta, sem
instruir o usuário a repetir uma operação de gravação.

Context isolation, sandbox, nodeIntegration desabilitado, CSP e protocolo local
permanecem. Não foi criado outro caminho de persistência nem armazenamento
financeiro no renderer. Consultas não pedem justificativa e não exibem botões
operacionais reservados às próximas subetapas.

## Paginação e filtros

Parcelas: limite padrão 25, máximo 200, deslocamento de 0 a 1 bilhão. Filtragem
por cliente, venda, situação e vencimentos inclusivos. Ordenação por vencimento,
venda, número e ID. Vencimentos futuros são aceitos como filtros; datas efetivas
não são solicitadas por estas consultas.

O padrão é Em aberto. O filtro Parcialmente pagas também inclui parcelas vencidas
com recebimento parcial, preservando o status oficial VENCIDO e o indicador
parcial. A data de referência vem de `localDay(clock())` no processo principal;
vencimento igual ao dia de referência não é vencido.

SQL aplica os predicados de saldo e situação antes de LIMIT/OFFSET. Os registros
selecionados recebem os valores e status oficiais de `parcelasFinanceiras`.
Testes comparam os IDs de cada filtro contra o conjunto produzido pelo serviço
3D e verificam que a concatenação das páginas coincide exatamente com o conjunto
filtrado. Não é paginação de um conjunto completo no Angular.

Reembolsos: filtros por cliente/venda e ativas, pendentes, quitadas, anuladas ou
todas; ordenação por data da correção e ID. Documentos corretivos usam ID
decrescente. Movimentos usam cursor `aposId` crescente e podem ser restringidos
à parcela ou obrigação, sempre da mesma venda.

Cliente tem busca paginada incluindo inativos. O filtro de venda aceita o ID do
número VENDA-ID e é preenchido automaticamente pelos links da venda. Não há
totalizadores calculados de páginas incompletas.

## Origem dos valores

| Valor apresentado                                                                                                                                                 | Fonte no processo principal                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Original, devoluções/cancelamentos líquidos, comercial líquido, recebimentos brutos, estornos, abatimentos, saldo exigível, reembolsos pagos/estornados/pendentes | `resumoFinanceiro` oficial da 3D                                                                         |
| Recebido líquido                                                                                                                                                  | Recebimentos brutos menos seus estornos, calculado no processo principal                                 |
| Reembolso pago líquido                                                                                                                                            | Pagamentos brutos menos seus estornos, calculado no processo principal                                   |
| Valor original das obrigações ativas                                                                                                                              | Soma inteira com `total`, restrita às correções geradoras CONFIRMADAS                                    |
| Valores, saldo, status e indicador parcial da parcela                                                                                                             | `parcelasFinanceiras`, com data local oficial                                                            |
| Original da obrigação                                                                                                                                             | Registro imutável de `reembolsos_cliente`                                                                |
| Pagamentos e estornos por obrigação                                                                                                                               | `total` sobre as alocações vinculadas às origens da obrigação                                            |
| Saldo exigível da obrigação ativa                                                                                                                                 | `saldoReembolso` oficial                                                                                 |
| Obrigação anulada                                                                                                                                                 | Original e pagamentos históricos preservados; exigível zero porque a correção geradora está ESTORNADA    |
| Movimentos e alocações                                                                                                                                            | Registros imutáveis, forma histórica, auditoria da operação e referências explícitas de original/estorno |
| Quantidades e custos corretivos                                                                                                                                   | Itens e movimentos históricos vinculados, sem recálculo de custeio                                       |

`recebimentosEfetivosCentavos` do resumo interno representa recebimentos
registrados antes de subtrair estornos. A interface o rotula como bruto e mostra
o líquido separadamente. Alocações, abatimentos e parcela técnica de entrada não
são tratados como dinheiro adicional. O Angular somente converte filtros e
formata os valores retornados; não calcula saldos.

O cenário de R$ 300 com entrada R$ 100, recebimento posterior R$ 150, devolução
R$ 200, pagamento de reembolso R$ 100 e estorno desse pagamento apresenta:
comercial líquido R$ 100, recebido R$ 250, saldo exigível zero, obrigação ativa
R$ 150, pagamentos brutos R$ 100, estornos R$ 100 e reembolso pendente R$ 150.
As operações da fixture são preparadas pelos serviços existentes, fora do
renderer e exclusivamente em banco de teste; a interface apenas consulta.

## Testes e evidências

Novos testes agrupados em `tests/financeiro-consulta.test.cjs` verificam:

- Valores exatos contra os resumos 3D; entrada e parcela técnica à vista.
- Pendentes, parciais, quitadas, vencidas e vencidas parcialmente pagas.
- Filtros anteriores à paginação, ordenação determinística, limites e páginas vazias.
- Cadastros renomeados/inativos e snapshots históricos preservados.
- Devolução parcial com perda, cancelamento, reembolso ativo, quitado e anulado.
- Alocações, obrigações, movimentos e documentos originais/estornos vinculados.
- Entradas malformadas, datas inválidas, enums/IDs/limites e vínculos cruzados.
- Preload restrito aos dez métodos de leitura e rejeição de remetentes indevidos.
- Comparação integral das tabelas antes/depois e execução com `query_only=ON`.

O cenário de interface compartilhado percorre filtros, páginas, detalhes e
links; compara cada campo monetário do resumo renderizado; verifica erros,
recuperação, teclado/foco, seletores e recarga. O host confere snapshot integral
do banco antes/depois. São capturados quatro contextos em três dimensões e três
zooms, sob `.cache/ui/financeiro-*.png`.

O smoke do pacote prepara a fixture antes de iniciar o executável, usa CDP com
rede emulada offline e reabre outro processo sobre o mesmo banco isolado. Arquivos
de teste, scripts e fixtures não integram o ASAR.

Resultados comprovados nesta entrega, em Windows 10 build 19045 e Electron 43.8.6:

| Verificação                                 | Resultado                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Typecheck, lint e build                     | Aprovados                                                                                              |
| `npm.cmd test`                              | 123 testes aprovados; integração cadastral em HTTP e protocolo local e smoke geral aprovados           |
| `npm.cmd run test:ui`                       | `DESKTOP_UI_OK`, Compras, Vendas e `FINANCEIRO_UI_OK`                                                  |
| Financeiro local e HTTP de desenvolvimento  | `FINANCEIRO_SCENARIO_OK`, `FINANCEIRO_READ_ONLY_OK`, `FINANCEIRO_UI_OK`                                |
| `npm.cmd run pack`                          | Pacote Windows x64 gerado                                                                              |
| `node scripts/verify-package.mjs`           | `PACKAGE_ISOLATION_OK`, 39 bundles de produção                                                         |
| `node scripts/financeiro-package-smoke.mjs` | `FINANCEIRO_PACKAGED_OFFLINE_OK`, `FINANCEIRO_PACKAGED_REOPEN_OK` e `FINANCEIRO_PACKAGED_READ_ONLY_OK` |

O primeiro teste completo encontrou uma expectativa antiga de mensagem de erro
dos canais cadastrais aplicada aos novos canais financeiros; a expectativa foi
corrigida e os 123 testes passaram. Uma primeira execução visual parou em um
diálogo de saída de Perfumes; a repetição da suíte completa passou. Mensagens
`Test-only lost reply` são injeções deliberadas dos testes existentes.

A primeira tentativa do smoke empacotado foi bloqueada pela ACL do Windows na
sandbox de automação. A execução autorizada fora dessa sandbox passou com banco
e perfil isolados; as configurações de segurança do aplicativo não foram alteradas.
O teste offline usa emulação de rede; Windows 11, máquina fisicamente desconectada,
instalação NSIS e leitor de tela não foram testados. O executável não está assinado.

## Organização e pendências

Arquivos criados: `shared/financeiro-ipc.ts`, `shared/correcoes-ipc.ts`,
`electron/services/financeiro-consulta.ts`, `electron/ipc/financeiro.ts`,
`src/app/core/financeiro.service.ts`, os cinco arquivos em
`src/app/features/financeiro/`, `tests/financeiro-consulta.test.cjs`,
`tests/helpers/financeiro-consulta-fixture.cjs`, os quatro scripts
`scripts/financeiro-*` e este relatório.

Arquivos modificados: `README.md`, `package.json`, `shared/contracts.ts`,
`electron/ipc/index.ts`, `electron/preload/index.ts`, `src/app/core/desktop.service.ts`,
`src/app/core/navigation.ts`, `src/app/core/route-reuse.ts`,
`src/app/shared/ui/icon.ts`, `src/app/features/vendas/editor.ts` e `editor.html`,
`tests/cadastros-ipc.test.cjs`, `tests/compras-ipc.test.cjs`,
`tests/vendas-ipc.test.cjs`, `scripts/cadastros-desktop.cjs`,
`scripts/ui-desktop.cjs` e `scripts/vendas-scenario.cjs`.

- 4E.2-A: somente consultas desta entrega, aguardando validação manual.
- 4E.2-B: recebimentos; não implementada e sem autorização nesta rodada.
- 4E.2-C: correções de vendas; não implementada.
- 4E.2-D: pagamentos de reembolso e estornos; não implementada.
- 4E.2-E: consolidação da etapa completa; permanece separada.
- **4F:** reservada para Dashboard e Relatórios Excel/PDF.
- **4G:** proposta futura de Correções de Compras e Ajustes de Estoque: devolução
  de compra, cancelamento de compra e estorno de ajustes manuais, mediante aprovação.

Não se antecipam funcionalidades 4F/4G, backup visual, instalador ou integrações.
Históricos individuais de alocações/origens são carregados no detalhe; listagens
de parcelas, movimentos, obrigações e documentos são paginadas. Escala de milhões
de documentos não foi validada; a reconciliação completa existente na abertura
permanece intacta. Não foi alterado o serviço de escrita para preparar fases futuras.
