# 4E.2-B — Backend e IPC de recebimentos

Este documento registra a execução anterior. A continuação de interface e
validação está no [relatório completo da 4E.2-B](etapa-4E2B-recebimentos.md).

Entrega parcial deliberada: esta execução conclui a integração dos dois canais
e seus testes. Não conclui a 4E.2-B: formulário Angular e validação visual local,
HTTP e pacote pertencem à próxima execução.

## Implementação

`financeiro.revisarRecebimento` recebe `{motivo,dados}` e retorna os dados
normalizados, identificação histórica, formas ativas, total, distribuição
oficial, saldos e situações previstos e impressão SHA-256. A revisão roda em
transação de leitura, sem auditoria ou simulação por gravação/rollback.

`financeiro.registrarRecebimento` recebe o mesmo conteúdo, UUID v4 e impressão.
O adaptador inicia uma transação IMMEDIATE. Para UUID novo, confere a impressão
antes de executar o serviço da 3D, na mesma transação. A impressão cobre venda,
versão/estado, parcelas/saldos, IDs de movimentos, alocações e abatimentos,
correções e formas de pagamento. Também detecta quitação concorrente, sem
depender de mudança na versão comercial.

Para UUID já persistido, delega diretamente ao serviço existente, que confere
tipo, hash normalizado e motivo e devolve a resposta original. Assim um replay
não é rejeitado por mudança posterior do saldo. A impressão é precondição de
uma operação nova; a identidade persistida continua baseada no conteúdo
financeiro normalizado da 3D, preservando hashes e respostas anteriores.

`normalizarRecebimento` e `prepararRecebimento` são compartilhados com o registro
existente. Alocações manuais são copiadas antes de ordenar. Não há outro
algoritmo de distribuição; efeitos previstos usam `situacaoParcela` da 3D.
Somente recebimentos foram refatorados; migrações e outras operações permanecem.

Os canais usam o registro protegido existente: WebContents, frame principal,
URL e aridade, além da validação de campos, IDs, datas, limites, formas e
pertencimento das parcelas. Preload expõe métodos literais tipados. A versão
real do aplicativo é passada para a auditoria. Erros nativos são sanitizados.
Datas inválidas são VALIDATION; revisão desatualizada é VERSION_CONFLICT.

## Testes e resultados em 04/11/2026

- `npm.cmd run typecheck`: aprovado.
- `npm.cmd run build:electron`: aprovado.
- Recorte de serviços/IPC, consultas, Compras, Vendas e segurança: 42/42 aprovados.
- `node --test tests/*.test.cjs`: 128/128 aprovados na repetição final.
- Os 16 testes históricos de financeiro estão incluídos; a nova cobertura não
  depende apenas desses testes antigos.

Novos cenários cobrem parcial, quitação, antecipação, várias formas, alocação
automática/manual, cliente inativo, entrada sem duplicação, excessos, zero,
negativos, decimais inválidos, datas inválidas/futuras/anteriores, forma inativa,
parcela de outra venda e aridade. Revisão é executada com `query_only=ON` e
comparação integral das tabelas. Testes de registro/preload verificam os dois
canais e rejeitam origens/frames/URLs inválidos antes de acessar os serviços.

Conflito financeiro é exercitado após recebimento concorrente inclusive integral.
Resposta perdida é simulada descartando o retorno de commit e reenviando a mesma
intenção, inclusive após outro recebimento e reabertura do banco. Conteúdo
diferente com mesma chave é rejeitado. Falhas injetadas em movimentos, alocações
e auditoria restauram todo o snapshot; a mesma intenção pode ser repetida.

A primeira execução completa teve 127/128: EPERM no rename de diretório isolado
do teste de fotos. A repetição autorizada fora da sandbox de automação passou
128/128, sem mudanças no código de fotos nem na segurança Electron.

## Arquivos e próximos passos

Alterados: `electron/services/financeiro.ts`, `electron/ipc/financeiro.ts`,
`electron/ipc/index.ts`, `electron/preload/index.ts`, `shared/financeiro-ipc.ts`,
expectativas de canais em `tests/cadastros-ipc.test.cjs`,
`tests/compras-ipc.test.cjs`, `tests/vendas-ipc.test.cjs`,
`scripts/financeiro-scenario.cjs` e `scripts/vendas-scenario.cjs`.

Criados/preservados do trabalho parcial: `electron/services/recebimentos.ts`,
`tests/recebimentos.test.cjs`. Criados nesta execução:
`tests/recebimentos-ipc.test.cjs` e este relatório.

Próximo passo: formulário e serviço Angular, mensagens por campo e recuperação
de intenção incerta na interface, seguido da matriz de interface e pacote.
Não foram realizados testes visuais de recebimentos nesta execução. Não houve
implementação de 4E.2-C/D, alterações de migração, commit ou push.
