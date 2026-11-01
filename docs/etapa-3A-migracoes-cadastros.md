# Entrega 3A — Migrações e cadastros

## Estado revisado

Antes desta revisão, a Etapa 3 era exclusivamente a especificação em Markdown.
Não havia executor de migrações, tabelas comerciais, serviços cadastrais, estoque,
compras/vendas, financeiro ou novos contratos IPC. Existiam dois testes da fundação
(SQLite/IPC) e smoke desktop; eles não validavam regras comerciais.

A implementação desta rodada se limita à **3A**. A divisão aprovada conceitualmente
está na [especificação principal](etapa-3-modelagem-dados.md#10-entregas-3a3d).
3B, 3C e 3D não foram iniciadas. Não há UI de cadastro ou API comercial no preload.

## Implementado

- Migração `0001-cadastros`, incluída no JavaScript compilado e no pacote ASAR,
  sem copiar/descobrir arquivos SQL em runtime.
- `schema_migrations`, `metadados_banco`, `operacoes`, `eventos_auditoria`,
  `marcas`, `categorias`, `formas_pagamento`, `clientes`, `fornecedores`, `produtos`
  e `historico_precos`, todas `STRICT`.
- Identificação por `application_id` e UUID; versão em `user_version`, histórico e
  checksum SHA-256. Banco desconhecido, versão futura, histórico/identidade inválidos
  ou schema incompleto bloqueiam abertura, sem tentativa de reparo destrutivo.
- Banco vazio da fundação (sem objetos/versão/identificação) é aceito como versão zero.
  Quando o arquivo já existe, a API de backup SQLite cria cópia consistente antes da
  primeira migração. Banco conhecido com migrações pendentes também recebe backup.
- Backups em `data/backups/pre-migration-<versão>-<UUID>.db`, com manifesto `.db.json`:
  identificação (nula na fundação), versão anterior/alvo, versão do aplicativo e UTC.
  Falha de backup ou de manifesto impede a migração. Não há exclusão automática de cópias.
- Conjunto pendente numa transação imediata, com rollback integral e verificações
  `integrity_check`/`foreign_key_check` antes do commit. Versões e checksum ficam na
  mesma transação. Nenhuma regra comercial ou IPC fica disponível durante essa abertura.
- `openDatabase` agora é assíncrona para aguardar backup fora da transação de migração.
  O processo principal espera o sucesso antes de criar janela/registrar IPC. Em falha,
  fecha a conexão e encerra com erro; não apaga nem recria o banco.
- Serviços `save/get/listReference`, `save/get/listPerson`, `save/get/listProduct` e
  `priceHistory` (nomes concretos no código: `saveReference`, `getReference`,
  `listReferences`, `savePerson`, `getPerson`, `listPeople`, `saveProduct`, `getProduct`,
  `listProducts`, `priceHistory`). SQL só no processo principal, sem ORM ou nova dependência.
- DTOs em `shared/catalogos.ts`: referências, pessoas, produtos, histórico de preço,
  comandos e filtros. Sem dependência de plataforma. Ainda não são canais IPC.
- Validação de estrutura/campos inesperados, tamanhos, inteiro seguro/limites,
  FKs, nomes normalizados com acentos, SKU e código de barras únicos, tipo de pessoa,
  CPF e CNPJ numérico/alfanumérico. A validação de DV não consulta situação cadastral.
- Documentos opcionais; nomes de pessoas não únicos; vazio opcional vira `NULL`.
  Busca literal, sem curingas SQL; filtros de ativo e paginação de 1–200 registros,
  padrão 50, ordenação estável por nome/ID. Campo `busca` é normalizado sem acentos.

O DV do CNPJ alfanumérico segue o
[manual técnico da Receita Federal/Serpro](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf),
incluindo o exemplo oficial usado no teste. A busca é inteiramente local; a validação
não exige internet.

### Regras de gravação

- Cadastro completo via `save`: `id` ausente cria, presente atualiza; campo opcional
  omitido é limpo, exceto `ativo`, que preserva o anterior e assume verdadeiro na criação.
  Campos obrigatórios precisam ser reenviados em atualização. Inativação usa o mesmo comando.
- SKU normalizado e imutável após cadastro, impedindo reutilização de identificador antigo
  sem tabela extra de reservas. Para outra apresentação/identidade, criar outro produto.
  Marca/categoria inativa não aceita nova associação, mas vínculo já existente é preservado.
- Cada gravação exige chave de operação e motivo, executando cadastro, auditoria e histórico
  de preço na mesma transação. Mesma chave/conteúdo normalizado retorna o resultado anterior;
  conteúdo diferente é rejeitado. Operação provisória só existe dentro da transação.
- Preço cadastral inicial e alterações geram histórico imutável com motivo e operação.
  Alteração de outro campo não duplica histórico. Preço armazenado exatamente em centavos,
  limitado a 9.000.000.000.000; não existe campo manual de custo atual.
- Exclusão cadastral bloqueada; usar inativação. Históricos, metadados e registros de
  migração protegidos contra atualização/exclusão. Operações finalizadas são imutáveis.
  Auditoria registra antes/depois e versão do aplicativo; não oferece inviolabilidade
  contra edição externa do arquivo.

As referências futuras a documentos comerciais serão acrescentadas à auditoria por
migração quando a 3C existir; não foram criadas FKs para tabelas inexistentes.
O saldo inicial do produto será acrescentado em 3B, incluindo os produtos criados na 3A.
Não se antecipou a tabela de estoque apenas para satisfazer o desenho final.

## Verificações

20 testes automatizados, executados por `npm.cmd test` com build e smoke desktop:

- Schema exato/`STRICT`, abertura/reabertura, identidade e pragmas preservados.
- Banco vazio anterior com cópia prévia; banco desconhecido/futuro recusado sem mudar
  os bytes do arquivo; checksum/histórico/identidade inválidos preservam registros.
- Evolução 0→1 real e 1→2 por fixture de teste (a única versão comercial suportada é 1).
  Atualização repetida não reaplica nem produz backup sem necessidade.
- Backup em WAL com registros preservados, leitura da cópia e conferência de identidade,
  IDs/valores/versão; falhas de backup, diretório e manifesto bloqueiam atualização.
- Falha na primeira migração e no meio de conjunto pendente desfaz tabelas e marcadores.
- Cadastros, pesquisa, paginação, unicidade normalizada, inativação, opcionais e documentos.
- Preços inteiros exatos, histórico de mudanças, auditoria antes/depois, limites e IDs seguros.
- Rejeição por SQL direto de tipo, FK ou flag inválida, alteração/exclusão histórica.
- Idempotência e falhas injetadas após gravações de produto/histórico/auditoria e antes
  de finalizar operação, com rollback de todos os efeitos e nova tentativa válida.
- Electron real: criação/migração, `STRICT`, FKs, serviço cadastral, backup legível e rollback.
- Smoke da entrada real: Angular, diagnóstico IPC/SQLite e ausência de Node no renderer.

Ambiente validado: Windows 10 build 19045 x64; Node 26.13.0/SQLite 3.53.4;
Electron 43.8.6 com Node 24.22.1/SQLite 3.53.4. Windows 11 e instalação NSIS permanecem
pendentes. O teste de runtime usa diretório novo em `.local-data/test`; testes Node
também usam fixtures novas, sem apagar bases. Smoke normal usa `.local-data/test/data`.

`test:ui` continua usando o banco normal de desenvolvimento; a abertura agora pode aplicar
a migração 3A com backup prévio. Esse comando não foi necessário nesta rodada sem mudanças
visuais. O ensaio de desenvolvimento foi iniciado com `MNR_SMOKE=1`, usando o banco de teste.

Além da suíte: `typecheck`, `lint`, `format:check`, build de produção, empacotamento
Windows descompactado e smoke desse executável; reinício de desenvolvimento em modo smoke.
O build precisou executar fora da sandbox por bloqueio de leitura de diretórios ancestrais
pelo esbuild; nenhuma configuração de segurança do aplicativo/Windows foi afrouxada.

## Próximas entregas e condições de avanço

| Entrega | Pendente                                                        | Prova exigida                                                                                  |
| ------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 3B      | Saldos/movimentos, custo médio inteiro, ajustes e reconciliação | Conservação do valor, resíduos, esgotamento, estoque negativo impossível                       |
| 3C      | Compras/vendas, descontos, rateios, parcelas e atomicidade      | Todos os centavos conservados em divisões inexatas e limites; soma de parcelas exata           |
| 3D      | Dinheiro recebido, abatimentos, reembolsos e devoluções         | Reversões acumuladas exatas, reembolso limitado à origem e consultas com componentes separados |

Não há ainda testes de descontos, rateios, parcelamentos, devoluções ou reembolsos,
porque essas operações não estão implementadas. Teste de preço inteiro cadastral não
equivale a validar cálculos financeiros. Esses testes serão requisitos de conclusão
das respectivas entregas, incluindo séries determinísticas com invariantes independentes.

Os contratos financeiros futuros distinguirão recebimentos efetivos, seus estornos,
abatimentos de dívida, reembolsos pagos/estornados/pendentes e saldo exigível. Nenhum
campo de consulta poderá tratar abatimento como dinheiro recebido; o desenho de campos
está na seção 10 da especificação principal. Os contratos financeiros ainda não existem.

Nenhuma alteração em `contextIsolation`, sandbox, `nodeIntegration`, CSP ou validação IPC.
Sem nova dependência, UI, commit ou push. Nenhum banco existente foi apagado ou recriado.
