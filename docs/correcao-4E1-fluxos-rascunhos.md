# Correção da 4E.1 e dos rascunhos de Compras e Vendas

## Escopo e investigação

Correção restrita aos editores Angular e aos testes dos fluxos existentes. Sem
4E.2, dependências, migrações, canais IPC ou alterações nos serviços comerciais.
As alterações anteriores da 4E.1 já presentes no diretório foram preservadas.
Não houve commit nem push.

Foram lidos AGENTS.md, README, documentação 4E.1/4D.2, editores/templates,
serviços Angular, contratos compartilhados, preload, validação de remetentes,
handlers, adaptadores e normalização/transações comerciais existentes.

## Evidência anterior à correção

Reprodução em Electron 43.8.6 com Angular de produção, `mnr://app`, preload,
handlers reais e SQLite/perfil exclusivos em `.local-data/test/ui-vendas-*`.
O código dos editores ainda não havia sido alterado nesse momento.

1. Salvar venda à vista; escolher prazo; incluir parcela sem valor; revisar:
   erro monetário genérico, após uma gravação comercial desnecessária (versão 2).
2. Corrigir visualmente o valor para R$ 2,00: revisão a prazo pronta (versão 3).
   Isso comprova que o binding de valor/vencimento funcionava nesse build.
3. Trocar para à vista, informar Pix de R$ 2,00 e revisar: `VALIDATION`, com
   “Confira os campos, pagamentos e limites informados”, embora os controles
   visíveis estivessem preenchidos. A parcela continuava no array e no comando,
   oculta pelo template. Salvar novamente não limpava esse array.
4. Reabrir venda salva e configurar somente Pix: “Informe justificativa de até
   4.000 caracteres”. Mesma reprodução em compra salva e reaberta.

Os novos testes de reabertura também foram executados contra o build original:
ambos falharam (`true !== false`) porque o campo de justificativa continuava
obrigatório no documento salvo sem edição comercial.

**Limite da reprodução:** não se reproduziu um bloqueio universal de toda venda
a prazo válida, nem a mensagem literal relatada sobre prazo não preenchido.
O prazo corrigido foi revisado no build original. Não há evidência para atribuir
esse sintoma específico a bindings quebrados, UUID corrompido ou loading preso.
O bloqueio após transição para à vista e a justificativa repetida foram
comprovados. A validação manual do proprietário continua necessária.

## Causas e solução

### Vendas

O template ocultava parcelas ao escolher à vista, mas `plan()` sempre enviava o
array completo. Valores ausentes também podiam ser convertidos mesmo com os
campos ocultos. Parcelas positivas eram rejeitadas pelo backend na modalidade à
vista. A troca de modalidade agora invalida a revisão e limpa pagamentos,
parcelas e opção de entrada incompatíveis; o plano à vista usa defensivamente
uma lista vazia de parcelas. Cliente, produtos, preços e motivos por item são
preservados. Desmarcar entrada limpa somente seus pagamentos iniciais.

Parcelas, datas e pagamentos possuem validação de preenchimento, valor positivo,
formato e soma, com identificação do pagamento/parcela e foco no controle.
Os campos recebem associação acessível do erro. A divisão dos centavos continua
oficial no backend, assim como estoque, custo, total e revalidação na confirmação.
As verificações do renderer servem para orientar o preenchimento.

### Rascunhos dos dois módulos

`touch()` marcava `dirty` também para pagamentos/parcelas. Além disso, `review()`
exigia motivo incondicionalmente, mesmo antes de verificar se havia algo a salvar.
Reabrir não recuperava o motivo da operação anterior (corretamente mantido na
auditoria), mas a tela o exigia novamente para simples revisão financeira.

Cada editor guarda uma impressão dos dados comerciais normalizados adotados do
documento persistido. Alterações efetivas marcam pendência; reverter o
preenchimento ao conteúdo salvo remove a pendência. Pagamentos/parcelas apenas
invalidam a revisão. Documento salvo sem mudanças é revisado diretamente e o
botão de salvar não cria outra versão sem necessidade. Motivos de itens abaixo
do custo, gravação comercial e descarte continuam obrigatórios nos casos
existentes. Alterações comerciais não salvas passam pelo salvamento antes da
revisão, nunca confirmam silenciosamente valores antigos.

Ao consultar uma versão mais recente preservando edição local, a referência da
comparação também é atualizada. Antes desse ajuste, voltar a um valor da versão
antiga podia limpar `dirty` embora esse valor divergisse do documento atual.
Os testes dos dois módulos reproduzem conflito durante salvamento, preservação
dos campos, exigência de motivo para dados divergentes e revisão direta ao
retornar aos valores efetivamente persistidos na versão atual.

A inspeção das capturas encontrou ainda uma divergência visual: o fornecedor
carregado no estado aparecia como “Não informado” no seletor reaberto. O novo
teste confirmou `select.value === ''`, embora o fornecedor persistido fosse 1.
As opções dinâmicas surgiam após a atribuição de `select.value`. As opções de
fornecedor, cliente, pagamentos e modalidade agora refletem explicitamente a
seleção do modelo. Testes conferem o valor nativo visível, além do resultado IPC.

O contrato comercial exige um motivo não vazio também para confirmar. O editor
usa o motivo informado ou um texto específico de confirmação, contendo número e
versão, apresentado no diálogo antes da aprovação explícita. Esse texto integra
o comando imutável e a auditoria normal, sem alterar validações do backend.

**Modalidade de venda:** o contrato atual persiste A_VISTA/A_PRAZO no documento,
e a revisão consulta esse valor. Quando apenas a modalidade mudou, é necessário
salvar essa mudança uma vez, com versão esperada e motivo específico auditável.
Isso ocorre automaticamente antes de revisar, sem exigir nova justificativa dos
itens. Configurar valores, formas, entrada ou vencimentos na modalidade já salva
não chama `salvarRascunho`. Não se criou outra persistência financeira.

### Estados transitórios e saída

Erros definitivos continuam liberando a intenção; conflito de versão exige
consulta atualizada. Resultado incerto conserva o UUID e o conteúdo original,
bloqueando edição/saída até repetição explícita. O SHA-256 da revisão permanece
validado no backend, incluindo documento, versão e plano normalizado.

Retornos sem revisão válida agora explicam a necessidade de revisar/consultar.
O botão Voltar usa o guard de navegação uma única vez; anteriormente Vendas
podia solicitar saída duas vezes quando havia pagamentos na sessão. Compras
também protege pagamentos pendentes sem depender da flag comercial. O estado
financeiro de um documento confirmado não impede sair do histórico.

## Regressões acrescentadas

- Salvar, sair e reabrir Compras/Vendas sem motivo; revisar pagamentos sem
  incrementar versão comercial nem exigir nova justificativa.
- Confirmar com motivo de confirmação gerado e repetir exatamente esse comando
  após resposta perdida, sem duplicar estoque ou pagamentos.
- Venda à vista sem cliente e com duas formas; prazo sem entrada com duas
  parcelas digitadas; prazo com entrada e divisão oficial do saldo restante.
- Valor ausente, zero, excedente e soma incorreta; datas ausentes, impossíveis e
  anteriores à data comercial; foco e associação acessível do erro.
- Corrigir prazo na mesma tela e confirmar; tentativa inválida de prazo seguida
  de à vista, com alternâncias repetidas e confirmação no mesmo editor.
- Mudança financeira invalida revisão sem gravar itens; mudança comercial exige
  motivo; reverter quantidade ao valor salvo permite revisar sem outra gravação.
- Reabrir prazo já salvo e configurar entrada sem salvar os itens novamente.
- Conflito de versão durante edição comercial: preservar campos, atualizar a
  referência de comparação e impedir confirmação com dados antigos não salvos.
- Executável de Compras reabre rascunho e confirma offline sem repetir motivo;
  Vendas reutiliza o mesmo cenário no protocolo local, HTTP e pacote.

As regressões existentes continuam cobrindo conflito de versão, referências
inativas, estoque insuficiente, abaixo do custo com/sem motivo, alterações de
custo após revisão, rollback completo em cada tabela, duplicidade, reabertura,
snapshots, clientes/fornecedores, perfumes/fotos, estoque, teclado e responsividade.

## Verificações desta rodada

Ambiente: Windows 10 build 19045 x64, Electron 43.8.6. Todos os comandos abaixo
terminaram com código 0 nas execuções aprovadas desta rodada.

| Comando                                                          | Resultado real                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm.cmd run typecheck`                                          | Angular, Electron e integração aprovados                                                         |
| `npm.cmd run lint`                                               | Aprovado, sem avisos                                                                             |
| `npm.cmd run format:check`                                       | Aprovado                                                                                         |
| `npm.cmd run build`                                              | Angular de produção, Electron e preload gerados                                                  |
| `npm.cmd test`                                                   | 120/120 testes; `CADASTROS_ANGULAR_OK` em HTTP e mnr; smoke geral aprovado                       |
| `npm.cmd run test:ui`                                            | `DESKTOP_UI_OK`, `COMPRAS_UI_OK`, `VENDAS_SCENARIO_OK`, `VENDAS_UI_OK`                           |
| `npm.cmd run test:vendas`                                        | 4/4 grupos de serviços/IPC e cenário real de Vendas aprovados                                    |
| `node --test tests/compras-ipc.test.cjs`                         | 6/6 grupos aprovados                                                                             |
| `node scripts/compras-ui-smoke.mjs`                              | `COMPRAS_OFFLINE_IDEMPOTENCIA_OK`, `COMPRAS_UI_OK`; seleção nativa final conferida               |
| `node scripts/vendas-ui-smoke.mjs --development`                 | `VENDAS_SCENARIO_OK`, `VENDAS_UI_OK`; seleção nativa e conflitos finais conferidos               |
| `node scripts/compras-ui-smoke.mjs --development`                | `COMPRAS_OFFLINE_IDEMPOTENCIA_OK`, `COMPRAS_UI_OK`; seleção nativa e conflitos finais conferidos |
| `node scripts/smoke.mjs --development`                           | `SMOKE_OK`, Perfumes, Pessoas e Estoque de desenvolvimento aprovados                             |
| `npm.cmd run pack`                                               | Executável Windows x64 atualizado em `release/win-unpacked`                                      |
| `node scripts/verify-package.mjs`                                | `PACKAGE_ISOLATION_OK`, 36 bundles de produção                                                   |
| `node scripts/vendas-package-smoke.mjs`                          | `VENDAS_SCENARIO_OK`, `VENDAS_PACKAGED_OFFLINE_OK`, `VENDAS_PACKAGED_REOPEN_OK`                  |
| `node scripts/compras-package-smoke.mjs`                         | `COMPRAS_PACKAGED_OFFLINE_OK`                                                                    |
| `node scripts/smoke.mjs 'release/win-unpacked/MNR Perfumes.exe'` | `SMOKE_OK`, Perfumes/Pessoas/Estoque offline aprovados                                           |

O cenário final de Vendas passou com à vista (duas formas, sem cliente), prazo
sem entrada (duas parcelas digitadas) e prazo com entrada (saldo dividido no
backend). Os valores de recebimento, saldo futuro, estoque e parcela técnica
foram conferidos por IPC real, incluindo o pacote reaberto em novo processo.
Compras e Vendas permitem reabrir e configurar o financeiro sem repetir motivo
comercial. Os cenários também confirmaram com o motivo de confirmação gerado.

O último ajuste de seleção nativa foi reconferido nos testes específicos locais,
HTTP e do pacote. Capturas de Compras e Vendas foram inspecionadas; o fornecedor
passou a aparecer selecionado corretamente no rascunho reaberto.

Falhas encontradas e tratadas nesta rodada:

- As execuções anteriores à correção falharam de propósito nos testes de
  justificativa obrigatória e seleção visual vazia, comprovando os defeitos.
- A primeira tentativa do Electron foi impedida pela sandbox de automação/ACL.
  `test:vendas` também teve uma tentativa impedida por acesso negado do esbuild.
  Reexecutados com autorização fora da sandbox de automação; a sandbox e o
  isolamento do aplicativo permaneceram habilitados.
- O primeiro lint apontou cinco variáveis locais não utilizadas; corrigidas,
  seguido de lint limpo.
- Uma execução de `test:ui` detectou que a opção de entrada ainda sinalizava
  pendência depois de confirmar. Corrigido para considerar somente documentos
  editáveis; `test:vendas` e a suíte visual completa passaram depois.
- O empacotador registrou uma tentativa de rename com EPERM e repetiu com sucesso.
  O comando terminou com código 0; os smokes usaram o pacote final gerado.

As mensagens `Test-only lost ... reply` dos testes são falhas de resposta
deliberadamente injetadas **após commit**. Os cenários exigem repetição idêntica,
ausência de duplicidade e saída 0. Não são falhas remanescentes da aplicação.

## Arquivos desta correção

- `src/app/features/vendas/editor.ts` e `editor.html`.
- `src/app/features/compras/editor.ts` e `editor.html`.
- `scripts/vendas-scenario.cjs` e `vendas-ui-desktop.cjs`.
- `scripts/compras-ui-desktop.cjs` e `compras-package-smoke.mjs`.
- Este relatório e o link correspondente no README.

## Limites

Testes usam somente bancos/perfis/arquivos isolados. Não houve teste em Windows
11, instalação/desinstalação NSIS, máquina limpa fisicamente offline ou leitor
de tela. Offline significa emulação de rede no Electron; executável Windows
real com ASAR foi executado na validação. Capturas cobrem regiões visíveis,
não todas as posições da rolagem. Pagamentos não confirmados continuam
restritos à sessão. A 4E.2 permanece fora do escopo. Aguardar validação manual
do proprietário antes de qualquer nova etapa.
