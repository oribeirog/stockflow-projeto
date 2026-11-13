# 4G.1 — Correções de compras

## Estado da execução

Implementação técnica e verificações automatizadas concluídas em 12/11/2026.
Aguarda validação manual do proprietário antes da 4G.2. O último ajuste foi
validado com 181 testes gerais, dez específicos, UI completa, HTTP, novo pacote,
ASAR e reabertura. A tentativa com timeout de captura está preservada; a repetição
integral da consolidação gerencial no pacote passou com 174 arquivos válidos.
Base inicialmente limpa no commit `27b68ae` (4F.4), precedido por `b949a1c`
(4F.3). Aprovação manual das etapas anteriores informada pelo proprietário.
Nenhuma alteração não commitada encontrada ou descartada. Sem commit/push.

## Diagnóstico anterior às alterações

Conferidos AGENTS.md, README, relatórios 3A–3D, 4D.1/4D.2, 4E.2 e 4F,
migrações, serviços comerciais, estoque/custeio, financeiro, correções,
contratos, IPC/preload, rotas, Compras e correções de Vendas, componentes MNR
e Builder. `git status`, diff e commits confirmaram a base limpa.

As operações `createCorrectionService.devolverCompra` e `cancelarCompra` já
existiam na 3D. Faltavam fronteira pública de revisão/confirmação, consultas de
compra corrigida, tela e testes integrados. Não há necessidade de migração ou
dependência nova. As migrações 0001–0005 e algoritmos de custo não são alterados.

## Regras existentes preservadas

Compras confirmam rascunhos versionados com snapshots históricos de fornecedor,
SKU, descrição, quantidades, preços, descontos e rateios. O custo de aquisição
inclui mercadoria líquida, frete e despesas; confirmação registra entrada no
estoque e pagamento integral. A média móvel persiste quantidade/valor e versão;
`custoSaida` usa BigInt e arredondamento half-up, retirando todo o resíduo na saída
integral. `reversaoAcumulada` distribui os centavos históricos de devoluções
sucessivas. Produtos são únicos por documento, inclusive na migração vigente.

Devolução de compra não é cancelamento parcial: cria `DEV_COMPRA`, vincula cada
item ao original e cada saída ao movimento original. Valida quantidade documental
acumulada e saldo físico atual. Usa custo médio atual para a saída, sem alterar
custos de vendas anteriores. Mercadoria é rateada pelo histórico, sem devolver
frete/despesas. A diferença mercadoria menos custo retirado fica em
`resultado_ajuste_centavos`, podendo ser negativa. Não há ajuste artificial de
estoque. Movimentos posteriores não proíbem toda devolução; exigem saldo suficiente.

Cancelamento cria `ESTORNO`, reverte integralmente quantidades e custos originais,
incluindo frete/despesas, e marca o original `ESTORNADO`. Exige compra confirmada,
ausência de correção efetiva anterior e ausência de qualquer movimento posterior
nos produtos da compra. Não resolve dependências em cascata. Originais e movimentos
permanecem no histórico.

**Limitação financeira formal da 3D:** devolução exige reembolso integral e
imediato da mercadoria pelo fornecedor. As formas/valores informados devem
representar dinheiro já recebido; a operação cria `REEMBOLSO_FORNECEDOR/ENTRADA`.
Não há crédito, obrigação pendente, contas a pagar ou recebimento futuro de
fornecedor. A interface informa essa condição antes da revisão e da confirmação,
sem preencher reembolso fictício. Mercadoria sem valor admite pagamentos vazios.
Cancelamento preserva `PAGAMENTO_COMPRA` e registra `ESTORNO_FINANCEIRO` oposto,
vinculado a cada pagamento original, conforme a 3D. A revisão mostra esses efeitos.

## Arquitetura e segurança

`prepararCompra` em `correcoes.ts` é somente leitura e compartilhada com a
gravação legada. Reutiliza custeio e rateio existentes; não simula escrita/rollback.
`correcoes-compras.ts` projeta contexto, lista paginada por cursor e detalhe,
revisão e confirmação. Objetos públicos não expõem auditoria interna ou SQL.

Sete métodos literais em `window.mnrApi.correcoesCompras`: `obterContexto`,
`listarDocumentos`, `obterDocumento`, `revisarDevolucao`, `revisarCancelamento`,
`devolver` e `cancelar`. Canais fixos `correcoes-compras:*`; não há dispatcher.
Registro protegido verifica WebContents, frame principal e URL. Fronteiras
validam aridade, campos fechados, vínculos, inteiros, datas locais reais/não
futuras, motivo, UUID v4 e impressão SHA-256. Erros são sanitizados.
Sandbox, contextIsolation, CSP e Node desabilitado no renderer permanecem.

Impressão cobre comando normalizado/motivo, documento/itens/correções, movimentos
financeiros, saldos/movimentos dos produtos e formas usadas no reembolso. Revisão
não reserva estoque. Confirmação nova confere impressão dentro da transação
IMMEDIATE que delega à 3D. UUID persistido segue primeiro o replay legado; não
exige estado atual igual ao antigo. Conteúdo diferente conflita. Tipos, versão 1
do hash, normalização e respostas persistidas permanecem compatíveis.

## Interface

Compra original → Correções e movimentos vinculados → Devolver/Cancelar →
Preenchimento → Revisão oficial → Confirmação explícita → Documento/movimentos.
Rotas `/compras/:id/correcoes`, `/compras/:id/devolver`, `/compras/:id/cancelar`.
O histórico também aceita `?documentoId=…`, validando o vínculo no main.

Exibe fornecedor/produto/SKU históricos, adquirido/corrigido/restante, estoque
físico e quantidade disponível para revisão. Preencher integral utiliza o menor
limite oficial documental/físico; custo e dependências são revalidados no backend.
Cancelamento inelegível mostra motivo; não oferece ação habilitada no histórico.
Custos originais, custo retirado, saldo anterior/posterior e ajuste são distintos.
Angular apenas converte entradas e formata DTOs; não calcula custo ou dinheiro.

Intenção tem UUID e cópia privada; promessa compartilhada evita envio duplicado.
Resposta incerta preserva comando, bloqueia edição/navegação/fechamento e oferece
repetição explícita. Campos mudados invalidam revisão; erros corrigíveis preservam
preenchimento. Sucesso com falha de releitura continua sucesso e oferece consulta.
Outra devolução cria nova intenção. Intenções ficam apenas em memória, como nas
etapas anteriores: após encerramento abrupto, consultar histórico antes de tentar
nova operação. Não há recuperação automática de intenção após reinicialização.

## Cenários e evidências de integridade

Dez testes específicos estão em `tests/correcoes-compras.test.cjs`. Não dependem
somente de arquivos existentes ou de mensagens de sucesso. Comparam saldos,
valores, vínculos, documentos/movimentos, resultados idempotentes e snapshots
integrais das tabelas; executam `integrity_check` e `foreign_key_check`.

| Cenário                                                                | Resultado comprovado nos serviços/IPC                                                                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compra 10 × R$ 20; compra posterior 10 × R$ 40; devolver 2 da primeira | Mercadoria R$ 40; custo atual retirado R$ 60; ajuste −R$ 20; sem trocar snapshots pelos nomes atuais                                                                       |
| Devoluções sucessivas de 2, 3 e 5                                      | Esgotam somente as 10 unidades documentais da primeira compra; três documentos distintos; cursor sem repetição/omissão                                                     |
| Comprar 10, vender 4, tentar devolver 7                                | INSUFFICIENT_STOCK, nenhuma escrita; devolver as 6 físicas restantes é permitido; custo histórico da venda preservado                                                      |
| Cancelar compra elegível                                               | Retirada integral do custo original; pagamentos originais preservados e estornos vinculados; replay e reabertura sem novos efeitos                                         |
| Compra de 3 centavos + 2 de frete + 1 de despesas                      | Cancelamento retira exatamente os 6 centavos; não usa custo médio arredondado exibido                                                                                      |
| Três unidades com líquido total de 1 centavo                           | Devoluções sucessivas com líquidos 0/1/0 centavo, preservando total e resíduo; não cria dinheiro de valor zero                                                             |
| Vários produtos                                                        | Itens, quantidades e custos independentes no mesmo corretivo, sem misturar IDs de compras diferentes                                                                       |
| Referências inativas/renomeadas                                        | Produto e fornecedor históricos permanecem utilizáveis; forma de reembolso nova precisa estar ativa                                                                        |
| Revisão somente leitura                                                | Devolução/cancelamento/contexto com query_only=ON; comparação integral antes/depois sem escrita                                                                            |
| Duas conexões independentes                                            | Revisões do mesmo estado: uma confirma e outra conflita; mesmo UUID concorrente retorna resultado igual sem duplicação                                                     |
| Resposta perdida/compatibilidade                                       | Comando persistido pela 3D é repetido pelo novo adaptador após mudanças; conteúdo diferente no UUID é recusado                                                             |
| Rollback                                                               | Falhas em documentos, itens, estoque, dinheiro e auditoria, tanto devolução quanto cancelamento, restauram todas as tabelas                                                |
| Fronteiras inválidas                                                   | Aridade, campos extras, SQL/paths, datas, IDs cruzados, zero/negativos/excessos, UUID/impressão, formas e estados são recusados sem escrita                                |
| Indicadores e arquivo                                                  | Após devolver 2 unidades de R$ 20, posição oficial é 8 unidades/R$ 160 e XLSX de estoque contém os mesmos valores; reembolso de fornecedor não vira recebimento de cliente |

O teste de registro/preload continua verificando a superfície fechada inteira,
agora com 84 handlers, incluindo os sete novos, recusando remetente/frame indevido
antes de tocar SQLite. A matriz existente cobre URL inválida. Os sete métodos do
preload são chamados no teste para conferir canal e aridade reais.

## Interface real, concorrência e ambientes

`scripts/correcoes-compras-smoke.mjs` usa renderer Angular, preload e IPC de
produção. Abre compra, segue o link real de correções, devolve parcialmente,
corrige excesso sem sair, invalida revisão ao editar, devolve o restante,
consulta documento/movimentos, cancela outra compra e confere bloqueio com
movimentação posterior. A reabertura em novo processo compara todas as tabelas.
Fixtures são criadas pelos serviços comerciais oficiais, sem SQL comercial
artificial. A regressão existente de Compras também cria/confirma compra pelo
formulário real. Não se alega que a preparação das fixtures seja digitação na UI.

O host exclusivo local/HTTP injeta perda de resposta **depois do commit** e falha
de consulta após sucesso. Confere repetição idêntica do comando/UUID, duplo clique,
proteção de navegação, ausência de duplicação e sucesso preservado após erro de
leitura. Esses hooks não entram no preload nem no ASAR.

O ensaio final foi ampliado: uma venda real, em outra conexão, consome um dos
dois produtos depois da revisão. A confirmação deve conflitar; consultar novamente
preserva campos e permite desmarcar o item agora indisponível, revisar e devolver
somente o outro. Nenhuma saída manual simula a correção. Esse recorte passou
após o último ajuste do checkbox nos três ambientes, incluindo reabertura.

Testa Tab, Shift+Tab, Enter, Escape, foco na revisão/diálogo, retorno de foco,
erro associado ao campo, estados de processamento e resultado. As nove combinações
1366×768/1000×700/640×480 e 100%/125%/150% conferem ausência de overflow da página.
O harness CDP emula viewport/densidade equivalentes ao zoom; não é ensaio de DPI
físico do Windows. Tabelas têm rolagem própria. Produto longo com 90 caracteres
sem espaços verifica quebra do título, preservando a identidade visual existente.

Ambiente: Windows 10 Pro x64 10.0.19045, Node 26.13.0, Electron 43.8.6. Bancos,
perfis Chromium, imagens e arquivos ficam em raízes exclusivas sob
`.local-data/test`. Pacote recebe LOCALAPPDATA isolado apenas no processo filho.
Nenhum banco real foi usado como fixture ou substituído. Rede offline emulada
não equivale a máquina fisicamente desconectada.

| Ambiente 4G.1, fechamento após o último ajuste | Banco/perfil exclusivos       | Evidência                                       |
| ---------------------------------------------- | ----------------------------- | ----------------------------------------------- |
| mnr://app                                      | `ui-correcoes-compras-qo6v7V` | CORRECOES_COMPRAS_UI_OK / REOPEN_OK             |
| HTTP Angular                                   | `ui-correcoes-compras-yA0LoZ` | UI_OK / REOPEN_OK                               |
| Executável/ASAR offline emulado                | `ui-correcoes-compras-h7CNFd` | UI_OK / REOPEN_OK; snapshot integral preservado |

Raízes e horários constam dos logs de fechamento. O novo pacote final passou
PACKAGE_ISOLATION_OK com 49 bundles de renderer, worker/ExcelJS presentes e
testes/scripts/caches excluídos. Pack, verificação ASAR, os três ambientes da
4G.1 e smokes gerais HTTP/pacote foram repetidos após a revisão final da interface.

## Resultados das regressões

Índice principal: `.cache/4g1-final-results.json`, executor
`.cache/verify-4g1.ps1`, logs `.cache/4g1-final-*.log`. Fechamento pós-ajuste:
`.cache/close-4g1.ps1`, `.cache/4g1-closing-results.json` e logs correspondentes.
Timestamps e códigos de saída são a evidência; logs incompletos não são aprovação.

| Comando                                 | Rodada principal comprovada                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| typecheck / lint / format:check / build | Passaram; repetidos no fechamento                                                    |
| npm.cmd test                            | 181/181, integração cadastral HTTP/local e smoke desktop passaram                    |
| test:ui                                 | Passou; fechamento completo após o ajuste final também passou                        |
| test:vendas                             | 4/4 e UI passaram                                                                    |
| test:financeiro                         | 45/45 e fluxos visuais passaram                                                      |
| test:correcoes                          | 8/8 e UI/reabertura passaram                                                         |
| test:reembolsos                         | 11/11 e UI/reabertura passaram                                                       |
| test:consolidacao                       | 2/2 e ciclo integrado passaram                                                       |
| test:relatorios                         | 10/10 e smoke passaram                                                               |
| test:dashboard                          | 3/3 e smoke passaram                                                                 |
| test:exportacoes                        | 7/7 e 40 arquivos por leitores independentes passaram                                |
| test:consolidacao-gerencial             | 9/9 e 174 arquivos/ciclo local passaram                                              |
| test:correcoes-compras                  | 10/10 e UI/reabertura passaram; recorte final ampliado repetido com sucesso          |
| pack / verify-package                   | Passaram; novo pack após ajuste final também passou                                  |
| Dashboard/Relatórios, HTTP e pacote     | Passaram, com reabertura                                                             |
| Exportações, HTTP e pacote              | 40 arquivos em cada ambiente passaram, válidos após fechar                           |
| Consolidação gerencial HTTP             | 174 arquivos e checkpoints passaram                                                  |
| Consolidação gerencial pacote           | Tentativa com timeout preservada; repetição integral passou com 174 arquivos válidos |

O fechamento iniciou às 20:23 e terminou às 20:33 (São Paulo). Seus 14 comandos
terminaram com saída 0, após as últimas alterações de código/testes. Incluiu nova
suíte geral 181/181, test:ui completo, recorte 4G.1 10/10, HTTP, pack/ASAR,
4G.1 empacotada, smokes gerais HTTP/pacote e repetição integral da consolidação
gerencial no pacote. As suítes financeiras/gerenciais anteriores não tiveram
código afetado pelos ajustes finais de HTML/CSS e continuaram aprovadas.

O índice `.cache/4g1-consolidated-results.json` reúne o último resultado de cada
um dos 30 comandos/ambientes, sem apagar as tentativas anteriores. As seis rodadas
de exportação bem-sucedidas validaram 642 arquivos: 40 por ambiente no smoke 4F.3
e 174 por ambiente na consolidação gerencial. Geradores são os existentes; não
foram criados novos modelos. Os arquivos foram abertos por leitores independentes
e conferidos após fechar o aplicativo. O teste específico também abre o XLSX de
estoque após uma correção de compra e compara os valores oficiais.

## Problemas encontrados e correções

- Enter CDP inicialmente não enviava texto de caractere; corrigido no harness.
- Checagem `input.disabled` não considerava fieldset; substituída por `:disabled`.
- Expressão de seletor DOM tinha aspas incorretas; corrigida sem mudar o produto.
- Espera de rAF no harness ficou sem retorno; removida espera indefinida e
  aplicada emulação de foco, com captura limitada ao viewport.
- A fixture de compra com valor zero precisava do motivo de bonificação exigido
  pela 3C; corrigida a fixture, preservando a regra de produção.
- Harness cadastral não removia os sete handlers novos entre janelas. A limpeza
  passou a incluí-los; repetição geral passou, mantendo todas as asserções.
- Textos novos com acentos corrompidos foram corrigidos; título de produto longo
  recebeu quebra de palavras no componente novo.
- Checkbox de item selecionado que perde disponibilidade após nova consulta
  passou a permitir desmarcação, sem permitir nova seleção indisponível.
- Consolidação gerencial do pacote teve timeout em `Page.captureScreenshot` no
  checkpoint de rankings. Não se comprovou a causa. A tentativa fica registrada
  como falha, sem atribuí-la à regra financeira; a repetição integral posterior
  passou, incluindo o mesmo checkpoint, reabertura e os 174 arquivos.

Tentativas e falhas preservadas em `.cache/4g1-specific-*`,
`.cache/4g1-format-first-failure.log`, `.cache/4g1-cadastro-harness-failure.log`
e no índice principal. Não foram removidas asserções, relaxada a segurança ou
adotadas mudanças transacionais para fazer testes passarem.

## Arquivos

Criados:

- `shared/correcoes-compras-ipc.ts`.
- `electron/services/correcoes-compras.ts`, `electron/ipc/correcoes-compras.ts`.
- `src/app/core/correcoes-compras.service.ts`.
- `src/app/features/compras/correcao.ts`, `correcao.html`, `correcao.scss`,
  `correcoes.ts` e `correcoes.html`.
- `tests/correcoes-compras.test.cjs`, `tests/helpers/correcoes-compras-fixture.cjs`
  e `correcoes-compras-worker.cjs`.
- `scripts/correcoes-compras-host.cjs`, `scripts/correcoes-compras-smoke.mjs`.
- Este relatório e cinco capturas em `docs/evidencias-4G1`.

Modificados:

- `electron/services/correcoes.ts` (preparação de compra compartilhada, mantendo
  tipos/normalização/hashes e gravação da 3D).
- `electron/ipc/index.ts`, `electron/preload/index.ts`, `shared/contracts.ts`.
- `src/app/core/desktop.service.ts`, `src/app/core/navigation.ts`.
- `src/app/features/compras/editor.ts` e `editor.html` (acesso ao histórico).
- `tests/cadastros-ipc.test.cjs`, `scripts/cadastros-desktop.cjs`.
- `package.json` (recorte específico e inclusão no test:ui), `README.md`.

Sem diff em migrações 0001–0005, algoritmos de custeio/rateio, serviço financeiro,
trust, main, Builder ou lockfile. Sem novas dependências. Artefatos de execução
ignorados ficam em `.cache` e `.local-data/test`, fora do pacote.

## Capturas inspecionadas

Capturas representativas foram abertas para inspeção de textos, valores, contraste
e quebra de linhas. O conjunto completo das matrizes fica em `.cache/ui/correcoes-compras-*`.
As imagens abaixo usam exclusivamente dados fictícios.

- [Formulário local](evidencias-4G1/formulario-local.png).
- [Revisão com nome longo](evidencias-4G1/revisao-local.png).
- [Revisão HTTP compacta](evidencias-4G1/revisao-http-compacta.png).
- [Cancelamento no pacote](evidencias-4G1/cancelamento-pacote.png).
- [Resultado no pacote](evidencias-4G1/resultado-pacote.png).

## Limitações e validação manual

Revisão não reserva estoque. Histórico paginado não mantém snapshot entre chamadas.
Intenção pendente permanece em memória; encerramento abrupto exige consultar os
documentos antes de criar outra operação. Não existe desfazimento de cancelamento
nem estorno de devolução de compra pela nova interface. Não se introduziu controle
financeiro de pendências do fornecedor. Sem benchmark de milhões de movimentos.

Windows 11, leitor de tela, DPI físico, máquina limpa, instalador e offline físico
não foram validados nesta máquina. ASAR/unpacked não é entrega de instalador.
Validação manual do proprietário continua necessária.

Checklist para homologação, usando somente dados de teste:

- Criar/confirmar compra; abrir detalhe e Correções e movimentos vinculados.
- Conferir fornecedor/produtos/SKU históricos e pagamentos originais.
- Devolver parcialmente, informando apenas reembolso realmente recebido.
- Conferir revisão: custo atual retirado, valor histórico e ajuste de resultado.
- Cancelar o diálogo; conferir retorno de foco e ausência de escrita.
- Confirmar e consultar documento, estoque e dinheiro vinculados.
- Devolver quantidades restantes e tentar excesso, corrigindo no formulário.
- Conferir produto/fornecedor inativos e renomeados.
- Cancelar compra elegível; verificar custo original, frete e pagamentos.
- Conferir bloqueio após consumo/movimento posterior/devolução anterior.
- Alterar estoque após revisão, consultar e revisar novamente sem perder campos.
- Conferir teclado, tamanhos/zoom, reabertura e valores em Dashboard/Relatórios.

4G.2 (estorno de ajustes), 4G.3 e Etapa 5 permanecem futuras. Não há contas a
pagar, crédito de fornecedor, backup/restauração ou instalador nesta entrega.
