# Entrega 3D — Recebimentos, devoluções, cancelamentos e reembolsos

## Escopo e execução incremental

Implementação no processo principal, sem interface Angular, canais IPC comerciais,
serviços externos ou dependências novas. Mantidos isolamento, sandbox, ausência de Node
no renderer, BRL, média ponderada móvel versão 1 e migrações 0001–0003 imutáveis.
Não há contas a pagar, carteira de crédito, juros, multas, taxas ou renegociação.

As seis fases foram executadas: contratos/cálculos; migração e preservação; recebimentos
e entrada; correções de venda/condição física; reembolsos/compras/estornos; integração,
reconciliação e documentação. Cada grupo recebeu verificações antes da integração seguinte.

## Serviços e contratos

Contratos independentes de plataforma em `shared/financeiro.ts`, com extensão dos tipos
comerciais e naturezas de estoque. Entradas são `unknown`, validadas estritamente no serviço.
Gravações usam `{ operacaoId, motivo, dados }`; a data efetiva pertence a `dados`.
Repetir chave/conteúdo devolve a resposta persistida; alterar conteúdo gera conflito.

| Serviço    | Comandos e consultas                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comercial  | `confirmarComEntrada`, além dos comandos 3C preservados                                                                                                          |
| Financeiro | `registrarRecebimento`, `estornarRecebimento`, `pagarReembolso`, `estornarReembolso`, `consultarVenda`, `listarParcelas`, `listarReembolsos`, `listarMovimentos` |
| Correções  | `devolverVenda`, `cancelarVenda`, `devolverCompra`, `cancelarCompra`, `estornarDevolucao`, `estornarAjuste`                                                      |

Recebimento informa venda, data, pagamentos por forma e, opcionalmente, alocações explícitas.
Uma operação atende uma venda. Sem seleção, aplica por vencimento/número/ID crescente;
formas são consolidadas e ordenadas por ID. Alocações explícitas devem somar o dinheiro
informado e respeitar o saldo de cada parcela. Excesso é rejeitado integralmente.
Antecipação apenas recebe parcelas já existentes. Cliente inativo pode quitar dívida;
novos movimentos exigem forma ativa; estornos preservam a forma histórica.

Entrada positiva menor que o total usa operação própria, sem mudar a normalização/hash
de `confirmar` da 3C. Cria parcela técnica `ENTRADA` número 1, quitada na confirmação;
parcelas futuras começam em 2 e somam somente o restante. Entrada integral usa venda
à vista. Total máximo de 1.000 parcelas inclui a entrada; pagamentos têm até 200 entradas.

Exemplo: venda de R$ 300, entrada de R$ 100, recebimento posterior de R$ 150 e devolução
de R$ 200 produzem R$ 100 comerciais, R$ 250 recebidos, saldo zero e obrigação de R$ 150.
Pagar R$ 100 deixa R$ 50 pendentes. Estornar esse pagamento reabre R$ 150 de obrigação,
sem reabrir parcela e sem apagar o recebimento original. O teste integrado percorre
também pagamentos por várias formas e reabertura do banco.

## Histórico e schema 0004

Documentos admitem devoluções e estornos, com origem real e transição auditada para
`ESTORNADO`; conteúdo confirmado não muda. Itens corretivos referenciam os originais,
registram quantidade para perda e diferença de avaliação. Parcelas recebem classificação
neutra `REGULAR` na migração; registros existentes não ganham recebimentos presumidos.

Financeiro ganha estornos e reembolsos; alocações ganham aplicação/estorno com referência
única à origem. Novas tabelas: `abatimentos_parcela`, `reembolsos_cliente`,
`origens_reembolso` e `alocacoes_reembolso`. Obrigações reservam recebimentos de origem
desde sua criação, antes de serem pagas. Pagamentos liquidam essas reservas, sem produzir
crédito, reabrir parcela ou contar novamente dinheiro recebido.

A reconstrução usa tabelas substitutas com FKs internas entre substitutas, copia os
registros, remove as antigas das dependentes para as referenciadas e renomeia o conjunto.
Inclui auditoria, parcelas e vínculos dependentes. Não reaplica movimentos aos saldos.
Preserva IDs, snapshots, respostas idempotentes e maior contador AUTOINCREMENT.
Proteções são restauradas ou explicitamente ampliadas; inspeção verifica tabelas STRICT,
índices e triggers das duas versões. Backup consistente e manifesto precedem a transação.

`foreign_keys=ON` permanece habilitado. O adiamento de FKs vale somente na transação;
histórico/checksums, identidade e versão só avançam com integridade e reconciliação válidas.
Falha implica rollback, sem excluir ou recriar o banco.

## Regras financeiras e de correção

Movimentos financeiros representam dinheiro; alocações não são nova receita. Consultas
separam original, correções comerciais, líquido, recebimentos brutos, seus estornos,
abatimentos, reembolsos pagos, seus estornos, saldo a receber e obrigação pendente.
Por parcela, saldo é `max(original − abatimentos líquidos − recebimentos líquidos, 0)`.
Pagamento de reembolso não reduz o histórico recebido nem reabre a parcela.
Status prioriza quitado, vencido, parcialmente pago e pendente; atraso usa data local
com relógio injetável, mantendo indicador de recebimento parcial.

Devolução abate primeiro saldos abertos das últimas parcelas e depois a parte recebida;
esta gera obrigação com origens identificadas. Reembolso é pago em comando separado,
uma obrigação por operação, parcial ou integralmente, por várias formas.

Cancelamento de venda é integral, sem devolução efetiva anterior; preserva recebimentos
e gera obrigação correspondente. Movimentos posteriores não impedem o retorno ao custo
histórico. Cancelamento de compra exige ausência de movimentos posteriores em qualquer
produto e de devoluções efetivas; reverte exatamente o estoque e contralança pagamentos.
Devolução de compra sai pela média vigente e recebe imediatamente o líquido histórico
da mercadoria, excluindo frete/despesas. Diferença entre recebido e custo retirado é
resultado de avaliação assinado, sem reescrever o custo das vendas anteriores.

Estornos financeiros são integrais, opostos, únicos e vinculados, incluindo alocações.
Recebimento que sustenta correção não pode ser estornado isoladamente. Estornar devolução
exige ausência de movimentos posteriores e pagamento dependente líquido zero; os pagamentos
devem ser estornados antes. Estorno de ajuste exige movimento manual reversível e sem
movimento posterior. Não há estorno de estorno ou desfazimento de cancelamento integral.

## Centavos e condição física

Valores persistidos em centavos inteiros; intermediários em BigInt. Limites monetários
e de estoque da 3B preservados. Agregações históricas no serviço acumulam inteiros em
BigInt e validam o intervalo seguro antes de retornar números, sem `REAL` financeiro.

Reversões usam a diferença de half-up acumulado por quantidade, não unitários arredondados.
Líquido e descontos são componentes independentes; o bruto corretivo é derivado da soma.
Isso evita desconto negativo e conserva cada componente ao concluir a devolução.
Unitário de correção é histórico informativo; compra/venda original mantém sua identidade.

Quantidade para revenda permanece disponível. Quantidade imprópria gera `DEV_VENDA`
seguida de `PERDA_DEVOLUCAO`, vinculada, na mesma transação e de custo exatamente oposto.
O SQLite valida o custo histórico devolvido por decomposição inteira; a perda exige
mesmo produto/operação, quantidade, custo e sequência imediatamente posterior à entrada.
Perda comum e devolução ao fornecedor continuam usando média vigente.

O teste residual conserva 100 centavos em devoluções 33/34/33, com a segunda destinada
à perda. O teste de média divergente compara quantidade e valor antes/depois do par,
incluindo retorno misto e desfazimento da devolução, preservando as demais unidades.

## Reconciliação, problemas encontrados e limites

Reconciliação verifica operações finalizadas, relações, alocações, origens reservadas,
obrigações e pagamentos, efeitos por parcela/venda, componentes históricos corretivos
e vínculos de estoque. Reconstrói quantidades disponíveis à época da correção incluindo
estornos já registrados naquele momento, sem precificar pelo estoque atual.
Inconsistência bloqueia abertura e preserva o arquivo para diagnóstico.

Problemas encontrados e corrigidos durante a implementação:

- Reconstrução parcial da v3 populada deixava pendência de FK no commit. A reconstrução
  passou a incluir dependentes, com referências entre tabelas substitutas e ordem explícita.
- O trigger de perda comum aplicava média vigente, inadequada à perda do retorno histórico.
  Criada natureza restrita ao par vinculado, mantendo o cálculo das demais saídas.
- Testes gerais esperavam schema 3. Atualizados para 4; teste específico 0003 continua
  exercitando somente v2→v3 e comparando literalmente suas proteções.
- Harness inicialmente reutilizava serviço após fechar sua conexão; corrigido para
  recriar o serviço após reabrir. Não exigiu alteração do armazenamento do aplicativo.
- Execução do Electron dentro da sandbox de automação encontrou bloqueio de ACL do Windows;
  a execução externa passou sem alterar ACLs, sandbox ou isolamento do aplicativo.

Os comandos comerciais/financeiros executam reconciliação financeira completa antes
do commit; esse custo cresce com o histórico. Não foi validada escala de milhões de
documentos nesta entrega. A política favorece consistência local; otimizações futuras
devem preservar a verificação completa na abertura e os mesmos invariantes.
Retorno seguido de perda também respeita limites intermediários de estoque.

## Verificação da entrega

As suítes novas cobrem bancos populados v1/v2/v3, backups WAL abertos separadamente,
falhas em reconstruções, comparação após reabertura, IDs/sequências elevados, índices,
triggers e FKs; fluxos integrados, concorrência por workers independentes, idempotência,
excedentes, rollback financeiro/comercial, custos históricos, arredondamentos e corrupção.
O mesmo cenário de aceitação financeira/migração executa em Node e Electron real.

Validado em **Windows 10 build 19045 x64**, em **02/11/2026**. Node 26.13.0;
Electron 43.8.6 / Node 24.22.1 / SQLite 3.53.4.

- `npm.cmd run typecheck`, `npm.cmd run lint` e `npm.cmd run format:check`: aprovados.
- `npm.cmd test`: build de produção, **76 testes aprovados**, sem falhas ou ignorados,
  incluindo 22 testes novos e execução dos cenários 3D no Electron real; `SMOKE_OK`.
- `npm.cmd run test:ui`: `DESKTOP_UI_OK`; nove rotas, foco/histórico, diagnóstico,
  teclado, protocolo offline, isolamento e três tamanhos por três níveis de zoom.
  Preservou a base de desenvolvimento, usando a migração versionada com backup.
- `npm.cmd run pack`: pacote Windows descompactado gerado. Smoke da entrada real com
  ASAR: `SMOKE_OK`, saída zero.
- Desenvolvimento reiniciado com `MNR_SMOKE=1`, usando a base de teste: `SMOKE_OK` e
  encerramento normal após diagnóstico.

Os smokes emitiram mensagens de GPU ao encerrar, com diagnóstico aprovado e saída zero.
Não foram alteradas configurações de segurança para suprimi-las.
Windows 11, instalação/desinstalação NSIS e ensaio offline em máquina limpa continuam
dependendo de ambiente específico; não foram declarados validados nesta entrega.
Nenhum banco foi apagado/recriado, nenhuma dependência adicionada e nenhum commit ou
push automático foi realizado.
