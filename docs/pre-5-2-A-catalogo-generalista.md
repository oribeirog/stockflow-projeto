# Pré-5.2 A — Generalização Integral do Catálogo de Produtos

## Diagnóstico anterior à implementação

Base limpa em `026daa0 fix: corrige reinicializacao apos restauracao de backup`.
A 5.1 e seu complemento estão commitados; a validação manual foi informada pelo
proprietário. Conferidos AGENTS/README, relatórios 3A–3D, 4F/4G, 5.1/complemento,
serviços e contratos, formulários/listagem, seleção comercial, migrações, fotos,
indicadores/exportações, IPC/preload, segurança e Builder. Nenhuma alteração
não commitada encontrada. Não houve reset, clean ou abertura experimental da base real.

### Matriz dos campos e impactos

| Campo atual              | Tipo/obrigatoriedade e validação                    | Telas                                           | Compras/vendas e histórico                                                                     | Relatórios                            | Backup           | Ação                                                                 |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| id                       | INTEGER PK AUTOINCREMENT                            | identidade interna                              | FKs e movimentos                                                                               | identificação                         | banco integral   | preservar IDs e sequência                                            |
| nome                     | TEXT obrigatório, NFC 1–200                         | cadastro/listagem/seletor                       | snapshot de descrição na confirmação; auditoria                                                | atual no estoque, histórico comercial | banco integral   | rótulo Produto; preservar snapshots                                  |
| sku                      | TEXT obrigatório único, até 64; uppercase; imutável | cadastro/listagem/busca                         | snapshot histórico                                                                             | estoque/rankings                      | banco integral   | preservar e continuar pesquisável                                    |
| codigo_barras            | TEXT opcional UNIQUE, 1–128, NFC/trim               | já existe no formulário; não participa da busca | não governa quantidade/preço                                                                   | não obrigatório                       | banco integral   | reutilizar; busca exata; zeros preservados; único inclusive inativos |
| marca_id                 | INTEGER FK obrigatório                              | seletor existente                               | não é snapshot do item; marca inativa retida em edição                                         | conforme DTOs oficiais                | banco integral   | preservar regra obrigatória atual, sem marca fictícia                |
| categoria_id             | INTEGER FK obrigatório                              | seletor existente                               | categorias livres, sem regra de perfume                                                        | conforme DTOs oficiais                | banco integral   | preservar; nenhuma categoria fixa                                    |
| volume_microlitros       | INTEGER NOT NULL 1–1e9                              | obrigatório, editor/listagem                    | não participa do custo nem snapshots dos itens; aparece em auditoria/operação cadastral antiga | não utilizado nos sete modelos        | banco integral   | remover da experiência; tornar legado nullable sem volumes fictícios |
| concentracao             | TEXT opcional até 120                               | editor                                          | auditoria/operações cadastrais antigas                                                         | não utilizado                         | banco integral   | legado preservado; remover da experiência                            |
| descricao                | TEXT opcional até 4000                              | editor                                          | descrição comercial do item é nome histórico, não esta observação                              | sem nova coluna desnecessária         | banco integral   | preservar como texto geral                                           |
| preco_venda_centavos     | INTEGER 0–9e12                                      | editor/listagem/seleção                         | histórico de preços; preço/custo do documento persistido                                       | totais oficiais                       | banco integral   | preservar centavos/precificação/histórico                            |
| estoque_minimo           | INTEGER 0–1e9                                       | editor/estoque                                  | não altera saldos                                                                              | indicadores de falta/baixo            | banco integral   | preservar                                                            |
| ativo                    | INTEGER boolean                                     | filtros/ativação                                | não apaga histórico; novos vínculos validados no backend                                       | inclui inativos conforme modelo       | banco integral   | preservar                                                            |
| criado_em/atualizado_em  | TEXT UTC                                            | DTOs/auditoria                                  | identidade temporal                                                                            | contratos existentes                  | banco integral   | preservar                                                            |
| foto                     | produto_fotos → foto_arquivos + objetos imutáveis   | componentes existentes                          | associação cadastral                                                                           | sem modificar processamento           | imagens e hashes | somente rótulos; Pré-5.2 B fora do escopo                            |
| unidade comercial (nova) | enum textual UN/CX/PCT/KIT/PAR/FR                   | editor/listagem/seletor                         | quantidades inteiras; snapshot do item                                                         | unidade quando pertinente             | banco integral   | adicionar; padrão UN compatível; sem conversão                       |

### Decisões do diagnóstico

- Não existe unidade comercial. Código de barras já existe e não requer outro
  campo ou novo índice: sua unicidade global já possui índice SQLite.
- A marca atualmente é obrigatória; não se presume ausência permitida nem se
  cria uma marca fictícia. Categorias e marcas continuam cadastros livres.
- A unidade identifica a mesma grandeza durante a vida do SKU; alteração posterior
  ao cadastro será recusada para não reinterpretar saldos/documentos existentes.
- A migração 0006 é indispensável: a constraint NOT NULL de volume não admite
  cadastro geral sem inventar um volume. Colunas antigas serão preservadas como
  legado interno; dados/auditoria/operações anteriores não serão reescritos.
- Itens históricos possuem SKU e descrição próprios. Unidade legada UN é
  compatível com as contagens inteiras existentes; itens novos registrarão a
  unidade correspondente sem mudar fórmulas comerciais ou financeiras.
- Reconstrução da tabela será limitada à transação oficial, preservando IDs,
  sequência, índices, triggers, FKs e todos os saldos. Foreign keys precisam ser
  coordenadas fora da transação durante a reconstrução e verificadas explicitamente
  antes do commit; não haverá writable_schema nem alteração das migrações 1–5.
- Backups formato 1/schema 5 não podem simplesmente ser aceitos como schema 6.
  O validador manterá schemas oficiais exatos separados; primeiro validará o
  conjunto 5 inteiro, depois migrará uma cópia em staging pelo executor oficial.
  O arquivo recebido e o estado ativo permanecerão intactos. Será preservada uma
  versão aprovada da 5.1 para gerar a fixture antiga legítima antes das alterações.
- A recuperação precisa considerar journals e gerações criados na 5.1, além de
  novas restaurações. Não se reduzirá validação nem será apagado um pending legado
  para permitir abertura.
- Rotas/seletores internos antigos poderão permanecer como aliases compatíveis;
  a navegação e os textos operacionais serão de Produtos. AppId, nome MNR Perfumes,
  raízes de dados e identidade dos backups permanecem iguais.

Referências: [ALTER TABLE e reconstrução](https://sqlite.org/lang_altertable.html)
e [foreign keys](https://sqlite.org/foreignkeys.html). Os mecanismos serão
comprovados em cópias isoladas, não presumidos pela documentação.

## Implementação e contratos

O catálogo público deixou de receber ou retornar volume/concentração em novas
operações. Os campos internos legados permanecem intactos em produtos antigos,
auditoria e respostas idempotentes históricas. Um UUID já persistido continua
reconhecendo o comando original e devolvendo a resposta original sem escrita;
novos UUIDs não podem gravar atributos de perfumaria. A unidade pode estar ausente
somente na resposta JSON antiga em cache; consultas novas sempre retornam a unidade.

O código de barras existente foi reutilizado: TEXT opcional, NFC/trim, máximo 128,
comparação exata e unicidade global, inclusive inativos. Zeros iniciais permanecem.
Não se exige GTIN/EAN nem leitor físico. Nome e SKU continuam pesquisáveis; a
pesquisa do Estoque também aceita o código exato. Não foi criado índice adicional.
Marca continua obrigatória porque o domínio anterior não autorizava sua ausência;
categorias são cadastradas livremente, sem lista fixa ou regra por segmento.

Unidades permitidas: UN, CX, PCT, KIT, PAR, FR. Default UN para registros anteriores,
pois todas as quantidades históricas eram inteiras sem conversão. Unidade e SKU
são imutáveis; outra apresentação/unidade deve usar outro SKU. Não há conversão,
fração, composição de kit, depósitos múltiplos nem reinterpretação de saldos.

Compras e vendas continuam usando os mesmos cálculos e serviços oficiais. Novos
itens confirmados guardam unidade_historica; corretivos copiam a unidade do item
original. Documentos antigos recebem UN sem alterar descrição, preço ou custo.
A unidade aparece no seletor e nas linhas do documento; quantidades e preços são
validados no processo principal. Não existem cálculos de custo no Angular.

Os canais IPC e métodos literais existentes foram mantidos. A expansão do contrato
compartilhado é consumida pelo serviço cadastral, IPC/preload já tipados e Angular.
Objetos fechados, limites de strings, enum da unidade, remetente/frame/origem,
aridade, sandbox, CSP e contextIsolation permanecem. Não há dispatcher novo,
SQL ou filesystem expostos ao renderer. Nenhuma dependência foi adicionada.

## Migração 0006 e integridade histórica

A única migração nova é 0006-catalogo-generalista; 0001–0005 permaneceram intactas.
O NOT NULL de volume impedia produtos universais. A 0006 torna esse legado nullable,
acrescenta unidade_comercial e unidade_historica com domínio fechado e default UN.
Não se usam volumes/concentrações fictícios. O produto é reconstruído sob o mesmo
nome, sem renomear tabelas referenciadas e sem disparar novas entradas de estoque.

O executor oficial cria sua proteção antes da migração. Desabilita FK apenas na
conexão ainda não exposta à interface e fora de transação, executa a reconstrução
em IMMEDIATE, confere integridade/FKs e reconciliação antes do commit e restaura
foreign_keys no finally. IDs, autoíndices, triggers oficiais e sqlite_sequence
são preservados. O trigger de criação do saldo é recriado após a cópia dos produtos.
O trigger adicional proíbe mudar a unidade já cadastrada. Nenhuma tabela comercial
nova, fórmula, custo histórico ou migração anterior foi reescrita.

As comparações dos testes abrangem todas as tabelas e sequências, admitindo apenas
as duas colunas novas e o registro oficial da 0006. O conteúdo anterior da auditoria,
operações idempotentes, fotografias, documentos, preços e vínculos é comparado
integralmente. Exceções injetadas em quatro fronteiras e encerramento do processo
após DROP TABLE dentro da transação comprovam rollback e reabertura em schema 5,
seguida de uma única migração bem-sucedida para 6.

## Backup 5.1 e compatibilidade 5/6

O formato 1 não mudou de significado. Aceita estritamente schemas oficiais 5 e 6,
com SQL do schema, application_id, identidade, checksums de migrações, integridade,
FKs, reconciliação e fotografias verificados antes de qualquer migração. Não basta
mudar user_version. Schema futuro 7, SQL adulterado e manifesto incompatível são
recusados. Os limites ZIP STORE-only, paths fechados, hashes e tipos permanecem.

A inspeção extrai em work exclusivo. Um backup 5 legítimo é validado como 5,
migrado pela 0006 oficial na cópia privada e validado novamente como 6. Um conjunto
novo recebe manifesto e hashes de 6, preservando a data de criação e a identificação
do backup original. O pacote selecionado nunca é aberto para escrita. A prévia
informa schema de origem e schema preparado. A confirmação continua criando uma
proteção independente e completa do estado atual antes de armar a restauração.

Para um pending.json criado pelo aplicativo 5.1, o plano e o conjunto 5 permanecem
imutáveis. Uma cópia é migrada em staging e um vínculo durável \*.upgrade.json liga
o hash do payload original ao ID e manifesto da geração 6 derivada. Só depois o
ponteiro pode mudar. O done registra geracao quando necessário e a abertura confere
esse vínculo; referências e retenção incluem ambas as gerações. Se houver falha,
o protocolo preserva o conjunto anterior recuperável. Não se apaga pending para
permitir abertura. O teste de interrupção após abertura admite a recuperação B
prevista no protocolo anterior; nas demais fronteiras verificadas exige A.

O backup legítimo 5 foi gerado pelo runtime do commit aprovado 026daa0, antes das
alterações. Os helpers também recompilam esse commit em cache exclusivo quando
necessário, sem checkout/reset, instalação de dependências ou alteração da árvore.
Isso permite repetir a prova sem depender de uma fixture construída pelo schema 6.
Um lock de preparação coordena arquivos de testes paralelos e preserva staging
interrompido. O runtime antigo e todos os fixtures ficam fora do ASAR.

## Defeitos encontrados e correções

1. Caminhos aninhados da proteção pré-migração com fotografias ultrapassaram o
   caminho tradicional do Windows e provocaram SQLITE_CANTOPEN. Reprodução em
   raiz exclusiva, com arquivo de 260 caracteres: a API falhou com caminho comum
   e funcionou com prefixo de namespace. sqlitePath aplica o prefixo somente aos
   nomes longos passados ao SQLite no Windows, inclusive backup, VACUUM e leitores.
   Não troca VFS, não altera locks e não muda paths no manifesto/renderer. Uma
   geração previamente ativa em schema 5 foi migrada com proteção completa em
   caminho longo e conferida novamente após reabertura.
2. Uma bateria de interrupções retornou EACCES na publicação de controle e recuperou
   B, mantendo todos os dados. A exceção foi registrada pelo harness. Uma reprodução
   com FileShare.None em active.json comprovou a mesma recusa temporária. Não foi
   identificado qual processo mantinha o handle na tentativa original. O helper
   Win32 agora repete exclusivamente erros 5/32/33 por até 2,25 s, mantendo os mesmos
   flags WRITE_THROUGH, mesma operação atômica e mesma política de não sobrescrita.
   Bloqueio permanente continua sendo erro; arquivo existente sem replace continua
   EEXIST. A prova controlada passou após liberar o lock, preservando a publicação.
3. A auditoria do relatório de estoque detectou a projeção de leitura sem a nova
   unidade, corrigida sem mudar os totais. Comparadores XLSX foram atualizados para
   a coluna adicional, mantendo as asserções de valores e completude.
4. Fixtures anteriores ainda enviavam volume em operações novas e esperavam schema
   atual 5. Foram adaptadas; testes que exercitam schemas antigos usam o serviço
   do runtime aprovado, preservando seus comandos e expectativas históricas.
   Testes de schema futuro passaram a usar 7, mantendo rejeição antes de escrita.
5. Os primeiros smokes novos identificaram problemas no próprio harness: navegar
   repetidamente para a mesma URL de criação reutilizava o editor salvo, e a espera
   de sucesso usava uma classe inexistente. A sequência e o seletor foram corrigidos;
   a confirmação oficial e as comparações de banco permaneceram obrigatórias.

6. Um produto CX ainda aparecia como UN no rascunho reaberto, embora a confirmação
   já persistisse CX. A preparação oficial agora grava a unidade imutável desde o
   rascunho; compra e venda têm teste de consulta, reabertura física e replay. O
   smoke salva e reabre ambos os rascunhos antes da revisão e confirmação.

Referências para a investigação de caminhos: [SQLite VFS](https://sqlite.org/vfs.html)
e [namespaces Win32](https://learn.microsoft.com/windows/win32/fileio/naming-a-file).
A solução foi comprovada no runtime, sem presumir suporte apenas pela documentação.

## Angular, Dashboard e arquivos

Navegação principal Produtos e rota /produtos; URLs antigas /perfumes redirecionam
para compatibilidade. Formulários, lista, seleção comercial, estados e mensagens
usam nomenclatura geral. Componentes/classes internos antigos podem conservar seus
nomes para evitar refatoração sem benefício. Marca MNR Perfumes, appId e diretórios
não foram alterados. Há link do catálogo ao estoque do produto.

O formulário mantém grupos, tokens e aparência existentes. Remove Volume e
Concentração e acrescenta seletor de unidade com aviso de imutabilidade. Erros são
associados aos controles; campos ficam preservados após falha. A lista mostra
nome, foto, SKU/código de barras, classificação, unidade, preço e situação. Saldos
e movimentos oficiais permanecem na área Estoque, acessível diretamente.

O Dashboard não ganhou fórmulas; sua metodologia explica quantidades por unidade
cadastral sem conversões. Os sete modelos de relatórios mantêm fluxos, posições e
coortes. Estoque inclui unidade por linha e nota explicativa. Rankings conservam
ordem e identificação histórica. Segurança das células, centavos, paginação,
snapshot, worker e publicação de XLSX/PDF permanecem sob os validadores existentes.
O processamento das fotografias não foi alterado; somente rótulos e a abertura do
SQLite na proteção com caminhos longos foram ajustados.

## Desempenho e limites

Benchmark isolado próprio com 50, 200 e 500 produtos por serviços oficiais. Mede
listagem, busca SKU/código, obter, resumo gerencial, coleta e XLSX. Cache aquecido,
100 chamadas cadastrais e 20 resumos por base. Relatório em
.cache/pre52a-catalogo-benchmark.json. Memória é amostra RSS/heap do processo Node,
não pico do worker/Electron. O smoke registra separadamente 20 chamadas por filtro
via renderer/IPC; não se confundem esses tempos com SQL puro. Não se promete
capacidade para milhões de registros. Não foram adicionados índices ou limites.

## Checklist manual do proprietário

- [ ] Guardar um backup anterior em local seguro e conservar a versão aprovada para referência.
- [ ] Abrir a nova versão e conferir produtos antigos, SKU, fotografias, preços e estoque.
- [ ] Confirmar que Volume/Concentração não aparecem nem são exigidos.
- [ ] Cadastrar perfume como produto comum, cosmético e acessório em categorias livres.
- [ ] Usar código com zeros iniciais; pesquisar por nome, SKU e código exato.
- [ ] Conferir recusa de SKU/código duplicado, inclusive em registro inativo.
- [ ] Cadastrar CX, comprar 10 caixas e vender 2: conferir saldo 8 CX e custo oficial.
- [ ] Renomear/inativar o produto e conferir a descrição/unidade do documento anterior.
- [ ] Conferir unidade imutável e manutenção dos vínculos com marca/categoria inativas.
- [ ] Conferir Estoque, Dashboard e relatórios, inclusive XLSX/PDF de estoque.
- [ ] Fazer backup novo, alterar dados, restaurar e conferir a PRIMEIRA abertura automática.
- [ ] Inspecionar backup legítimo schema 5: conferir origem 5/preparado 6 antes de confirmar.
- [ ] Após restaurar, conferir dados/fotos/histórico e a proteção pré-restauração B.
- [ ] Fechar e abrir novamente; registrar uma operação nova e conferir persistência.
- [ ] Testar teclado, erros e janelas/zoom usuais, sem transbordamento da página.

## Limitações e próximas etapas

Quantidades inteiras e uma unidade fixa por SKU. Não há scanner, conversão,
estoque fracionário ou kits compostos. Marca/categoria continuam obrigatórias.
Volume/concentração só permanecem em legado/histórico interno. Backups não são
criptografados; guardá-los fora do computador com proteção adequada. Não usar uma
versão anterior do aplicativo para abrir um banco já migrado para schema 6.

Validação automatizada nesta máquina Windows 10 x64; offline emulado não é ensaio
físico desconectado e não homologa Windows 11. O executável ASAR é um pacote de
teste, sem instalador. Pré-5.2 B (fotografias), Pré-5.2 C (visual), 5.2 (instalador)
e 5.3 (homologação final) permanecem pendentes. Sem commit/push e sem acesso de
escrita a dados reais. As verificações finais estão documentadas abaixo; a
aprovação manual permanece com o proprietário.

## Resultados finais de 16/11/2026

**Implementação tecnicamente concluída; validação manual do proprietário pendente.**
226 testes gerais aprovados, incluindo os 12 grupos específicos do catálogo. Zero
falhas, interrupções ou testes ignorados nessa suíte final. O comando npm test
completo também aprovou os dois hosts Angular cadastrais e o smoke desktop.

A bateria principal teve 27 execuções com código 0. Após a correção final do
rascunho/unidade, foram repetidas nove verificações afetadas: typecheck, lint,
formatação, build, teste geral, interface, vendas, financeiro e correções. Todas
aprovaram e mantiveram constante a impressão dos arquivos de produção durante a
reexecução. Os demais recortes e os smokes específicos também foram aprovados.
Não se contaram as tentativas anteriores malsucedidas como aprovação.

Ledger principal: [.cache/pre52a-final-2026-11-16T13-11-05-119Z/results.json](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/results.json).
Reexecuções afetadas: [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/results.json](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/results.json).
Cada linha registra comando, início/fim UTC, código de saída e caminho do log.
A tabela usa o resultado aprovado mais recente de cada comando.

| Comando                                                                          | Saída | Fim UTC                  | Log                                                                                                                       |
| -------------------------------------------------------------------------------- | ----: | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                                          |     0 | 2026-11-16T13:41:26.312Z | [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/01.log](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/01.log) |
| `npm.cmd run lint`                                                               |     0 | 2026-11-16T13:41:32.250Z | [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/02.log](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/02.log) |
| `npm.cmd run format:check`                                                       |     0 | 2026-11-16T13:41:43.192Z | [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/03.log](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/03.log) |
| `npm.cmd run build`                                                              |     0 | 2026-11-16T13:41:53.759Z | [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/04.log](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/04.log) |
| `npm.cmd test`                                                                   |     0 | 2026-11-16T13:44:12.935Z | [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/05.log](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/05.log) |
| `npm.cmd run test:ui`                                                            |     0 | 2026-11-16T13:47:38.562Z | [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/06.log](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/06.log) |
| `npm.cmd run test:vendas`                                                        |     0 | 2026-11-16T13:48:00.966Z | [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/07.log](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/07.log) |
| `npm.cmd run test:financeiro`                                                    |     0 | 2026-11-16T13:49:16.975Z | [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/08.log](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/08.log) |
| `npm.cmd run test:correcoes`                                                     |     0 | 2026-11-16T13:49:42.924Z | [.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/09.log](../.cache/pre52a-final-addon-2026-11-16T13-41-20-350Z/09.log) |
| `npm.cmd run test:reembolsos`                                                    |     0 | 2026-11-16T13:20:08.081Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/10.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/10.log)             |
| `npm.cmd run test:correcoes-compras`                                             |     0 | 2026-11-16T13:20:33.649Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/11.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/11.log)             |
| `npm.cmd run test:estornos-estoque`                                              |     0 | 2026-11-16T13:21:03.522Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/12.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/12.log)             |
| `npm.cmd run test:consolidacao`                                                  |     0 | 2026-11-16T13:21:40.130Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/13.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/13.log)             |
| `npm.cmd run test:consolidacao-gerencial`                                        |     0 | 2026-11-16T13:25:05.757Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/14.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/14.log)             |
| `npm.cmd run test:consolidacao-estoque`                                          |     0 | 2026-11-16T13:27:50.705Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/15.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/15.log)             |
| `npm.cmd run test:relatorios`                                                    |     0 | 2026-11-16T13:28:05.880Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/16.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/16.log)             |
| `npm.cmd run test:dashboard`                                                     |     0 | 2026-11-16T13:28:27.725Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/17.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/17.log)             |
| `npm.cmd run test:exportacoes`                                                   |     0 | 2026-11-16T13:29:47.221Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/18.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/18.log)             |
| `npm.cmd run test:backup-restauracao`                                            |     0 | 2026-11-16T13:33:28.936Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/19.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/19.log)             |
| `npm.cmd run test:catalogo-generalista`                                          |     0 | 2026-11-16T13:35:46.716Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/20.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/20.log)             |
| `npm.cmd run pack`                                                               |     0 | 2026-11-16T13:36:52.144Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/21.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/21.log)             |
| `node scripts/verify-package.mjs`                                                |     0 | 2026-11-16T13:36:52.334Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/22.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/22.log)             |
| `node scripts/backup-restauracao-smoke.mjs --catalogo-generalista --development` |     0 | 2026-11-16T13:37:44.293Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/23.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/23.log)             |
| `node scripts/backup-restauracao-smoke.mjs --catalogo-generalista --package`     |     0 | 2026-11-16T13:38:30.762Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/24.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/24.log)             |
| `node scripts/backup-restauracao-smoke.mjs --legacy-schema5 --development`       |     0 | 2026-11-16T13:39:19.394Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/25.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/25.log)             |
| `node scripts/backup-restauracao-smoke.mjs --legacy-schema5 --package`           |     0 | 2026-11-16T13:40:00.364Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/26.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/26.log)             |
| `node scripts/benchmark-catalogo-generalista.cjs`                                |     0 | 2026-11-16T13:40:03.618Z | [.cache/pre52a-final-2026-11-16T13-11-05-119Z/27.log](../.cache/pre52a-final-2026-11-16T13-11-05-119Z/27.log)             |

O benchmark foi repetido após distinguir corretamente a versão da biblioteca
better-sqlite3 da versão do motor SQLite; não se alteraram consultas ou fixtures
para produzir números favoráveis. Resultado em [.cache/pre52a-benchmark-final.log](../.cache/pre52a-benchmark-final.log).

### Prova do pacote e da versão final

A inspeção do ASAR verificou preload, handlers, worker de exportação, worker de
backup, bibliotecas XLSX/ZIP, migração 0006 e suporte a paths longos. Scripts,
fixtures, cache e novos diagnósticos de teste ficam fora do pacote.

Após as reexecuções, foram comparados byte a byte 144 arquivos de
produção do ASAR com o dist recompilado: **zero divergências**. Assim, os smokes do
executável correspondem ao código final validado. Auditoria:
[.cache/pre52a-artifact-audit.json](../.cache/pre52a-artifact-audit.json).

- Base aprovada: `026daa03db88c8eda8c36a0412cf1bb23df32f7f`.
- Impressão constante das fontes de produção na rodada final: `4848c92132d5182be9b44a1554bb84ac0855bce9bf40fb667b4f57bb37e2ec35`.
- SHA-256 do ASAR: `f77cbd087c3a39fe0afbe207702642e2a22929d3310b32f16fc493fe4f82062c`.
- SHA-256 do backup schema 5 original e imutável: `37483776f676ba1496f22bd286f075d8587c42229af9a54dabdf931b2fe27627`.

### Ambientes e restauração real

Nos seis ciclos abaixo, a PRIMEIRA abertura automática apresentou A, a SEGUNDA
abertura manteve A, o produto exclusivo B estava ausente, B permaneceu integral
na proteção e não houve startup-error. Em seguida uma nova operação foi aceita;
na terceira abertura, seu estado persistiu. Todos os arquivos continuaram válidos
depois de fechar o aplicativo. Não se aceitou apenas a segunda abertura como prova.

| Origem restaurada     | Ambiente | Primeira / segunda abertura | Proteção   | XLSX/PDF válidos | Evidência                                                                                 |
| --------------------- | -------- | --------------------------- | ---------- | ---------------: | ----------------------------------------------------------------------------------------- |
| Novo schema 6         | local    | A / A                       | B integral |               16 | [.cache/pre52a-catalogo-local-smoke.json](../.cache/pre52a-catalogo-local-smoke.json)     |
| Novo schema 6         | http     | A / A                       | B integral |               16 | [.cache/pre52a-catalogo-http-smoke.json](../.cache/pre52a-catalogo-http-smoke.json)       |
| Novo schema 6         | package  | A / A                       | B integral |               16 | [.cache/pre52a-catalogo-package-smoke.json](../.cache/pre52a-catalogo-package-smoke.json) |
| Legítimo schema 5 → 6 | local    | A / A                       | B integral |               16 | [.cache/pre52a-legacy-local-smoke.json](../.cache/pre52a-legacy-local-smoke.json)         |
| Legítimo schema 5 → 6 | http     | A / A                       | B integral |               16 | [.cache/pre52a-legacy-http-smoke.json](../.cache/pre52a-legacy-http-smoke.json)           |
| Legítimo schema 5 → 6 | package  | A / A                       | B integral |               16 | [.cache/pre52a-legacy-package-smoke.json](../.cache/pre52a-legacy-package-smoke.json)     |

Total: **96 arquivos nesses seis ciclos**, reabertos por openpyxl/pypdf/pdfplumber,
com estrutura, textos, tipos, centavos, totais, linhas completas, A4 e páginas
conferidos. O ambiente package é o executável Windows x64 com ASAR e rede emulada
offline; http usa Angular servido localmente; local usa mnr://app. A 5.1 também
passou em npm run dev supervisionado, com primeira abertura automática validada.

O smoke generalista cadastrou FR/CX/UN sem campos de perfumaria, buscou nome/SKU/código
com zero inicial, salvou e reabriu rascunhos CX de compra/venda, confirmou 10 caixas
a R$20 e venda de duas a R$50,01, conferiu saldo 8 CX/16000 centavos e custo histórico
4000 centavos. Renomeação/inativação preservou os itens confirmados. Dashboard e
os sete modelos foram comparados com as consultas oficiais após restauração.

Os testes usaram bancos, imagens, perfis e destinos exclusivos dentro das raízes
de teste. LOCALAPPDATA foi ajustado apenas no filho empacotado. Respostas dos
diálogos de arquivo foram controladas pelo harness externo; a interação visual
com o seletor nativo permanece no checklist manual. Não houve banco real como fixture.

### Desempenho observado

Windows 10 Pro 10.0.19045 x64; Node 26.13.0; better-sqlite3
13.0.3; SQLite 3.53.4. Electron empacotado 43.8.6;
Angular 22.2.4. Os casos foram executados em sequência, com cache aquecido.
Tempos em ms; medianas nas consultas. RSS é amostra do processo Node após a
etapa, não pico e não consumo isolado do worker. A coleta contém todas as linhas.

| Produtos | Listar |   SKU | Código exato | Obter | Resumo gerencial | Coleta estoque |    XLSX | Bytes XLSX | RSS MiB |
| -------: | -----: | ----: | -----------: | ----: | ---------------: | -------------: | ------: | ---------: | ------: |
|       50 |  0,212 | 0,183 |        0,182 | 0,038 |            1,568 |          2,306 |  83,949 |      12942 |    91,3 |
|      200 |  0,439 | 0,392 |        0,405 | 0,036 |            1,515 |          1,819 |  54,428 |      20025 |   114,7 |
|      500 |  0,824 | 0,939 |        0,966 | 0,038 |            1,506 |          5,027 | 111,322 |      33834 |   129,0 |

Fonte: [.cache/pre52a-catalogo-benchmark.json](../.cache/pre52a-catalogo-benchmark.json). O resumo é
consulta oficial do backend, não renderização do Dashboard. Tempos de renderer/IPC
com instrumentação CDP estão separados nos catalogAudit.perf dos smokes; não são
SQL puro. Não houve comparação formal antes/depois de performance nem medição de
pico de memória. Nenhuma promessa para milhões de registros ou otimização especulativa.

### Capturas inspecionadas

A captura inicial de catálogo tinha superfície nativa menor que o viewport emulado;
o harness passou a ajustar ambas antes de capturar. Isso foi um defeito de captura,
sem evidência de divergência comercial. As capturas abaixo foram inspecionadas na
versão corrigida; PDFs foram renderizados por Poppler. Tabelas e valores estão
legíveis, sem cortes horizontais, com cabeçalhos repetidos e páginas numeradas.

- [Catálogo generalista no executável](evidencias-pre-5-2-A/catalogo-pacote.png).
- [Cadastro geral, SKU e código de barras](evidencias-pre-5-2-A/cadastro-produto.png).
- [Prévia do backup antigo migrado em staging](evidencias-pre-5-2-A/backup-schema5-revisao.png).
- [Estoque em PDF, primeira página](evidencias-pre-5-2-A/estoque-pdf-pagina-1.png).
- [Estoque em PDF, continuação e unidade CX](evidencias-pre-5-2-A/estoque-pdf-pagina-2.png).

### Arquivos criados ou modificados

- `README.md`
- `docs/evidencias-pre-5-2-A/backup-schema5-revisao.png`
- `docs/evidencias-pre-5-2-A/cadastro-produto.png`
- `docs/evidencias-pre-5-2-A/catalogo-pacote.png`
- `docs/evidencias-pre-5-2-A/estoque-pdf-pagina-1.png`
- `docs/evidencias-pre-5-2-A/estoque-pdf-pagina-2.png`
- `docs/pre-5-2-A-catalogo-generalista.md`
- `electron/infrastructure/database/index.ts`
- `electron/infrastructure/database/migrate.ts`
- `electron/infrastructure/database/migrations/0006-catalogo-generalista.ts`
- `electron/infrastructure/database/sqlite-path.ts`
- `electron/main/index.ts`
- `electron/services/backup/control.ts`
- `electron/services/backup/controller.ts`
- `electron/services/backup/format.ts`
- `electron/services/backup/io.ts`
- `electron/services/backup/jobs.ts`
- `electron/services/backup/worker.ts`
- `electron/services/catalogos.ts`
- `electron/services/comercial.ts`
- `electron/services/correcoes.ts`
- `electron/services/estoque-consulta.ts`
- `electron/services/exportacoes/documento.ts`
- `electron/services/exportacoes/worker.ts`
- `electron/services/media-snapshot.ts`
- `electron/services/relatorios-sql.ts`
- `electron/services/relatorios.ts`
- `package.json`
- `scripts/backup-restauracao-smoke.mjs`
- `scripts/benchmark-backup-restauracao-main.cjs`
- `scripts/benchmark-catalogo-generalista.cjs`
- `scripts/benchmark-estoque.cjs`
- `scripts/cadastros-desktop.cjs`
- `scripts/catalogo-generalista-scenario.mjs`
- `scripts/compras-package-smoke.mjs`
- `scripts/compras-ui-desktop.cjs`
- `scripts/consolidacao-gerencial-scenario.mjs`
- `scripts/consolidacao-scenario.cjs`
- `scripts/database-runtime.cjs`
- `scripts/estoque-ui.cjs`
- `scripts/fotos-runtime.cjs`
- `scripts/pessoas-fixture.cjs`
- `scripts/ui-desktop.cjs`
- `scripts/vendas-scenario.cjs`
- `scripts/verify-package.mjs`
- `shared/backup.ts`
- `shared/catalogos.ts`
- `shared/comercial.ts`
- `shared/estoque-ipc.ts`
- `shared/relatorios-ipc.ts`
- `src/app/core/navigation.ts`
- `src/app/features/compras/editor.html`
- `src/app/features/compras/editor.ts`
- `src/app/features/dashboard/dashboard.html`
- `src/app/features/estoque/detalhe.html`
- `src/app/features/estoque/estoque.html`
- `src/app/features/perfumes/editor.html`
- `src/app/features/perfumes/editor.ts`
- `src/app/features/perfumes/perfumes.html`
- `src/app/features/perfumes/perfumes.ts`
- `src/app/features/perfumes/photo-editor.ts`
- `src/app/features/settings/backup.html`
- `src/app/features/vendas/editor.html`
- `src/app/features/vendas/editor.ts`
- `tests/angular/main.ts`
- `tests/backup-restauracao.test.cjs`
- `tests/cadastros-ipc.test.cjs`
- `tests/catalogo-generalista.test.cjs`
- `tests/catalogos.test.cjs`
- `tests/compras-ipc.test.cjs`
- `tests/consolidacao-estoque.test.cjs`
- `tests/database.test.cjs`
- `tests/estoque-ipc.test.cjs`
- `tests/estoque.test.cjs`
- `tests/financeiro-migrations.test.cjs`
- `tests/fotos.test.cjs`
- `tests/helpers/approved-v5.cjs`
- `tests/helpers/backup-recovery-diagnostics.cjs`
- `tests/helpers/catalogo-migration-child.cjs`
- `tests/helpers/catalogo-v5-fixture.cjs`
- `tests/helpers/comercial-migration.cjs`
- `tests/helpers/consolidacao-estoque-fixture.cjs`
- `tests/helpers/consolidacao-fixture.cjs`
- `tests/helpers/correcoes-compras-fixture.cjs`
- `tests/helpers/correcoes-ui-fixture.cjs`
- `tests/helpers/estoque-fixture.cjs`
- `tests/helpers/financeiro-consulta-fixture.cjs`
- `tests/helpers/financeiro-runtime.cjs`
- `tests/helpers/recebimentos-ui-fixture.cjs`
- `tests/helpers/reembolsos-ui-fixture.cjs`
- `tests/migrations.test.cjs`

### Estado de entrega

Nenhum commit ou push. Migrações 0001–0005 intactas; regras financeiras, algoritmo
de custo médio, hashes e documentos históricos preservados. Nenhuma dependência
nova. Não foram implementados Pré-5.2 B/C, instalador ou homologação final. O código
e o pacote estão disponíveis para a validação manual pelo checklist deste relatório.
