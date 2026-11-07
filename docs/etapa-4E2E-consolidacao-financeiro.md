# Etapa 4E.2-E — Consolidação e validação integral do Financeiro

## Estado e diagnóstico inicial

Execução exclusiva da consolidação. A validação manual e os commits de A–D
foram informados pelo proprietário. Repositório inicialmente limpo, HEAD
`89a7e7e` (reembolsos/estornos), precedido por `e368459`, `be2de0e` e `4061d8e`.
AGENTS, README e relatórios 3A–3D e 4A–4E.2-D foram consultados, junto aos
serviços, domínio, migrações/inspeção, contratos, preload/registro protegido,
serviços Angular, telas e confirmação do Design System. Não há planejamento
4E.2 separado encontrado: fronteiras constam dos relatórios e da autorização.

Os módulos já possuíam cobertura extensa por operação. A lacuna real era
acompanhar o mesmo produto abastecido por compra e a mesma venda através de
todo o ciclo A/B/C/D, inclusive nos três ambientes de interface. Também faltava
medição específica das consultas financeiras com volume crescente.

Não foi comprovado defeito nas regras de produto nesta execução. Não foram
alterados serviços de produção, canais/contratos IPC, componentes Angular,
hashes, respostas persistidas, migrações 0001–0005, dependências ou lockfile.
Não houve commit/push. Os testes usam somente diretórios novos isolados sob
`.local-data/test`; bancos existentes não são apagados, substituídos ou recriados.

**Estado: consolidação técnica concluída e verificações automatizadas aprovadas.**
A validação manual do proprietário continua pendente. Não avançar para 4F/4G.

## Matriz de integração e cobertura

| Integração                           | Regra/fonte oficial reutilizada                         | Evidência automatizada                                                              | Risco/limite acompanhado                                                                         |
| ------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Cadastro → compra → estoque          | `catalogos`, `comercial`, `compras`, custeio e triggers | Novo fixture abastece somente por compras reais; novo cenário confirma compra na UI | Cadastros iniciais do novo cenário via API tipada; formulários cadastrais na regressão existente |
| Estoque → venda à vista              | `comercial.confirmar`, `vendas`                         | Baixa de 3 unidades, R$ 300 recebidos, saldo zero                                   | Parcela técnica não pode duplicar dinheiro                                                       |
| Prazo sem entrada → recebimentos     | `recebimentos`, `financeiro`                            | R$ 50 + R$ 250, alocações, quitação e histórico                                     | Recebimento antecipado/manual/múltiplas formas permanece na suíte B                              |
| Prazo com entrada → A/B              | `confirmarComEntrada`, consultas oficiais               | Entrada R$ 100 quitada, posterior R$ 150, saldo R$ 50                               | Nenhum recálculo de saldo no Angular                                                             |
| Venda → devolução → C/A              | `correcoes-vendas`, `correcoes`, `financeiro-consulta`  | Devolução R$ 200, histórica e mista; obrigação R$ 150                               | Sucessivas/integral/cancelamento e bloqueios na suíte C                                          |
| Obrigação → pagamentos → D/A         | `reembolsos-estornos`, `financeiro`                     | R$ 100, estorno, Pix R$ 90 + dinheiro R$ 60, estornos individuais                   | Não existe cascata de estornos                                                                   |
| D → estorno de devolução → estoque/A | preparação compartilhada da 3D                          | Obrigação anulada, saldo R$ 50, estoque anterior restaurado                         | Dependências pagas e estoque posterior bloqueiam pela regra existente                            |
| Persistência e segurança             | inspeção de banco, reconciliações, registro IPC         | Comparação integral após reabertura; suítes de segurança/migração                   | Limites dos ensaios de distribuição abaixo                                                       |

Os novos testes são `tests/consolidacao-financeiro.test.cjs`, com helper
`tests/helpers/consolidacao-fixture.cjs`. Usam serviços reais e os handlers
financeiros existentes. `npm.cmd test` os descobre automaticamente. O recorte
`test:financeiro` também os inclui.

`scripts/consolidacao-scenario.cjs` executa compras, três modalidades de venda,
recebimentos e devolução pelas telas reais. Compara todos os campos renderizados
do resumo com `financeiro.obterVenda`, inclusive zeros. Depois reutiliza o cenário
D inteiro: pagamentos, estornos, dependências, erros, proteção de saída e, no host
local/HTTP, falhas injetadas, replay e falha de consulta após sucesso.

O flag `--consolidacao` amplia os hosts D existentes; não cria outro Electron,
preload de teste nem rotas de produto. Os outros casos D continuam como fixtures
separadas para bloqueios. O novo produto principal entra no estoque somente por
compras confirmadas pela interface. IDs finais são guardados na fixture isolada
para o segundo processo, sem persistência paralela no renderer.

## Valores conferidos no ciclo de referência

Valores em reais; resultados verificados por consultas oficiais, sem reconstrução
de saldo no Angular.

| Momento                              | Comercial líquido | Recebido líquido | Saldo exigível da venda | Reembolso pago líquido | Reembolso pendente |
| ------------------------------------ | ----------------: | ---------------: | ----------------------: | ---------------------: | -----------------: |
| Venda R$ 300 com entrada R$ 100      |            300,00 |           100,00 |                  200,00 |                   0,00 |               0,00 |
| Recebimento posterior R$ 150         |            300,00 |           250,00 |                   50,00 |                   0,00 |               0,00 |
| Devolução R$ 200                     |            100,00 |           250,00 |                    0,00 |                   0,00 |             150,00 |
| Pagamento R$ 100                     |            100,00 |           250,00 |                    0,00 |                 100,00 |              50,00 |
| Estorno desse pagamento              |            100,00 |           250,00 |                    0,00 |                   0,00 |             150,00 |
| Pagamento Pix R$ 90 + dinheiro R$ 60 |            100,00 |           250,00 |                    0,00 |                 150,00 |               0,00 |
| Estorno somente Pix                  |            100,00 |           250,00 |                    0,00 |                  60,00 |              90,00 |
| Estorno do dinheiro restante         |            100,00 |           250,00 |                    0,00 |                   0,00 |             150,00 |
| Estorno da devolução                 |            300,00 |           250,00 |                   50,00 |                   0,00 |               0,00 |

Obrigação original R$ 150 permanece histórica e fica anulada no último passo.
Os pagamentos e estornos permanecem vinculados. Recebimentos originais não
desaparecem. A UI D verifica explicitamente que a segunda forma não é estornada
junto com a primeira e que uma obrigação anulada não oferece pagamento.

Na 3D, `abatimentosDividaCentavos` representa o abatimento comercial total
registrado nas parcelas: R$ 200 neste caso. R$ 50 extinguem saldo aberto e
R$ 150 correspondem ao excesso recebido que origina a obrigação. Esse campo não
é R$ 50 nem dinheiro recebido. A regra foi preservada; o teste inicial que
esperava R$ 50 foi corrigido para refletir a semântica oficial existente.

O teste de serviços também completa a venda com entrada até R$ 300 recebidos,
confere uma única parcela ENTRADA quitada e compara todas as tabelas após
reabrir o banco. No cenário de UI, a venda com entrada mantém R$ 50 de saldo
para percorrer a devolução de referência; a venda sem entrada é quitada.

## Estoque e custos históricos

No teste principal: compra de 20 unidades a R$ 1, venda de 3, compra posterior
de 5 a R$ 100. Antes da devolução: 22 unidades e R$ 517 de valor total.
A média atual difere do custo histórico de R$ 1 da venda. Devolver 2 unidades,
uma imprópria, gera três movimentos: retorno apto +1/R$ 1; retorno impróprio
+1/R$ 1; perda vinculada −1/R$ 1. Ficam 23 unidades/R$ 518. O estorno restaura
22/R$ 517 exatamente. O item corretivo registra R$ 2 de custo histórico.

Na UI, o mesmo produto abastece três vendas de 3 unidades: 20 → 11, segunda
compra → 16/R$ 511, devolução mista → 17/R$ 512, estorno → 16/R$ 511.
O cenário D confere os deltas físicos e monetários; a reabertura compara o saldo
persistido. Nenhuma unidade imprópria fica disponível para venda.

As suítes anteriores verificam retornos aptos/impróprios/mistos, sucessivos,
cancelamento com retorno integral, resíduos históricos cumulativos, bloqueio por
movimento posterior e reversão na ordem inversa. Não se usa média atual para
reavaliar o documento original nem ajuste manual para simular estorno.

## Segurança, auditoria, concorrência e atomicidade

O registro protegido confere WebContents exato, frame principal, URL autorizada
e aridade. Canais são constantes tipadas, com métodos literais no preload;
handlers validam campos, vínculos, IDs, datas, motivos, UUID/revisão e valores.
O mapeamento interno fechado de métodos não aceita nome de operação do renderer.
Erros nativos são sanitizados. `sandbox` e `contextIsolation` permanecem ativos,
`nodeIntegration` desativado, CSP preservada. Não há Node/SQL/filesystem no Angular.

Revisões de recebimento, correção e reembolso/estorno executam preparação
somente de leitura em transação; não gravam e desfazem documentos provisórios.
As suítes B/C/D executam com `query_only=ON` e snapshot integral de tabelas.
O novo ciclo também faz essa comparação antes de devolver. As medições de
consultas rodam com `query_only=ON`.

Para UUID novo, impressão SHA-256 é conferida dentro da transação IMMEDIATE
que invoca a gravação existente. Para UUID persistido, a idempotência legada
retorna a resposta original; conteúdo diferente gera conflito. Não houve mudança
nas normalizações, tipos de operação, hashes ou formatos de respostas antigos.
O novo ciclo repete a mesma intenção corretiva depois de todos os pagamentos e
estornos e compara todas as tabelas, sem efeitos adicionais.

As suítes existentes verificam recebimentos, devoluções, pagamentos, estornos,
versões documentais, formas inativadas e estoque alterados após revisão;
workers independentes disputam tanto UUID idêntico como intenções distintas.
Falhas em movimentos, alocações, parcelas/abatimentos, origens/obrigações,
documentos, estoque e auditoria são injetadas para conferir rollback completo.
Depois de respostas perdidas há replay explícito da mesma intenção. Uma falha
de leitura após commit oferece somente consulta e não nova gravação.

Na reabertura são conferidos `integrity_check=ok`, `foreign_key_check=[]`,
reconciliações comercial/financeira e de estoque e preservação de histórico.
Inspeção confere cinco migrações/checksums, STRICT, índices/triggers, identidade,
versões e regras existentes; não tenta recriar banco incompatível.

## Usabilidade e ajustes comprovados

As regressões mantêm consultas sem motivo, identificação histórica inativa,
links entre venda/parcela/movimento/obrigação/correção, campos preservados após
erros, revisão invalidada ao editar, botões indisponíveis e proteção para resultado
incerto. O novo fluxo atravessa as fronteiras Compras → Vendas → Financeiro →
Correções → Reembolsos e confere os resumos exibidos em cada passagem.

Um problema do harness foi encontrado: a asserção de Tab partia do último botão
da página e exigia que o foco permanecesse no documento, embora o navegador possa
transferi-lo para fora dele. O host passou a testar Tab/Shift+Tab a partir do
campo de data, verificando retorno ao mesmo campo. Continuam as asserções de
Enter, Escape, foco inicial e restauração ao botão de confirmação. Nenhuma
asserção financeira foi removida e nenhuma gravação é repetida para mascarar falha.

O teste novo também foi corrigido para esperar os três movimentos reais do
retorno misto, em vez de presumir um retorno agregado. Ambos foram erros das
novas expectativas de teste, sem alteração das regras de produção.

São exercitadas 1366×768, 1000×700 e 640×480 com zoom 100%, 125% e 150%, teclado
e ausência de overflow horizontal da página. Tabelas podem ter rolagem própria.
Nos hosts locais/HTTP, zoom usa `webContents.setZoomFactor`; no pacote usa
emulação CDP de viewport/escala equivalente. Capturas em `.cache/ui/reembolsos-*`.

## Desempenho efetivamente medido

`node scripts/benchmark-financeiro.cjs`: Windows 10 build 19045 x64,
Intel Core i7-7700 3,60 GHz, Node 26.13.0, SQLite 3.53.4. Banco isolado
`financeiro-benchmark-2UQkQB`, resultados brutos `.cache/benchmark-financeiro.json`.
Fixtures geradas por serviços reais, com compras, vendas nas três modalidades,
recebimentos e devoluções. Uma única referência de produto/cliente exercita
histórico compartilhado crescente. Cache do sistema não foi esvaziado.

Cada consulta tem aquecimento e 20 amostras síncronas do processo principal;
mediana é a amostra ordenada de índice 10 e p95 a de índice 18. Estes tempos
não incluem IPC, pintura Angular, abertura do executável ou inicialização SQLite.

| Consulta                                        | 50 vendas: mediana/p95 ms | 200 vendas: mediana/p95 ms | 500 vendas: mediana/p95 ms |
| ----------------------------------------------- | ------------------------: | -------------------------: | -------------------------: |
| Listagem de parcelas, página de 25              |             5,018 / 5,636 |              5,029 / 5,625 |             7,344 / 22,170 |
| Filtro cliente + em aberto                      |             5,371 / 6,508 |              5,805 / 6,569 |             8,291 / 10,250 |
| Última página de parcelas                       |            5,575 / 17,055 |              5,285 / 5,646 |             6,073 / 12,179 |
| Resumo de venda                                 |             0,245 / 0,386 |              0,221 / 0,293 |              0,245 / 0,446 |
| Página de movimentos                            |             0,250 / 0,316 |              0,289 / 0,462 |              0,348 / 0,512 |
| Detalhe de movimento, incluindo busca da página |             0,698 / 1,054 |              0,847 / 0,926 |              1,101 / 1,263 |
| Reembolsos pendentes, página de 25              |             1,860 / 2,130 |              4,835 / 5,503 |              5,083 / 6,050 |
| Detalhe de obrigação                            |             0,240 / 0,279 |              0,220 / 0,345 |              0,221 / 0,263 |
| Detalhe corretivo com elegibilidade             |             1,164 / 1,545 |              6,730 / 7,986 |            36,910 / 43,611 |

Volumes respectivos: 99/399/999 parcelas, 39/159/409 movimentos financeiros,
9/34/84 devoluções. O último cenário tem 50 recebimentos pequenos na mesma venda.
Maior amostra de consulta: 47,442 ms no detalhe corretivo com 500 vendas.
Não foi evidenciado bloqueio prolongado de consulta neste recorte.

A geração, excluída das medições de consulta, levou 1,884 s, mais 24,309 s e mais
217,071 s para atingir os volumes. Não são tempos de uma operação individual.
Reconciliação integral a cada escrita e inspeção de dependências de estoque são
pontos de atenção para crescimento. O detalhe corretivo consulta movimentos
posteriores e pode retornar muitos vínculos, apesar de as listagens terem limites
SQL. Essa abrangência preserva a explicação dos bloqueios; não se alterou regra,
índice ou schema para otimizar sem evidência e autorização. Não se promete escala
de milhões de documentos nem desempenho em hardware inferior.

Medição adicional: `node scripts/benchmark-financeiro-ui.mjs` abriu Angular/Electron
real em `mnr://app`, 1366×768 e zoom 100%, sobre backup consistente do banco isolado
de 500 vendas. Cada ação tem um aquecimento e cinco amostras; inclui IPC, DOM
pronto, polling de 10 ms e dois frames de animação. Não mede partida a frio nem
tempo exclusivo de pintura. Detalhes aguardam também a página de movimentos
carregada (até 25 linhas) e ausência de status de carregamento. Comparação de todas
as tabelas antes/depois confirmou que o ensaio não gravou dados.

| Ação na interface             | Mediana ms | Máximo ms |
| ----------------------------- | ---------: | --------: |
| Abrir listagem                |     53,762 |    72,361 |
| Aplicar filtro Quitadas       |     41,727 |    52,788 |
| Avançar página                |     47,761 |    62,054 |
| Abrir venda com 5 movimentos  |     45,175 |    46,141 |
| Abrir venda com 20 movimentos |     43,817 |    45,451 |
| Abrir venda com 50 movimentos |     35,710 |    44,740 |

Resultados em `.cache/benchmark-financeiro-ui.json`. Variação não monotônica é
esperada com poucas amostras/cache; não é evidência de que mais histórico acelera
a consulta. O benchmark inicial falhou antes de iniciar o app por usar nome de
diretório fora do prefixo `ui-` permitido. O harness foi corrigido e executado com
sucesso, sem relaxar a proteção de caminhos. Carga de outros processos e cache do
SO não são controlados; estes números são um recorte prático da máquina utilizada.

## Verificações e resultados

| Verificação executada                                          | Resultado real                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                        | Passou; repetido após os novos arquivos de teste                                                        |
| `npm.cmd run lint`                                             | Passou; repetido após os novos arquivos de teste                                                        |
| `npm.cmd run format:check`                                     | Passou, incluindo os novos scripts e documentação                                                       |
| `npm.cmd run build`                                            | Passou nas execuções de test/UI/recortes/pack                                                           |
| `npm.cmd test`                                                 | 149 testes, 149 passaram, zero falhas; cadastros HTTP/mnr e smoke desktop passaram                      |
| `npm.cmd run test:ui`                                          | Todos os módulos locais, ciclo integrado, teclado/responsividade e reaberturas passaram                 |
| `npm.cmd run test:vendas`                                      | 4 testes e cenário real passaram                                                                        |
| `npm.cmd run test:financeiro`                                  | 45 testes e quatro cenários reais, incluindo a consolidação, passaram                                   |
| `npm.cmd run test:correcoes`                                   | 8 testes e cenário/reabertura passaram                                                                  |
| `npm.cmd run test:reembolsos`                                  | 11 testes e cenário/reabertura passaram                                                                 |
| `npm.cmd run test:consolidacao`                                | 2 testes e ciclo integrado/reabertura passaram                                                          |
| `npm.cmd run pack`                                             | Executável Windows x64/ASAR gerado com sucesso                                                          |
| `node scripts/verify-package.mjs`                              | 45 bundles de produção; testes, scripts e caches excluídos                                              |
| Seis `*-ui-smoke.mjs --development`                            | Compras, Vendas, Financeiro, Recebimentos, Correções e Reembolsos passaram; último com `--consolidacao` |
| Seis `*-package-smoke.mjs`                                     | Todos passaram; último com `--consolidacao`, offline emulado e novo processo                            |
| `node scripts/smoke.mjs release/win-unpacked/MNR Perfumes.exe` | Passou, incluindo Perfumes/Pessoas/Estoque                                                              |
| `node scripts/smoke.mjs --development`                         | Passou; Electron/Angular reiniciados em ambiente isolado                                                |
| `node scripts/benchmark-financeiro.cjs`                        | Três volumes concluídos e integridade/reconciliação válidas                                             |
| `node scripts/benchmark-financeiro-ui.mjs`                     | Seis ações medidas no renderer real, snapshot integral sem alterações                                   |

O pipeline de recortes/HTTP/pacote registra 20 verificações com exit code 0 em
`.cache/4e2e-results.json`. Há avisos de GPU no encerramento de alguns hosts;
as asserções e os processos terminaram com sucesso. Não foram usados retries
indiscriminados para obter aprovação.

Logs desta execução em `.cache/4e2e-*.log`. Mensagens de erro explicitamente
injetadas após commit são esperadas nos testes de resposta perdida, e não
falhas do produto. O status final de cada processo deve ser conferido.

## Arquivos alterados

- `README.md` e este relatório: estado atual, resultados e planejamento reservado.
- `package.json`: recortes `test:consolidacao`, `benchmark:financeiro`; inclusão
  do teste nos recortes financeiro e UI, preservando o cenário D como parte do fluxo.
- `tests/helpers/consolidacao-fixture.cjs`: cadastros, compra e modalidades de venda.
- `tests/consolidacao-financeiro.test.cjs`: duas integrações com histórico e reabertura.
- `scripts/consolidacao-scenario.cjs`: ciclo real pelas telas e comparação oficial.
- `scripts/benchmark-financeiro.cjs`: geração isolada e medição reproduzível.
- `scripts/benchmark-financeiro-ui.mjs` e `scripts/benchmark-financeiro-ui-desktop.cjs`:
  cópia consistente do fixture final e medição real de consultas na interface.
- `scripts/reembolsos-ui-smoke.mjs`: flag de consolidação propagado ao host.
- `scripts/reembolsos-ui-desktop.cjs`: seleção do cenário, IDs para reabertura e
  asserção de teclado corrigida.
- `scripts/reembolsos-package-smoke.mjs`: seleção do cenário ampliado no executável.

## Limitações, próximas etapas e validação manual

Não executados: Windows 11 próprio, instalação/atualização/desinstalação NSIS,
máquina fisicamente sem rede, leitor de tela e assinatura digital. Offline de
pacote é emulação CDP, não substitui desconexão física. A nova integração prepara
cadastros pela API tipada; criação/edição visual de cada cadastro é verificada na
regressão cadastral separada. Medições de serviço cobrem três volumes; medição de
interface cobre o volume final e três tamanhos de histórico. Não substituem ensaio
prolongado no hardware do proprietário. Validação humana continua necessária.

Permanecem reservadas, sem implementação nesta entrega:

- **4F — Dashboard e Relatórios:** indicadores gerenciais, relatórios financeiros,
  exportações Excel/PDF.
- **4G — Correções de Compras e Ajustes de Estoque:** devolução a fornecedor,
  cancelamento de compra e estorno de ajuste manual.
- **Etapa 5 — Preparação para entrega:** backup/restauração pela interface,
  instalador, distribuição/máquina limpa, validação final do proprietário e entrega.

Recomenda-se ao proprietário repetir o ciclo financeiro da tabela em banco de
homologação, conferir textos e vínculos, alternar modalidades no editor, corrigir
um valor excedente, consultar uma dependência bloqueada, navegar e fechar durante
confirmação, conferir teclado/zoom e reabrir o aplicativo. Usar somente dados de
homologação para esses ensaios. Aguardar validação manual antes de 4F/4G.
