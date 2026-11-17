# Pré-Instalador — Backup Automático por Dias de Uso

## Diagnóstico anterior à implementação

HEAD `1dc3e23 feat: amplia suporte a imagens e renomeia aplicativo para MNR Gestao`.
Pré-5.2 B efetivamente commitada; `git status --short` e diff vazios. AGENTS e README,
relatório da 5.1 e complemento de reinicialização, controller, worker/jobs/formato,
gate central, fila de fotos, paths, preload/IPC, configurações Angular e testes foram
examinados. Os dados habituais não são fixtures e não serão substituídos.

| Área                    | Fonte atual                                    | Decisão                                                  |
| ----------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Snapshot                | BackupController / backupJob capture           | Reutilizar VACUUM INTO, staging e validações             |
| Consistência de imagens | photos.withLock + DataGate.protect             | Mesma coordenação, inclusive normalização assíncrona     |
| Formato/publicação      | packageSet/readArchive/moveDurable/hashFile    | Mesmo formato 1, sem sobrescrita e com verificação       |
| Restauração             | recovery/sets, pending/active/done/last        | Não substituir nem criar outro protocolo                 |
| Dados persistentes      | raiz legada e gerações data/images             | Política fora das gerações e fora do backup comercial    |
| Configuração geral      | Não há repositório de configurações apropriado | Sidecar local próprio, versionado, checksummed e durável |
| Schema                  | 6; backups 5/6                                 | Nenhuma migração/tabela comercial nova                   |
| IPC                     | Seis canais fechados da 5.1                    | Preservar; canais próprios mínimos para política         |
| Inicialização           | recoverAndOpen, fotos, loadURL, ready          | Política só inicia depois de ready, com erro isolado     |

## Regras implementadas

- Dia de uso: abertura operacional da interface em primeiro plano ou interação
  posterior (teclado, ponteiro, foco) com a interface operacional. Polls de estado,
  aplicativo ocioso/background e dias sem execução não contam. O main determina
  a data local; o renderer não fornece timestamps ou calcula a obrigação.
- Três datas locais distintas desde a última cópia válida tornam o backup devido.
  Reaberturas no mesmo dia não duplicam. Backup válido satisfaz a data atual e
  reinicia o ciclo somente nos dias posteriores; backup manual também satisfaz.
- Relógio regressivo não remove dias: torna a obrigação conservadoramente devida
  e mostra aviso. Um backup validado permite estabelecer uma nova referência local.
  Mudanças de fuso podem mudar a data observada, sem apagar o histórico. Não se
  promete proteção perfeita contra adulteração local sem fonte externa de tempo.
- Automação habilitada por padrão; sem pasta, solicitar configuração. Desabilitar
  automação mantém contagem/obrigação. Tentativa automática no máximo uma por data
  de uso; nova tentativa explícita disponível. Sem tarefas/serviços Windows.
- Adiamento exige motivo fechado e fica no histórico; nunca zera a obrigação.
  Banner persistente e lembrança na próxima utilização; vendas não ficam bloqueadas
  pela indisponibilidade da mídia. Captura usa somente a pausa breve já existente.
- Estado local vinculado ao perfil, fora das gerações restauráveis; resultado novo
  de restauração força nova obrigação, sem reinstalar destino vindo do backup.
- Retenção 7 por padrão, opções 3/7/14/30: somente arquivos automáticos catalogados,
  com identidade do diretório/arquivo e hash. Nunca manuais, desconhecidos ou proteções.
  Nova cópia deve estar validada antes de qualquer limpeza. Falha de limpeza é aviso.
- Seleção de pasta exclusivamente pelo diálogo do main. Revalidar identidade e
  canonicalização antes de publicar ou limpar; rejeitar junctions/symlinks e raízes
  administradas/instalação. Recomendar unidade independente, sem prometer tolerância
  a falha física para outra pasta no mesmo disco.

## Arquitetura e persistência

O núcleo `shared/backup-policy.ts` recebe datas civis locais e devolve o estado do
ciclo. Não importa Angular, Electron, Node, filesystem ou relógio. Adaptadores
separados cuidam da persistência, seletor, execução e apresentação. Não há suporte
mobile implementado nem promessa de compatibilidade de arquivo mobile.

`backup-policy/state.json`, na raiz oficial do perfil, contém envelope versionado,
identidade do perfil/raiz, sequência e SHA-256 do estado. A gravação usa arquivo
exclusivo, sincronização e substituição durável do estado conhecido. Não integra
o banco comercial nem as gerações restauráveis. Não houve migração 0007: schema 6,
migrações 0001–0006, formato 1 e identidade técnica permanecem iguais.

São persistidos dias, referência temporal, obrigação, destino autorizado com sua
identidade de filesystem, configuração, última conclusão, tentativa por data,
adiamento com motivo, comprovante pendente, catálogo próprio de automáticos e
histórico limitado às últimas 50 ocorrências. Consultas de estado e repetições do
mesmo dia não gravam novamente o arquivo. O histórico registra início, conclusão,
falha, interrupção, configuração e adiamento, sem SQL ou conteúdo comercial.

Checksum detecta corrupção acidental; não constitui autenticação contra alguém com
acesso de escrita aos dados locais. Cópia de configuração para outra raiz não
autoriza apagar arquivos do perfil anterior. Configuração inválida é preservada,
produz obrigação/erro isolado e impede automação/limpeza; os módulos comerciais e
o botão original **Criar backup** continuam disponíveis. Não apagar o sidecar para
ocultar o aviso; preservar o conjunto para suporte.

Na primeira atualização, a contagem começa no primeiro uso operacional. Cópias
anteriores continuam restauráveis, mas arquivos encontrados no disco não são
adotados como histórico de conclusão ou catálogo de retenção sem comprovante local.

## Execução e confirmação

O serviço recorrente encaminha a execução ao mesmo `BackupController` da 5.1.
Não implementa snapshot alternativo. `DataGate`, fila de fotografias, worker,
`VACUUM INTO`, validação SQLite/FKs/schema/referências, manifesto, hashes e
publicação exclusiva são compartilhados. A cópia só satisfaz a política depois
da validação do pacote e da conferência de tamanho, identidade e hash do arquivo
publicado. Nomes incluem UUID e não conflitam entre execuções.

Há dois tipos rigorosamente distintos:

- Automático: iniciado pelo motor quando devido; entra no catálogo de retenção.
- Manual: iniciado pelo operador, tanto por **Criar backup** quanto por **Realizar
  backup agora** na pasta configurada; satisfaz o ciclo, mas nunca é apagado pela
  retenção automática.

Antes da publicação, um comprovante durável registra hash, tamanho, identidade do
arquivo candidato, diretório e data do ciclo. Se o processo cair depois da
publicação e antes do registro de sucesso, a próxima abertura confere essa prova
e reinspeciona o pacote pelo leitor oficial antes de reconhecer a conclusão.
Arquivo ausente, substituído ou adulterado não recebe crédito; é preservado e
uma nova cópia fica devida. A reconciliação usa a data original, sem satisfazer
indevidamente um dia posterior. Queda durante a gravação dos dias também solicita
uma cópia conservadora; temporários desconhecidos não são apagados. Depois de uma
cópia válida, os mesmos vestígios já reconhecidos não forçam obrigação infinita.

Falha ao registrar a política não apaga uma cópia manual válida nem a apresenta
como contagem reiniciada. O estado informa a necessidade de suporte; a proteção
física do arquivo manual é mantida. O usuário nunca recebe crédito apenas pela
presença de um arquivo com extensão `.mnrbackup`.

## Destino, concorrência e retenção

O renderer não informa paths: somente o main abre o diálogo nativo de pasta.
A pasta precisa existir; diretórios administrados pelo sistema e a instalação
são recusados. Caminhos são canonicalizados; componentes simbólicos/junctions são
rejeitados. Identidades de pasta e arquivo são revalidadas antes de captura,
publicação, reconhecimento e limpeza. Troca de unidade/diretório exige nova
autorização no seletor. Não há fallback silencioso para outra pasta.

São herdadas as garantias e limitações de publicação da 5.1, inclusive staging
no volume de destino e erro explícito se a publicação durável não for suportada.
O erro mantém a obrigação. Não há promessa de tolerância à remoção física em
qualquer instante ou a hardware que desrespeite sincronização. Pendrive, FAT/exFAT
e disco externo físico continuam sujeitos à validação manual na mídia utilizada.

Não há duas capturas concorrentes. Restauração, revisão de restauração e backups
usam o controlador existente; a automação não começa durante revisão/restauração.
O fechamento normal é coordenado enquanto a operação está em andamento. Uma queda
forçada é recuperada pelo comprovante, sem marcar sucesso prematuro.

Retenção padrão: sete automáticos verificados; opções: 3, 7, 14 ou 30. Somente os
arquivos catalogados pelo mesmo perfil, com prefixo próprio, caminho, identidade e
hash confirmados, podem ser removidos. Antes de cada exclusão, a cópia mais nova é
revalidada. A última cópia válida permanece. Manuais, desconhecidos, arquivos de
outro perfil e proteções pré-restauração não entram na rotação. Alterar o limite
produz efeito na próxima conclusão válida, sem limpeza antecipada. Falha de
limpeza deixa aviso e preserva o arquivo; não invalida a nova cópia.

Limites operacionais defensivos: até 512 comprovantes automáticos catalogados,
8 MiB no sidecar e 128 vestígios locais antes de exigir suporte. Esses limites
não truncam backups nem limitam linhas comerciais; ao atingi-los, a automação é
recusada de forma explícita. Cópias manuais continuam disponíveis. Falhas de limpeza
repetidas podem conservar mais cópias que o limite escolhido e exigir intervenção.

## Restauração e tempo local

Restauração não reinstala destino, dias ou histórico operacional de outro momento
ou dispositivo: esses dados ficam fora do arquivo comercial. Um novo resultado
oficial de recuperação/restauração força uma cópia do conjunto reaberto, conserva
a configuração e registra o evento. O mesmo resultado não é reaplicado em todas
as aberturas. A rotina inicia somente depois da recuperação, abertura segura e
carregamento operacional da interface; seu erro não vira diálogo global de abertura.

Mudanças regressivas de relógio/fuso tornam a política conservadoramente devida.
Avançar vários dias não conta os dias sem utilização; uma nova data observada
conta somente uma vez. Um backup validado estabelece nova referência local.
Datas futuras incorretas podem gerar avisos conservadores ao corrigir o relógio.
Não existe prova externa de tempo nem proteção absoluta contra manipulação local.

## Interface e obrigatoriedade

**Configurações → Backup e Restauração** mostra automação, três dias de uso,
contagem, dias restantes, estado, última cópia, destino, retenção e histórico.
Desabilitar automação não desabilita a obrigação. Sem pasta, o aviso oferece a
configuração; falha de mídia permite trocar pasta ou tentar explicitamente outra
vez. Há no máximo uma tentativa automática por data de utilização, sem loop de
tentativas. O operador pode solicitar cópias adicionais manualmente.

O banner global permanece enquanto houver obrigação. **Continuar temporariamente**
registra motivo e horário; não satisfaz nem apaga a obrigação. Uma nova abertura
retoma a lembrança. Vendas urgentes continuam possíveis sem pendrive. A pausa breve
de operações na captura é a mesma da 5.1. Progresso é indeterminado, sem porcentagem
inventada; a conclusão verificada gera aviso discreto.

Se o aplicativo ficar aberto durante a meia-noite, a primeira interação/foco
visível registra a nova data. O polling de estado não registra uso: deixar o
computador ocioso por dias não produz dias artificiais. Abertura operacional da
interface também conta um dia, mesmo sem uma venda, pois consulta é utilização.

## Segurança IPC

Namespace tipado `backupRecorrente`: `estado`, `utilizar`, `selecionarPasta`,
`configurar`, `executar` e `adiar`; seis canais fechados. O main verifica remetente,
frame principal, URL, aridade, objetos fechados, booleano, retenção permitida e
motivo enumerado. Não aceita relógio, path, SQL ou seleção de arquivo pelo renderer.
Os seis canais históricos da 5.1 permanecem. Sandbox, CSP, contextIsolation,
nodeIntegration desativado e identidades legadas foram preservados.

## Validação automatizada e evidências

Conclusão técnica em 16/11/2026, horário local (os ledgers usam UTC, já em
17/11). **240 testes gerais aprovados**, zero falhas/cancelamentos; recorte dedicado
com **19 testes aprovados**, sendo 11 grupos novos e oito verificações IPC existentes.
O recorte é subconjunto da suíte geral, não 19 testes adicionais aos 240.

Ledgers preservados, com comando, início/fim UTC, código de saída e caminho de log:

- A: `.cache/backup-auto-checks-2026-11-16T23-58-12-706Z/results.json` — regressões amplas.
- B: `.cache/backup-auto-checks-2026-11-17T00-26-19-401Z/results.json` — repetição, pacote final e ASAR.
- C: `.cache/backup-auto-checks-2026-11-17T00-47-46-350Z/results.json` — backups históricos no ASAR.
- D: `.cache/backup-auto-checks-2026-11-17T00-49-11-325Z/results.json` — repetição após a correção de limpeza.
- E: `.cache/backup-auto-checks-2026-11-17T00-45-46-870Z/results.json` — checks estáticos após a última alteração de produção.

| Comando/verificação                       | Log                                      | Resultado                                                                                                                   |
| ----------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                   | E/01.log                                 | 0                                                                                                                           |
| `npm.cmd run lint`                        | E/02.log                                 | 0                                                                                                                           |
| `npm.cmd run format:check`                | E/03.log                                 | 0; documentação conferida novamente ao encerrar                                                                             |
| `npm.cmd run build`                       | B/04.log; reconstrução também em D/01–02 | 0                                                                                                                           |
| `npm.cmd test`                            | D/01.log                                 | 0; 240/240, cadastros Angular nas duas origens e smoke desktop                                                              |
| `npm.cmd run test:ui`                     | B/06.log                                 | 0; cadastros/fotos, compras, estoque, vendas, recebimentos, correções, reembolsos, Dashboard, compras corretivas e estornos |
| `npm.cmd run test:backup-restauracao`     | B/07.log                                 | 0; falhas/interrupções e reinício real supervisionado de dev                                                                |
| `npm.cmd run test:financeiro`             | B/08.log                                 | 0; 45 testes e fluxos reais, incluindo correções/reembolsos                                                                 |
| `npm.cmd run test:vendas`                 | B/09.log                                 | 0                                                                                                                           |
| `npm.cmd run test:correcoes-compras`      | B/10.log                                 | 0                                                                                                                           |
| `npm.cmd run test:estornos-estoque`       | B/11.log                                 | 0                                                                                                                           |
| `npm.cmd run test:relatorios`             | B/12.log                                 | 0                                                                                                                           |
| `npm.cmd run test:dashboard`              | B/13.log                                 | 0                                                                                                                           |
| `npm.cmd run test:consolidacao`           | B/14.log                                 | 0                                                                                                                           |
| `npm.cmd run test:catalogo-generalista`   | A/07.log                                 | 0; atual e schema 5                                                                                                         |
| `npm.cmd run test:fotos-internet`         | A/08.log                                 | 0; JPEG/PNG/WebP/JFIF e restauração                                                                                         |
| `npm.cmd run test:consolidacao-estoque`   | A/09.log                                 | 0                                                                                                                           |
| `npm.cmd run test:consolidacao-gerencial` | A/10.log                                 | 0; 174 XLSX/PDF validados                                                                                                   |
| `npm.cmd run test:exportacoes`            | A/11.log                                 | 0; 40 XLSX/PDF validados                                                                                                    |
| `npm.cmd run test:backup-automatico`      | D/02.log                                 | 0; 19/19 e ciclo real local após a correção final                                                                           |
| Smoke recorrente `--development`          | D/03.log                                 | 0; HTTP e primeira abertura automática                                                                                      |
| `npm.cmd run pack`                        | B/17.log                                 | 0; reconstruído após a correção final de produção                                                                           |
| `node scripts/verify-package.mjs`         | D/04.log                                 | 0; 52 bundles, módulos iguais ao build atual, sem testes/clock do harness                                                   |
| Smoke recorrente `--package`              | B/19.log                                 | 0; Windows x64 ASAR, offline emulado                                                                                        |
| Smoke `--legacy-schema5 --package`        | C/01.log                                 | 0; migração oficial em staging e reabertura                                                                                 |
| Smoke `--legacy-schema6 --package`        | C/02.log                                 | 0; runtime antigo aprovado e reabertura                                                                                     |

As verificações de esquema, migrações, FKs, idempotência, auditoria, isolamento IPC,
custo médio e financeiro existentes permanecem na suíte geral. Os novos testes
comparam snapshots completos do SQLite, não apenas quantidades de linhas. Foram
exercitados datas/fusos controlados em processos filhos, quatro usos no mesmo dia,
meia-noite, dias sem uso, regressão de relógio, manual no segundo dia, automático no
terceiro, retorno após falha, troca de identidade de destino, concorrência manual/
automática/inspeção, hashes inválidos, retenção e corrupção do sidecar preservada.
As quedas reais de filhos antes/depois de publicar e durante a gravação dos dias
foram seguidas de duas inicializações, integridade/FKs e ausência de alterações
comerciais. Os testes novos não criam hooks na aplicação de produção.

## Evidências dos três ambientes

Em cada ambiente: pasta escolhida pelo fluxo nativo; segundo/terceiro dia por
teclado real com relógio exclusivo da política; cópia automática completa;
destino ausente; adiamento sem apagar obrigação; backup manual satisfazendo o ciclo;
restauração A/B; primeira reinicialização automática, segunda abertura e exportação.

| Ambiente / evidência                                | Bytes da cópia automática | Criação manual completa (ms) | Até primeira reabertura (ms) | XLSX/PDF |
| --------------------------------------------------- | ------------------------: | ---------------------------: | ---------------------------: | -------: |
| [mnr local](../.cache/backup-auto-local-smoke.json) |                    509465 |                       2008,0 |                       4908,9 |       16 |
| [HTTP](../.cache/backup-auto-http-smoke.json)       |                    509465 |                       2038,4 |                       4860,5 |       16 |
| [ASAR](../.cache/backup-auto-package-smoke.json)    |                    509465 |                       2007,4 |                       4961,2 |       16 |

Hashes SHA-256 dos automáticos, também registrados nos respectivos JSONs:

- Local: `6ce1a0510ab9cbaff2a72882bebaa226609a7da7954cce7062d8267c12fedb04`.
- HTTP: `2403f4bedc8743a1d9a7ee636fd3dc2bf28aea9a4e9931d6b0b8414c03ca1a97`.
- ASAR: `41b094d78e7fce97740f442b90d35c224d9e36998ea833c183960c4f521dc8f7`.

Os três JSONs comprovam `firstAutomaticOpening=A`, `secondManualOpening=A`,
`exclusiveBAbsent=true`, `protectionExactlyB=true`, `pendingAbsent=true` e
`startupErrors=0`, além de `manualSatisfied` e `restoredLocalPolicy`. As 48
exportações desses três ciclos foram reabertas pelos leitores independentes.
Os nomes dos arquivos e locais das proteções constam dos JSONs, em perfis de teste.

Nove combinações de tamanho/zoom por ambiente, sem overflow horizontal da página,
incluindo Tab, Shift+Tab, Enter, Escape, cancelamento do seletor e restauração de
foco. Capturas representativas em `.cache/ui/backup-auto-{local,http,package}-*.png`;
foram inspecionadas visualmente as de 1366×768 e 640×480/150%, inclusive ASAR.
Na menor janela, o painel usa rolagem vertical; não houve redesign global.

Medições do primeiro automático: SQLite ~22,5/22,5/23,3 ms e cópia de fotos
~29,4/23,8/22,7 ms (local/HTTP/ASAR). Chamada completa ao worker de captura:
~293,9/232,3/219,7 ms; worker de pacote: ~193,6/179,3/177,4 ms. RSS observado
após o pacote: ~123,7/118,9/148,9 MiB do main. São amostras, não percentis ou pico
agregado; criação completa inclui coordenação, staging, sincronização e estado local.

O Builder informou ícone padrão e ausência de certificado de assinatura, condições
anteriores à etapa de instalador. Um diagnóstico gráfico isolado `GPU state invalid`
apareceu em B/08.log; as asserções e o processo financeiro terminaram com código zero.
A causa gráfica não foi determinada e não foi apresentada como defeito financeiro.
As mensagens de resposta perdida nos testes são injeções explícitas do harness.

## Problemas identificados durante a implementação

- Classificação de cópias: ações do operador foram separadas da rotação automática;
  mesmo **Realizar backup agora** na pasta recorrente permanece manual e preservado.
- Falha de persistência após publicação: a cópia manual física permanece válida,
  mas o fluxo recorrente não afirma que a contagem foi reiniciada sem seu registro.
  A reabertura pode reconhecer comprovante pendente somente após reinspeção oficial.
- Falha na consulta inicial do estado de recuperação: passou a ser capturada dentro
  da inicialização da política, resolvendo sua coordenação mesmo em erro. Assim,
  o observador do backup manual não fica esperando indefinidamente uma inicialização
  que não ocorrerá. Teste injeta rejeição dessa consulta e conclui uma cópia manual.
- Retenção foi reforçada com prova positiva de exclusão do automático antigo válido
  e prova de preservação dos três mais recentes, além dos casos de desconhecidos,
  manuais e arquivo substituído com os mesmos bytes.
- Exceção inesperada na limpeza depois do crédito durável foi reproduzida com
  asserção falhando em `.cache/backup-auto/cleanup-reproduction.log`. A limpeza foi
  isolada da conclusão já confirmada: preserva a cópia válida e mostra aviso.
  O teste mantém a injeção e exige ciclo satisfeito. Falha de persistência da
  própria configuração continua exigindo verificação/suporte, sem apagar a cópia.
  Os resultados anteriores a essa correção não substituem sua repetição final.
- Uma execução de `format:check` encontrou formatação pendente em `recurring.ts`;
  foi corrigida, sem omitir o log da tentativa. Erros de construção anteriores
  permanecem nos logs de desenvolvimento; somente resultados finais valem para aceite.

## Ambiente e limites da evidência

Execução nesta máquina: Windows 10 x64, kernel `10.0.19045`, Node `v26.13.0`,
oito processadores lógicos e aproximadamente 16 GiB de RAM; Electron `43.8.6`.
Perfis Chromium, bancos, destinos e raízes de dados exclusivos foram usados.
O ASAR é o executável Windows x64, com rede emulada offline nos smokes existentes.
Isso não homologa Windows 11, máquina limpa, mídia removível física, compartilhamento
de rede ou desconexão física. Não foi construído/validado instalador NSIS.

As falhas EACCES, ENOSPC, ENODEV e publicação/verificação são injetadas pelo teste,
sem encher o disco, alterar permissões do usuário ou remover dados habituais.
O harness simula ausência de mídia renomeando somente seu próprio diretório de
saída e restaurando-o em `finally`. As quedas usam processos filhos encerrados nos
pontos controlados do teste; não são ensaios de corte físico de energia.

Medições de captura SQLite, cópia de fotos, worker de pacote, RSS, ciclo completo
e reabertura estão nos JSONs de cada ambiente. RSS é observação do processo main
naquele instante, não pico agregado de todos os processos. Tempos de worker e
captura não devem ser confundidos com o ciclo completo, IPC ou renderer. A fixture
é comercial e relacional, mas pequena; não se promete desempenho para milhões de
documentos nem para mídias externas que não foram medidas.

## Checklist manual pelo VS Code

1. Preserve uma cópia externa válida antes de abrir dados habituais atualizados.
   Para ensaios, use somente perfil dedicado no terminal PowerShell:

   ```powershell
   $env:MNR_UI_TEST_RUN = 'ui-validacao-backup-auto-' + (Get-Date -Format yyyyMMddHHmmss)
   npm.cmd run dev
   ```

2. Confira o nome MNR Gestão, abra **Configurações → Backup e Restauração** e
   selecione uma pasta exclusiva fora da raiz de dados/instalação. Recomenda-se
   uma unidade independente. Mantenha o terminal de desenvolvimento aberto.
3. Execute **Realizar backup agora**: confira confirmação, última cópia manual e
   zero dias. Abra/feche no mesmo dia: a contagem não deve duplicar.
4. Para simular três dias sem alterar o Windows, feche esse perfil e execute
   `npm.cmd run test:backup-automatico`. O harness cria outro perfil isolado,
   controla somente o relógio da política pelo debugger externo, abre o seletor,
   produz o automático no terceiro dia e simula pasta ausente. Não existe porta de
   relógio artificial no aplicativo de produção.
5. Consulte `.cache/backup-auto-local-smoke.json` e as capturas
   `.cache/ui/backup-auto-local-*.png`: confirme arquivo, hash, banner pendente,
   adiamento registrado, cópia manual satisfazendo o ciclo e configuração preservada.
6. No perfil manual, com uma pasta exclusiva configurada, simule indisponibilidade
   removendo somente sua mídia de teste. Tente backup: confira erro, persistência
   da obrigação e possibilidade de continuar uma operação. Reconecte ou selecione
   outra pasta e tente novamente. Não remova pastas do armazenamento do aplicativo.
7. Crie dados fictícios e foto, faça backup, altere os dados, selecione o backup,
   confira a prévia e restaure. Observe a **primeira** reinicialização automática:
   interface normal, dados/fotos/financeiro recuperados e proteção anterior
   consultável. A configuração local deve permanecer e a política solicitar nova
   cópia do conjunto restaurado. Reabra novamente e confira ausência de duplicidade.
8. Harness HTTP: `node scripts/backup-restauracao-smoke.mjs --backup-automatico --development`.
   Harness ASAR, após `npm.cmd run pack` e `node scripts/verify-package.mjs`:
   `node scripts/backup-restauracao-smoke.mjs --backup-automatico --package`.
   Ambos criam seus próprios perfis, bancos e destinos. Não apontam para a base usual.
9. Faça ensaio físico na mídia externa que será usada, inclusive acesso/permissão,
   reconexão e abertura posterior do backup, usando dados fictícios. Offline emulado
   não equivale a computador fisicamente desconectado nem homologa toda mídia.

## Arquivos desta entrega

Novos: `shared/backup-policy.ts`,
`electron/services/backup/policy-store.ts`,
`electron/services/backup/recurring.ts`, `electron/ipc/backup-recorrente.ts`,
`src/app/core/backup-policy-client.ts`,
`src/app/shared/ui/backup-notice.ts`,
`src/app/features/settings/recurring-backup.ts`,
`tests/backup-automatico.test.cjs`, `tests/helpers/backup-auto-crash.cjs`,
`scripts/backup-automatico-scenario.mjs` e este relatório.

Modificados: `README.md`, `package.json`, `shared/contracts.ts`,
`electron/main/index.ts`, `electron/preload/index.ts`,
`electron/services/backup/controller.ts`, `electron/services/backup/io.ts`,
`src/app/core/desktop.service.ts`, `src/app/core/shell/shell.ts`,
`src/app/core/shell/shell.html`, `src/app/features/settings/backup.ts`,
`src/app/features/settings/backup.html`, `tests/cadastros-ipc.test.cjs`,
`scripts/backup-restauracao-smoke.mjs` e `scripts/verify-package.mjs`.

Sem novas dependências, alteração de lockfile, migrações, regras financeiras,
custeio, snapshots históricos, fotografias existentes ou formato de backup.
Logs, perfis, imagens e pacotes de teste ficam em `.cache`/`.local-data/test`,
ignorados pelo Git e excluídos do ASAR.

## Pendências futuras

Não foram implementados instalador, homologação final, planilhas, nuvem,
sincronização, Agendador de Tarefas ou serviço Windows. Revisão visual global e
validação do proprietário permanecem separadas. Não houve commit ou push.
