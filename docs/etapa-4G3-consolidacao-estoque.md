# 4G.3 — Consolidação Integral das Correções de Compras e Estoque

## Estado e diagnóstico inicial

Execução iniciada em 13/11/2026. Repositório inicialmente limpo; HEAD
`8d32229 feat: implementa estornos de ajustes de estoque`, precedido por
`a839ff5` (4G.1), `27b68ae` (4F.4), `b949a1c` (4F.3) e `407ead2` (4F.2).
A aprovação manual e os commits anteriores foram informados pelo proprietário.
Foram consultados AGENTS, README, relatórios 3A–3D, 4D/4E, 4F e 4G.1/4G.2,
contratos, serviços, custeio, migrações, IPC/preload, interfaces, exportadores,
testes e configuração do pacote. Código e contratos atuais orientam as asserções.

As suítes existentes já cobriam individualmente custos/rateios, compras,
correções comerciais, financeiro, ajustes, IPC, snapshots e publicação segura.
As lacunas eram a cadeia única com ambas as correções da 4G, concorrência entre
operações diferentes e comparação repetida com Dashboard e arquivos no mesmo
estado controlado. A entrega acrescenta essas verificações, sem reimplementar
operações comerciais, alterar migrações ou criar hooks de teste na produção.

**Estado final: consolidação técnica concluída, aguardando validação manual
do proprietário.** Não houve alteração de código de produção nem avanço para
a Etapa 5. Tentativas interrompidas/falhas permanecem identificadas nos logs.

## Matriz de operações e regras preservadas

`Q/V` são quantidade/valor persistidos; variações monetárias são centavos
inteiros. Saldos e versões são atualizados pelos serviços oficiais. Todas as
escritas conservam operação idempotente e auditoria transacionais.

| Operação / serviço oficial                  | Documento e movimento / Q e V                                         | Custeio, financeiro e vínculos                                                                                         | Elegibilidade, concorrência e leitura gerencial                                     |
| ------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Compra / comercial                          | COMPRA confirmada; entrada positiva                                   | Aquisição rateada com frete/despesas; pagamento ao fornecedor vinculado                                                | Cadastros e revisão oficiais; aumenta estoque atual, não faturamento                |
| Venda / comercial                           | VENDA; saída negativa                                                 | Custo histórico da saída; recebimento e/ou parcelas conforme modalidade                                                | Saldo e versão; fluxo comercial, coorte e estoque distintos                         |
| Devolução de venda / correcoes              | DEV_VENDA, retorno e eventual perda                                   | Custos históricos; redução comercial, abatimento e obrigação de reembolso quando aplicáveis                            | Quantidades acumuladas e dependências; não equivale a dinheiro recebido             |
| Cancelamento de venda / correcoes           | ESTORNO vinculado; REVERSAO_ENTRADA                                   | Reversão definida no domínio; preserva original e pagamentos                                                           | Dependências revalidadas na transação; consultas distinguem efeitos                 |
| Estorno de devolução de venda / correcoes   | Corretivo e inversos vinculados                                       | Restaura comercial/custo original; obrigação anulada, não paga                                                         | Resolver pagamentos dependentes; custo histórico da venda imutável                  |
| Devolução de compra / correcoes-compras     | DEV_COMPRA e saída vinculada                                          | Saída pelo custo médio atual; mercadoria histórica e diferença de ajuste; reembolso integral já recebido do fornecedor | Quantidade documental e saldo físico; revisão SHA-256; não é recebimento de cliente |
| Devoluções sucessivas / correcoes-compras   | Novos corretivos ligados à mesma compra                               | Acumulação oficial impede devolver novamente as mesmas quantidades                                                     | Revisão e IMMEDIATE serializam; nenhuma cascata automática                          |
| Cancelamento de compra / correcoes-compras  | ESTORNO e REVERSAO_SAIDA vinculados                                   | Reverte aquisição integral incluindo frete/despesas; estorno vinculado do pagamento original                           | Sem correção efetiva nem movimento posterior dos produtos                           |
| Ajuste positivo / estoque                   | AJUSTE_ENTRADA, sem documento comercial                               | Aumenta Q/V pelo valor formal informado; sem financeiro                                                                | Operação oficial e valores inteiros; posição atual e movimento do período           |
| Ajuste negativo / estoque                   | AJUSTE_SAIDA                                                          | Retira Q/V pelo custeio oficial; sem financeiro                                                                        | Saldo suficiente; preserva resíduos e histórico                                     |
| Perda / estoque                             | PERDA                                                                 | Baixa física e valor oficial; não é venda ou recebimento                                                               | Mesmas invariantes de saldo e custeio                                               |
| Contagem / estoque                          | Operação de contagem e movimento quando há diferença                  | Confronta quantidade contada e versão; zero diferença não cria movimento reversível                                    | Versão otimista; mantém motivo e auditoria                                          |
| Estorno elegível / estornos-estoque         | Movimento inverso com FK de origem; sem documento comercial inventado | Quantidade e valor opostos exatos; não usa custo médio atual; sem financeiro                                           | Integral, único, sem movimento posterior do mesmo produto                           |
| Estorno inelegível / estornos-estoque       | Nenhuma escrita                                                       | Não restaura saldo histórico nem modifica vendas                                                                       | Bloqueia origem comercial, duplicidade, movimento posterior e revisão obsoleta      |
| Recebimento / financeiro                    | Movimento financeiro e alocações oficiais                             | Dinheiro de cliente por data efetiva; reduz exigível, não altera estoque                                               | Parcelas técnicas não duplicam recebimentos; idempotência oficial                   |
| Pagamento/estorno de reembolso / financeiro | Movimentos ligados à obrigação e ao pagamento original                | Pago líquido/pendente, preservando estornos; não é fornecedor                                                          | Saldo da obrigação e revisão; sem financeiro artificial                             |

## Cadeia integrada e invariantes

A fixture compartilhada `consolidacao-estoque-fixture.cjs` usa apenas serviços
oficiais para dados comerciais. O cenário faz compras 10×2.000 e 10×4.000:
20 unidades/60.000 centavos. Devolver duas da primeira compra preserva 4.000
históricos, retira 6.000 do estoque e registra ajuste −2.000: saldo 18/54.000.
Venda de três unidades guarda custo histórico 9.000; entrada 10.000 e posterior
recebimento 15.000 deixam exigível 5.000. Devolução comercial 20.000, incluindo
uma unidade imprópria, deixa comercial 10.000, recebido 25.000, exigível zero e
reembolso pendente 15.000. Pagamento 10.000 deixa pendente 5.000; seu estorno
restaura 15.000. Estorno da devolução restaura comercial 30.000/exigível 5.000,
com obrigação anulada e pendente zero. Custos da venda original são comparados
integralmente antes/depois. Devoluções sucessivas da compra completam a cadeia.

Outro produto testa ajuste positivo com resíduo de um centavo, negativo,
perda e contagem; cada inverso exato restaura 10 unidades/1.000 centavos.
Contagem sem diferença produz movimento nulo. Compra separada de três unidades
de um centavo mais frete de dois/despesa de um é cancelada integralmente,
preservando os centavos oficiais sem arredondamento de interface. Consumo do
último resíduo e rateios fracionários também permanecem nas regressões de custeio.

O teste soma todo o ledger com BigInt e compara quantidade, valor e versão de
cada saldo, não uma fórmula alternativa de custo médio. Reconciliações oficiais,
integrity_check e foreign_key_check complementam essas asserções.

## Concorrência, idempotência e rollback

Workers de testes abrem conexões independentes com barreira sincronizada.
Venda posterior invalida revisão de devolução de compra; compra posterior
invalida cancelamento e estorno de ajuste. Duas devoluções disputam quantidade
insuficiente para ambas: uma confirma e outra conflita, sem pressupor qual UUID
vence. Replay do vencedor retorna resposta original inclusive após reabertura;
conteúdo diferente com mesmo UUID conflita. Snapshots integrais comprovam
ausência de escrita nas recusas.

Falhas isoladas de teste em documentos, itens, movimentos, saldos, vínculos,
financeiro, auditoria e persistência do resultado idempotente devem reverter
todas as tabelas do banco misto. Os triggers de falha ficam apenas na fixture e
são retirados após a asserção; nenhum hook entra no aplicativo de produção.

## Indicadores, Dashboard e arquivos

O auditor da 4F.4 é reutilizado em dez checkpoints e após novo processo:
13 cartões, rankings, tabelas alternativas aos gráficos, contexto de navegação
e sete modelos com totais e todas as linhas. Comparações independentes ocorrem
sem escritas concorrentes. Leituras são executadas com query_only e snapshots
integrais antes/depois. Não se exige exibir campo ausente do contrato da tela.

Teste separado percorre mais de 200 produtos dentro de uma coleta WAL. Uma
devolução de compra em outra conexão durante a paginação muda o estoque atual,
mas o documento congelado mantém todas as linhas e os totais anteriores.
Esse documento também é gerado em XLSX/PDF nos smokes. Não há snapshot
persistente entre interfaces.

Nesse ensaio, 209 produtos aparecem exatamente uma vez; o arquivo conserva
215 unidades e 20.205 centavos, enquanto a devolução concorrente deixa a posição
atual em 16.205 centavos. A consulta posterior é conferida contra o serviço
oficial, e a soma BigInt do ledger continua compatível com os saldos.

Fluxos comerciais, financeiros, posições atuais e coortes conservam a semântica
da 4F.1. Nomes históricos dos documentos não são substituídos após renomeação e
inativação; ajustes manuais mostram identificação cadastral atual.

## Resultados finais e ambientes

As 34 verificações da bateria final terminaram com código zero, incluindo a
repetição completa de exportações após uma tentativa gráfica falha. A suíte
geral passou 195 testes e foi novamente executada após as últimas alterações:
195 aprovados, zero falhas, zero cancelados e zero ignorados. Os recortes da
4G.1 e 4G.2 mantêm dez testes cada; o recorte novo possui quatro testes de
integração, além do smoke real. Typecheck/lint foram repetidos ao final do código.

| Ambiente do novo cenário           | Checkpoints incluindo reabertura | Arquivos validados após fechamento | Resultado |
| ---------------------------------- | -------------------------------- | ---------------------------------- | --------- |
| Electron mnr://app                 | 11                               | 156                                | Aprovado  |
| Electron Angular HTTP              | 11                               | 156                                | Aprovado  |
| Windows x64 ASAR / offline emulado | 11                               | 156                                | Aprovado  |

São 468 arquivos novos, sete modelos em cada checkpoint e dois arquivos de
snapshot por ambiente. Os 429 valores de cartões (13 × 11 × 3), rankings,
tabelas e modelos exportados coincidiram com as consultas oficiais. A suíte
gerencial anterior também validou 174 arquivos; o smoke de exportações validou
40 arquivos em cada um dos três ambientes e o de ajustes validou oito por
ambiente. Não se contam arquivos somente existentes como aprovados: todos
esses conjuntos passaram pelos leitores independentes após fechar o aplicativo.

O pacote foi reconstruído por npm run pack e inspecionado por verify-package:
worker, preload, módulos e biblioteca XLSX presentes; testes/scripts/fixtures/
caches e hooks não incluídos no ASAR. Os fluxos efetivos de compras, ajustes,
Dashboard, consultas e exportações passaram no executável, inclusive reabertura.
A emulação offline não equivale a máquina fisicamente desconectada.

Bancos, perfis e arquivos ficam exclusivamente em diretórios novos de
`.local-data/test`. Logs, horários e códigos de todas as tentativas estão em
`.cache/4g3-verificacoes.json`; índices detalhados por ambiente e respectivos
manifestos são preservados. Nenhum banco do proprietário foi utilizado.

## Matriz de consistência observada

Checkpoint após devolução de venda, base sem escritas concorrentes. Valores
oficiais e dos arquivos abaixo são centavos, pontos-base ou unidades conforme
o tipo; a coluna Dashboard conserva a apresentação visível. Estoque é global
e inclui a compra separada de três unidades/seis centavos e o produto manual
sem saldo. O filtro de cliente aplica-se somente ao comercial e financeiro.

| Indicador / fonte da 4F.1                               | Oficial | Dashboard | XLSX  | PDF   | Semântica            | Resultado |
| ------------------------------------------------------- | ------- | --------- | ----- | ----- | -------------------- | --------- |
| `fluxoComercial.faturamentoLiquidoCentavos` (moeda)     | 10000   | R$ 100,00 | 10000 | 10000 | Fluxo comercial      | Igual     |
| `fluxoComercial.vendasConfirmadas` (inteiro)            | 1       | 1         | 1     | 1     | Fluxo comercial      | Igual     |
| `fluxoComercial.resultadoBrutoEstimadoCentavos` (moeda) | 4000    | R$ 40,00  | 4000  | 4000  | Fluxo comercial      | Igual     |
| `fluxoComercial.margemBrutaPontosBase` (percentual)     | 4000    | 40,00%    | 4000  | 4000  | Fluxo comercial      | Igual     |
| `coorteVendas.ticketMedioCentavos` (moeda)              | 10000   | R$ 100,00 | 10000 | 10000 | Coorte atual         | Igual     |
| `fluxoFinanceiro.recebidoLiquidoCentavos` (moeda)       | 25000   | R$ 250,00 | 25000 | 25000 | Fluxo financeiro     | Igual     |
| `posicaoAtual.contas.exigivelCentavos` (moeda)          | 0       | R$ 0,00   | 0     | 0     | Posição atual        | Igual     |
| `posicaoAtual.contas.vencidoCentavos` (moeda)           | 0       | R$ 0,00   | 0     | 0     | Posição atual        | Igual     |
| `posicaoAtual.reembolsos.pendenteCentavos` (moeda)      | 15000   | R$ 150,00 | 15000 | 15000 | Posição atual        | Igual     |
| `estoque.posicaoAtual.valorCentavos` (moeda)            | 48006   | R$ 480,06 | 48006 | 48006 | Posição atual global | Igual     |
| `estoque.posicaoAtual.unidades` (inteiro)               | 19      | 19        | 19    | 19    | Posição atual global | Igual     |
| `estoque.posicaoAtual.semEstoque` (inteiro)             | 1       | 1         | 1     | 1     | Posição atual global | Igual     |
| `estoque.posicaoAtual.abaixoMinimo` (inteiro)           | 3       | 3         | 3     | 3     | Posição atual global | Igual     |

Nesse checkpoint, o CMV histórico líquido oficial é 3.000 centavos e a perda
de unidades impróprias é 3.000; resultado bruto estimado é 4.000. A venda
original conserva custo de 9.000, sem recalcular vendas após correções de
compras. Essas definições são conferidas no teste de serviços; não se exige
novo cartão de CMV ou perda no Dashboard. Totais detalhados de recebimentos,
parcelas, obrigações e rankings são comparados em todos os arquivos dos
modelos correspondentes. Reembolso recebido de fornecedor não aparece como
recebimento de cliente.

As matrizes completas de todos os checkpoints, linhas, rankings e arquivos
ficam nos índices `.cache/4g3-local-audit.json`, `4g3-http-audit.json` e
`4g3-package-audit.json` após a execução de cada ambiente. Os manifestos
apontados nesses índices permitem reproduzir a leitura independente.

## Segurança e reutilização das regressões

O registro central protege os handlers de compras e ajustes com a mesma
verificação de WebContents, frame principal, URL exata sem fragmento e aridade.
Contratos fechados validam IDs/vínculos, objetos simples, campos autorizados,
inteiros seguros, data local real, motivo, UUID e SHA-256. O preload mantém
métodos literais; não há dispatcher público, SQL, filesystem ou SQLite no
Angular. Erros internos continuam sanitizados. Sandbox/contextIsolation/CSP e
nodeIntegration desabilitado não foram alterados.

As suítes existentes de cadastros/IPC, 4G.1 e 4G.2 verificam remetentes/frame/URL,
aridade/campos, datas, replay, conflitos e limpeza dos 87 handlers. A revisão
somente leitura e o rollback individual da 4G.2 permanecem cobertos, além do
rollback cruzado novo. Exportações mantêm worker/conexão somente leitura,
transação DEFERRED/WAL durante toda a coleta e encerramento da leitura antes
de gerar/gravar; PDF usa sessão isolada sem scripts/rede ou permissões. O
salvamento conserva cancelamento, extensão, bloqueio de duplicidade, publicação
sem sobrescrita e erro sanitizado. Não se alterou o mecanismo de hard links.

O novo smoke integra as telas reais de correção de compra e ajuste, comparações
do Dashboard e exportações pelo IPC real. Os smokes anteriores complementam
campo inválido, revisão obsoleta, duplo clique, resposta perdida após commit,
mesma intenção/UUID, bloqueio de navegação, falha de leitura após sucesso,
cancelamento e restauração de foco, Tab/Shift+Tab/Enter/Escape e reabertura.
Os diálogos nativos têm respostas controladas pelo harness: não se declara
homologação manual do diálogo do Windows nem teste de leitor de tela.

## Desempenho medido

Ensaio de 13/11/2026 em Windows 10 build 19045, Intel Core i7-7700 3,60 GHz,
Node 26.13.0 nos serviços diretos; Electron 43.8.6, Chromium 150.0.7871.250 e
Node embarcado 24.22.1 nos ensaios Electron. Versões completas constam nos JSONs. Base
fictícia com compras, correções, ajustes, reembolsos e 50/200/500 vendas.
Cada checkpoint é serializado em arquivo novo limitado a 50 MiB, sem db.backup.
As consultas usam cache aquecido, 20 amostras após aquecimento; revisões de
devolução usam 20 amostras somente leitura. Confirmações abaixo são amostras
individuais, sem inferência estatística de p95. Setup excluído dos tempos.

| Vendas | Resumo gerencial mediana ms | Estoque mediana ms | Revisão devolução mediana ms | Confirmar devolução ms | Confirmar estorno ms | Dashboard mediana ms |
| ------ | --------------------------- | ------------------ | ---------------------------- | ---------------------- | -------------------- | -------------------- |
| 50     | 4,756                       | 0,805              | 1,14                         | 46,19                  | 41,38                | 49,91                |
| 200    | 9,184                       | 0,474              | 1,30                         | 122,82                 | 118,29               | 69,97                |
| 500    | 20,079                      | 1,058              | 1,80                         | 278,65                 | 280,77               | 109,37               |

Dashboard inclui renderer + IPC + DOM, cinco amostras após aquecimento. Consulta,
revisão e confirmação são chamadas diretas dos serviços, sem latência de IPC.
Não houve medição separada de CPU/memória do worker neste benchmark. O RSS
exportador abaixo é somente do main, não a soma dos processos de impressão. Os smokes
exercitam o worker real, enquanto a medição de geração chama os mesmos geradores
diretamente no processo principal Electron para separar coleta e geração.

| Vendas | Coleta máxima ms | XLSX geração + gravação máxima ms | PDF geração + gravação máxima ms | Maior arquivo bytes | RSS exportador MiB | RSS main Dashboard MiB |
| ------ | ---------------- | --------------------------------- | -------------------------------- | ------------------- | ------------------ | ---------------------- |
| 50     | 12,36            | 83,12                             | 652,56                           | 78.281              | 169                | 107                    |
| 200    | 28,57            | 67,49                             | 964,14                           | 130.291             | 202                | 115                    |
| 500    | 165,06           | 186,54                            | 1.390,03                         | 232.625             | 257                | 144                    |

Máximos sobre os sete modelos, não necessariamente do mesmo modelo. Não foi
isolado o tempo de gravação do tempo de geração. Há 50/200/500 vendas completas
nos respectivos XLSX de vendas, sem usar só a primeira página da origem.
Os 44 arquivos (42 dos modelos e dois de precisão) passaram pelo validador
independente. JSONs: `.cache/benchmark-4g3-consultas.json`,
`benchmark-4g3-exportacoes.json` e `benchmark-4g3-dashboard.json`.
Código final zero registrado em `.cache/4g3-benchmark-exit.json` e log
`.cache/4g3-fourth-benchmark.log`.

RSS do processo Node após setup/consultas foi 131/253/744 MiB, influenciado pela
criação sintética em lote; não representa memória exclusiva de uma consulta.
Uma tentativa anterior de criar toda a base sem devolver controle ao event
loop cresceu a vários GiB e foi interrompida deliberadamente. GC explícito
sozinho não resolveu. Lotes de dez operações oficiais, GC e yield entre lotes
permitiram concluir; a causa exata da retenção nativa não foi isolada. Essa
mudança é exclusiva do harness, fora das medições de consulta/confirmação;
nenhum comportamento de produção foi alterado por hipótese. Medições ocorreram
durante outras regressões, com contenção variável. Não extrapolar para outras
máquinas, discos ou milhões de movimentos.

## Ocorrências e correções no harness

- A primeira asserção concorrente supunha qual UUID venceria. Corrigida para
  reconhecer o vencedor efetivo e exigir exatamente um sucesso/um conflito.
- O benchmark tentou comprar depois da inativação proposital da fixture.
  Reativação explícita por serviços oficiais foi adicionada apenas ao setup.
- Reforço do teste de snapshot enviou período vazio a uma consulta que exige
  datas. Corrigido o teste para enviar o dia válido; validação de produção
  corretamente recusou o contrato inválido.
- Tentativas com pressão de memória não contam como benchmark aprovado;
  logs iniciais preservados, seguidos do ensaio completo de código zero.
- A primeira bateria final de `test:exportacoes` passou os sete testes de
  serviço/IPC e falhou com timeout de 65 segundos em `Page.captureScreenshot`.
  `.cache/4g3-final-exportacoes-attempt1.log` e
  `.cache/4g3-final-attempt1-results.json` preservam a tentativa de código 1.
  O harness de exportações passou a habilitar emulação de foco e capturar a
  view (`fromSurface: false`), conservando sincronização de frames, viewport,
  todas as asserções e exportações. Reexecução completa local passou, com 40
  arquivos, e a consolidação gerencial passou com 174 arquivos. Os demais
  ambientes também passaram na bateria final. A causa de baixo nível não foi isolada;
  não há evidência de erro financeiro nessa ocorrência gráfica.

Não foi demonstrado defeito comercial, financeiro, de custeio ou de interface
que justificasse alteração do código de produção.

## Evidências visuais

Inspeção das duas páginas do resumo gerencial e páginas 1, 2 e 11 do estoque
paginado: A4, títulos, metodologia, cabeçalhos repetidos, rodapé, acentos,
moedas e contraste legíveis, sem cortes ou sobreposições observadas nas páginas
inspecionadas. Renderização local com PDFium disponível no runtime (Poppler
não localizado), além de pypdf/pdfplumber para integridade e conteúdo.

- [Revisão de compra local](evidencias-4G3/revisao-compra-local.png).
- [Revisão de compra no executável ASAR](evidencias-4G3/revisao-compra-pacote.png).
- [Revisão de ajuste em HTTP](evidencias-4G3/revisao-ajuste-http.png).
- [Revisão de ajuste, 640×480 com zoom 150%](evidencias-4G3/revisao-ajuste-compacta.png).
- [Revisão de critérios de exportação](evidencias-4G3/revisao-relatorio.png).
- [Resumo gerencial após devolução de venda](evidencias-4G3/pdf-gerencial.png).
- [Página intermediária de estoque](evidencias-4G3/pdf-paginado.png).

Os nove pares de 1366×768, 1000×700 e 640×480 com zoom 100/125/150% verificam
largura da página nas duas revisões; rolagem vertical mantém acesso ao restante
do conteúdo. As capturas são evidência representativa, não inspeção humana de
todas as páginas ou homologação de DPI físico.

## Comandos e resultados reais

Execução em 13/11/2026, horários locais −03:00. A tabela mostra a última
execução de cada comando da bateria; todas terminaram com código zero.
A tentativa inicial de exportações de 00:43:11 a 00:45:32 saiu com código 1
e permanece no índice e no log de attempt1, sem ser convertida em aprovação.

| Comando                                                        | Início   | Fim      | Código | Log em .cache                             |
| -------------------------------------------------------------- | -------- | -------- | ------ | ----------------------------------------- |
| `npm.cmd run typecheck`                                        | 00:31:10 | 00:31:19 | 0      | `4g3-final-typecheck.log`                 |
| `npm.cmd run lint`                                             | 00:31:19 | 00:31:30 | 0      | `4g3-final-lint.log`                      |
| `npm.cmd run format:check`                                     | 00:31:30 | 00:32:07 | 0      | `4g3-final-format.log`                    |
| `npm.cmd run build`                                            | 00:32:07 | 00:32:27 | 0      | `4g3-final-build.log`                     |
| `npm.cmd test`                                                 | 00:32:27 | 00:34:39 | 0      | `4g3-final-test.log`                      |
| `npm.cmd run test:ui`                                          | 00:34:39 | 00:38:20 | 0      | `4g3-final-ui.log`                        |
| `npm.cmd run test:vendas`                                      | 00:38:20 | 00:38:46 | 0      | `4g3-final-vendas.log`                    |
| `npm.cmd run test:financeiro`                                  | 00:38:46 | 00:40:12 | 0      | `4g3-final-financeiro.log`                |
| `npm.cmd run test:correcoes`                                   | 00:40:12 | 00:40:43 | 0      | `4g3-final-correcoes.log`                 |
| `npm.cmd run test:reembolsos`                                  | 00:40:43 | 00:41:23 | 0      | `4g3-final-reembolsos.log`                |
| `npm.cmd run test:correcoes-compras`                           | 00:41:23 | 00:41:51 | 0      | `4g3-final-compras.log`                   |
| `npm.cmd run test:consolidacao`                                | 00:41:51 | 00:42:30 | 0      | `4g3-final-consolidacao.log`              |
| `npm.cmd run test:relatorios`                                  | 00:42:30 | 00:42:47 | 0      | `4g3-final-relatorios.log`                |
| `npm.cmd run test:dashboard`                                   | 00:42:47 | 00:43:11 | 0      | `4g3-final-dashboard.log`                 |
| `npm.cmd run test:exportacoes`                                 | 00:46:08 | 00:47:32 | 0      | `4g3-final-exportacoes.log`               |
| `npm.cmd run test:consolidacao-gerencial`                      | 00:47:32 | 00:52:05 | 0      | `4g3-final-gerencial.log`                 |
| `npm.cmd run test:estornos-estoque`                            | 00:52:05 | 00:52:39 | 0      | `4g3-final-estornos.log`                  |
| `npm.cmd run test:consolidacao-estoque`                        | 00:52:39 | 00:55:53 | 0      | `4g3-final-estoque-integrado.log`         |
| `node scripts/consolidacao-estoque-smoke.mjs --development`    | 00:55:53 | 00:58:37 | 0      | `4g3-final-estoque-integrado-http.log`    |
| `node scripts/estornos-estoque-smoke.mjs --development`        | 00:58:37 | 00:59:03 | 0      | `4g3-final-estornos-http.log`             |
| `npm.cmd run pack`                                             | 00:59:03 | 01:00:11 | 0      | `4g3-final-pack.log`                      |
| `node scripts/verify-package.mjs`                              | 01:00:11 | 01:00:11 | 0      | `4g3-final-verify-package.log`            |
| `node scripts/consolidacao-estoque-smoke.mjs --package`        | 01:00:11 | 01:02:00 | 0      | `4g3-final-estoque-integrado-package.log` |
| `node scripts/estornos-estoque-smoke.mjs --package`            | 01:02:00 | 01:02:15 | 0      | `4g3-final-estornos-package.log`          |
| `node scripts/correcoes-compras-smoke.mjs --development`       | 01:02:15 | 01:02:34 | 0      | `4g3-final-compras-http.log`              |
| `node scripts/correcoes-compras-smoke.mjs --package`           | 01:02:34 | 01:02:45 | 0      | `4g3-final-compras-package.log`           |
| `node scripts/dashboard-smoke.mjs --development`               | 01:02:45 | 01:03:03 | 0      | `4g3-final-dashboard-http.log`            |
| `node scripts/dashboard-smoke.mjs --package`                   | 01:03:03 | 01:03:11 | 0      | `4g3-final-dashboard-package.log`         |
| `node scripts/relatorios-smoke.mjs --development`              | 01:03:11 | 01:03:21 | 0      | `4g3-final-relatorios-http.log`           |
| `node scripts/relatorios-smoke.mjs --package`                  | 01:03:21 | 01:03:23 | 0      | `4g3-final-relatorios-package.log`        |
| `node scripts/exportacoes-smoke.mjs --development`             | 01:03:23 | 01:04:16 | 0      | `4g3-final-exportacoes-http.log`          |
| `node scripts/exportacoes-smoke.mjs --package`                 | 01:04:16 | 01:04:48 | 0      | `4g3-final-exportacoes-package.log`       |
| `node scripts/smoke.mjs --development`                         | 01:04:48 | 01:05:01 | 0      | `4g3-final-desktop-http.log`              |
| `node scripts/smoke.mjs release/win-unpacked/MNR Perfumes.exe` | 01:05:01 | 01:05:03 | 0      | `4g3-final-desktop-package.log`           |
| `npm.cmd run typecheck`                                        | 00:50:58 | 00:51:06 | 0      | `4g3-post-typecheck.log`                  |
| `npm.cmd run lint`                                             | 00:51:06 | 00:51:18 | 0      | `4g3-post-lint.log`                       |
| `node --test tests/*.test.cjs`                                 | 00:51:18 | 00:52:01 | 0      | `4g3-post-node-suite.log`                 |

O benchmark completo e seu código zero têm índice separado
`.cache/4g3-benchmark-exit.json`, com timestamps dos artefatos de consulta,
exportação e renderer. Log final: `.cache/4g3-fourth-benchmark.log`.

A inspeção final de whitespace/format e a preservação do escopo são registradas
em `.cache/4g3-closing-results.json` após finalizar a documentação.

## Arquivos da entrega

Novos: `tests/consolidacao-estoque.test.cjs`,
`tests/helpers/consolidacao-estoque-fixture.cjs`,
`tests/helpers/consolidacao-estoque-worker.cjs`,
`scripts/consolidacao-estoque-smoke.mjs`, este relatório e capturas
`docs/evidencias-4G3`.

Modificados: `package.json` (recorte e benchmark),
`scripts/benchmark-relatorios.cjs`, `benchmark-exportacoes.mjs`,
`benchmark-exportacoes-main.cjs`, `benchmark-gerencial-ui.mjs` (opção 4G.3,
checkpoints/resultados separados, reutilizando o caminho anterior) e README.
`scripts/exportacoes-smoke.mjs` ajusta somente foco/captura do harness após
timeout comprovado; não muda geração, segurança ou interface de produção.
Sem alteração de produção, contratos, dependências/lockfile, migrações, índices,
triggers oficiais, custos, hashes ou snapshots históricos.

## Checklist manual do proprietário

- [ ] Criar compras a custos diferentes e conferir o custo médio persistido.
- [ ] Devolver parte da primeira compra; conferir valor histórico, custo da
      saída, diferença, reembolso de fornecedor já recebido e vínculos.
- [ ] Vender e devolver parcialmente, incluindo perda; conferir exigível e
      reembolso de cliente sem misturar fluxos de fornecedor.
- [ ] Pagar/estornar reembolso e estornar devolução após resolver dependências.
- [ ] Cancelar compra elegível e conferir frete/despesas/pagamento histórico;
      verificar bloqueio com movimentos posteriores.
- [ ] Estornar ajustes positivo/negativo/perda/contagem elegíveis; conferir
      inverso exato, ausência de financeiro, duplicidade e bloqueio posterior.
- [ ] Conferir campos inválidos, revisão obsoleta, resposta incerta, replay,
      diálogos, teclado/foco e três tamanhos/zooms com dados fictícios.
- [ ] Conferir históricos após renomear/inativar e após reabrir o aplicativo.
- [ ] Comparar Dashboard e sete modelos Excel/PDF; abrir arquivos após fechar
      o aplicativo e revisar páginas extensas em um leitor instalado.

## Limitações e próximos passos

Não há nova operação comercial, conta a pagar, crédito futuro de fornecedor,
estorno parcial ou flexibilização de movimento posterior. Sem mudança de
migrações 0001–0005, algoritmo de custeio, hashes, snapshots históricos,
dependências ou segurança Electron. Não fazer commit/push.

Etapa 5 permanece pendente: backup/restauração pela interface, instalador
Windows, distribuição/máquina limpa, homologação Windows 10/11, ensaios offline
físicos e documentação de instalação/recuperação. ASAR unpacked com offline
emulado não comprova instalador, máquina limpa ou desconexão física.

As funcionalidades comerciais, financeiras, gerenciais e correções de estoque
previstas até a 4G foram consolidadas tecnicamente, com validação manual da
4G.3 ainda pendente. Isso não significa aplicativo pronto para distribuição.
