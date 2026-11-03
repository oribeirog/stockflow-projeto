# Etapa 4E.1 — Vendas

## Entrega e autorização

Implementada exclusivamente a 4E.1, conforme planejamento aprovado. A 4E.2 não
ganhou telas, namespaces IPC ou operações. Não foram alteradas as migrações
0001–0005 nem os serviços comerciais, financeiros, de correções ou custeio
existentes. Não foram adicionadas dependências. Não houve commit ou push.

Vendas oferece listagem paginada por estado/cliente, seleção paginada de perfumes,
clientes e formas de pagamento, rascunhos com versão, descarte lógico, descontos
por item/globais, preços editáveis, revisão oficial e confirmação à vista, a prazo
ou com entrada. Novos produtos usam o preço cadastrado como sugestão. Quantidades
e valores monetários respeitam os limites inteiros existentes.

Pagamentos e vencimentos são preparados na sessão e persistidos somente ao
confirmar. A saída avisa que precisarão ser preenchidos novamente. Não foi criada
persistência paralela no renderer. À vista permite cliente não informado; a prazo
exige cliente. Entrada deve ser positiva e menor que o total; entrada integral
deve ser lançada como venda à vista.

## Integração e integridade

`window.mnrApi.vendas` expõe sete operações específicas: listar, obter,
salvarRascunho, revisarPlano, confirmar, confirmarComEntrada e descartarRascunho.
Cada canal valida remetente, frame principal, URL autorizada, aridade e entrada.
Campos inesperados, IDs de outros tipos documentais, limites e datas inválidas
são rejeitados. Erros públicos são sanitizados. O renderer continua sem Node,
Electron, SQLite ou IPC genérico; sandbox, isolamento de contexto e CSP permanecem.

O novo serviço de fronteira delega toda gravação ao serviço comercial existente.
As projeções de histórico usam o resumo financeiro e as parcelas financeiras
existentes, mantendo snapshots dos documentos concluídos. Somente rascunhos
consultam nomes/SKU atuais. O recebido na confirmação é consultado pela operação
original de confirmação, e não pela soma das parcelas ou recebimentos posteriores.

A revisão é uma transação somente de leitura. Usa `somar`, `dividirParcelas`,
`dinheiro` e `custoSaida` existentes; não cria operação, auditoria, movimento ou
reserva de estoque. O backend divide os centavos pelos vencimentos informados.
Angular apenas converte entradas e apresenta os resultados oficiais.

O plano normalizado recebe uma impressão SHA-256, incluindo documento, versão,
modalidade de entrada, pagamentos e parcelas. Trata-se de identificação do plano,
não de credencial de autorização ou reserva de estoque. A interface conserva uma
cópia revisada e invalida a revisão ao alterar qualquer campo comercial ou
financeiro. A confirmação exige plano correspondente e revalida o estado atual,
na mesma transação imediata que contém a operação comercial.

Estoque insuficiente, custo atual que exija motivo, referência inativa e versão
desatualizada impedem a confirmação integral. Motivo por item permite venda abaixo
do custo, com aviso na revisão. Os custos históricos definitivos são os capturados
pelo serviço comercial na confirmação. Não há cálculo de custo no Angular.

Cada intenção conserva UUID e comando imutável. Resultado incerto bloqueia edição
e saída; repetição explícita reutiliza ambos. O serviço comercial permanece dono
da idempotência persistida. Uma projeção retornada em repetição pode refletir
recebimentos posteriores, mas não produz novos efeitos. Falha de atualização após
sucesso não repete a gravação. Após reiniciar o aplicativo, consultar o histórico;
não há fila persistida de intenções no renderer.

## Valores apresentados

- **Total vendido:** valor original do documento, preservado historicamente.
- **Recebido na confirmação:** dinheiro dos movimentos da confirmação original.
- **Saldo futuro na revisão:** restante oficial coberto pelas parcelas planejadas.
- **Saldo exigível atual:** resultado do resumo financeiro, considerando pagamentos,
  abatimentos e correções existentes.
- O detalhe também distingue líquido comercial, recebimentos e seus estornos,
  abatimentos, reembolsos pagos, estornos de reembolso e obrigações pendentes.

A parcela técnica ENTRADA aparece quitada e explicitamente identificada como já
incluída no recebido. Ela não é somada novamente como dinheiro. Vendas corrigidas
ou parcialmente pagas usam o resumo financeiro da 3D, inclusive na projeção do
campo de saldo público da venda. Não foram disponibilizadas ações da 4E.2.

## Testes e evidências

Ambiente: Windows 10 build 19045 x64, Node 26.13.0 e Electron 43.8.6.
Todos os novos testes usam diretórios exclusivos sob `.local-data/test`; o teste
do pacote redireciona LOCALAPPDATA exclusivamente no processo filho, para pasta
isolada no repositório. Bancos reais de produção/desenvolvimento não são fixtures.

| Verificação                               | Evidência                                                           |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Typecheck, lint e formatação              | Comandos padrão do projeto                                          |
| Build Angular, Electron e preload         | Build de produção e geração do pacote                               |
| Suíte de serviços/IPC                     | 120 testes aprovados, incluindo quatro cenários agrupados de Vendas |
| Integração cadastral real                 | `CADASTROS_ANGULAR_OK` em HTTP e protocolo local                    |
| Smoke desktop geral                       | `SMOKE_OK`, perfumes, pessoas e estoque offline                     |
| Regressão visual existente                | `DESKTOP_UI_OK`; rotas, cadastros, fotos, estoque e acessibilidade  |
| Vendas Electron local                     | `VENDAS_UI_OK`, `VENDAS_SCENARIO_OK`                                |
| Vendas por HTTP de desenvolvimento        | Mesmos marcadores, origem HTTP conferida                            |
| Executável Windows real                   | `VENDAS_PACKAGED_OFFLINE_OK`                                        |
| Reabertura do executável em novo processo | `VENDAS_PACKAGED_REOPEN_OK` sobre o mesmo banco isolado             |
| Inspeção ASAR                             | `PACKAGE_ISOLATION_OK`; testes, scripts e caches excluídos          |

Os testes de Vendas cobrem:

- Revisão sem qualquer escrita, divisão com resíduos de centavos, descontos,
  múltiplas formas, venda à vista, prazo sem entrada e prazo com entrada.
- Entrada quitada sem dupla contabilização; saldos oficiais e movimentos exatos.
- Estoque insuficiente, custo alterado entre revisão e confirmação, motivo por
  item, forma inativa e versão desatualizada, preservando o rascunho.
- Alteração do plano rejeitada; edição visual invalida a revisão anterior.
- Idempotência após resposta perdida e após reabertura; nenhum efeito duplicado.
- Falhas injetadas nas inserções de estoque, parcelas, financeiro, alocações e
  auditoria, comparando snapshots completos antes/depois do rollback.
- Rollback real durante confirmação pela interface nos três modos de execução,
  usando trigger exclusivamente no banco de teste, removido antes da nova revisão.
- Histórico de cliente/produto inativado ou renomeado; venda parcialmente recebida
  e posteriormente devolvida consultada pelo resumo existente.
- Aridade, objetos inválidos, campos inesperados, IDs cruzados, descarte repetido,
  filtros e ausência de canais de Financeiro/Correções.
- Rótulos nativos, Tab/Shift+Tab, Enter/Escape, foco no diálogo e restauração ao
  botão, 1366×768, 1000×700 e 640×480, com zoom 100%, 125% e 150%.

Capturas ficam em `.cache/ui/vendas-*.png`. A captura compacta de 640×480 a 150%
foi inspecionada visualmente; os nove pares tamanho/zoom passam na verificação de
ausência de transbordamento horizontal da página. Tabelas têm rolagem própria.

O reinício de desenvolvimento foi validado pelo harness oficial com fixtures
isoladas: `SMOKE_OK`, `PERFUMES_DEVELOPMENT_OK`, `PESSOAS_DEVELOPMENT_OK` e
`ESTOQUE_DEVELOPMENT_OK`.

Comandos para reproduzir, na raiz, com npm.cmd no PowerShell:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd test
npm.cmd run test:ui
node scripts/vendas-ui-smoke.mjs --development
npm.cmd run pack
node scripts/verify-package.mjs
node scripts/vendas-package-smoke.mjs
```

`test:vendas` oferece o recorte de serviços/IPC e interface local. `test:ui`
inclui o novo cenário de Vendas depois das regressões existentes e de Compras.

## Problemas encontrados e resolvidos

- A sandbox de automação bloqueou o esbuild ao ler diretórios ancestrais. Build e
  desktop foram executados com autorização externa, sem alterar ACLs ou segurança.
- Testes antigos fixavam a quantidade de canais e ausência de Vendas. Expectativas
  foram atualizadas para os sete canais específicos; ausência de Financeiro e
  Correções continua verificada.
- O harness cadastral alterna HTTP/protocolo local na mesma execução. Sua limpeza
  passou a remover também os handlers de Vendas antes de registrar novamente.
- O teste visual geral ainda esperava a página reservada de Vendas. Foi atualizado
  para reconhecê-la como módulo implementado.
- Validação do foco revelou a necessidade de restauração explícita ao cancelar a
  confirmação de venda; corrigida no editor, com teste de teclado.
- Em HTTP, emular offline antes de carregar módulos sob demanda impede buscá-los
  no servidor. O teste pré-carrega as rotas necessárias antes da emulação e libera
  a rede local para recarregar HTTP. Produção usa `mnr://app` e recarrega offline.
- O format:check encontrou vírgula excedente preexistente no import do editor de
  Compras. A única alteração nessa tela foi sua normalização pelo Prettier.
- Dois testes com teclado em execução simultânea disputaram o foco nativo de
  janelas. As verificações visuais finais devem rodar sequencialmente.
- Uma tentativa de smoke de desenvolvimento com banco isolado vazio falhou porque
  o smoke geral exige Pessoas com documentos vinculados. A repetição usou o harness
  oficial `node scripts/smoke.mjs --development`, que prepara essas fixtures e passou.

Mensagens de erro deliberadas sobre respostas perdidas nos testes são esperadas;
os cenários exigem recuperação idempotente e saída zero.

## Limitações e continuidade

Windows 11, instalação/desinstalação NSIS e máquina limpa offline não foram
executados nesta rodada. Validação de acessibilidade é estrutural e por teclado;
não equivale a ensaio com leitor de tela. A infraestrutura existente reconcilia
o histórico a cada gravação; escala de milhões de documentos não foi validada.

No HTTP de desenvolvimento, carga inicial e recarga precisam do servidor local.
Depois de carregar as rotas, os comandos IPC funcionam com rede emulada offline.
O executável empacotado foi exercitado offline; a reabertura confere o banco
persistido em novo processo. Não há reserva de estoque nem garantia do custo da
revisão até a confirmação.

A 4E.2 continua aguardando aprovação separada: área Financeiro, recebimentos
posteriores, devoluções/cancelamentos de vendas, reembolsos e estornos vinculados.
As consultas resumidas no detalhe de Vendas não antecipam essas operações.

**Pendência futura adicional:** disponibilizar interfaces para devolução de compra,
cancelamento de compra e estorno de ajustes manuais de estoque. Os serviços já
existem, mas essas interfaces estão fora da 4E.1 e da 4E.2 atualmente planejada.

## Arquivos criados ou modificados

Novos:

```text
shared/vendas-ipc.ts
electron/services/vendas.ts
electron/ipc/vendas.ts
src/app/core/vendas.service.ts
src/app/features/vendas/lista.ts
src/app/features/vendas/lista.html
src/app/features/vendas/editor.ts
src/app/features/vendas/editor.html
src/app/features/vendas/vendas.scss
tests/vendas-ipc.test.cjs
scripts/vendas-scenario.cjs
scripts/vendas-ui-desktop.cjs
scripts/vendas-ui-smoke.mjs
scripts/vendas-package-smoke.mjs
docs/etapa-4E1-vendas.md
```

Modificados:

```text
README.md
package.json
shared/contracts.ts
electron/preload/index.ts
electron/ipc/index.ts
src/app/core/desktop.service.ts
src/app/core/navigation.ts
src/app/core/route-reuse.ts
src/app/features/compras/editor.ts
tests/cadastros-ipc.test.cjs
tests/compras-ipc.test.cjs
scripts/cadastros-desktop.cjs
scripts/ui-desktop.cjs
```
