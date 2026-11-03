# Etapa 4D.1 — Gestão de estoque

Entrega autorizada separadamente da 4D.2. Implementa consultas e operações reais
de estoque na interface Angular, sem implementar compras ou formas de pagamento.
Ambiente de validação: Windows 10 build 19045 x64, Electron 43.8.6.

## Interface

- `#/estoque`: pesquisa por nome/SKU, ativos/inativos/todos, filtro abaixo do mínimo,
  páginas de 25, saldo disponível, mínimo, valor do saldo e média unitária arredondada.
- Estoque baixo significa quantidade estritamente menor que o mínimo. Saldo zero
  aparece como “Sem estoque”. O total monetário corresponde ao filtro inteiro,
  não apenas à página. Mudanças de filtro reiniciam a paginação.
- `#/estoque/:id`: identificação, saldo/versionamento, operações manuais e histórico.
  Entradas, saídas, perdas e contagens são explicitamente distinguidas de compras
  e pagamentos. Produtos inativos continuam aceitando ajustes, conforme a 3B.
- Histórico usa cursor crescente por ID, páginas de 25 e indicação textual de
  ajustes originados de contagem. Exibe valores, saldo/versão posteriores, operação,
  justificativa, data efetiva e registro UTC. Naturezas comerciais existentes são
  somente consultáveis. Os custos exibidos provêm do backend.
- Tema, tokens, tabelas/cartões compactos, Field, Button, ContentState, Badge e
  Confirm reutilizam a 4B/4C. O diálogo compartilhado passou a preservar quebras
  de linha e oferece foco opcional no título para iniciar a revisão pelo resumo,
  inclusive em zoom alto.

## Operações e recuperação

Todo comando exige UUID, justificativa e data efetiva real não futura. A confirmação
mostra produto/SKU, operação, quantidade, custo informado quando aplicável, data,
justificativa e impacto. Não há envio automático ao preencher ou abrir a revisão.

- Entrada exige quantidade positiva e **custo total da entrada**, inclusive zero.
- Saída/perda exige quantidade positiva; não aceita custo informado. A interface
  previne insuficiência evidente e o backend verifica o saldo na transação.
- Contagem usa quantidade física e a versão do saldo consultado. Sobra exige o
  custo total da diferença positiva; falta usa o custeio existente do backend.
- Conflito de versão conserva o preenchimento e exige nova leitura e revisão.
- **Contagem sem diferença registra somente operação e auditoria.** Não cria
  movimento zero, não altera a versão e não aparece como movimento no histórico.
  Esta tela não consulta eventos de auditoria; a limitação é informada na própria
  interface. O sucesso da contagem informa sua identificação mesmo sem movimento.

Cada intenção possui cópia privada do comando e UUID. Envios concorrentes compartilham
a promessa. BUSY, falha IPC ou erro interno conservam a intenção, bloqueiam edição e
navegação conflitante e oferecem repetição explícita do mesmo comando. Não há retry
automático. Conflito de idempotência bloqueia substituição automática da chave.

Após sucesso, o resultado original é apresentado e o saldo/histórico são consultados
novamente. Uma falha nessa consulta não refaz a gravação. Guardas protegem alterações
não salvas e operações incertas; editores são recriados ao trocar de ID. Há proteção
adicional contra fechamento/recarga normal. Encerramento abrupto perde a intenção em
memória; não existe recuperação automática de UUID após reiniciar.

## Contratos e segurança

`window.mnrApi.estoque` expõe exclusivamente sete métodos, cada um com um argumento:

| Método              | Canal                          | Entrada                                                                          |
| ------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| listar              | `estoque:listar`               | busca, ativo, somenteBaixo, limite, deslocamento                                 |
| obter               | `estoque:obter`                | produtoId                                                                        |
| listarMovimentacoes | `estoque:listar-movimentacoes` | produtoId, aposId, limite                                                        |
| registrarEntrada    | `estoque:registrar-entrada`    | ComandoEstoque com produtoId, quantidade, custoTotalCentavos                     |
| registrarSaida      | `estoque:registrar-saida`      | ComandoEstoque com produtoId, quantidade                                         |
| registrarPerda      | `estoque:registrar-perda`      | ComandoEstoque com produtoId, quantidade                                         |
| registrarContagem   | `estoque:registrar-contagem`   | ComandoEstoque com produtoId, quantidadeContada, versaoEsperada e custo opcional |

DTOs e erros públicos estão em `shared/estoque-ipc.ts`. São reutilizados os contratos
de saldo, contagem, comando e resultado existentes. A API manual não aceita origem
de movimento, SQL, caminhos, natureza arbitrária ou operação comercial.

Os handlers validam aridade e objetos fechados; os serviços validam tipos, textos,
inteiros seguros, datas e limites. Todas as operações passam pela validação existente
de janela, webContents, frame principal e URL exata, preservando somente o hash de rota.
Erros são sanitizados. Não há exposição de Electron, Node, SQLite ou filesystem ao
renderer, nem alteração de CSP, permissões ou preferências de isolamento.

As novas consultas são somente leitura e usam snapshots transacionais. A pesquisa
preserva normalização de acentos e busca literal por nome/SKU. Filtros precedem a
paginação; o limite público é de 200. O histórico reutiliza o serviço da 3B.

**Precisão:** custo médio de exibição é calculado no main por BigInt/half-up para
centavos e transmitido como texto decimal; saldo zero recebe null. Não é base para
qualquer gravação. O valor total filtrado é acumulado com BigInt e transmitido como
string de centavos para suportar somas superiores a Number.MAX_SAFE_INTEGER. O Angular
apenas converte texto de entrada para inteiros, formata valores e mostra diferenças
de quantidade. Não calcula custos oficiais, rateios ou saldos monetários.

`electron/services/estoque.ts`, regras de custeio, serviços comerciais e migrações
0001–0005 permanecem intactos. Não há dependências ou migrações novas. Não há reparo
automático nem recriação de banco.

## Testes

- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run format:check` e
  `npm.cmd run build`.
- `npm.cmd test`: **110 testes aprovados**, integração Angular nos endereços HTTP
  local e mnr, e smoke desktop offline. Inclui todos os testes anteriores de
  estoque/custeio, concorrência, transações, rollback, migrações e financeiro.
- Novos testes IPC: consultas, filtros, paginação, média/resíduos, produtos inativos,
  insuficiência, contagem versionada, contagem sem diferença, repetição idempotente,
  rollback após falha de auditoria, entradas inválidas e mensagens sanitizadas.
- Agregado real de 1.002 produtos com custo máximo comprova transmissão exata acima
  do limite seguro de number. Preload expõe somente sete operações fixas de estoque.
- A matriz de remetentes não autorizados exercita todos os handlers registrados,
  incluindo estoque, antes de qualquer acesso ao banco. Canais de compras continuam
  ausentes. Asserções da integração anterior foram atualizadas para a superfície nova.
- `npm.cmd run test:ui`: renderer/preload/IPC reais, entradas/saídas/perdas, contagens
  com sobra/falta/sem diferença, conflito de versão com preservação do preenchimento,
  insuficiência concorrente, perda de resposta após commit e falha de releitura.
- Interface: paginação de produtos/histórico, falha/repetição de consulta, resposta
  antiga ignorada, confirmação/Escape, navegação protegida, Tab, foco e gravação offline.
  Matriz 1366×768, 1000×700 e 640×480, zoom 100%, 125% e 150%, incluindo formulários,
  histórico e sidebar. Capturas sob `.cache/ui/estoque-*`.
- Regressão completa existente de Perfumes/fotografias, Clientes e Fornecedores.
  Cada execução usa banco, imagens e Chromium exclusivos sob `.local-data/test` e
  verifica o hash da base de desenvolvimento. Interceptações ficam no host de teste.
- Pacote Windows: `npm.cmd run pack`, `node scripts/verify-package.mjs` e
  `node scripts/smoke.mjs "release/win-unpacked/MNR Perfumes.exe"`. O smoke testa
  consulta e contagem sem diferença pela interface real e preserva os vínculos
  comerciais preparados exclusivamente na fixture isolada.
- Desenvolvimento reiniciado pelo runner isolado `node scripts/smoke.mjs --development`,
  que utiliza a entrada de `npm.cmd run dev`, sem acessar o banco de desenvolvimento.

## Limitações e próxima entrega

- Não há consulta de auditoria; contagens sem diferença são confirmadas, mas não
  listadas como movimentos. Não há inventário em lote ou exportação de relatórios.
- Paginação não mantém um snapshot entre páginas; novas leituras refletem mudanças
  posteriores. A ordem do histórico é ID de registro, não data retroativa.
- Média exibida é arredondada; somas totais e valores de saldo permanecem exatos.
- Intenções permanecem somente em memória durante a sessão.
- Windows 11, instalação/atualização NSIS e máquina limpa offline não foram validados
  nesta máquina; emulação offline não substitui esses ensaios externos.
- **4D.2 não implementada.** Antes dela, revisar o plano para cadastro, consulta e
  inativação seguros de formas de pagamento com os serviços existentes, sem sementes
  ou dados fictícios automáticos. A revisão/implementação depende de nova aprovação.

## Arquivos

Criados:

- `shared/estoque-ipc.ts`
- `electron/services/estoque-consulta.ts`
- `electron/ipc/estoque.ts`
- `src/app/core/estoque.service.ts`
- `src/app/features/estoque/estoque.ts`, `estoque.html`, `estoque.scss`
- `src/app/features/estoque/detalhe.ts`, `detalhe.html`, `detalhe.scss`, `format.ts`
- `tests/estoque-ipc.test.cjs`
- `scripts/estoque-ui.cjs`
- `docs/etapa-4D1-gestao-estoque.md`

Modificados:

- `shared/contracts.ts`, `shared/estoque.ts` (neste último, somente comentário)
- `electron/ipc/index.ts`, `electron/preload/index.ts`
- `electron/main/index.ts` (ampliação do smoke já existente)
- `src/app/core/desktop.service.ts`, `navigation.ts`, `route-reuse.ts`
- `src/app/shared/ui/confirm.ts`
- `tests/cadastros-ipc.test.cjs`, `tests/angular/main.ts`
- `scripts/cadastros-desktop.cjs`, `scripts/ui-desktop.cjs`
- `README.md`

Nenhum commit ou push automático.
