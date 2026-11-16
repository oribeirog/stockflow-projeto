# Pré-5.2 B — Compatibilidade de Fotografias e Identidade MNR Gestão

As seções originais registram a entrega JPEG/PNG e renomeação. A ampliação de
entrada WebP/JFIF, a dependência adicional e suas verificações posteriores estão
em **Complemento — Compatibilidade com imagens baixadas da internet**, ao final.

## Diagnóstico antes das alterações

HEAD `d359480 feat: generaliza catalogo de produtos e preserva backups antigos`:
Pré-5.2 A efetivamente commitada. Árvore limpa; diff vazio. Nenhum Electron do
aplicativo em execução na coleta. Bancos habituais não foram abertos. Examinados
AGENTS, README, relatórios cadastrais, 5.1/complemento, Pré-A, migração 0006,
serviços/contratos/preload, componentes, armazenamento, backup e Builder.

Sem amostra privada da fotografia rejeitada: reproduções serão sintéticas.
Não se atribuirá a causa histórica a uma hipótese sem evidência.

### Matriz A — Fotografias

| Etapa        | Implementação atual                                    | Possível rejeição / decisão                                                           |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Seleção      | main, diálogo nativo JPEG/PNG                          | filtro por extensão; cancelamento nulo; renderer não envia path                       |
| Angular      | PhotoEditor chama API, apresenta miniatura normalizada | não valida MIME/bytes; sem processamento local                                        |
| IPC          | cinco canais literais, sender/frame/URL/aridade        | validação preservada; erros atualmente pouco distintos                                |
| Leitura      | handle, stat e leitura limitada a 10 MiB               | tamanho/arquivo inacessível atualmente viram erro genérico                            |
| Cabeçalho    | imageHeader, assinatura/estrutura/dimensões            | PNG exige fim exato; JPEG exige EOI nos últimos dois bytes; limites 8192/24 MP        |
| Decoder      | nativeImage.createFromBuffer no main                   | variante não decodificável; orientação/cor precisam de prova                          |
| Normalização | JPEG com qualidade 90/PNG, máximo 2048, sem ampliação  | saídas >8 MiB e miniaturas >256 KiB rejeitadas                                        |
| Miniatura    | mesmo decoder, máximo 160                              | falha hoje indistinguível da entrada inválida                                         |
| Persistência | UUID, staging, fsync, objetos imutáveis                | preparo grava ledger antes de ambos os arquivos; examinar falhas                      |
| Associação   | transação IMMEDIATE e replay                           | token de janela/expiração; publicação precede vínculo; anterior preservado até commit |
| Apresentação | blob, revisão, miniatura/ampliação                     | sem file://; URLs revogadas; fotos antigas não serão convertidas                      |
| Backup       | fila de fotos + gate, hashes e pares vinculados        | normalização nova precisa continuar PNG/JPEG compatível com schemas5/6                |

### Matriz B — Identidade

| Superfície                                | Ação                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Marca textual, cabeçalho e título Angular | MNR Gestão; preservar símbolo M existente                                       |
| Janela, abertura segura e diálogos        | MNR Gestão                                                                      |
| Mensagens atuais, configurações e backup  | MNR Gestão                                                                      |
| Novos XLSX/PDF                            | MNR Gestão; não reescrever arquivos históricos                                  |
| package description/productName/Windows   | atualizar nome público; verificar executável e scripts                          |
| nome npm interno                          | preservar mnr-perfumes                                                          |
| appId/protocolo                           | preservar br.com.mnrsoftware.mnrperfumes e mnr://app                            |
| paths                                     | preservar raiz MNR Software/MNR Perfumes, data/mnr-perfumes.db, images/recovery |
| app userData/sessionData                  | preparePaths define explicitamente antes da abertura; comprovar no runtime      |
| ownership de gerações                     | preservar app: MNR Perfumes: identidade formal já persistida                    |
| formato/manifesto de backup               | preservar extensão, formato1, identidade técnica e schemas5/6                   |
| logs, UUIDs, migrações e históricos       | preservar conteúdo antigo; novos títulos públicos atualizados                   |
| documentação                              | README e este relatório atuais; relatórios históricos preservados               |

MNR Gestão é o novo nome comercial do aplicativo anteriormente denominado MNR
Perfumes. Os identificadores técnicos e caminhos persistentes anteriores serão
mantidos para preservar a compatibilidade dos dados. Schema 6 permanece; nenhuma
necessidade estrutural de migração foi identificada.

## Reproduções e decisão técnica

No Electron43.8.6, o runtime aprovado d359480 aceitou os JPEG baseline, progressivo,
CMYK e ICC e PNG RGB/RGBA/transparente/paleta/16bits testados. Extensão e MIME do
nome não governam a decodificação. Um JPEG com dados acrescentados depois do EOI
foi recusado, embora o decoder tolerasse o sufixo; essa recusa foi mantida por se
tratar de conteúdo adicional, não de uma variante necessária do catálogo.

Defeito comprovado: JPEG120×80 com EXIF6 era salvo120×80 sem rotação. A orientação
independente esperada é80×120. A nova normalização lê somente orientation de IFD0
com offsets/tamanhos verificados e aplica as oito transformações EXIF uma vez.
Comparação de pixels com ImageOps.exif_transpose/Pillow verifica rotação e espelhos,
além das dimensões. EXIF/GPS não são conservados no novo objeto.

Sem a amostra rejeitada pelo proprietário, **a causa histórica da rejeição não foi
comprovada**. Os limites anteriores, arquivos danificados e variantes não cobertas
continuam possibilidades; não se atribui o problema histórico automaticamente a
EXIF, CMYK ou extensão. O corpus e o runtime congelado ficam em .cache/pre52b para
repetir a comparação sem tocar em dados habituais.

O nativeImage foi mantido. A [documentação oficial Electron](https://www.electronjs.org/docs/latest/api/native-image)
prevê JPEG/PNG e pixels sRGB no Electron43. Foram consultadas também as APIs de
[construção](https://sharp.pixelplumbing.com/api-constructor/) e
[orientação](https://sharp.pixelplumbing.com/api-operation/) do Sharp. As variantes
representativas funcionaram com o decoder embarcado; uma biblioteca nativa adicional
não se justificou nesta reprodução. **Nenhuma dependência foi adicionada.** Pillow
é ferramenta externa dos testes sintéticos, não dependência do aplicativo/ASAR.

## Política de entrada, normalização e recursos

### Rejeição de PNG válido reproduzida e corrigida

Um PNG RGB sintético de **1800×1700 / 9.194.752 bytes** é válido pelo leitor
independente Pillow e fica dentro de 10 MiB / 24 MP. O runtime aprovado d359480
o rejeitou com PHOTO_INVALID: a recodificação ultrapassava os 8 MiB permitidos
por foto_arquivos. A revisão inicial desta etapa ainda o recusava como
PHOTO_PROCESSING. Evidência: .cache/pre52b/rgb-rejection-before.json.

A normalização agora reduz proporcionalmente em passos de 10% quando necessário
para caber no teto persistido, com no máximo quatro tentativas adicionais. Mantém
PNG e transparência, sem baixar arbitrariamente a qualidade JPEG nem alterar o
schema. Miniatura é gerada a partir da imagem final. Os testes incluem PNG RGB
incompressível e PNG RGBA com variação de transparência; ambos são persistidos
e o RGBA também atravessa backup/restauração. Isso comprova uma causa representativa
de rejeição; sem a foto do proprietário, não comprova a causa da ocorrência histórica.

- JPEG estático baseline/progressivo, RGB/CMYK nas variantes testadas, EXIF/ICC;
  PNG RGB/RGBA, transparência, paleta, Adam7 e 16 bits nas variantes testadas.
- Assinatura, estrutura, tamanho e dimensões antes do decoder. Nova importação PNG
  verifica CRC dos chunks; essa verificação não reinterpreta objetos antigos.
- Mantidos os limites aprovados: 10 MiB, 8192 pixels por lado, 24 milhões de pixels. Uma imagem 6000×4000 no
  limite e JPEG detalhado 4096×3072 são exercitados. O limite de pixels restringe
  o bitmap decodificado a 96 MB de canais RGBA; isso não é limite do RSS total do
  processo/decoder, que também mantém buffers e estruturas internas.
- Redução proporcional para 2048 pixels, sem ampliação. Bitmap sRGB já reduzido é orientado,
  recodificado JPEG com qualidade 90 ou PNG; miniatura de 160 pixels preserva proporção/transparência.
  Limites persistidos continuam 8 MiB/256 KiB. Schema 6 e migrações 1–6 intactos.
- Uma seleção por janela e fila compartilhada de fotos/backup. O trabalho nativo
  é síncrono e limitado pela entrada; não há timeout preemptivo nem promessa de
  interromper um decoder nativo bloqueado. Não foi criado botão de cancelamento
  falso. Tempos e memória observados serão registrados abaixo.
- Não há SVG, URLs remotas, animação, formatos ilimitados, conversão em massa ou
  reprocessamento das fotos históricas. Perfis ICC fora das amostras não têm garantia
  universal. Erros ficam isolados no cadastro, sem erro global de inicialização.

## Persistência, erros e diagnósticos

Objeto e miniatura são preparados antes do vínculo. Arquivos têm criação exclusiva,
fsync e hashes; publicação e associação mantêm o protocolo anterior. Na falha de
preparo, o registro é retirado e os arquivos comprovadamente próprios são limpos;
um arquivo substituído/incerto é preservado. Nenhum vínculo parcial é criado. A
foto anterior permanece válida antes do commit; replay/recuperação continuam oficiais.

PHOTO_INVALID, FORMAT, SIZE, DIMENSIONS, ACCESS, PROCESSING e WRITE distinguem as
falhas. PHOTO_EXPIRED/UNAVAILABLE permanecem compatíveis. O renderer recebe somente
códigos/mensagens sanitizados, sem stack/path/SQL. A prévia vem da miniatura normalizada;
o editor informa processamento e só confirma a fotografia após salvar o vínculo.

Diagnóstico estruturado registra fase, código, formato, bytes, dimensões, orientação
e tempos. Produção escreve logs/foto-importacao.jsonl até aproximadamente 1 MiB, sem
binário, nome do arquivo selecionado ou caminho pessoal. Falha do log não altera o
resultado da operação nem a abertura. Dados antigos/objetos imutáveis não são alterados.

## Identidade pública e compatibilidade

Marca textual, títulos Angular/nativos, seleção/salvamento, mensagens atuais e novos
XLSX/PDF usam MNR Gestão. O símbolo M e o Design System foram preservados. Builder
usa productName MNR Gestão e executableName MNR Gestao; edição dos recursos Windows
foi habilitada para substituir os metadados genéricos Electron. Nenhum instalador
foi criado. Nome npm mnr-perfumes e autoria MNR Software permanecem técnicos.

Foi reproduzida uma incompatibilidade nova ao usar a marca acentuada em app.setName:
o fluxo mnr://app recebeu U+FFFD no bridge de Headers e não carregou a interface.
O User-Agent técnico derivado do nome foi fixado em ASCII (MNRGestao), preservando
o nome público acentuado. O [User-Agent do Electron](https://www.electronjs.org/docs/latest/api/app#appuseragentfallback)
é separado dos paths/identidade dos dados. Os smokes verificam a entrada real,
não somente strings da configuração. Os logs negativos foram preservados.

Protocolo, appId, banco, manifesto, ownership e raiz legada são invariantes. O
runtime aprovado d359480 produziu um backup legítimo schema 6 e uma geração ativa
antes dos novos testes. A nova aplicação abre uma cópia isolada desse perfil com
as mesmas tabelas, imagens e seleção, sem criar raiz MNR Gestão. O backup antigo
schema 5 continua proveniente do runtime aprovado 026daa0. Os originais não são
modificados. Comparações integrais e reinicializações serão registradas abaixo.

## Checklist manual pelo VS Code

Antes de abrir dados habituais atualizados, preservar um backup externo válido.
Não ensaiar corrupção ou substituição no banco real. No terminal PowerShell do
repositório, executar em um perfil novo:

```powershell
$env:MNR_UI_TEST_RUN = 'ui-validacao-pre52b-' + (Get-Date -Format 'yyyyMMddHHmmss')
npm.cmd run dev
```

- [ ] Conferir MNR Gestão no título, cabeçalho, configurações e diálogos.
- [ ] Em cópia isolada da instalação anterior, conferir produtos, fotos, histórico e
      gerações; nenhuma segunda raiz de dados deve aparecer.
- [ ] Cadastrar produto com JPEG comum e progressivo; conferir prévia e salvar.
- [ ] Importar JPEG de celular com orientação; conferir imagem ampliada e miniatura.
- [ ] Substituir por PNG transparente, salvar, remover e salvar novamente.
- [ ] Selecionar arquivo inválido e arquivo acima do limite: conferir mensagens distintas.
- [ ] Cancelar seleção: fotografia anterior deve permanecer.
- [ ] Conferir Tab/Shift+Tab/Enter/Escape, foco, mensagens e janelas/zoom habituais.
- [ ] Fechar e abrir no mesmo terminal/perfil: conferir persistência das imagens.
- [ ] Criar backup com fotos novas, alterar/remover foto, restaurar explicitamente.
- [ ] Conferir a PRIMEIRA abertura automática: interface normal, status restaurado,
      foto original do backup e proteção anterior disponíveis.
- [ ] Fechar/abrir outra vez; criar nova operação e conferir Dashboard/XLSX/PDF.
- [ ] Em perfis exclusivos, restaurar backups legítimos schema 5 e schema 6 antigos.
- [ ] Repetir no executável ASAR isolado; não confundir com instalador.
- [ ] Conferir manutenção da raiz MNR Software/MNR Perfumes e ausência de banco paralelo.

Ao encerrar o perfil de ensaio, remover apenas a variável desta sessão:

```powershell
Remove-Item Env:MNR_UI_TEST_RUN
```

Smokes isolados: node scripts/backup-restauracao-smoke.mjs --fotos, com
--development ou --package para os outros ambientes. Corpus sintético é gerado
por node scripts/fotos-compatibilidade.mjs. Não usar fotos particulares como fixtures.

## Evidências funcionais e regressões

Os 26 casos positivos são sintéticos e próprios: JPEG baseline/progressivo, CMYK,
ICC, oito orientações EXIF, PNG com EXIF, RGB/RGBA/transparência, paleta, Adam7,
16 bits, imagem pequena, 24 MP, JPEG/PNG grandes, duas imagens que exigem ajuste
ao teto de bytes e nome/caminho longo com espaços/acentos. Electron decodifica,
normaliza, publica e relê os arquivos; Pillow reabre e verifica os resultados de
forma independente, incluindo pixels orientados e alfa. O recorte possui 19 grupos,
com falhas de preparo/publicação/commit, replay, permissões simuladas, limites,
metadados inválidos, CRC, campos fechados, aridade, origem/frame e paths rejeitados.

O ciclo UI cadastra e edita produtos, substitui/remove fotos, mantém a imagem após
erro/cancelamento, repete somente a fotografia após falha de gravação, amplia e
fecha por Escape com foco restaurado e consulta a miniatura no catálogo. As três
execuções importam os 26 casos pela API real. Os retornos dos diálogos nativos são
controlados pelo harness externo; o uso físico do seletor Windows fica no checklist.
Resoluções 1366×768, 1000×700 e 640×480, zoom 100/125/150%, sem overflow horizontal.

| Origem restaurada                | Ambiente | Primeira / segunda abertura | Proteção anterior | XLSX/PDF |
| -------------------------------- | -------- | --------------------------- | ----------------- | -------: |
| Fotografias novas / schema 6     | local    | A / A exatos                | B integral        |       16 |
| Fotografias novas / schema 6     | http     | A / A exatos                | B integral        |       16 |
| Fotografias novas / schema 6     | package  | A / A exatos                | B integral        |       16 |
| MNR Perfumes aprovado / schema 6 | local    | A / A exatos                | B integral        |       16 |
| MNR Perfumes aprovado / schema 6 | http     | A / A exatos                | B integral        |       16 |
| MNR Perfumes aprovado / schema 6 | package  | A / A exatos                | B integral        |       16 |
| MNR Perfumes aprovado / schema 5 | local    | A / A exatos                | B integral        |       16 |
| MNR Perfumes aprovado / schema 5 | http     | A / A exatos                | B integral        |       16 |
| MNR Perfumes aprovado / schema 5 | package  | A / A exatos                | B integral        |       16 |

**144 arquivos nos nove ciclos acima**, reabertos após fechar o aplicativo por
openpyxl/pypdf/pdfplumber, com nome público, linhas, valores, totais e estrutura
conferidos. Todos os ciclos exigem PID novo, A em todas as tabelas e sequências,
B exclusivo ausente, proteção B exata, pending ausente, done/active correspondentes
e zero startup-error. Uma nova operação é aceita e conferida na terceira abertura.
Fotografias usam comparação de SHA-256 e associação, não apenas existência/tamanho.
Banco em WAL é comparado logicamente; não se presume igualdade bruta do .db aberto.

Os cenários antigos usam backups legítimos dos runtimes aprovados 026daa0 e d359480.
Seus SHA-256 continuam 37483776f676ba1496f22bd286f075d8587c42229af9a54dabdf931b2fe27627 e 703cfa9f1adaead704577f6412933b4b43a83843ac2492ac9e753406a77811e3, respectivamente.
O perfil schema 6 já tinha geração ativa/proteção; a nova aplicação o abriu sem criar
raiz alternativa ou outro banco por causa da marca. O protocolo de upgrade do schema 5
foi preservado. As matrizes de 13 indicadores oficiais/Dashboard/XLSX/PDF estão em
[ambientes.json](evidencias-pre-5-2-B/ambientes.json).

### Comandos e códigos de saída

A tabela usa a execução mais recente de cada comando. Horários UTC, códigos,
repetições e tentativas negativas estão em [validacoes.json](evidencias-pre-5-2-B/validacoes.json).
O recorte de backup inclui encerramentos reais em estados intermediários, retomada,
segunda abertura e supervisor de desenvolvimento. Nenhuma asserção foi removida.

| Comando                                   | Saída | Fim UTC                  | Evidência                                                      |
| ----------------------------------------- | ----: | ------------------------ | -------------------------------------------------------------- |
| `npm.cmd run typecheck`                   |     0 | 2026-11-16T18:03:47.362Z | [log](../.cache/pre52b-checks-2026-11-16T18-03-39-300Z/01.log) |
| `npm.cmd run lint`                        |     0 | 2026-11-16T18:15:08.160Z | [log](../.cache/pre52b-checks-2026-11-16T18-14-46-869Z/03.log) |
| `npm.cmd run format:check`                |     0 | 2026-11-16T18:04:15.792Z | [log](../.cache/pre52b-checks-2026-11-16T18-03-39-300Z/03.log) |
| `npm.cmd run build`                       |     0 | 2026-11-16T18:04:30.621Z | [log](../.cache/pre52b-checks-2026-11-16T18-03-39-300Z/04.log) |
| `npm.cmd test`                            |     0 | 2026-11-16T18:17:45.243Z | [log](../.cache/pre52b-checks-2026-11-16T18-14-46-869Z/04.log) |
| `npm.cmd run test:ui`                     |     0 | 2026-11-16T16:38:49.940Z | [log](../.cache/pre52b-checks-2026-11-16T16-32-04-121Z/06.log) |
| `npm.cmd run test:vendas`                 |     0 | 2026-11-16T16:45:58.882Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/01.log) |
| `npm.cmd run test:financeiro`             |     0 | 2026-11-16T18:19:04.984Z | [log](../.cache/pre52b-checks-2026-11-16T18-14-46-869Z/05.log) |
| `npm.cmd run test:correcoes`              |     0 | 2026-11-16T16:47:45.059Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/03.log) |
| `npm.cmd run test:reembolsos`             |     0 | 2026-11-16T18:19:40.016Z | [log](../.cache/pre52b-checks-2026-11-16T18-14-46-869Z/06.log) |
| `npm.cmd run test:correcoes-compras`      |     0 | 2026-11-16T16:48:47.579Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/05.log) |
| `npm.cmd run test:estornos-estoque`       |     0 | 2026-11-16T16:49:20.299Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/06.log) |
| `npm.cmd run test:consolidacao`           |     0 | 2026-11-16T16:49:59.704Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/07.log) |
| `npm.cmd run test:consolidacao-gerencial` |     0 | 2026-11-16T16:53:40.626Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/08.log) |
| `npm.cmd run test:consolidacao-estoque`   |     0 | 2026-11-16T16:56:36.689Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/09.log) |
| `npm.cmd run test:relatorios`             |     0 | 2026-11-16T16:56:53.797Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/10.log) |
| `npm.cmd run test:dashboard`              |     0 | 2026-11-16T16:57:17.853Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/11.log) |
| `npm.cmd run test:exportacoes`            |     0 | 2026-11-16T16:58:37.729Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/12.log) |
| `npm.cmd run test:backup-restauracao`     |     0 | 2026-11-16T16:42:38.504Z | [log](../.cache/pre52b-checks-2026-11-16T16-32-04-121Z/07.log) |
| `npm.cmd run test:catalogo-generalista`   |     0 | 2026-11-16T17:00:56.562Z | [log](../.cache/pre52b-checks-2026-11-16T16-45-32-497Z/13.log) |
| `npm.cmd run test:fotos-compatibilidade`  |     0 | 2026-11-16T16:43:55.673Z | [log](../.cache/pre52b-checks-2026-11-16T16-32-04-121Z/08.log) |
| `npm.cmd run pack`                        |     0 | 2026-11-16T16:22:23.415Z | [log](../.cache/pre52b-checks-2026-11-16T16-19-59-472Z/02.log) |
| `node scripts/verify-package.mjs`         |     0 | 2026-11-16T18:19:41.448Z | [log](../.cache/pre52b-checks-2026-11-16T18-14-46-869Z/08.log) |

### Ocorrências da validação e correções no harness

- A primeira tentativa do novo perfil antigo usou cpSync sobre uma raiz já criada;
  o harness passou a exigir raiz exclusiva vazia e copiar somente seus componentes.
- Uma espera de cancelamento consultava o primeiro role=status dentro de um diálogo
  fechado de ampliação, em vez da mensagem do editor. Seletor corrigido; a mensagem
  de cancelamento já estava presente no DOM. Log negativo preservado.
- O teste de Escape disparava click() sem focar o botão que abria a ampliação;
  foi corrigida a preparação do teste, mantendo a asserção de retorno de foco.
- Uma reconfirmação geral terminou o arquivo reembolsos-estornos após oito casos,
  sem asserção ou exceção original informativa. Essa execução (225/226) falhou e não
  foi considerada aprovação. O recorte isolado aprovou 11 casos e a suíte completa
  com reporter TAP aprovou 228; não apareceu evento Windows explicativo na coleta.
- A investigação demonstrou separadamente uma corrida de encerramento do harness:
  o worker enviava resultado antes de db.close e o pai podia executar terminate antes
  do fechamento. Um probe controlado deixou o marcador de fechamento incompleto na
  versão anterior, enquanto o protocolo corrigido fechou e saiu com código 0.
  O helper de teste agora fecha antes de responder; o pai aguarda saída natural e
  exige códigos [0,0]. Dois escritores independentes e todas as asserções comerciais
  permanecem. Não se atribuiu a saída original a essa corrida como causa comprovada.
  A causa nativa exata daquela ocorrência continua indeterminada. Logs/probe foram
  preservados; serviços financeiros e cálculo comercial não foram alterados.

Após esse ajuste exclusivamente de testes, duas execuções isoladas aprovaram os
11 casos, a suíte geral aprovou **228/228** e os recortes financeiro e de reembolsos
terminaram com saída 0. A conferência final de formatação e diferenças está em
[fechamento.json](../.cache/pre52b-fechamento.json).

## Desempenho observado

Windows 10 19045 x64, i7-7700, aproximadamente 16 GiB RAM; Node 26.13.0,
Electron 43.8.6. Amostras locais com caches do SO, sem SLA ou extrapolação.
A coluna Main mede validação/decoder/normalização/adequação de bytes/encoding,
sem confundir esse tempo com IPC, renderer, gravação ou reabertura. Dados brutos e
fases individuais estão em [benchmark.json](evidencias-pre-5-2-B/benchmark.json).

| Entrada sintética    | Main local ms | Main HTTP ms | Main ASAR ms | Cópia final |
| -------------------- | ------------: | -----------: | -----------: | ----------- |
| grande-detalhada.jpg |           388 |          374 |          366 | 2048×1536   |
| png-grande.png       |          1020 |          984 |          986 | 2000×1500   |
| png-ruido-rgb.png    |           763 |          743 |          752 | 1620×1530   |
| rgba-detalhada.png   |           686 |          632 |          623 | 1620×1080   |

A seleção via UI (IPC, preparo/sincronização e observação CDP) variou de
438.3 a 1107.9 ms nessas entradas grandes;
selecionar e salvar, incluindo cadastro/associação, variou de
491.5 a 1215.9 ms.
Abrir a foto persistida grande pela UI variou de
103.1 a 123.0 ms.
O maior RSS acumulado do main observado nessas quatro importações por ambiente foi
352.4 MiB; não inclui renderer/GPU e não é memória exclusiva do codec.
O harness de 26 casos executa normalização repetida e mantém fixtures: seu maxRSS
registrado separadamente não deve ser tratado como pico de uma única importação.

## Pacote, segurança e integridade preservados

O ASAR e o dist final tiveram **146 arquivos de produção idênticos**, incluindo
normalizador, orientação, diagnóstico, preload, workers de backup/exportação e
bibliotecas de produção. Scripts, fixtures, cache, ferramentas Python e injeções
externas não entram no pacote. ProductName/FileDescription Windows são MNR Gestão,
CompanyName MNR Software e executável MNR Gestao.exe. Não há certificado de assinatura
configurado; não foi gerado instalador. Ícone padrão do executável já existia e não
foi substituído por uma nova marca; símbolo M e estilo da UI foram mantidos.

AppId, mnr://app, application_id SQLite, nome do banco, raiz antiga, ownership,
formato 1, schemas 5/6, UUIDs e históricos estão preservados. Migrações 0001–0006
foram comparadas com HEAD e permaneceram intactas; não há schema 7. Auditoria npm
de produção terminou com zero vulnerabilidades. A compatibilidade de single-instance
foi verificada em perfil exclusivo com nome antigo/novo: a segunda instância foi
recusada. [Auditoria de pacote/identidades](evidencias-pre-5-2-B/pacote-identidades.json).

## Capturas e arquivos alterados

- [Catálogo com fotografia no ASAR](evidencias-pre-5-2-B/catalogo-asar.png).
- [Erro recuperável mantendo a foto anterior](evidencias-pre-5-2-B/fotografias-asar.png).
- [Editor em 640×480 / 150%](evidencias-pre-5-2-B/fotografias-640-150.png).
- [Primeira restauração validada no ASAR](evidencias-pre-5-2-B/primeira-restauracao-asar.png).
- [Orientação do runtime anterior](evidencias-pre-5-2-B/orientacao-anterior.jpg) e
  [orientação corrigida](evidencias-pre-5-2-B/orientacao-corrigida.jpg), com a mesma fonte sintética.

As capturas foram inspecionadas. A alteração visual se limita à marca textual e aos
estados de fotografia; não houve redesign global. A lista completa está em
[arquivos.json](evidencias-pre-5-2-B/arquivos.json). Mudanças concentram-se em codec/
orientação/diagnóstico, preparo de arquivos, mensagens/tipos, PhotoEditor, marca em
main/Angular/exportações/Builder, nomes esperados pelos smokes, testes e documentação.
Na entrega original, package-lock não mudou e nenhuma dependência de produção foi acrescentada. Python
com Pillow é ferramenta de testes já disponível; MNR_PYTHON permite indicar outro
interpretador com os módulos necessários. Não é requisito do aplicativo empacotado.

## Limitações e pendências

Sem foto rejeitada do proprietário, as causas históricas individuais não podem ser
certificadas. Foram reproduzidos o PNG válido acima do teto de saída, a orientação
ignorada e a preparação parcial diante de falha de gravação, além do problema do
User-Agent introduzido pela renomeação. Fotografias antigas não são convertidas:
para corrigir uma orientação antiga, reimportar o original. Variantes não testadas,
resolução/bytes acima dos limites e formatos não suportados podem ser recusados
com mensagem específica. Não há timeout preemptivo de chamada nativa/IO bloqueada.

Retorno de diálogo controlado não equivale a ensaio físico de todos os seletores,
ACLs, discos/USB ou quedas elétricas. Offline emulado não é desconexão física.
Windows 11 não foi homologado nesta máquina Windows 10. Backup continua sem
criptografia; manter cópias externas protegidas. Não foram utilizados bancos ou
fotografias privados do proprietário nos ensaios.

## Estado final

Implementação tecnicamente concluída, aguardando a validação manual do proprietário.
Sem commit ou push. Pré-5.2 C (revisão visual), 5.2 (instalador) e 5.3 (homologação)
permanecem pendentes e não foram implementadas.

## Complemento — Compatibilidade com imagens baixadas da internet

### Diagnóstico e decisão

O complemento começou sobre o trabalho não commitado da Pré-5.2 B, preservado.
HEAD continuava `d359480`; não houve commit, push ou acesso experimental aos dados
habituais. A reprodução com WebP sintético válido no Electron 43.8.6 mostrou dois
impedimentos: `imageHeader` retornava `PHOTO_FORMAT`, e `nativeImage.createFromBuffer`
retornava imagem vazia. O seletor também ocultava `.webp` e `.jfif`.
Isso comprova uma limitação do pipeline anterior, sem atribuir a ela todas as
rejeições históricas observadas pelo proprietário.

O `nativeImage` permanece no caminho já aprovado de JPEG/PNG e na geração de
miniaturas. Para WebP, foi incorporado **Sharp 0.35.5**, fixado no package.json e
lockfile, com `@img/sharp-win32-x64` 0.35.5, libvips 8.18.7 e libwebp 1.6.0.
O caminho especializado é carregado sob demanda, recebe somente Buffer e não
aceita URLs, paths do renderer, SVG ou formatos arbitrários.

A alternativa de renderer auxiliar/canvas ampliaria a coordenação de janelas,
transferência de bytes e dependência do contexto Chromium para uma operação de
filesystem do main. Sharp oferece decodificação especializada assíncrona e limites
explícitos, sem alterar o isolamento do renderer. O cliente não precisa de Python,
Pillow, ImageMagick ou serviço online; Pillow é apenas leitor de testes.

Referências oficiais consultadas: [nativeImage](https://www.electronjs.org/docs/latest/api/native-image),
[instalação e ASAR do Sharp](https://sharp.pixelplumbing.com/install/#electron),
[limites e failOn](https://sharp.pixelplumbing.com/api-constructor/),
[cache e concorrência](https://sharp.pixelplumbing.com/api-utility/).
O pacote Windows inclui as licenças distribuídas pelo Sharp e pelo pacote binário;
essas licenças e atualizações de segurança deverão continuar sendo acompanhadas na distribuição.

### Formatos, pipeline e limites

| Entrada                                             | Política                                                      |
| --------------------------------------------------- | ------------------------------------------------------------- |
| JPG/JPEG/JFIF, inclusive extensão maiúscula         | Conteúdo JPEG; pipeline anterior preservado                   |
| PNG estático                                        | Pipeline anterior, preservando alfa                           |
| WebP lossy/lossless estático, com ICC ou EXIF       | Sharp; orientação única, sRGB, metadados removidos            |
| WebP com alfa                                       | PNG verdadeiro, com transparência preservada                  |
| WebP sem alfa                                       | JPEG verdadeiro, qualidade 90                                 |
| GIF, AVIF, WebP animado/APNG, SVG e outros formatos | Recusados; ausência de suporte não implica arquivo corrompido |

Não há importação por URL nem scraping. Extensão e MIME não decidem a aceitação.
O seletor nativo lista JPG/JPEG/JFIF/PNG/WebP; a prévia recebida pelo Angular já é
a miniatura da representação normalizada.

WebP passa por verificação RIFF/WEBP: comprimento total exato, limites de chunks,
padding, duplicações, imagem única, dimensões VP8/VP8L/VP8X coerentes e rejeição de
animação antes de expandir pixels. Depois, Sharp verifica metadados, formato e
dimensões, com `failOn:'warning'`, `limitInputPixels:24_000_000`, quatro canais e
leitura sequencial. A saída é validada como JPEG/PNG e decodificada antes da preparação.

Permanecem **10 MiB, 8192 pixels por lado e 24 MP** de entrada. Saída até 2048
pixels por lado, sem ampliação, máximo 8 MiB; miniatura até 160 pixels / 256 KiB.
Se necessário, até quatro reduções proporcionais adicionais de 10% limitam a saída.
libvips utiliza uma thread, cache de 16 MiB/16 itens e zero arquivos em cache.
Há timeout cooperativo de 15 segundos por tentativa de conversão WebP; não é
watchdog preemptivo de todo o processo nem garantia para IO do sistema bloqueada.
Os limites de pixels/cache não equivalem a um limite rígido de RSS.

A preparação passou a aguardar normalizadores assíncronos **dentro do mesmo
withLock** já usado por associação, descarte e captura de backup. A conversão
termina antes de inserir o ledger ou escrever staging. Não se publica WebP bruto
como JPEG/PNG. Falhas preservam a associação anterior; mensagens e diagnóstico
continuam sem paths pessoais ou exceções internas.

### Persistência, backup e empacotamento

Nenhuma migração: schema 6 e migrações 0001–0006 permanecem intactos. Objetos e
miniaturas anteriores não são convertidos; seus hashes e associações permanecem.
Contratos IPC, appId, protocolo, raiz legada, marca MNR Gestão, journals e formato
de backup não mudam. O backup recebe apenas os objetos JPEG/PNG finais pelo
protocolo existente; não precisa de um novo formato de manifesto.

Sharp e `@img` são explicitamente desempacotados do ASAR, conforme orientação do
fornecedor. A verificação de pacote exige módulo `.node`, libvips e DLLs Windows;
o smoke empacotado precisa efetivamente importar WebP, não apenas verificar arquivos.
Não há instalador ou homologação Windows 11 nesta etapa.

### Testes e evidências do complemento

O recorte `npm.cmd run test:fotos-internet` conserva os testes anteriores e inclui
dez entradas novas: WebP lossy, lossless, transparente, caminho acentuado/com
espaços, grande 6000×4000, ICC, EXIF6, JFIF, JFIF progressivo acentuado e JFIF EXIF6.
Pillow reabre o formato interno e compara pixels, orientação, alfa e metadados.
Os casos negativos incluem GIF/AVIF, animação, dimensões/pixels excessivos,
truncamento, RIFF malformado, arquivo falso e payload sem dados de pixels.
Snapshots integrais conferem ausência de escrita para entradas inválidas.

Um teste com barreira externa mantém a normalização pendente e comprova que a
captura via withLock aguarda os dois arquivos de staging completos. Não há hook
novo de teste no aplicativo. Integridade SQLite, FKs e associação anterior são
conferidas após os cenários. As falhas injetadas e os testes antigos de publicação
parcial continuam no recorte anterior.

O fluxo de interface cria produtos por WebP e JFIF, verifica prévia e catálogo,
fecha/reabre antes do backup, registra estado B, restaura A e exige os mesmos hashes
na primeira reinicialização automática, na segunda abertura e na proteção B.
As respostas dos diálogos são controladas externamente; isso não substitui o
ensaio manual físico do seletor do Windows. O pacote é executado com offline emulado.

Durante a revisão, foi acrescentada revalidação dos diretórios **depois** do await
de normalização e antes da primeira escrita. Um teste troca staging por uma junction
enquanto o normalizador cede execução: a operação é recusada, o snapshot completo
do banco fica igual e nenhum arquivo aparece no destino externo ao diretório de imagens.
O teste usa exclusivamente raízes próprias e restaura a estrutura de teste ao final.
Também é conferido um WebP servido com nome `.JPG`, pelo mesmo leitor limitado do
seletor: a assinatura real determina a conversão, sem exigir renomeação pelo operador.

Ocorrências preservadas, sem considerar tentativas falhas como aprovação:

- Um primeiro fixture que zerava parte do payload ainda era uma imagem decodificável;
  a expectativa de rejeição falhou. O fixture foi substituído por RIFF/VP8L com
  cabeçalho válido e ausência comprovada dos bytes de pixels. A exigência de rejeição
  permaneceu; não foi reduzido `failOn` nem removida validação de conteúdo.
- O verificador inicialmente procurou `sharp/lib/index.js`; o pacote 0.35.5 usa
  `sharp/dist/index.cjs`. A conferência foi ajustada ao entry point real e passou
  a exigir também licenças e os três binários Windows desempacotados.
- Um smoke interrompeu na captura, com `Failed to print window` / `Unable to capture
screenshot`. Outro perdeu a seleção de janela por trecho fixo da URL após a
  reinicialização, com `setContentSize` em undefined. As asserções anteriores de
  restauração não falharam, mas os comandos completos foram considerados falhos.
  A captura agora usa a identidade da janela ligada ao renderer, exige sua existência,
  e admite até três tentativas apenas para o erro específico de captura, registrando
  cada tentativa. Uma captura real continua obrigatória; falha persistente reprova.
  A causa nativa exata do erro de PrintWindow não foi determinada.

Os binários adicionais do decoder somam **19.795.456 bytes**. O ensaio de 24 MP
expande um WebP de 42.756 bytes para validar o limite por pixels, e não apenas bytes.
Os tempos do recorte incluem duas normalizações e persistência por caso; não devem
ser confundidos com o tempo de uma única decodificação ou de seleção pela UI.
O limite de cache de 16 MiB não é um teto de RSS do processo. Há no máximo 256 chunks
na pré-validação, uma importação por bloqueio de fotos, uma thread libvips e timeout
cooperativo de 15 segundos por tentativa de conversão, com até cinco tentativas
para adequar o tamanho. Não há promessa de limite rígido de memória/tempo de processo.

A auditoria de produção (`npm audit --omit=dev`) não apontou vulnerabilidades.
A auditoria completa registrou 14 avisos moderados em ferramentas de desenvolvimento,
todos com nós marcados `dev` no lockfile; não foram aplicadas atualizações automáticas
ou mudanças de versões fora do escopo para ocultar esses avisos.

<!-- internet-final-start -->

### Resultado final das verificações

Na versão final, **229 testes gerais**, **20 grupos do recorte de fotografias**
(incluindo os anteriores) e os dez casos positivos novos foram aprovados.
Os testes de segurança, snapshots sem escrita, junction, leitura limitada,
coordenação assíncrona, SQLite e persistência foram reexecutados.

Os três ciclos WebP/JFIF finalizaram com estado A na primeira abertura automática
e na segunda abertura, produto exclusivo de B ausente e proteção exatamente B.
Os seis hashes de fotos (dois por ambiente) permaneceram iguais; não houve erro de
inicialização. Cada ciclo validou 16 XLSX/PDF após fechar o aplicativo: **48 arquivos**
nos três ciclos. Backups antigos legítimos dos schemas 5 e 6 foram revalidados no
executável atual, sem alterar seus arquivos de origem.

| Ambiente                          | WebP/JFIF | Primeira/segunda abertura | Proteção B | XLSX/PDF |
| --------------------------------- | --------- | ------------------------- | ---------- | -------: |
| mnr://app                         | Aprovados | A / A                     | Exata      |       16 |
| HTTP desenvolvimento              | Aprovados | A / A                     | Exata      |       16 |
| Windows x64 ASAR, offline emulado | Aprovados | A / A                     | Exata      |       16 |

No pacote final, 147 arquivos de produção foram comparados byte a
byte com o dist; os três binários nativos também correspondem aos instalados.
O fingerprint de fontes/lockfile é `eeb530a12642170d43f43c21622845f8381c954922fb7a46703ed374816f159d`.
O pico observado do processo no recorte de dez entradas foi
161.5 MiB; inclui Electron, fixtures e persistência e
não representa teto de memória nem pico exclusivo de uma foto.

| Comando                                                                    | Saída | Fim UTC                  | Evidência                                                      |
| -------------------------------------------------------------------------- | ----: | ------------------------ | -------------------------------------------------------------- |
| `npm.cmd run typecheck`                                                    |     0 | 2026-11-16T19:30:10.139Z | [log](../.cache/pre52b-checks-2026-11-16T19-26-09-614Z/03.log) |
| `npm.cmd run lint`                                                         |     0 | 2026-11-16T19:30:21.602Z | [log](../.cache/pre52b-checks-2026-11-16T19-26-09-614Z/04.log) |
| `npm.cmd run format:check`                                                 |     0 | 2026-11-16T19:11:10.145Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/03.log) |
| `npm.cmd run test:fotos-internet`                                          |     0 | 2026-11-16T19:12:31.323Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/04.log) |
| `npm.cmd run pack`                                                         |     0 | 2026-11-16T19:13:42.542Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/05.log) |
| `node scripts/verify-package.mjs`                                          |     0 | 2026-11-16T19:30:23.971Z | [log](../.cache/pre52b-checks-2026-11-16T19-26-09-614Z/06.log) |
| `node scripts/backup-restauracao-smoke.mjs --fotos-internet --development` |     0 | 2026-11-16T19:14:49.816Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/07.log) |
| `node scripts/backup-restauracao-smoke.mjs --fotos-internet --package`     |     0 | 2026-11-16T19:15:49.418Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/08.log) |
| `npm.cmd test`                                                             |     0 | 2026-11-16T19:18:23.222Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/09.log) |
| `npm.cmd run test:backup-restauracao`                                      |     0 | 2026-11-16T19:22:18.057Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/10.log) |
| `npm.cmd run test:catalogo-generalista`                                    |     0 | 2026-11-16T19:24:43.114Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/11.log) |
| `node scripts/backup-restauracao-smoke.mjs --legacy-schema6 --package`     |     0 | 2026-11-16T19:25:26.072Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/12.log) |
| `node scripts/backup-restauracao-smoke.mjs --legacy-schema5 --package`     |     0 | 2026-11-16T19:26:08.578Z | [log](../.cache/pre52b-checks-2026-11-16T19-10-35-066Z/13.log) |
| `npm.cmd run test:ui`                                                      |     0 | 2026-11-16T19:29:50.465Z | [log](../.cache/pre52b-checks-2026-11-16T19-26-09-614Z/01.log) |
| `npm.cmd run build`                                                        |     0 | 2026-11-16T19:30:03.269Z | [log](../.cache/pre52b-checks-2026-11-16T19-26-09-614Z/02.log) |

Histórico de tentativas, incluindo comandos falhos, em
[internet-validacoes.json](evidencias-pre-5-2-B/internet-validacoes.json).
[Dados dos ambientes e hashes](evidencias-pre-5-2-B/internet-ambientes.json),
[decoder, timings, pacote e auditorias](evidencias-pre-5-2-B/internet-decoder.json),
[backups antigos](evidencias-pre-5-2-B/internet-backups-antigos.json) e
[inventário de arquivos](evidencias-pre-5-2-B/internet-arquivos.json).
Capturas inspecionadas do ASAR: [WebP](evidencias-pre-5-2-B/internet-webp-asar.png)
e [JFIF orientado](evidencias-pre-5-2-B/internet-jfif-asar.png).

O fechamento de formatação/diff após gerar esta documentação ficará registrado em
`.cache/pre52b-internet/fechamento.json`. Windows 11, máquina limpa, mídia física
offline e instalador continuam fora das evidências desta máquina Windows 10.
Não foram usados dados reais. Nenhum commit/push foi feito. Complemento técnico
concluído, aguardando a validação manual da Pré-5.2 B completa; sem avanço à Pré-5.2 C.

<!-- internet-final-end -->

### Checklist manual adicional — perfil isolado

Use o perfil novo definido no [checklist principal](#checklist-manual-pelo-vs-code).
A variável fica somente naquele terminal; não a configure globalmente.

1. Preserve um backup externo válido antes de abrir seus dados habituais.
2. Em um perfil de teste, execute `npm.cmd run dev` e abra Produtos.
3. Selecione WebP lossy/lossless e WebP transparente baixados do disco; confira que
   aparecem no filtro do seletor, na prévia, no catálogo e no detalhe após salvar.
4. Repita com `.jfif`/`.JFIF`, incluindo fotografia orientada; não renomeie a extensão
   para contornar o seletor. Confira orientação e miniatura.
5. Feche e abra; confira as imagens. Crie backup A. Substitua as fotos para criar B.
6. Restaure A pela revisão explícita e confira a **primeira abertura automática**,
   as fotos originais, a proteção B e uma segunda abertura. Execute nova operação.
7. Repita no executável ASAR, sem usar a pasta real para ensaios destrutivos.
8. Selecione falso WebP, WebP truncado, GIF e AVIF: confira erro claro e manutenção
   da foto anterior. Cancele o seletor e confira ausência de alteração.
9. Use `npm.cmd run test:fotos-internet` para o recorte automatizado isolado.
