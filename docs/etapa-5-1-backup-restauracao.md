# 5.1 — Backup, Restauração Segura e Recuperação de Falhas

**Complemento da validação manual:** foi encontrada e reproduzida uma falha no
supervisor de desenvolvimento durante a primeira reinicialização. O relato,
correção, lacuna dos testes anteriores e novas evidências estão no
[relatório complementar de reinício](complemento-5-1-reinicio-restauracao.md).
Os resultados abaixo registram a entrega inicial; não substituem essa validação.

## Diagnóstico anterior à implementação

Base limpa, HEAD `f730180 test: consolida correcoes de compras e estoque`.
4G.3 efetivamente commitada; aprovação manual informada pelo proprietário.
AGENTS/README, relatórios integrais 3A–3D e 4G.1–4G.3, documentação 4D/4E/4F,
main, paths, conexão/migrações, fotos, snapshots internos, exportações, IPC,
preload, navegação, Builder e testes foram examinados antes desta implementação.
Sem descarte de alterações ou manipulação de bancos existentes.

O processo principal abre `data/mnr-perfumes.db` em WAL, synchronous FULL,
foreign_keys ON e trusted_schema OFF. A abertura oficial inspeciona identidade,
schema, checksums das cinco migrações, integridade e reconciliação. Migrações
0001–0005 e algoritmos comerciais permanecem fora das alterações autorizadas.
O encerramento fecha a conexão principal. Exportações abrem conexões de leitura
em workers; fotografias usam fila `withLock`, publicação e descarte próprios.

## Inventário persistente

Raiz instalada: `%LOCALAPPDATA%/MNR Software/MNR Perfumes`; desenvolvimento:
`.local-data/development`. Testes usam raízes novas/exclusivas e LOCALAPPDATA
isolado somente no processo filho. Banco fica em `data`, imagens em `images`,
separados. Logs e perfil Chromium na raiz são descartáveis para recuperação
comercial e não fazem parte do backup.

Todas as tabelas são preservadas no SQLite, não uma seleção de linhas:
metadados_banco, schema_migrations, operacoes, eventos_auditoria, marcas,
categorias, formas_pagamento, clientes, fornecedores, produtos, historico_precos,
saldos_estoque, movimentacoes_estoque, documentos, itens_documento,
parcelas_receber, movimentos_financeiros, alocacoes_recebimento,
vinculos_estoque_comercial, abatimentos_parcela, reembolsos_cliente,
origens_reembolso, alocacoes_reembolso, foto_arquivos e produto_fotos, além de
sequências e demais estruturas persistentes do schema oficial.

`produto_fotos.foto_id` referencia `foto_arquivos.id`; bytes atuais estão em
`images/objects/<UUID>.image` e `<UUID>.thumb`, com tamanho/hash no banco.
Não há caminho absoluto cadastral nem anexo externo obrigatório identificado.
`images/staging` contém preparações temporárias; owners de tokens ficam em
memória. Arquivos de fotos retiradas são elimináveis pelo serviço existente;
backup inclui todos os objetos/miniaturas efetivamente vinculados, mantendo
também os registros históricos do banco. Referência atual ausente/inválida
impede declarar o conjunto completo; não são inventadas imagens ou alteradas
referências. Arquivos desconhecidos são preservados, sem inclusão cega.

Não incluir executáveis/ASAR, dependências, build/release, Chromium, caches,
logs, fixtures, outros bancos, exportações externas ou backups antigos de
migração: são artefatos separados, não componentes do estado ativo atual.

## Estratégia definida para implementação

- Snapshot oficial VACUUM INTO, conexão de origem somente leitura em worker,
  sincronização explícita da saída e validação completa antes do uso. Evitar
  repetir o padrão de db.backup que apresentou problemas no benchmark anterior.
- Coordenação central dos IPCs: impedir novas operações durante captura/crítico,
  aguardar operações anteriores e usar também a fila do serviço de fotos.
  O lock SQLite sozinho não congela o filesystem. Liberar o aplicativo depois
  do staging consistente, antes de empacotar/publicar backup externo.
- Formato `.mnrbackup`, ZIP versionado com manifesto SHA-256 e entradas STORE
  (sem compressão). Leitura sequencial, caminhos fechados, tamanhos/quantidades
  limitados; rejeitar links, diretórios, duplicados, nomes inesperados e conteúdo
  comprimido. Versão inicial aceita somente formato 1/schema 5 reconhecido.
- Dependências diretas previstas: yazl 3.3.1 para escrita em fluxo e yauzl 3.4.0
  para leitura lazy/validação; tipos correspondentes em desenvolvimento. Evitam
  implementar ZIP manualmente e depender da árvore transitiva do ExcelJS.
  Versões e auditoria serão registradas no lockfile e nos logs desta etapa.
- Pacote não criptografado: hashes verificam integridade, não autenticidade.
  Guardar em mídia/pasta protegida fora do computador; não criar criptografia,
  nuvem, contas ou senhas próprias nesta entrega.
- Publicação em temporário no mesmo diretório do destino; flush antes de
  movimentação nativa Windows sem sobrescrita. Avaliar helper estático Win32
  MOVEFILE_WRITE_THROUGH, sem hard links, para suportar NTFS/exFAT/FAT dentro
  dos limites do próprio volume. Nenhum script virá de arquivos de backup.
- Restauração prepara geração completa `recovery/sets/<UUID>/{data,images}`.
  O conjunto ativo anterior não é desmontado. Plano/journal durável controla
  ativação de ponteiro para a geração inteira, nunca duas renomeações soltas.
  Antes disso, criar e validar backup pré-restauração independente.
- Confirmação explícita arma o plano e pede reinicialização oficial. A seleção
  só é ativada com todas as conexões antigas encerradas, antes de IPC/janela.
  Abertura/reconciliação/fotos aprovadas precedem confirmação final de sucesso.
  Erro exige recuperação do conjunto anterior ou bloqueio claro, sem iniciar
  operação normal sobre estado misto. Repetir recuperação deve ser idempotente.
- Retenção deve preservar as três proteções mais recentes e o legado inicial;
  limpeza somente de conjuntos comprovadamente pertencentes a planos próprios,
  sem apagar arquivos desconhecidos ou a última proteção recuperável. Falha de
  limpeza será informada e terá limite defensivo, não crescimento silencioso.

Referências consultadas: [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html),
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md),
[yauzl](https://github.com/thejoshwolfe/yauzl),
[yazl](https://github.com/thejoshwolfe/yazl) e
[File.Move / não sobrescrita](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.move).
Garantias reais e compatibilidade serão comprovadas nos testes, não presumidas
pela documentação ou pela existência dos arquivos.

## Implementação e formato entregue

O diagnóstico acima registra a decisão anterior ao código. A implementação usa
as estratégias descritas, com os seguintes detalhes efetivos:

| Componente                     | Responsabilidade                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `shared/backup.ts`             | DTOs, seis canais e API fechada; nenhum path no contrato público                  |
| `backup/controller.ts`         | Diálogos, intenção, exclusão mútua, staging, proteção e reinicialização           |
| `backup/gate.ts`               | Drenagem de operações IPC em andamento e bloqueio temporário de novas chamadas    |
| `backup/format.ts`             | Snapshot, formato ZIP STORE, manifesto, hashes, schema e referências              |
| `backup/jobs.ts` / `worker.ts` | Trabalho pesado fora do event loop principal, limites e encerramento de handles   |
| `backup/io.ts`                 | Arquivos exclusivos, sincronização, espaço, publicação nativa e erros sanitizados |
| `backup/ownership.ts`          | Prova de propriedade dos temporários, identidade de arquivo e hashes              |
| `backup/control.ts`            | Gerações completas, journal, ativação, recuperação e retenção                     |
| `electron/ipc/backup.ts`       | Seis handlers literais protegidos por remetente/frame/origem/aridade              |
| `settings/backup.*`            | Formulário, prévia, confirmação explícita, estado e resultado após reabertura     |

Arquivo externo: `.mnrbackup`, ZIP STORE com `manifest.json`,
`data/mnr-perfumes.db` e pares `images/objects/<UUID>.image/.thumb` vinculados.
O manifesto canônico contém aplicativo `br.com.mnrsoftware.mnrperfumes`, formato 1,
schema 5, versão do aplicativo, identidade do banco, instante ISO, paths relativos,
tamanhos e SHA-256. Um envelope contém também o SHA-256 do manifesto canônico.
CRC32 das entradas ZIP é conferido além de SHA-256. Não há scripts, senhas,
macros, caminhos pessoais ou executáveis no formato.

Somente **formato 1 / schema 5** é aceito nesta versão. Não há promessa de importar
backups de outros aplicativos ou de schemas anteriores/futuros. O original nunca
é migrado ou alterado durante inspeção. Comparação de SQL com schema oficial
construído em memória precede execução de constraints/consultas de domínio sobre
o arquivo recebido. Identidade, checksums de migrações, integridade, FKs,
reconciliações e referências das imagens são verificados em leitura.

O formato não está criptografado. SHA-256 e CRC detectam corrupção/alteração,
mas não autenticam o remetente. Guardar cópias em mídia protegida, fora deste
computador, e restaurar apenas arquivos de origem confiável. O aplicativo não
substitui uma política de armazenamento externo seguro.

## Captura SQLite e coordenação das fotografias

`VACUUM INTO ?` usa conexão somente leitura em worker, origem WAL e destino
exclusivo. `synchronous=FULL` e sincronização explícita do arquivo de saída
precedem validação. O resultado é autocontido e não depende do WAL/SHM original.
Não se usa cópia do `.db` ativo nem o padrão `db.backup` do benchmark antigo.
As tabelas com chaves explícitas e `sqlite_sequence` são comparadas no roundtrip.

O gate aguarda requisições anteriores, inclusive exportações e operações
assíncronas de fotos. Durante captura, chamadas ordinárias recebem BUSY;
o estado de manutenção continua consultável. `photos.withLock` coordena a fila
de publicação/remoção. O snapshot SQLite **não congela o filesystem sozinho**.
Os objetos atuais são copiados com hashes/tamanhos persistidos, em staging.
Depois disso, o gate é liberado durante empacotamento e gravação externa.
Foto vinculada ausente, alterada ou inválida impede backup completo; não se
cria substituto, remove referência ou apresenta sucesso parcial.

Worker possui limite de heap antigo de 384 MiB e geração nova de 32 MiB. O prazo
de 30 minutos solicita encerramento do worker; liberação de uma chamada nativa
ou I/O bloqueado pelo sistema pode demorar além desse pedido. Não há promessa
de cancelamento imediato ou botão que o ofereça. Arquivos são lidos em fluxo com
buffers de 64 KiB; manifesto é
limitado a 32 MiB. Limites do formato: banco 128 GiB, conjunto 512 GiB, 200.001
componentes (banco mais até 100 mil pares de imagens). Limites de fotografia do
serviço existente permanecem: imagem 8 MiB, miniatura 256 KiB. Superar limites
gera recusa explícita, nunca arquivo truncado aprovado. Esses limites defensivos
não constituem medição de capacidade para bases desse tamanho.

## Publicação Windows e segurança do contêiner

O destino vem exclusivamente do diálogo nativo do main. O nome sugerido contém
data/hora ISO; extensão, caracteres, nomes reservados e destino são validados.
Raízes administradas e instalação ficam protegidas. Não há sobrescrita.

Pacote é gerado em subdiretório temporário exclusivo no **mesmo volume** do
destino, sincronizado, reaberto pelo leitor e conferido antes de publicação.
Helper Windows estático chama `MoveFileExW` com WRITE_THROUGH, sem COPY_ALLOWED
ou REPLACE para arquivos externos. Não depende de hard links. O source do helper
é fixo; paths passam por ambiente do processo filho oculto, nunca por interpolação
de script. Não há bypass de política PowerShell. Bloqueio empresarial do Add-Type
provoca falha segura. REPLACE fica restrito aos pequenos ponteiros próprios.

Referência específica: [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).
NTFS foi exercitado no ambiente disponível. Compatibilidade física com pendrive
FAT/exFAT, remoção de USB e queda elétrica real exige ensaio de hardware; não é
inferida do teste de processo. FAT32 continua sujeito ao limite de arquivo de
4 GiB. Falhas de permissão, espaço, mídia e publicação não são sucesso.

Leitura ZIP lazy rejeita compressão, criptografia, entradas extras, nomes
duplicados, paths absolutos, traversal, barras invertidas, ADS, links/dispositivos,
tipos não regulares e tamanhos acima dos limites. Extração ocorre somente no
layout fechado próprio. Arquivo com extensão correta mas formato errado é recusado.
Alterar o arquivo externo depois da inspeção não troca a intenção: confirmação
usa a cópia validada privada e a revalida integralmente.

## Restauração, proteção anterior e journal

1. Seleção por `showOpenDialog`; extração/validação em geração exclusiva.
2. Prévia com data, formato/schema, versão, produtos, clientes, fornecedores,
   vendas, compras, fotografias e tamanho. Selecionar/descartar não escreve nos
   dados comerciais ativos.
3. Checkbox com aviso de substituição e diálogo explícito de confirmação.
4. Main valida token UUID e comando fechado, fecha gate, drena operações e
   revalida staging/hash. Falhas até aqui permitem operar normalmente outra vez.
5. Captura e valida **outro backup** completo do estado atual, em
   `recovery/protection/<UUID>.mnrbackup`; sincroniza e publica antes do journal.
6. Plano durável `plans/<UUID>.json` registra geração anterior, nova geração,
   sequência, data, hash do manifesto e hash da proteção. `pending.json` registra
   intenção pendente. Depois de iniciar a gravação da intenção, resultado incerto
   mantém operações bloqueadas e solicita reinicialização para resolução segura.
7. `app.relaunch()` / `app.quit()` encerram conexão e workers já drenados.
   Nenhum banco aberto é substituído e WAL/SHM abertos não são apagados.
8. Antes de janela/IPC normal, startup valida proteção, geração e fotos;
   `active.json` seleciona **todo** `sets/<UUID>/{data,images}`. Abre pelo
   `openDatabase` oficial e verifica novamente o conjunto.
9. Escreve `<UUID>.done.json` e `last.json`, remove pending e só então abre UI.
   Sucesso aparece depois desta aprovação, não no clique anterior.

Falha antes da conclusão validada recupera a geração anterior intacta; a tela
informa **recuperado**, distinguindo de **restaurado**. Se nem o conjunto anterior
puder ser validado, a abertura normal é recusada e os arquivos são preservados.
Se done já foi sincronizado, startup conclui idempotentemente a seleção confirmada.
Uma segunda abertura não reaplica a restauração. A cópia inicial legada em
`root/data` e `root/images` nunca é descartada automaticamente.

## Retenção, temporários e recuperação manual

Conservar as três proteções concluídas mais recentes, gerações ativa/anteriores
necessárias a elas e o legado inicial. Retenção verifica hashes antes de remover
arquivos próprios antigos. Temporários são removidos apenas com marker da
alocação, registro de identidade (volume/inode/criação) e hash quando concluídos.
Fotos criadas depois da ativação são reconhecidas pelo ledger validado e hashes.
Um nome com UUID sozinho **não** autoriza exclusão. Entrada desconhecida ou
substituída faz preservar o conjunto inteiro e apresentar aviso.

Limites de oito planos/proteções pendentes de limpeza e doze stagings por área
impedem acumulação silenciosa; falhas exigem inspeção antes de novas operações.
Não há limpeza recursiva de pastas do usuário. Diretórios externos incompletos
`.mnr-backup-*.partial` podem permanecer após encerramento abrupto; não têm
extensão final e não são apresentados como backup concluído. Não apagar conteúdo
desconhecido só pelo nome.

**Abrir pasta de proteção**, na tela, abre somente a pasta fixa
`%LOCALAPPDATA%/MNR Software/MNR Perfumes/recovery`. Backups independentes ficam
em `protection`; o proprietário pode selecionar um deles pelo fluxo normal de
restauração. Não mover manualmente banco/WAL/imagens de gerações diferentes.
Se startup bloquear por journal/storage inválido, fechar o aplicativo, preservar
a raiz inteira e procurar suporte com este relatório; não recriar banco nem
apagar `active`, `pending`, `plans` ou a última proteção por tentativa.

## IPC, interface e isolamento

Seis métodos: `estado`, `criar`, `selecionar`, `descartar`, `restaurar`,
`abrirProtecoes`. Canais literais, aridade exata, sender/WebContents/frame principal
e URL autorizada, objetos fechados, UUID e confirmação literal. Erros não incluem
SQL, stack ou paths pessoais. Preload tipado; Angular não lê ZIP, SQLite ou paths.
CSP, sandbox, contextIsolation e nodeIntegration permanecem protegidos.

Configurações → Backup e Restauração usa componentes MNR. Estado indeterminado,
fase real, bloqueio de duplo clique, mensagens acessíveis, foco após seleção,
erro e Escape do diálogo, prévia descartável e bloqueio de navegação durante
operação. Não há percentual inventado ou botão de cancelamento de geração.
Cancelamento do seletor não é erro. Estado final só vem do backend.

## Dependências e empacotamento

Produção: **yauzl 3.4.0** e **yazl 3.3.1**; desenvolvimento: tipos das mesmas
versões. Escrita em fluxo e leitura lazy de bibliotecas estabelecidas evitam
implementação manual de ZIP e dependência incidental do ExcelJS. Lockfile
atualizado. Auditoria de produção antes/depois: zero vulnerabilidades nos logs
`.cache/5-1-audit-before.json` e `5-1-audit-after.json`; avisos moderados da árvore
de desenvolvimento existente não foram tratados por atualização indiscriminada.
Worker e bibliotecas devem estar no ASAR; scripts, fixtures, doubles de falha e
caches desta etapa ficam fora dele, conferidos por `verify-package.mjs`. Nenhum hook foi adicionado ao
aplicativo para injetar falhas: doubles existem apenas nos processos de teste.

Comparação binária adicional após o último build: **141 arquivos de produção
em `dist` no ASAR são idênticos aos arquivos locais finais**. Registro em
`.cache/5-1-package-current-check.json`, além da inspeção de isolamento do pacote.

## Testes específicos e evidências funcionais

`npm.cmd run test:backup-restauracao` compila, executa a suíte e o smoke real
local. O smoke aceita `--development` e `--package`. Testes usam raízes novas,
SQLite/perfis/imagens/saídas exclusivos. LOCALAPPDATA é isolado apenas no processo
filho empacotado, sem alterar configuração global. Fixtures comerciais vêm dos
serviços oficiais da 4G.3, incluindo compras, custos diferentes, vendas, parcelas,
recebimentos, correções, reembolsos, ajustes, estornos, snapshots históricos,
produtos inativos, operações e auditoria.

A comparação é integral das tabelas e sequências, valores em centavos, vínculos e
hashes das imagens. Antes da restauração, são feitas operações novas e remoção
da foto; depois, estado e bytes originais devem reaparecer exatamente. A proteção
prévia é aberta separadamente e comparada com o estado posterior ao backup.
Nova operação oficial é aceita e persiste na segunda abertura.

Casos hostis incluem manifestos/formato/schema futuros, corrupção, FK inválida,
trigger adulterado mesmo com hash recalculado, duplicados, traversal, symlink,
compressão, alteração do arquivo selecionado e foto ausente. SQL direto existe
somente para fabricar entradas maliciosas de schema em bancos de teste.

Worker escritor WAL independente grava clientes por serviços oficiais enquanto
ocorre VACUUM; o snapshot contém um prefixo transacional completo, com operações
e auditoria correspondentes, e a consulta seguinte vê os posteriores. O gate
com foto pendente e exportação em curso é testado separadamente; mutações após
liberação não entram retroativamente no pacote capturado.

Encerramentos reais de processo em quatro fronteiras (antes/depois do ponteiro,
depois da abertura e depois do commit do controle) comprovam recuperação,
segunda inicialização idempotente e ausência de conjunto misto. Geração preparada
adulterada recupera o anterior. Cinco ciclos validam retenção limitada. Falhas
de capture/package/publicação/leitura/space são injetadas no harness, com snapshots
integrais inalterados e repetição segura; não equivalem a retirar pendrive real.

O smoke verifica cancelamentos, prévia/descartar, confirmação/Escape/foco, duplo
clique, reabertura em PID novo, 13 cartões e sete modelos XLSX/PDF após restaurar,
mais estoque nos dois formatos depois da segunda abertura. Leitores independentes
reabrem os **16 arquivos após fechar o aplicativo**, conferindo conteúdo/valores.
Resoluções 1366×768, 1000×700, 640×480, zoom 100/125/150%, sem overflow da página.
Diálogos nativos têm somente seu retorno controlado pelo harness; seleção manual
de pasta pelo Windows permanece no checklist do proprietário.

Capturas: `.cache/ui/backup-<local|http|package>-<sucesso|revisao|restaurado>-*.png`.
JSONs: `.cache/5-1-<local|http|package>-smoke.json`, com raiz, arquivo, proteção,
PIDs, tempos, auditoria e manifesto das exportações. Logs incompletos não contam
como aprovação.

## Comparação após restauração real

No estado final da fixture comercial integrada, os três ambientes obtiveram a
mesma comparação entre fonte oficial, Dashboard e arquivos reabertos. Valores
monetários abaixo estão em centavos; margem em pontos-base. São observações
do ensaio, sem valores fixos nos geradores de produção.

| Informação                       | Oficial | Dashboard | XLSX  | PDF   |
| -------------------------------- | ------- | --------- | ----- | ----- |
| Comercial líquido (fluxo)        | 30000   | R$ 300,00 | 30000 | 30000 |
| Vendas confirmadas (fluxo)       | 1       | 1         | 1     | 1     |
| Resultado bruto estimado         | 21000   | R$ 210,00 | 21000 | 21000 |
| Margem bruta estimada            | 7000    | 70,00%    | 7000  | 7000  |
| Ticket da coorte                 | 30000   | R$ 300,00 | 30000 | 30000 |
| Recebimentos líquidos (clientes) | 25000   | R$ 250,00 | 25000 | 25000 |
| Saldo exigível atual             | 5000    | R$ 50,00  | 5000  | 5000  |
| Saldo vencido atual              | 0       | R$ 0,00   | 0     | 0     |
| Reembolso pendente atual         | 0       | R$ 0,00   | 0     | 0     |
| Valor atual de estoque           | 40000   | R$ 400,00 | 40000 | 40000 |
| Unidades atuais                  | 23      | 23        | 23    | 23    |
| Produtos sem estoque             | 1       | 1         | 1     | 1     |
| Produtos abaixo do mínimo        | 3       | 3         | 3     | 3     |

O ciclo anterior à captura inclui a devolução comercial de R$ 200 sobre venda
de R$ 300 com R$ 250 recebidos, pagamentos/estornos e restauração comercial;
o backup preserva todos esses documentos e movimentos. Igualdade de tabelas
inteiras comprova também os estados históricos, além dos indicadores atuais.
Fluxos, coorte e posições atuais continuam distintos. As matrizes completas
com fonte/semântica e referências dos arquivos estão nos JSONs dos smokes.

Evidências visuais do executável empacotado:

- [Revisão antes da confirmação](evidencias-5-1/revisao.png).
- [Revisão em 640×480 / 150%](evidencias-5-1/revisao-640-150.png).
- [Reabertura validada e proteção anterior](evidencias-5-1/restaurado.png).
- [PDF gerencial após restaurar](evidencias-5-1/pdf-restaurado-gerencial.png).
- [PDF de estoque após restaurar](evidencias-5-1/pdf-restaurado-estoque.png).

PDFs foram renderizados com PDFium disponível no runtime (Poppler não estava
disponível), além de pypdf/pdfplumber e openpyxl/zipfile nas verificações
independentes. Páginas inspecionadas sem cortes, sobreposições ou contraste
inadequado. As fotografias administradas possuem nomes UUID; nomes livres dos
arquivos selecionados não são persistidos. Nome externo do backup com acentos,
espaços e caracteres especiais foi testado sem interpretação de shell.

## Desempenho

`npm.cmd run benchmark:backup-restauracao` usa Electron real com checkpoints
isolados de 50/200/500 vendas da 4G.3 em leitura e cópias exclusivas feitas por
serialize apenas no harness, limitado a 50 MiB. Não usa db.backup. Fotografias
JPEG reais de ruído sintético são publicadas pelo serviço oficial; preparação
de fixture não entra nos tempos. Cada volume executa backup, alteração,
inspeção, proteção, ativação, comparação integral e nova operação.

Pré-requisito para executar novamente em clone/cache novo: gerar os checkpoints
com `node --expose-gc scripts/benchmark-relatorios.cjs --consolidacao-estoque`.
O benchmark de backup recusa fontes fora de `.local-data/test`; fixtures antigas
ausentes precisam ser regeneradas, sem substituir bancos existentes.

Dados brutos: `.cache/benchmark-5-1-backup.json`. RSS é do processo principal Electron
observado a cada 10 ms, incluindo workers, sem somar processos GPU/renderer e sem isolar heap de cada
worker. Steps de worker incluem inicialização, consulta/validação e encerramento;
captura SQLite e cópia de fotos também são medidas pelo smoke. Tempo de reabrir
do benchmark é abertura do conjunto no processo; reinicialização real/renderer
é medida separadamente no smoke. Espaço 5× arquivo é estimativa conservadora do
ensaio, não medição de pico no filesystem. Não extrapolar para milhões de linhas.

Medição em Windows 10 19045, i7-7700, Electron 43.8.6 / Node 24.22.1; fixtures
menores usam imagens 1024×1024 e maior 2048×2048. Execução compartilhando máquina
com regressões; tempos são observações locais, sem garantia de SLA.

| Vendas | Fotos | Banco MiB | Fotos MiB | Backup MiB | Backup s | Inspeção s | Proteção/preparo s | Abrir conjunto s | RSS MiB |
| ------ | ----- | --------- | --------- | ---------- | -------- | ---------- | ------------------ | ---------------- | ------- |
| 50     | 2     | 0,94      | 1,43      | 2,37       | 1,72     | 0,70       | 2,85               | 1,53             | 157,7   |
| 200    | 10    | 2,44      | 7,17      | 9,61       | 2,84     | 1,21       | 5,61               | 2,80             | 195,7   |
| 500    | 30    | 5,41      | 85,54     | 90,97      | 14,94    | 8,82       | 22,57              | 9,09             | 265,5   |

Snapshot SQLite da captura inicial: 37,3 / 49,8 / 254,7 ms; cópia de fotos:
67,9 / 280,2 / 4.201,0 ms. Backup total inclui validações repetidas, pacote,
sincronização e publicação. Inspeção inclui extração e verificação integral.

## Problemas encontrados durante execução

- A primeira automação completou restauração e relatórios, mas a segunda abertura
  colidiu com a porta CDP ainda liberando. Harness passou a aguardar ambas as
  portas fechadas; preservado `.cache/5-1-first-local.log`.
- Duas tentativas iniciais receberam `Promise was collected` no inspector antes
  do main terminar de inicializar. Chamadas síncronas ao main e espera explícita
  da raiz isolada corrigiram o harness. A verificação prematura leu o userData
  padrão e abortou antes de operações, conforme `5-1-fourth-local.log`.
- Primeiro stream com `autoClose:false` aguardava fechamento e não concluía
  pipeline. Corrigido para fechamento automático; testes incompletos dessa
  tentativa não foram classificados como aprovados.
- Mock de leitura de foto inicialmente usou API inexistente de mock original;
  corrigido no teste, sem enfraquecer a asserção de rollback. Log preservado.
- Revisão da limpeza demonstrou que nome UUID não prova propriedade; registro de
  identidade/hash e preservação de entradas desconhecidas cobrem essa lacuna.
- Erro real de mídia durante cópia de foto agora preserva código de espaço,
  permissão ou I/O em vez de rotular todo erro como fotografia ausente.
- Falha reproduzida entre plano durável e pending preservava os dados, porém
  não informava a tentativa incompleta na reabertura. Log negativo preservado
  em `.cache/5-1-journal-diagnosis.log`; correção retorna aviso e abre a área
  de proteção. Ponteiro para geração sem commit/pending bloqueia abertura normal.
- Colisão de nome temporário de controle não autoriza apagar o arquivo que já
  existia. Criação exclusiva e identidade verificada protegem também esse caso.
- Captura CDP de 1366 px sobre janela nativa inicial menor apresentava margem
  branca/corte de superfície, embora o DOM coubesse no viewport. Harness agora
  ajusta também o tamanho nativo e repete os smokes; não foi redesenhada a UI.

## Arquivos alterados

Novos: `shared/backup.ts`, `electron/ipc/backup.ts`, oito módulos de
`electron/services/backup`, `src/app/features/settings/backup.{ts,html,scss}`,
`tests/backup-restauracao.test.cjs`, três helpers backup em `tests/helpers`,
`scripts/backup-restauracao-smoke.mjs`, dois scripts benchmark e este relatório.
Modificados: main, IPC central/fotos, preload, shared/contracts, DesktopService,
navegação/rotas/settings, package/lock, verify-package, testes de contrato/preload
e README. Conferir `git status --short` para a lista efetiva final. Migrações,
algoritmos financeiros/custeio e identidades históricas não foram modificados.

## Checklist manual do proprietário

- [ ] Em Configurações, criar backup com seletor Windows em pasta externa segura.
- [ ] Conferir nome, horário e tamanho; cancelar outro seletor sem arquivo novo.
- [ ] Repetir nome existente e conferir preservação do primeiro arquivo.
- [ ] Conferir tabulação, Escape, foco e avisos nos tamanhos/zoom habituais.
- [ ] Em perfil de teste, alterar cadastro/foto depois do backup.
- [ ] Selecionar backup, conferir prévia e descartar sem alterar dados.
- [ ] Confirmar substituição explicitamente, aguardar reabertura e mensagem final.
- [ ] Conferir fotos, histórico, estoque, financeiro, Dashboard e XLSX/PDF.
- [ ] Criar nova operação e reabrir outra vez; conferir persistência.
- [ ] Abrir pasta de proteção e identificar o backup pré-restauração.
- [ ] Ensaiar mídia externa real com cópia redundante; FAT32 só até 4 GiB/arquivo.
- [ ] Validar política de armazenamento seguro fora do computador.

## Estado de execução e pendências

Implementação técnica concluída e verificações aprovadas; **aguardando validação
manual do proprietário**. Bateria de 37 comandos, seis reconfirmações e duas
repetições de captura, todos com saída 0. A última execução de `npm.cmd test`
aprovou **211 testes gerais**, incluindo os **16 grupos específicos de backup**,
seguida da integração Angular de cadastros e smoke desktop. Typecheck, lint,
formatação, build e verificação de pacote foram repetidos depois das correções.
Auditoria final de dependências de produção: zero vulnerabilidades.

Após a última correção do controle de recuperação, o recorte de backup foi
reexecutado integralmente, assim como a suíte geral e os fluxos reais de backup
nos três ambientes. A repetição de capturas altera somente o harness. As primeiras
tentativas negativas/interrompidas permanecem nos logs anteriores e não são usadas
como aprovação. Nenhum teste foi removido ou teve asserções enfraquecidas.

Evidências portáteis versionáveis:

- [45 comandos, horários e saídas](evidencias-5-1/validacoes.json).
- [Três ambientes, PIDs, tempos e matriz de 13 indicadores](evidencias-5-1/ambientes.json).
- [Benchmark completo](evidencias-5-1/benchmark.json).

Logs detalhados permanecem nos caminhos abaixo e nas pastas exclusivas indicadas
pelos JSONs originais de `.cache`. Após interrupção futura, preservar os arquivos,
conferir Git e estes registros e repetir qualquer verificação sem saída final.

### Resultados dos comandos

| Comando                                                        | Início (13/11/2026, -03) | Fim      | Saída | Log                                              |
| -------------------------------------------------------------- | ------------------------ | -------- | ----- | ------------------------------------------------ |
| `npm.cmd run typecheck`                                        | 04:34:25                 | 04:34:33 | 0     | `.cache/5-1-final-typecheck.log`                 |
| `npm.cmd run lint`                                             | 04:34:33                 | 04:34:40 | 0     | `.cache/5-1-final-lint.log`                      |
| `npm.cmd run format:check`                                     | 04:34:40                 | 04:34:51 | 0     | `.cache/5-1-final-format.log`                    |
| `npm.cmd run build`                                            | 04:34:51                 | 04:35:05 | 0     | `.cache/5-1-final-build.log`                     |
| `npm.cmd test`                                                 | 04:35:05                 | 04:37:41 | 0     | `.cache/5-1-final-test.log`                      |
| `npm.cmd run test:ui`                                          | 04:37:41                 | 04:41:09 | 0     | `.cache/5-1-final-ui.log`                        |
| `npm.cmd run test:vendas`                                      | 04:41:09                 | 04:41:33 | 0     | `.cache/5-1-final-vendas.log`                    |
| `npm.cmd run test:financeiro`                                  | 04:41:33                 | 04:42:51 | 0     | `.cache/5-1-final-financeiro.log`                |
| `npm.cmd run test:correcoes`                                   | 04:42:51                 | 04:43:23 | 0     | `.cache/5-1-final-correcoes.log`                 |
| `npm.cmd run test:reembolsos`                                  | 04:43:23                 | 04:44:02 | 0     | `.cache/5-1-final-reembolsos.log`                |
| `npm.cmd run test:correcoes-compras`                           | 04:44:02                 | 04:44:28 | 0     | `.cache/5-1-final-compras.log`                   |
| `npm.cmd run test:consolidacao`                                | 04:44:28                 | 04:45:09 | 0     | `.cache/5-1-final-consolidacao.log`              |
| `npm.cmd run test:relatorios`                                  | 04:45:09                 | 04:45:26 | 0     | `.cache/5-1-final-relatorios.log`                |
| `npm.cmd run test:dashboard`                                   | 04:45:26                 | 04:45:48 | 0     | `.cache/5-1-final-dashboard.log`                 |
| `npm.cmd run test:exportacoes`                                 | 04:45:48                 | 04:47:09 | 0     | `.cache/5-1-final-exportacoes.log`               |
| `npm.cmd run test:consolidacao-gerencial`                      | 04:47:09                 | 04:50:38 | 0     | `.cache/5-1-final-gerencial.log`                 |
| `npm.cmd run test:estornos-estoque`                            | 04:50:38                 | 04:51:09 | 0     | `.cache/5-1-final-estornos.log`                  |
| `npm.cmd run test:consolidacao-estoque`                        | 04:51:09                 | 04:53:59 | 0     | `.cache/5-1-final-estoque-integrado.log`         |
| `node scripts/consolidacao-estoque-smoke.mjs --development`    | 04:53:59                 | 04:56:53 | 0     | `.cache/5-1-final-estoque-integrado-http.log`    |
| `node scripts/estornos-estoque-smoke.mjs --development`        | 04:56:53                 | 04:57:19 | 0     | `.cache/5-1-final-estornos-http.log`             |
| `npm.cmd run test:backup-restauracao`                          | 04:57:19                 | 04:59:45 | 0     | `.cache/5-1-final-backup.log`                    |
| `node scripts/backup-restauracao-smoke.mjs --development`      | 04:59:45                 | 05:00:33 | 0     | `.cache/5-1-final-backup-http.log`               |
| `npm.cmd run pack`                                             | 05:00:33                 | 05:01:49 | 0     | `.cache/5-1-final-pack.log`                      |
| `node scripts/backup-restauracao-smoke.mjs --package`          | 05:01:49                 | 05:02:33 | 0     | `.cache/5-1-final-backup-package.log`            |
| `node scripts/verify-package.mjs`                              | 05:02:33                 | 05:02:34 | 0     | `.cache/5-1-final-verify-package.log`            |
| `node scripts/consolidacao-estoque-smoke.mjs --package`        | 05:02:34                 | 05:04:19 | 0     | `.cache/5-1-final-estoque-integrado-package.log` |
| `node scripts/estornos-estoque-smoke.mjs --package`            | 05:04:19                 | 05:04:34 | 0     | `.cache/5-1-final-estornos-package.log`          |
| `node scripts/correcoes-compras-smoke.mjs --development`       | 05:04:34                 | 05:04:54 | 0     | `.cache/5-1-final-compras-http.log`              |
| `node scripts/correcoes-compras-smoke.mjs --package`           | 05:04:54                 | 05:05:05 | 0     | `.cache/5-1-final-compras-package.log`           |
| `node scripts/dashboard-smoke.mjs --development`               | 05:05:05                 | 05:05:24 | 0     | `.cache/5-1-final-dashboard-http.log`            |
| `node scripts/dashboard-smoke.mjs --package`                   | 05:05:24                 | 05:05:32 | 0     | `.cache/5-1-final-dashboard-package.log`         |
| `node scripts/relatorios-smoke.mjs --development`              | 05:05:32                 | 05:05:42 | 0     | `.cache/5-1-final-relatorios-http.log`           |
| `node scripts/relatorios-smoke.mjs --package`                  | 05:05:42                 | 05:05:44 | 0     | `.cache/5-1-final-relatorios-package.log`        |
| `node scripts/exportacoes-smoke.mjs --development`             | 05:05:44                 | 05:06:38 | 0     | `.cache/5-1-final-exportacoes-http.log`          |
| `node scripts/exportacoes-smoke.mjs --package`                 | 05:06:38                 | 05:07:10 | 0     | `.cache/5-1-final-exportacoes-package.log`       |
| `node scripts/smoke.mjs --development`                         | 05:07:10                 | 05:07:25 | 0     | `.cache/5-1-final-desktop-http.log`              |
| `node scripts/smoke.mjs release/win-unpacked/MNR Perfumes.exe` | 05:07:25                 | 05:07:27 | 0     | `.cache/5-1-final-desktop-package.log`           |
| `npm.cmd test`                                                 | 05:07:27                 | 05:09:50 | 0     | `.cache/5-1-post-test.log`                       |
| `npm.cmd run typecheck`                                        | 05:09:50                 | 05:09:58 | 0     | `.cache/5-1-post-typecheck.log`                  |
| `npm.cmd run lint`                                             | 05:09:58                 | 05:10:06 | 0     | `.cache/5-1-post-lint.log`                       |
| `npm.cmd run format:check`                                     | 05:10:06                 | 05:10:15 | 0     | `.cache/5-1-post-format.log`                     |
| `npm.cmd run build`                                            | 05:10:15                 | 05:10:29 | 0     | `.cache/5-1-post-build.log`                      |
| `node scripts/verify-package.mjs`                              | 05:10:29                 | 05:10:30 | 0     | `.cache/5-1-post-verify-package.log`             |
| `node scripts/backup-restauracao-smoke.mjs`                    | 05:10:47                 | 05:11:28 | 0     | `.cache/5-1-capture-final-local.log`             |
| `node scripts/backup-restauracao-smoke.mjs --development`      | 05:11:28                 | 05:12:16 | 0     | `.cache/5-1-capture-final-http.log`              |

5.2 instalador Windows, 5.3 homologação/máquina limpa/Windows 10 e 11 e ensaio
offline físico continuam pendentes. O offline desta etapa é emulado e o SO
medido é Windows 10 build 19045; não há alegação de Windows 11 validado. Nenhum
commit/push automático foi executado.
