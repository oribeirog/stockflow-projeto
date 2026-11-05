# Etapa 4E.2-B — Recebimentos

Implementação para validação manual do proprietário. Somente recebimentos de uma
venda confirmada; sem operações visuais de correção, reembolso ou estorno.
Continua o [backend/IPC já implementado](etapa-4E2B-ipc-recebimentos.md), preservado
nesta execução.

## Interface e valores oficiais

A rota `/financeiro/vendas/:id/receber` é acessível por Contas a receber, detalhe
da parcela e resumo financeiro da venda, quando existe saldo. A entrada pela
parcela seleciona essa parcela em alocação manual. A modalidade automática
explica que considera todas as parcelas da venda, inclusive futuras.

O formulário mostra cliente histórico, inclusive inativo, venda, valor original,
saldo atual, parcelas e vencimentos. Permite parcial, integral, antecipação,
múltiplas formas ativas com pesquisa/paginação e alocação manual em várias
parcelas. Exige somente o motivo da operação financeira, uma vez.

| Informação                                              | Fonte no processo principal                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| Valor original e saldo da venda                         | `obterVenda().resumo`, projeção da 3D                              |
| Valores, saldos e situações das parcelas                | `listarParcelas` e `obterParcela`                                  |
| Total recebido, formas e distribuição automática/manual | `revisarRecebimento().plano`, `dados` e `formas`                   |
| Saldo anterior, saldo previsto e situação prevista      | `revisarRecebimento().resumo`, `saldoPrevistoCentavos` e `efeitos` |
| Resultado confirmado                                    | `registrarRecebimento().financeiro` e IDs dos movimentos           |
| Histórico e alocações persistidas                       | Consultas de venda, movimentos e seus detalhes da 4E.2-A           |

Angular converte texto monetário em centavos e valida sintaxe de campos; não
distribui dinheiro, soma saldos ou recalcula regras financeiras. A revisão oficial
mostra data, motivo, cliente, formas, valores alocados e saldos previstos antes
do diálogo de confirmação. Qualquer alteração dos dados invalida a revisão.

## Confirmação, segurança e recuperação

São utilizados os dois métodos tipados existentes:
`financeiro.revisarRecebimento({motivo,dados})` e
`financeiro.registrarRecebimento({operacaoId,motivo,dados,revisao})`.
Não foi criado outro canal, persistência no renderer ou acesso genérico a IPC.

A revisão usa transação de leitura, compartilhando normalização e preparação com
o serviço original. SHA-256 cobre comando normalizado, motivo, parcelas/saldos,
venda, movimentos, alocações, abatimentos, correções e formas. A confirmação nova
confere essa impressão dentro da mesma transação `IMMEDIATE` da gravação. Uma
mudança concorrente exige consultar e revisar novamente, preservando os campos.

UUID confirmado é tratado primeiro pela idempotência persistida da 3D: replay
devolve o resultado original, mesmo após mudanças financeiras posteriores. O
renderer mantém uma única intenção com UUID e cópia imutável do comando. Não há
fila, gravação automática ao reabrir ou repetição por falha de consulta.

Erros definitivos liberam correção/revisão. Resposta perdida ou resultado incerto
preserva a intenção, desabilita edição e protege navegação e fechamento; o replay
explícito reutiliza o mesmo comando. Uma confirmação bem-sucedida seguida de falha
de leitura mantém o sucesso visível e oferece somente nova consulta. O resultado
identifica os movimentos para navegação ao histórico.

Foram preservadas validações de WebContents, frame, URL, aridade, campos, IDs,
valores, vínculos, datas e formas; sandbox, contextIsolation, CSP e ausência de
Node no renderer. Migrações 0001–0005, contratos financeiros anteriores e serviços
de correção/reembolso/estorno permanecem sem mudanças adicionais.

## Cenários comprovados

No cenário visual principal, venda de R$ 300 com três parcelas de R$ 100:

| Operação                              | Recebido acumulado oficial | Saldo da venda | Efeito                                      |
| ------------------------------------- | -------------------------- | -------------- | ------------------------------------------- |
| R$ 50 na primeira                     | R$ 50                      | R$ 250         | Primeira com R$ 50 pendentes                |
| Outros R$ 50                          | R$ 100                     | R$ 200         | Primeira quitada                            |
| R$ 100 na segunda, vencimento em 2099 | R$ 200                     | R$ 100         | Antecipação sem novas parcelas              |
| R$ 60 Pix e R$ 40 dinheiro            | R$ 300                     | R$ 0           | Terceira quitada; cinco movimentos no total |

O teste consulta detalhes dos cinco movimentos e suas alocações. Também verifica
R$ 25 em cada uma de duas parcelas (ambas com R$ 75 restantes), cliente inativo,
e venda com entrada de R$ 100 mais recebimento de R$ 50 (recebido total R$ 150).

Local e HTTP exercitam valor zero, excesso, data inválida, soma manual incorreta,
alternância de modalidades, invalidação da revisão, forma desativada, mudança
concorrente, rollback em alocação, cliques repetidos, resposta perdida depois do
commit, replay com comando idêntico, proteção de saída e falha de consulta depois
de sucesso. Os testes de serviços/IPC abrangem também IDs de outra venda, limites,
conteúdo incompatível no mesmo UUID e rollback em movimentos, alocações e auditoria.

Cada execução usa banco, arquivos e perfil Chromium sob diretório isolado. Local
e HTTP fecham e iniciam outro processo, conferindo saldo zero, recebidos de R$ 300
e cinco movimentos, sem novas gravações.

## Verificações em 04/11/2026

Ambiente: Windows 10 x64, build 19045, Electron 43.8.6.

| Comando                                                | Resultado                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                | Aprovado                                                                                      |
| `npm.cmd run lint`                                     | Aprovado                                                                                      |
| `npm.cmd run format:check`                             | Aprovado; repetido após documentação                                                          |
| `npm.cmd run build`                                    | Aprovado, Angular e Electron                                                                  |
| `npm.cmd test`                                         | 128/128; integração Angular de cadastros nas duas origens e smoke desktop aprovados           |
| `npm.cmd run test:ui`                                  | Aprovado: UI base, Perfumes, Pessoas, Estoque, Compras, Vendas, consultas e recebimentos      |
| `npm.cmd run test:financeiro`                          | 24/24, consultas somente leitura e UI de recebimentos/reabertura aprovadas na repetição final |
| `npm.cmd run test:vendas`                              | 4/4 e UI de Vendas aprovadas                                                                  |
| `node scripts/recebimentos-ui-smoke.mjs --development` | Aprovado, incluindo falhas e reabertura                                                       |
| `npm.cmd run pack`                                     | Aprovado: Windows x64 com ASAR                                                                |
| `node scripts/verify-package.mjs`                      | Aprovado: 41 bundles de produção, sem artefatos de testes                                     |
| `node scripts/recebimentos-package-smoke.mjs`          | Aprovado: cenário completo offline e reabertura em outro processo                             |
| `node scripts/financeiro-package-smoke.mjs`            | Aprovado: consultas offline, reabertura e snapshot sem gravações                              |
| `node scripts/compras-package-smoke.mjs`               | Aprovado: regressão offline de Compras                                                        |
| `node scripts/vendas-package-smoke.mjs`                | Aprovado: regressão offline de Vendas e reabertura                                            |

`test:financeiro` foi atualizado para incluir testes históricos, consultas, novos
serviços/IPC e os dois smokes de interface. `test:ui` inclui o novo smoke no final,
em sequência. Os testes que disputam foco nativo foram executados sequencialmente.

Capturas reais em `.cache/ui/recebimentos-{local,http}-*.png`: revisão e resultado
nos tamanhos externos 1366×768, 1000×700 e 640×480, com zoom real 100%, 125% e
150%. Checagem de transbordamento horizontal da página e inspeção de capturas.
Tab, Shift+Tab, Enter e Escape nativos, foco de revisão e retorno após cancelar o
diálogo foram exercitados. Tabelas extensas mantêm rolagem própria.

No executável, `.cache/ui/recebimentos-offline-*.png` registra os mesmos nove
pares por emulação CDP de viewport/densidade, com a rede emulada offline. As
54 capturas de recebimentos ficam ignoradas pelo Git. Em local/HTTP o zoom é
`setZoomFactor` nativo; no pacote é emulação de viewport equivalente, sem alterar
preferências do usuário ou adicionar controles de teste ao executável.

O pacote iniciou outro processo com o mesmo diretório isolado
`.local-data/test/recebimentos-package-yJoPnV`, comprovando saldo zero,
R$ 300 recebidos e cinco movimentos. As falhas artificiais de resposta e leitura
são injetadas somente no host de teste local/HTTP; não há esses ganchos no ASAR.

## Problemas encontrados e corrigidos

- Tipagem de estado inicial de alocação: removida duplicação de propriedades.
- Novo recebimento na mesma URL: link não iniciava novo formulário quando a rota
  permanecia igual. A ação agora encerra o resultado e inicia um preenchimento
  limpo, sem recarregar página/componente nem reutilizar UUID.
- Validações sem orientação suficiente: handler mapeia apenas mensagens estáticas
  conhecidas de excesso, soma e vínculo/saldo da parcela; não expõe mensagens SQL.
- Dois problemas no novo teste foram corrigidos: codificação UTF-8 ao editar pelo
  PowerShell e emissão incompleta de Enter nativo. As execuções foram repetidas.
- Restrições da sandbox de automação impediram leitura no build e lançamento do
  Electron; repetidos fora dessa restrição, mantendo sandbox do aplicativo ativo.

## Arquivos

Novos nesta continuação: `src/app/features/financeiro/receber.ts`, `receber.html`,
`scripts/recebimentos-scenario.cjs`, `recebimentos-ui-desktop.cjs`,
`recebimentos-ui-smoke.mjs`, `recebimentos-package-smoke.mjs`,
`tests/helpers/recebimentos-ui-fixture.cjs` e este relatório.

Alterados nesta continuação: `src/app/core/financeiro.service.ts`,
`src/app/core/navigation.ts`, `src/app/features/financeiro/lista.html`,
`detalhe.html`, `electron/ipc/financeiro.ts` (somente mensagens públicas),
`package.json`, `README.md` e referência no relatório anterior.

Preservados do trabalho anterior: `electron/services/financeiro.ts`,
`electron/services/recebimentos.ts`, `electron/ipc/index.ts`,
`electron/preload/index.ts`, `shared/financeiro-ipc.ts`,
`tests/recebimentos.test.cjs`, `tests/recebimentos-ipc.test.cjs`, ajustes de
expectativas em testes IPC de cadastros/Compras/Vendas e cenários de scripts
Financeiro/Vendas. A lista completa pode ser conferida com `git status --short`.

## Limitações e próximos passos

Validação manual do proprietário permanece pendente. Windows 11, máquina limpa,
instalação NSIS e uso com leitor de tela não foram ensaiados nesta execução.
Os smokes automatizados complementam essa validação; não a substituem.
As intenções ficam somente em memória. Após encerrar à força, consulte o histórico
persistido; o aplicativo não recria uma operação de resultado desconhecido.

4E.2-C, D e E aguardam autorização separada. 4F segue Dashboard/Relatórios;
4G será proposta para Correções de Compras e Ajustes de Estoque. Nenhuma operação
dessas etapas foi implementada. Sem migrações, dependências, commit ou push novos.
