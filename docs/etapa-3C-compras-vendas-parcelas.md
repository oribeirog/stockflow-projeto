# Entrega 3C — Compras, vendas e parcelas

## Estado e fronteiras

Implementada no processo principal, sem telas Angular, novos canais comerciais IPC,
dependências ou alterações na segurança Electron. Migrações 0001/0002 preservadas.
Schema versão 3; identidade, BRL e regra de média ponderada móvel versão 1 preservados.

Compra é integralmente paga na confirmação; venda à vista é integralmente recebida;
venda a prazo exige cliente ativo vinculado, com CPF/CNPJ opcional, e nasce sem recebimento.
Não há serviços de recebimentos posteriores, entrada parcial a prazo, antecipação,
abatimento, devolução, estorno, cancelamento, reembolso, contas a pagar ou encargos.
Esses efeitos financeiros e correções continuam para 3D, conforme seu escopo aprovado.

## Serviço e contratos

`createCommercialService(db, appVersion, clock?)`, em `electron/services/comercial.ts`:

| Operação            | Comportamento                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `salvarRascunho`    | Cria ou substitui integralmente o conteúdo de um rascunho; atualização exige ID e versão esperada.         |
| `confirmar`         | Exige ID/versão esperada e pagamentos ou plano explícito de parcelas; todos os efeitos na mesma transação. |
| `descartarRascunho` | Descarte lógico auditado, com ID/versão esperada. Não apaga registros.                                     |
| `consultar`         | Documento por ID, itens, parcelas originais, recebimentos efetivos e saldo a receber.                      |
| `listar`            | Cursor `aposId`, padrão 50 e máximo 200 documentos por página.                                             |

DTOs em `shared/comercial.ts`, independentes de plataforma. Os serviços validam entradas
`unknown`, incluindo campos inesperados, datas reais, textos, inteiros seguros e limites.
Gravações exigem `{ operacaoId, motivo, dados }`. A chave usa o formato da 3A/3B,
com hash SHA-256 da entrada normalizada, tipo e versão do comando. Mesma chave/conteúdo
retorna a resposta original sem revalidar cadastros ou disponibilidade atuais;
conteúdo diferente gera `IDEMPOTENCY_CONFLICT`.

Rascunho pode não ter contraparte/modalidade ou itens, mas os valores informados precisam
ser válidos. Sua data comercial é obrigatória. Não afeta estoque, parcelas ou caixa.
Limites por comando: 1.000 itens/parcelas, 200 entradas de pagamento. Produto repetido
é rejeitado; pagamentos da mesma forma são consolidados. Edição é por conteúdo completo,
como nos cadastros; não é atualização parcial. A confirmação valida cadastros ativos.

Estados: `RASCUNHO`, `CONFIRMADO`, `DESCARTADO`. O descarte lógico é a extensão explícita
ao modelo conceitual que permite preservar FKs de auditoria. Tipo, número e identidade
não mudam. Número é `<TIPO>-<ID AUTOINCREMENT>`, sem finalidade fiscal. Cada atualização
incrementa a versão: confirmar envolve preparação e fechamento, portanto incrementa
duas vezes. O consumidor deve usar a versão retornada, sem calculá-la.

Erros comerciais: `VALIDATION`, `NOT_FOUND`, `INACTIVE_REFERENCE`, `VERSION_CONFLICT`,
`INVALID_STATE`, `BELOW_COST`, `INSUFFICIENT_STOCK`, `IDEMPOTENCY_CONFLICT`, `BUSY` e
`INTEGRITY`. Banco ocupado permite nova tentativa com a mesma chave.

## Valores e histórico

Dinheiro em centavos, cálculos intermediários `BigInt`. Limite monetário de
9.000.000.000.000 centavos e de quantidade de 1.000.000.000 unidades, preservando a 3B.
Não há média decimal persistida, `REAL` financeiro ou `BigInt` em JSON.

Desconto de entrada: `{ tipo: 'CENTAVOS' | 'PONTOS_BASE', valor }`. Percentuais usam
pontos-base inteiros de 0 a 10.000, convertidos com half-up; persistem os centavos finais.

1. Bruto do item = quantidade × unitário; subtrair desconto individual.
2. Desconto global proporcional às bases após desconto individual.
3. Frete e despesas, apenas em compras, rateados separadamente pelos líquidos.
4. Cada rateio usa partes inteiras, maiores restos e desempate por sequência.
5. Se todos os líquidos forem zero, frete/despesas usam quantidade como base.

Desconto não supera base. Base global zero só admite desconto zero. Custo de aquisição
é líquido + frete + despesas rateadas. Item de aquisição com custo zero exige motivo de
bonificação; compra zero não gera pagamento zero. Venda zero não gera parcela ou caixa,
mas exige motivo por item quando abaixo do custo.

Na confirmação, conservar nome/documento da contraparte, SKU/nome do produto,
preços, descontos, rateios, custo total efetivamente movimentado e nome da forma de
pagamento. Alterações cadastrais e compras posteriores não reescrevem esses valores.
Data comercial retroativa não reordena custeio: a ordem permanece a dos movimentos
confirmados. Datas comerciais futuras são recusadas; vencimentos futuros são aceitos.

Venda consulta disponibilidade de todos os produtos e usa `custoSaida` da 3B.
Líquido final do item menor que seu custo total exige motivo específico naquele item.
Não comparar preço unitário com média arredondada. Saída integral esgota exatamente
o valor residual; a sequência de 100 centavos em três unidades continua 33, 34 e 33.

## Parcelas e caixa

`parcelas_receber` guarda apenas original positivo, número, vencimento e criação,
com cliente obtido da venda. Plano explícito pode ter valores desiguais e vencimentos
coincidentes; não pode vencer antes da data comercial. Soma deve coincidir exatamente
com o total. `dividirParcelas` fornece divisão igualitária, colocando centavos restantes
nas primeiras parcelas e recusando parcelas zero.

Venda à vista positiva cria uma parcela técnica, vencendo na data comercial, recebida
integralmente na confirmação. Compra positiva exige pagamentos pelo total e não cria
conta a pagar. Cada forma gera movimento financeiro próprio.

`movimentos_financeiros` registra dinheiro efetivo, com natureza/sentido e forma histórica.
`alocacoes_recebimento` vincula o recebido às parcelas da mesma venda. Não há unicidade
que limite uma parcela a um recebimento, nem um recebimento a uma parcela. A 3D poderá
estender as regras de inserção para receber entrada parcial e pagamentos adicionais,
mantendo documentos/parcelas originais imutáveis. Na 3C, triggers permitem somente o
recebimento integral à vista dentro da confirmação; não existe serviço financeiro 3D.

Consultas distinguem `totalCentavos`, `recebimentosEfetivosCentavos` e
`saldoReceberCentavos`. Rascunho não é dívida; venda a prazo confirmada já baixa estoque,
mas seu recebimento permanece zero. Nenhum campo mutável de quitação substitui o histórico.

## Atomicidade, migração e proteção

Confirmação síncrona em `IMMEDIATE`: idempotência → rascunho/versão → operação provisória →
cadastros e valores → snapshots/custos → movimentos e vínculos → parcelas/pagamentos →
confirmação → auditoria antes/depois → resposta final. Falha desfaz todos os produtos,
financeiro, operação e auditoria; o rascunho anterior permanece. Não há `await` na transação.

O ponto interno `aplicarMovimentoNaTransacao` passa a aceitar compra como entrada e
venda como saída. Os métodos de ajuste da 3B continuam disponíveis e com seu comportamento.
Os triggers continuam sendo o caminho de aplicação de saldo; custo de saída continua
validado no SQLite por decomposição inteira, sem função personalizada.

0003 reutiliza trechos do SQL **imutável** da 0002 para preservar literalmente seus
índices e triggers. Reconstrói apenas a tabela de movimentos para ampliar o domínio
das naturezas, sem alterar deltas, snapshots, IDs ou origens. Remove temporariamente
as proteções dependentes, copia registros para a tabela substituta sem aplicá-los
novamente ao saldo, substitui a tabela, restaura índices/triggers e o maior contador
AUTOINCREMENT. Tudo na transação do executor 3A, com `foreign_keys=ON` e
`defer_foreign_keys=ON`; o adiamento termina no commit/rollback.

Backup consistente em WAL e manifesto são anteriores à alteração. Falha de backup,
schema, FKs, integridade ou reconciliação impede a migração. Marcadores e checksum
estão na mesma transação. Não há reparo por recriação de banco.

Tabelas novas: documentos, itens, parcelas, movimentos financeiros, alocações e vínculos
de estoque. Auditoria recebe `documento_id` opcional; eventos anteriores conservam todos
os campos e ganham apenas esse campo nulo. Movimentos antigos não recebem vínculo
comercial presumido. Cada vínculo novo usa movimento PK/FK e item FK indexada, permitindo
que entregas futuras tenham vários movimentos por item.

Triggers validam a confirmação, totais, contrapartes, snapshots, vínculo/produto/natureza,
custos, pagamentos e parcelas. Históricos rejeitam alterações, exclusão e substituição
conflitante. Inspeção verifica presença de tabelas STRICT, triggers e índices esperados.

Reconciliação completa de estoque da 3B é mantida. A verificação comercial acrescentada
confere componentes persistidos, vínculos e financeiro na abertura e antes do commit da
migração. Não recalcula custos históricos pelo algoritmo atual e não corta histórico.
Inconsistência ou operação comercial provisória persistida bloqueia abertura, preservando
o arquivo. Isso não constitui assinatura criptográfica contra edição externa deliberada.

## Verificação realizada

Ambiente: **Windows 10 build 19045 x64**, em 01/11/2026. Node 26.13.0;
Electron 43.8.6 / Node 24.22.1 / SQLite 3.53.4.

- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run format:check` e build aprovados.
- Suíte completa: **54 testes**, todos aprovados, sem testes ignorados. Mantidas as
  verificações cadastrais, estoque, IPC e banco.
- Testes financeiros usam exemplos conhecidos e 800 casos determinísticos, verificando
  conservação e limites das frações por produtos cruzados independentes do rateador.
  Cobrem 1 centavo, restos/desempate, bases zero, descontos, limite monetário e overflow.
- Descontos percentuais: **90.009 combinações** (todos os 10.001 percentuais em
  pontos-base, em nove bases, incluindo zero e o limite monetário). Oráculo independente
  por desigualdades e produtos cruzados, sem divisão nem chamada ao arredondador para
  calcular o esperado. Rateios verificam também a prioridade dos maiores restos e o
  desempate pela sequência; parcelas verificam a ordem dos centavos restantes.
- Compra multiproduto/múltiplas formas, venda à vista, prazo sem dinheiro, bonificação,
  justificativa abaixo do custo, rascunhos/versões/descarte e preservação histórica.
- Falhas injetadas em itens, documento, movimentos, saldos, vínculos, parcelas, financeiro,
  alocações, auditoria e finalização: rollback e nova tentativa idempotente.
- Workers independentes disputam última unidade e repetem confirmação simultaneamente;
  banco ocupado é recuperável sem operação provisória persistida.
- SQL adversarial: confirmação incompleta, reescrita/substituição de histórico,
  substituição de operação/auditoria e alocações inválidas. Corrupção de custo histórico
  bloqueia reabertura e conserva o valor adulterado para diagnóstico.
- Migração real 2→3 com movimentos e referências entre eles: comparação de todas as
  linhas anteriores, FKs, SQL de índices/triggers e sequências. Contador elevado a 800
  é preservado e o próximo movimento recebe 801. Backup v2 permanece legível.
- Falhas em sete pontos da reconstrução e violação de FK adiada restauram schema,
  registros, índices/triggers, sequências, identidade e versão 2. Caminhos 0→3 e 1→3
  também são cobertos; testes específicos 3B continuam exercitando 1→2.
- Cada falha de reconstrução também é exercitada em **arquivo existente com WAL e backup
  prévio**: após o rollback, fecha-se a conexão e reabre-se o arquivo para comparar todas
  as linhas, schema, sequências e versão. Cada backup é aberto separadamente e conserva
  as linhas e sequências da 3B. O mesmo teste executa em Node e no Electron real.
- Electron real executa migração populada, falhas/rollback, compra, venda à vista,
  parcelamento a prazo sem recebimento e reabertura idempotente.
- Pacote Windows descompactado gerado; smoke da entrada real com ASAR: `SMOKE_OK`.
  Desenvolvimento reiniciado com `MNR_SMOKE=1`, usando somente a base de teste: `SMOKE_OK`.
- Teste visual existente (`scripts/ui-desktop.cjs`) executado com entrada real em
  diretório isolado `.local-data/test/ui-3c-review-gON3KJ`: `DESKTOP_UI_OK`. Verificou nove rotas,
  foco/histórico, diagnóstico, teclado, protocolo offline, isolamento e três tamanhos
  por três níveis de zoom. Banco normal de desenvolvimento não foi aberto pelo teste.

O teste isolado do Electron encontrou restrição de ACL na sandbox de automação e passou
ao executar fora dela. Não se alteraram ACLs, sandbox, isolamento ou integração Node do
aplicativo. O smoke completo emitiu mensagens de GPU ao encerrar, com saída zero e
`SMOKE_OK`; o smoke do pacote também passou.

Medição adicional com fixtures de ajustes: 1.000/10.000 movimentos, distribuídos em
1/100 produtos. Em 10.000, abertura aproximadamente 110–118 ms e verificação comercial
1,4–1,7 ms. Relatório `.cache/stock-benchmark/node-1793550259517.json`. São amostras
locais com cache do sistema, sem documentos comerciais; não substituem medição de
grandes volumes de compras/vendas nem as medições de um milhão da 3B.

Pendentes externos: Windows 11 e instalação NSIS em ambiente específico. Nenhuma base
do usuário foi apagada/recriada, nenhum commit ou push automático foi realizado.
