# 4F.2 — Dashboard visual gerencial

## Recuperação da execução interrompida

Retomada em 09/11/2026, sem reset, clean, descarte geral, commit ou push.
Antes de editar foram lidos AGENTS.md, README.md, o relatório da 4F.1, contratos,
serviços e os scripts relevantes. Foram examinados status, diff completo,
arquivos não rastreados e datas/tamanhos dos arquivos recentes. O Git exigiu
execução como proprietário devido à diferença de usuário da sandbox; nenhuma
configuração global de safe.directory foi alterada.

O estado encontrado já continha a implementação principal da interface, com
arquivos modificados entre 13:47 e 14:03 de 07/11/2026. Não foram encontrados
arquivos truncados, imports incompletos ou marcadores de conflito nesse recorte.
Não havia relatório 4F.2 nem atualização do README para a entrega. Os logs mais
recentes encontrados em .cache eram da 4F.1; nenhum teste da 4F.2 foi considerado
concluído por inferência. Nenhum processo node/electron foi encontrado na
inspeção inicial. As verificações foram executadas novamente.

Arquivos recuperados e preservados:

| Arquivo                                      | Estado e conteúdo encontrado                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/app/features/dashboard/dashboard.ts`    | Modificado; consultas oficiais, sinais, cartões, filtros e descarte de respostas antigas |
| `src/app/features/dashboard/dashboard.html`  | Modificado; interface completa, estados, rankings e navegação                            |
| `src/app/features/dashboard/dashboard.scss`  | Modificado; tokens MNR, grades e adaptação de largura                                    |
| `src/app/core/navigation.ts`                 | Modificado; descrição do Dashboard gerencial                                             |
| `package.json`                               | Modificado; test:dashboard e integração em test:ui, sem novas dependências               |
| `scripts/ui-desktop.cjs`                     | Modificado; substituição dos testes da demonstração antiga pelos controles reais         |
| `src/app/features/dashboard/chart.ts`        | Novo, não rastreado; gráfico SVG e tabela equivalente                                    |
| `src/app/features/dashboard/chart.scss`      | Novo, não rastreado; estilos do gráfico/tabela                                           |
| `src/app/features/dashboard/presentation.ts` | Novo, não rastreado; calendário local, validação e formatação                            |
| `tests/dashboard-presentation.test.cjs`      | Novo, não rastreado; três testes de calendário/formatação                                |
| `scripts/dashboard-test-main.cjs`            | Novo, não rastreado; host exclusivo para falha/atraso de IPC                             |
| `scripts/dashboard-smoke.mjs`                | Novo, não rastreado; ambientes local, HTTP e pacote, banco e perfil exclusivos           |
| `scripts/dashboard-scenario.cjs`             | Novo, não rastreado; cenário visual e financeiro integrado                               |

Após a retomada foram concluídos: correção de opção duplicada do cliente
selecionado, comparação automatizada dos dois rankings com as consultas oficiais,
sincronização da recarga e renderização do harness de UI, validações completas,
inspeção visual de capturas e documentação desta entrega.
A opção auxiliar do cliente agora aparece somente quando a seleção está fora da
página de resultados da pesquisa. O restante da implementação válida foi mantido.

## Interface e critérios

Usa Button, Card, ContentState, RouterLink e tokens existentes do Design System
MNR, sem biblioteca de gráficos ou dependência nova. Dashboard segue como rota
inicial e é carregado sob demanda. Os links levam às telas existentes de Vendas,
Financeiro, Clientes e Estoque; não prometem aplicar filtros nessas telas.

Os 13 cartões são:

- Comercial: faturamento líquido, vendas confirmadas, resultado bruto comercial
  estimado, margem bruta estimada e ticket médio da coorte.
- Financeiro: recebimentos líquidos do período, saldo a receber, total vencido e
  reembolsos pendentes atuais.
- Estoque: valor, unidades, produtos sem estoque e produtos abaixo do mínimo atuais.

Todos os valores, contadores, ticket, margem, CMV e saldos vêm dos DTOs oficiais
da 4F.1. Angular apenas formata moeda, quantidade e pontos-base e projeta
coordenadas dos gráficos. Não soma parcelas ou reconstitui regras financeiras.
Não há alterações no processo principal, preload, IPC, contratos, migrações
0001–0005, lockfile ou serviços financeiros.

Oito consultas de relatórios compõem cada atualização: resumo gerencial,
séries comerciais/recebimentos, rankings de produtos/clientes, resumo de estoque
e listas de produtos abaixo do mínimo/sem estoque. O cadastro oficial de clientes
é pesquisado em páginas de 25, consultando um item adicional para indicar próxima
página. Inclui clientes inativos. Estoque sempre inclui todos os produtos.

Mês atual vai do primeiro dia até hoje; últimos 30/90 dias incluem hoje e os
29/89 dias anteriores. Período personalizado aceita até 366 dias inclusivos e
valida calendário, ordem e campos vazios antes da consulta. A competência local
não é convertida em UTC. Séries podem ser diárias ou mensais.

Faturamento segue o fluxo na data comercial de vendas/correções. Recebimentos
seguem a data efetiva do dinheiro. Ticket e ranking de clientes usam o líquido
atual da coorte de vendas do período, inclusive correções posteriores. Contas,
reembolsos e estoque são posições atuais de todo o histórico. A interface exibe
período, data de referência e instante de consulta, distinguindo essas naturezas.
As chamadas têm snapshots independentes; não há snapshot único das oito leituras.

Margem/ticket sem denominador são “Não aplicável”. Valores negativos são
preservados. Resultado bruto estimado não é lucro líquido. A diferença entre
vendas e recebimentos não é apresentada como inadimplência. Vendas anônimas
nunca aparecem como clientes identificados no ranking.

Produtos são os cinco primeiros por unidades líquidas decrescentes, ID como
desempate; clientes são os cinco primeiros por valor líquido atual decrescente,
ID como desempate. Nomes históricos são mantidos. Listas de alerta de estoque
usam cadastro atual, cinco primeiros por ID e informam existência de mais itens.
Não se inferem totais a partir dessas páginas. Produto com quantidade zero e
mínimo positivo pode aparecer em ambos os alertas.

## Estados, navegação e acessibilidade

Atualizar/Aplicar filtros consultam um novo conjunto; carregamento remove os
indicadores anteriores. Falha em qualquer consulta impede exibir um conjunto
parcial, oferece nova tentativa e não deixa indicadores antigos sob filtros
novos. Cada atualização tem sequência própria; respostas antigas ou recebidas
após sair da tela são ignoradas. Pesquisa de clientes tem sequência independente,
carregamento, erro, nova tentativa e paginação. Ausência de movimentos informa
que posições atuais ainda podem ter saldo; rankings e alertas têm estados vazios.

Controles possuem rótulos nativos, datas inválidas têm aria-invalid e mensagem
associada, estados são anunciados e o foco visível vem do Design System.
Gráficos locais SVG têm nome acessível, eixos em reais/competência, linha zero,
sinais negativos e tabela completa expansível por teclado. Não dependem apenas
da cor nem de hover. Não há animação nova. As grades se adaptam à largura; tabelas
podem rolar dentro da própria região sem transbordar a página.

## Verificações e evidências

Ambiente: Windows 10 build 19045 x64 e Node 26.13.0.
Resultados finais são registrados em `.cache/4f2-final-results.json`, com logs
individuais `.cache/4f2-final-*.log`. O pipeline exclusivo de validação fica em
`.cache/verify-4f2.ps1`. Esses artefatos são ignorados e não entram no pacote.
O primeiro build dentro da sandbox falhou por acesso negado aos diretórios;
a repetição autorizada fora da sandbox compilou e executou o teste desktop.
Mensagens de falha de IPC injetada são esperadas nos cenários de recuperação.

A primeira bateria geral de UI atingiu o timeout de 180 segundos no trecho de
recarga offline após os controles do Dashboard. O registro foi preservado em
`.cache/4f2-initial-test-ui-timeout.log`, com resultado 1, e o índice inicial em
`.cache/4f2-initial-results.json`. O harness passou a aguardar did-finish-load
antes de consultar o novo documento e também aguarda os indicadores após a
recarga. Isso evita consultar o Dashboard antigo e agendar um frame num contexto
prestes a ser destruído. A mudança é exclusiva do teste; preserva as asserções
de offline, segurança, navegação e dados. A causa de baixo nível do bloqueio não
foi isolada. A execução isolada corrigida encerrou com DESKTOP_UI_OK, incluindo
recarga offline e navegação posterior, conforme `.cache/4f2-ui-reload-check.log`.
Uma repetição geral teve novo timeout em outro ponto, durante a confirmação de
situação cadastral de cliente; log `.cache/4f2-second-test-ui-timeout.log`.
O harness passou também a desativar background throttling apenas na janela de
teste e a limitar cada avaliação a dez segundos, indicando a expressão bloqueada.
Isso mantém animation frames ativos quando outra janela encobre a automação.
Não foram alteradas as preferências de produção ou removidas asserções.
A repetição integral com o harness final passou, incluindo todos os módulos
anteriores, recarga offline e Dashboard. Os dois timeouts anteriores permanecem
documentados; a aprovação final usa o log completo e código de saída 0.

Os testes específicos verificam:

- Calendário real, ano bissexto, limite de 366 dias, datas invertidas/vazias,
  extremos 0000/9999, virada do ano e presets inclusivos em calendário local.
- Formatação dos pontos-base oficiais, inclusive null e negativos.
- Treze cartões, séries e rankings comparados aos DTOs oficiais pelo preload real.
- Banco vazio, venda de R$ 300 com entrada R$ 100, recebimento posterior R$ 150,
  devolução mista R$ 200, obrigação R$ 150, pagamento R$ 100 e respectivos estornos.
- Modalidades à vista/a prazo, correção em outro dia, fluxo negativo, ticket/margem
  null, nomes históricos após renomear/inativar e seleção de cliente inativo.
- Filtros, agrupamentos, ausência de dados, falha/nova tentativa, carregamento e
  resposta atrasada que não pode substituir o filtro atual.
- Navegação pelos links reais, Tab/Shift+Tab, Enter na tabela, foco visível,
  ausência de Node no renderer e reabertura do mesmo banco em novo processo.
- Snapshot integral do banco antes/depois das consultas, inclusive falhas.
  Somente os serviços de fixture alteram dados entre checkpoints.

Capturas em `.cache/ui/dashboard-{local,http,package}-*.png`: visão geral,
comercial, séries, rankings e estoque nas larguras 1366×768, 1000×700 e 640×480,
com fatores 100%, 125% e 150%; também vazio, inválido, erro, carregamento,
referência, negativo e tabela. O smoke específico emula viewport/escala via CDP;
o teste de UI geral mantém sua matriz de janela/zoom Electron real. Asserções
conferem ausência de transbordamento horizontal de documento e conteúdo.

| Comando                                                        | Resultado                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                        | Passou                                                                                                          |
| `npm.cmd run lint`                                             | Passou                                                                                                          |
| `npm.cmd run format:check`                                     | Passou; repetido após a documentação final                                                                      |
| `npm.cmd run build`                                            | Passou                                                                                                          |
| `npm.cmd test`                                                 | 162 testes aprovados, zero falhas; integração cadastral nas duas origens e smoke desktop passaram               |
| `npm.cmd run test:ui`                                          | Passou integralmente: módulos anteriores, teclado, foco, tamanhos/zoom, recarga offline, Dashboard e reabertura |
| `npm.cmd run test:financeiro`                                  | 45 testes aprovados e cenários reais, incluindo consolidação                                                    |
| `npm.cmd run test:relatorios`                                  | 10 testes aprovados e smoke dos 13 métodos oficiais                                                             |
| `npm.cmd run test:consolidacao`                                | 2 testes aprovados e ciclo real/reabertura                                                                      |
| `npm.cmd run test:dashboard`                                   | 3 testes aprovados; cenário Angular/Electron, valores, rankings e reabertura passaram                           |
| `npm.cmd run pack`                                             | Pacote Windows x64 gerado                                                                                       |
| `node scripts/verify-package.mjs`                              | PACKAGE_ISOLATION_OK; 44 bundles de produção; testes/scripts/caches excluídos                                   |
| `node scripts/dashboard-smoke.mjs --development`               | Dashboard real via HTTP, falha/atraso, teclado, matriz de capturas e reabertura passaram                        |
| `node scripts/dashboard-smoke.mjs --package`                   | Executável real, offline emulado, cenário e reabertura passaram                                                 |
| `node scripts/relatorios-smoke.mjs --development`              | Todos os métodos oficiais e reabertura por HTTP passaram                                                        |
| `node scripts/relatorios-smoke.mjs --package`                  | Todos os métodos oficiais no executável e reabertura passaram                                                   |
| `node scripts/smoke.mjs --development`                         | Passou, novo processo Electron/Angular com base isolada                                                         |
| `node scripts/smoke.mjs release/win-unpacked/MNR Perfumes.exe` | Passou, incluindo Perfumes/Pessoas/Estoque                                                                      |

O Builder registrou uma tentativa de renomeação EPERM e concluiu com código 0;
a inspeção do ASAR e os smokes seguintes validaram o artefato produzido. Logs de
GPU e mensagens de falhas injetadas dos cenários anteriores não foram usados
isoladamente como critério de aprovação: cada comando exige encerramento com
código 0 e asserções concluídas. As capturas inspecionadas incluíram visão geral,
séries, valores negativos, rankings em largura reduzida, estoque e estado de erro.

## Validação manual e limites

Aguarda validação manual do proprietário. Conferir na base desejada: abrir
Dashboard, alternar períodos e agrupamentos, pesquisar cliente, comparar com
Vendas/Financeiro/Estoque, expandir tabelas, navegar por teclado e atualizar após
movimentação em outra tela. Testar redução de largura/zoom e confirmar que a
data de referência das posições atuais permanece explícita em períodos antigos.

Offline do pacote é emulado via CDP; não substitui ensaio fisicamente sem rede.
Windows 11, leitor de tela, máquina limpa, instalador NSIS, atualização,
desinstalação e assinatura digital não foram validados nesta etapa. Não há
exportações Excel/PDF, relatórios visuais adicionais 4F.4, correções de compras
4G ou recursos da Etapa 5. Nenhum dado real foi usado como fixture ou apagado.
