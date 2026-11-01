# Entrega 3B — Estoque e custeio

## Implementação

Migração `0002-estoque`, sem alteração da migração 0001. O schema passa a versão 2;
a identidade e a regra de custeio versão 1 permanecem. Produtos anteriores recebem
saldo zero, sem quantidade presumida ou movimento. Trigger cria saldo zero junto
de cada novo produto. Backup, manifesto e migração atômica seguem a infraestrutura 3A.

`saldos_estoque` contém produto PK/FK, quantidade, valor em centavos e versão.
`movimentacoes_estoque` contém produto, natureza, deltas, snapshots posteriores,
versão posterior, motivo, data efetiva, registro UTC, operação e origem opcional FK.
Tabelas STRICT; índices de produto/ID, operação e origem; produto/versão único.

Movimentos são imutáveis. Triggers conferem disponibilidade, versão, snapshots,
custo, origem e operação provisória, e aplicam o único caminho normal de alteração
do saldo. Alterações diretas, exclusão, REPLACE e UPSERT conflitantes são rejeitados.
Saldo zero exige valor zero. Limites preservados: 1 bilhão de unidades e
9 trilhões de centavos. IDs e versões respeitam inteiros seguros.

Os serviços `registrarEntrada`, `registrarSaida`, `registrarPerda`, `registrarContagem`,
`consultarSaldo`, `listarMovimentacoes` e `reconciliarEstoque` ficam no processo principal.
Consultas de histórico usam cursor por ID, padrão 50 e máximo 200 por página; isso
não limita o histórico nem a reconciliação. DTOs em `shared/estoque.ts`, sem API IPC nova.

Gravação exige `{ operacaoId, motivo, dataEfetiva, dados }`. Data efetiva real, não futura,
comparada ao dia local; registro UTC gerado pelo relógio injetável. Custeio segue ID,
nunca data retroativa. Entrada exige custo total, inclusive zero justificado pelo motivo.
Saída/perda não aceita custo informado. Ajustes em produtos inativos são permitidos.

Contagem exige versão esperada; sobra exige custo total da diferença; falta usa média
vigente. Sem diferença, gera auditoria e operação idempotente, sem movimento ou nova
versão do saldo. Custo informado sem sobra é rejeitado. O snapshot auditado inclui a
contagem e a versão esperada.

Transações imediatas síncronas incluem operação provisória, movimento/saldo, auditoria
e resultado idempotente. Chave/conteúdo canônico igual devolve o resultado original,
inclusive após reabrir; tipo/conteúdo diferente é conflito. Falhas desfazem todos os
efeitos. Banco ocupado retorna `BUSY`; repetir com a mesma chave após liberar a disputa.

`aplicarMovimentoNaTransacao` exige transação ativa e é o ponto interno de composição
para a 3C. O chamador deve validar o comando, criar operação provisória, auditar todos
os efeitos, finalizar resultado e assumir o commit/rollback. Não é canal público.
Na 3C, criar tabela de vínculo movimento PK/FK → item comercial FK na mesma transação.
Não editar movimentos antigos, inventar compras/vendas ou vincular ajustes retroativamente.
Estornos ficam para etapa posterior; correções atuais são novos ajustes com motivo.
As naturezas comerciais exigirão nova migração na 3C, ampliando o CHECK e as regras
de aplicação com preservação dos IDs, FKs, índices, triggers e histórico. Não alterar
a migração 0002 já entregue nem recalcular custos anteriores ao ampliar essas regras.

## Precisão e trusted_schema

Persistir Q e V; não persistir média unitária arredondada. Entrada soma quantidade e
custo total. Saída parcial custa `(2n * V * q + Q) / (2n * Q)` em BigInt; total custa V.
O resíduo permanece no estoque. Exemplo Q=3/V=100: saídas 33, 34 e 33 centavos.
Limites são conferidos antes da conversão para number, SQLite ou JSON.

better-sqlite3 13.0.3 não expõe SQLITE_INNOCUOUS. Ensaio em memória confirmou que uma
função deterministic em trigger falha com `unsafe use` sob `trusted_schema=OFF`.
Nenhuma função personalizada é usada pelo novo schema. A abertura mantém explicitamente
`trusted_schema=OFF`, foreign_keys ON, WAL, synchronous FULL e timeout de 5 segundos.
Não foram carregadas extensões nem alterada a segurança Electron.

Referências: [restrições de trusted_schema](https://sqlite.org/c3ref/c_dbconfig_defensive.html)
e [aritmética inteira/overflow do SQLite](https://sqlite.org/lang_expr.html).

A trigger valida independentemente o custo da saída, com divisão inteira SQLite:

```text
a = V / Q
r = V % Q
p = r * q
custo = a*q + p/Q + (p%Q >= Q/2 + Q%2 ? 1 : 0)
```

Após validar 0<q<=Q<=10^9 e V<=9*10^12, a*q<=V e p<10^18. Todos os intermediários
cabem no INTEGER de 64 bits. Nunca calcular V\*q em SQL, usar REAL ou converter um
intermediário grande para number. Mudanças nesses limites exigem rever a prova e testes.
Testes comparam a decomposição, BigInt e a desigualdade independente do arredondamento,
incluindo empates, resíduos e limites. A trigger real também rejeita custo adulterado.

## Reconciliação e medição

Abertura inspeciona identidade/schema/checksums e integridade, configura pragmas,
executa migração pendente e reconcilia antes de disponibilizar serviços. Falha fecha
a conexão e preserva o banco. Não há reparo, reconstrução automática ou liberação parcial.

Reconciliação em snapshot consistente percorre produtos e movimentos por iteradores,
acumula deltas BigInt e compara cada snapshot/versão e o saldo final. Não recalcula
custos históricos. Retorna divergências com produto, movimento, campo e valores em
texto decimal. Memória não cresce com histórico válido; relatórios crescem com o número
de divergências. Tempo cresce com produtos e movimentos, sem corte arbitrário.

Benchmark reproduzível, fora da suíte rápida:

```powershell
npm.cmd run build:electron
node scripts/benchmark-estoque.cjs
```

Para Electron, executar `scripts/benchmark-estoque.cjs` com o binário Electron usando
o ambiente de `scripts/env.mjs`. Para o runtime do pacote, usar o executável empacotado
com `ELECTRON_RUN_AS_NODE=1` e o mesmo script; isso mede a abertura do banco nesse
runtime, não a inicialização gráfica completa. O smoke do executável valida separadamente
a entrada real, Angular, preload, IPC e SQLite.

Fixtures novas em `.local-data/test/stock-benchmark-*`; relatórios em
`.cache/stock-benchmark/*.json`. Não usa nem apaga bancos existentes. Gera ajustes
com custo BigInt e triggers reais; operações/auditoria compostas por lote. Geração
fica fora da janela medida. Escalas padrão: 1 mil, 10 mil, 100 mil e 1 milhão;
distribuições em 1 e 100 produtos; três aberturas por escala. `MNR_BENCH_SIZES` permite
escolher outras escalas crescentes; não é limite do aplicativo.

O gerador agrupa até 1.000 ajustes por operação/auditoria. Isso isola o crescimento
do ledger, mas produz menos linhas técnicas do que um milhão de comandos manuais
individuais. Aberturas de bases com auditoria/cadastros maiores podem custar mais;
os tempos não devem ser extrapolados para qualquer base com igual número de movimentos.

Registra reconciliação isolada, primeira abertura pós-geração e duas reaberturas,
fases internas, RSS/heap, tamanho do banco e ambiente. Cache do SO não é esvaziado;
RSS/heap são amostras após geração, não picos de memória isolados da reconciliação.
EXPLAIN confirma índice estoque_produto sem ordenação temporária. Ao final, corrupção
controlada perto do último movimento deve bloquear a abertura em cada distribuição.
Não há limite de latência em CI nem otimização persistente antecipada.

### Resultados em Windows 10

Medição em 01/11/2026: Windows 10 build 19045 x64, Intel Core i7-7700, aproximadamente
16 GiB de RAM; SQLite 3.53.4. Valores abaixo em milissegundos: reconciliação isolada
e mediana das três aberturas completas sem migração pendente. Não representam garantia
de latência nem ensaio em disco/cache frio.

| Runtime                        | Produtos | Movimentos | Reconciliação (ms) | Abertura mediana (ms) |
| ------------------------------ | -------: | ---------: | -----------------: | --------------------: |
| Node 26.13.0                   |        1 |      1.000 |               1,79 |                 13,55 |
| Node 26.13.0                   |        1 |     10.000 |              15,94 |                 86,11 |
| Node 26.13.0                   |        1 |    100.000 |             149,71 |                924,23 |
| Node 26.13.0                   |        1 |  1.000.000 |           1.519,77 |             10.213,10 |
| Node 26.13.0                   |      100 |      1.000 |               2,41 |                 15,48 |
| Node 26.13.0                   |      100 |     10.000 |              16,86 |                 94,37 |
| Node 26.13.0                   |      100 |    100.000 |             177,84 |              1.041,09 |
| Node 26.13.0                   |      100 |  1.000.000 |           6.445,72 |             15.820,17 |
| Electron 43.8.6 / Node 24.22.1 |        1 |      1.000 |               4,78 |                 21,02 |
| Electron 43.8.6 / Node 24.22.1 |        1 |     10.000 |              17,78 |                 92,19 |
| Electron 43.8.6 / Node 24.22.1 |        1 |    100.000 |             156,68 |                988,90 |
| Electron 43.8.6 / Node 24.22.1 |        1 |  1.000.000 |           1.603,03 |             10.309,00 |
| Electron 43.8.6 / Node 24.22.1 |      100 |      1.000 |               2,37 |                 14,54 |
| Electron 43.8.6 / Node 24.22.1 |      100 |     10.000 |              15,77 |                100,96 |
| Electron 43.8.6 / Node 24.22.1 |      100 |    100.000 |             189,51 |              1.042,52 |
| Electron 43.8.6 / Node 24.22.1 |      100 |  1.000.000 |           6.500,76 |             15.987,87 |
| Pacote / RUN_AS_NODE           |        1 |      1.000 |               2,23 |                 15,31 |
| Pacote / RUN_AS_NODE           |        1 |     10.000 |              15,39 |                 93,58 |
| Pacote / RUN_AS_NODE           |        1 |    100.000 |             155,73 |              1.130,64 |
| Pacote / RUN_AS_NODE           |        1 |  1.000.000 |           1.656,37 |             10.428,97 |
| Pacote / RUN_AS_NODE           |      100 |      1.000 |               2,22 |                 14,19 |
| Pacote / RUN_AS_NODE           |      100 |     10.000 |              16,29 |                 95,95 |
| Pacote / RUN_AS_NODE           |      100 |    100.000 |             181,48 |              1.067,05 |
| Pacote / RUN_AS_NODE           |      100 |  1.000.000 |           6.743,02 |             15.957,99 |

Relatório Node: `.cache/stock-benchmark/node-1793503645910.json`. Bases de 1 milhão
mediram aproximadamente 180–181 MiB. Abertura inclui duas passagens de inspeção/integridade
da infraestrutura 3A: a fase de migração inclui reinspeção mesmo sem migração pendente.
Isso explica parte significativa da latência além da reconciliação.

Na escala maior, o RSS amostrado do processo Node ficou aproximadamente em 71 MiB
para 1 produto e 81 MiB para 100 produtos; não é medição de pico. Distribuir movimentos
entre produtos aumentou o custo de leitura pelo índice, especialmente na escala maior.
Não foram introduzidos índices adicionais ou caches persistentes para esconder esse custo.
Corrupção perto do último movimento bloqueou a abertura: aproximadamente 10,26 s
com 1 produto e 15,74 s com 100 produtos. A falha segura permanece obrigatória.

Relatório Electron: `.cache/stock-benchmark/electron-1793503958724.json`, executado
como aplicação Electron real, sem BrowserWindow. RSS principal na escala maior em torno
de 90–99 MiB. Corrupção no fim do histórico bloqueou abertura em aproximadamente
10,37 s e 15,81 s, respectivamente. Esses tempos não incluem criação de janela/renderer.

Relatório do runtime empacotado: `.cache/stock-benchmark/packaged-1793504275354.json`,
Electron 43.8.6 / Node 24.22.1 / SQLite 3.53.4. O script carrega os módulos compilados
do workspace nesse executável em RUN_AS_NODE; o smoke separado valida o bundle ASAR
pela entrada real do aplicativo. RSS principal na escala maior em torno de 71–78 MiB;
falha segura por corrupção em aproximadamente 10,09 s e 16,13 s. Inicialização gráfica
com histórico de um milhão não foi medida; as medições isolam a abertura do banco.

## Verificações e limites

Validados `typecheck`, `lint`, `format:check`, build de produção, **35 testes** e smoke
desktop. Pacote Windows descompactado gerado e executado com SMOKE_OK. Desenvolvimento
reiniciado com `MNR_SMOKE=1`, usando somente a base de teste, também com SMOKE_OK.
Build e Electron exigiram execução fora da sandbox de automação; nenhuma ACL ou
configuração de segurança do Windows/aplicativo foi alterada.

Testes cobrem entradas, saídas, perdas, contagens, inativação, esgotamento, insuficiência,
limites, centavos residuais, séries determinísticas, SQL adversarial, idempotência,
persistência, disputa entre workers, banco ocupado e falhas em cada gravação.
Migração 0→2 e 1→2 preserva dados 3A; falha durante 0002 desfaz schema e marcadores.
Electron real verifica STRICT, custeio residual, rollback, reabertura e backup.

Auditoria e triggers protegem o uso normal; não prometem inviolabilidade contra edição
externa do arquivo e substituição das proteções. Reconciliação não é uma assinatura
criptográfica. Windows 11 e instalação NSIS exigem execução específica nesses ambientes.
Não foram criados UI, canais comerciais, compras/vendas, financeiro ou dependências.

## Arquivos

- Schema: `electron/infrastructure/database/migrations/0002-estoque.ts`; registro e
  validação por versão em `migrate.ts`; configuração e reconciliação na abertura em `index.ts`.
- Regras: `electron/domain/custeio.ts`, `electron/services/estoque.ts`,
  `estoque-validation.ts` e `estoque-reconciliation.ts`; DTOs em `shared/estoque.ts`.
- Testes: `tests/custeio.test.cjs`, `tests/estoque.test.cjs`, helpers de fixture/worker;
  atualização dos testes de banco/migração e de `scripts/database-runtime.cjs`.
- Medição: `scripts/benchmark-estoque.cjs`. Documentação: este relatório, README e
  especificação da Etapa 3. Migração 0001, Electron main/preload/IPC, contratos IPC,
  package.json e lockfile preservados. Sem commit ou push automático.
