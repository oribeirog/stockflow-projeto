# Complemento da 5.1 — Primeira reinicialização após restaurar

## Ocorrência manual e preservação

O proprietário observou erro nativo de “abertura segura” na primeira
reinicialização automática após restaurar, seguido de abertura manual normal.
Esse comportamento não foi aceito como sucesso. O diagnóstico separou ativação
dos dados, conclusão do journal e carregamento da interface.

O trabalho prévio da 5.1 continuava não commitado, sobre HEAD `f730180`.
Nenhuma alteração válida foi descartada. Nenhum banco original, geração,
proteção ou journal foi apagado, movido, substituído ou restaurado nesta correção.
Não foram alteradas migrações, regras financeiras, custeio ou identidades.

Na coleta, não havia Electron do aplicativo em execução. Os componentes de
`data`, `images` e `recovery` do perfil de desenvolvimento foram copiados para
evidência exclusiva em `.local-data/test/backup-manual-evidence-*`: **41 arquivos,
7.200.506 bytes**, incluindo componentes SQLite eventualmente presentes.
SHA-256 foi calculado antes/depois e conferido novamente ao encerrar. Essa cópia
diagnóstica com aplicativo fechado não substitui o mecanismo de backup da 5.1.
Os ensaios abriram outras cópias, preservando também a evidência inicial.
Chromium/logs originais não foram removidos ou manipulados.

O perfil instalado foi apenas localizado por metadados: não continha journal da
ocorrência; não foi aberto para operações. Os registros de restauração recentes
estavam em `.local-data/development/recovery`. A pasta de logs estava vazia.
O catch antigo conservava somente o código sanitizado no console, não a exceção
original em arquivo. Não existe log histórico suficiente para atribuir a cada
PID original os passos daquela execução; isso não foi inventado retroativamente.

## Estado encontrado no journal

| Registro             | Estado preservado                                                  |
| -------------------- | ------------------------------------------------------------------ |
| Plano anterior       | `c56dca84-991a-4268-99dc-7642d8610bb0`, sequência 1, origem legada |
| Plano mais recente   | `5d0cb258-4225-495d-9c54-3787b65f25ec`, sequência 2                |
| `active.json`        | aponta para o plano mais recente, não para `old`                   |
| `pending.json`       | ausente na coleta                                                  |
| `done` / `last`      | `restaurado`, 13/11/2026 09:18:44 (-03)                            |
| Proteção anterior    | arquivo próprio vinculado ao UUID do plano, preservado             |
| Manifesto da geração | SHA-256 igual ao `payload` do plano                                |
| Fotografias          | hashes iguais aos registrados no manifesto                         |

A validação de uma cópia passou por schema, integridade, chaves estrangeiras,
reconciliações oficiais e referências de imagens. Contagens observadas: seis
produtos, dois clientes, dois fornecedores, 13 vendas, dez compras e três fotos.

O hash bruto do `.db` ativo não coincide com o hash do arquivo capturado antes
da ativação. Um banco aberto oficialmente em WAL não deve ser tratado como
arquivo imutável do pacote. **Isso não prova corrupção, nem prova sozinho a
igualdade lógica histórica.** O arquivo de backup escolhido na validação manual
não foi identificado durante esta coleta; não se declarou comparação integral
com um arquivo que não estava disponível. O manifesto e o journal comprovam a
seleção da geração nova; o ciclo controlado abaixo comprova a igualdade lógica
A/B por todas as tabelas e sequências.

O estado final manual, isoladamente, também não demonstra qual inicialização
gravou `done`. A ordem causal da falha foi comprovada na reprodução instrumentada,
e a PRIMEIRA abertura passou a ser verificada explicitamente nos novos testes.

## Causa raiz reproduzida

O lançador `scripts/dev.mjs`, utilizado por `npm.cmd run dev`, iniciava Angular e
Electron e executava `stop()` quando o filho Electron encerrava. `stop()` também
encerrava Angular. Já a restauração chamava `app.relaunch()` e `app.quit()`.

Portanto:

1. A restauração preparava/protegia os conjuntos e solicitava reinício.
2. O Electron inicial encerrava normalmente.
3. O lançador de desenvolvimento encerrava o servidor Angular.
4. O Electron relançado mantinha `MNR_DEV=1` e a mesma raiz/cwd.
5. A recuperação podia ativar/validar os dados e concluir `active/done/last`.
6. `window.loadURL('http://127.0.0.1:4200/')` falhava porque não havia servidor.
7. O catch comum transformava a falha de interface em `BACKUP_FAILED` e mostrava
   exatamente a mensagem genérica de “abertura segura”.
8. Abrir novamente pelo lançador iniciava outro Angular, permitindo carregar a
   interface sobre os dados já selecionados.

Em uma cópia preservada, o lançador original foi reproduzido externamente,
somente com instrumentação de observação. O primeiro processo foi PID **9560**;
o relançado, PID **23228**. Ambos utilizaram a mesma raiz isolada, cwd e `MNR_DEV=1`.
O relançado registrou:

```text
Error: ERR_CONNECTION_REFUSED (-102) loading 'http://127.0.0.1:4200/'
    at rejectAndCleanup (node:electron/js2c/browser_init:2:96575)
    at WebContents.finishListener (node:electron/js2c/browser_init:2:96737)
    at WebContents.emit (node:events:514:28)
```

O registro do diálogo desse PID contém o título e a mensagem relatados pelo
proprietário. A mesma cópia abre com `mnr://app`, sem servidor HTTP. Não foi
reproduzido erro SQLite de arquivo ocupado, falha de worker, troca incorreta de
path ou violação de single-instance lock como causa dessa ocorrência.

**Lacuna dos testes anteriores:** o smoke HTTP iniciava Angular separadamente e
o mantinha vivo durante `app.relaunch`. Ele não utilizava o supervisor real
`npm run dev`, logo não cobria sua política de encerrar o servidor.

Referências primárias: [relaunch do Electron](https://www.electronjs.org/docs/latest/api/app/#apprelaunchoptions)
e [IPC de processos filhos Node](https://nodejs.org/api/child_process.html).
As referências explicam o mecanismo; a causa foi confirmada por execução local.

## Correção aplicada

- Em desenvolvimento supervisionado, o main envia ao pai uma única mensagem
  fixa `mnr:relaunch` pelo canal Node do processo filho e aguarda a confirmação
  `mnr:relaunch-ready` do pai antes de `app.quit()`. O supervisor registra sua
  responsabilidade antes de confirmar e inicia o próximo Electron **após o exit do anterior**,
  mantendo Angular ativo. Fechamento comum continua encerrando o servidor.
- Em Electron independente e ASAR, mantém-se `app.relaunch()` / `app.quit()`.
  O executável não depende do supervisor, mesmo se receber variáveis de ambiente
  de desenvolvimento. Não há novo canal público renderer→main.
- Falha do canal ou falta de confirmação em cinco segundos não cria um segundo
  processo órfão: o main encerra e preserva a intenção durável para a próxima
  abertura. Esse caminho não é apresentado como restauração validada na interface.
- Não foram alterados os estados/transações de recuperação, a revisão, as
  validações, a retenção, o bloqueio de mutações ou o fechamento oficial SQLite.
- A inicialização registra a fase (`recovery`, `photos`, `interface`, `ready`).
  Erro de carregamento da interface tem título **“interface indisponível”** e
  orientação correspondente, sem afirmar falha da restauração. Erros de dados
  continuam recusando a abertura segura.
- A exceção original é registrada em `logs/startup-error-<instante>-<UUID>.json`,
  com fase, PID, código, mensagem e stack. Arquivo exclusivo, sem sobrescrever
  evidência anterior; paths pessoais são redigidos. O diálogo continua sanitizado.
  Uma conexão aberta é encerrada no caminho de falha antes de sair do processo.

Novo ensaio sem Angular confirmou `phase=interface`, código original
`ERR_CONNECTION_REFUSED` e o título correto. Não houve relaxamento de CSP,
sandbox, contextIsolation, nodeIntegration, remetente IPC ou permissões.

## Cenário A/B e primeira abertura

O smoke usa serviços oficiais e perfil/banco/imagens/destinos novos:

1. Cria A com compras/custos, vendas, financeiro, correções, auditoria e foto.
2. Faz backup A pela API real do aplicativo e diálogo nativo controlado pelo harness.
3. Cria B: inclui produto exclusivo `BACKUP-B-ONLY`, altera estoque e remove foto.
4. Restaura A pela interface e aguarda a PRIMEIRA reinicialização automática.
5. Exige PID novo, interface carregada, status `restaurado`, gate liberado,
   active correspondente ao plano confirmado, done e ausência de pending.
6. Compara todas as tabelas e `sqlite_sequence` com A; exige ausência do produto B.
7. Extrai/valida a proteção pré-restauração e a compara integralmente com B,
   inclusive sequências e presença do produto exclusivo.
8. Fecha e abre manualmente outra vez: exige novamente **A exato**.
9. Executa uma nova operação oficial; terceira abertura verifica persistência,
   fotografias e exportações. Nenhuma operação comercial é criada por SQL direto.

Não basta ver dados semelhantes nem abrir na segunda tentativa. A primeira
abertura precisa cumprir todos os critérios; qualquer diálogo de erro, falha de
carregamento ou log de erro de startup invalida o smoke.

O modo adicional `--supervised-development` executa o lançador real `scripts/dev.mjs`
com os mesmos passos de `npm.cmd run dev`. Confere que o pai e Angular continuam
ativos após a confirmação e que o PID Electron foi substituído sem sobreposição.
Os outros modos mantêm Electron local, HTTP independente e ASAR offline emulado.

## Verificações e evidências

Três testes novos verificam relaunch independente/empacotado, confirmação do
envio ao supervisor e persistência/redação dos diagnósticos. O recorte específico
passou a incluir esses testes e o fluxo supervisionado real. A suíte geral inicial
deste complemento aprovou **214 testes** (211 anteriores mais três).

A primeira bateria de interface foi interrompida sem saída final; o processo já
não estava ativo ao retomar. Log preservado em
`.cache/5-1-followup-ui-interrupted-1022.log`; não foi classificada como aprovada.
A bateria foi retomada a partir de `test:ui`. A causa da interrupção do harness
não foi estabelecida, portanto não foi atribuída ao produto sem evidência.

**Correção técnica concluída, aguardando validação manual.** Os 19 comandos
registrados abaixo terminaram com saída 0. A última execução geral, após o
protocolo de confirmação do supervisor, aprovou **214 testes**. O recorte contém
**19 grupos** (16 de backup/interrupções e três de ciclo de vida). Testes afetados
foram repetidos após as alterações; o log interrompido não conta como aprovação.

| Ambiente       | Primeira automática | Segunda manual | B exclusivo | Proteção | Erros startup | Arquivos XLSX/PDF |
| -------------- | ------------------- | -------------- | ----------- | -------- | ------------- | ----------------- |
| local          | A exato             | A exato        | ausente     | B exato  | 0             | 16                |
| dev-supervisor | A exato             | A exato        | ausente     | B exato  | 0             | 16                |
| http           | A exato             | A exato        | ausente     | B exato  | 0             | 16                |
| package        | A exato             | A exato        | ausente     | B exato  | 0             | 16                |

Os **64 arquivos** foram reabertos pelos leitores independentes após fechar os
aplicativos. Fotografias, 13 indicadores do Dashboard, tabelas e sequências
foram conferidos. Uma nova operação depois da segunda abertura persistiu na
terceira. ASAR inclui o worker e bibliotecas necessários; a comparação binária
final encontrou **142 arquivos de produção idênticos ao último build**.
Os **41 arquivos originais continuam com SHA-256 inalterado**.

- [Comandos, horários, saídas e logs](evidencias-5-1-reinicio/validacoes.json).
- [PIDs, marcadores A/B e tempos por ambiente](evidencias-5-1-reinicio/ambientes-ab.json).
- [Estado preservado e exceções antes/depois](evidencias-5-1-reinicio/diagnostico.json).
- [Primeira abertura supervisionada](evidencias-5-1-reinicio/primeira-abertura-dev-supervisor.png).
- [Primeira abertura no ASAR](evidencias-5-1-reinicio/primeira-abertura-package.png).

| Comando                                                        | Início (-03, 13/11/2026) | Fim      | Saída | Log                                              |
| -------------------------------------------------------------- | ------------------------ | -------- | ----- | ------------------------------------------------ |
| `npm.cmd run typecheck`                                        | 09:38:04                 | 09:38:11 | 0     | `.cache/5-1-followup-final-typecheck.log`        |
| `npm.cmd run lint`                                             | 09:38:11                 | 09:38:21 | 0     | `.cache/5-1-followup-final-lint.log`             |
| `npm.cmd run format:check`                                     | 09:38:21                 | 09:38:31 | 0     | `.cache/5-1-followup-final-format.log`           |
| `npm.cmd run build`                                            | 09:38:31                 | 09:38:44 | 0     | `.cache/5-1-followup-final-build.log`            |
| `npm.cmd test`                                                 | 09:38:44                 | 09:41:10 | 0     | `.cache/5-1-followup-final-general.log`          |
| `npm.cmd run test:ui`                                          | 10:21:42                 | 10:25:18 | 0     | `.cache/5-1-followup-final-ui.log`               |
| `npm.cmd run test:backup-restauracao`                          | 10:25:19                 | 10:29:10 | 0     | `.cache/5-1-followup-final-backup.log`           |
| `node scripts/backup-restauracao-smoke.mjs --development`      | 10:29:10                 | 10:29:57 | 0     | `.cache/5-1-followup-final-http.log`             |
| `npm.cmd run pack`                                             | 10:29:57                 | 10:31:12 | 0     | `.cache/5-1-followup-final-pack.log`             |
| `node scripts/verify-package.mjs`                              | 10:31:12                 | 10:31:12 | 0     | `.cache/5-1-followup-final-package-verify.log`   |
| `node scripts/backup-restauracao-smoke.mjs --package`          | 10:31:12                 | 10:32:06 | 0     | `.cache/5-1-followup-final-package.log`          |
| `node scripts/smoke.mjs --development`                         | 10:32:06                 | 10:32:19 | 0     | `.cache/5-1-followup-final-desktop-http.log`     |
| `node scripts/smoke.mjs release/win-unpacked/MNR Perfumes.exe` | 10:32:19                 | 10:32:22 | 0     | `.cache/5-1-followup-final-desktop-package.log`  |
| `npm.cmd test`                                                 | 10:32:23                 | 10:34:31 | 0     | `.cache/5-1-followup-confirm-general.log`        |
| `npm.cmd run typecheck`                                        | 10:34:31                 | 10:34:38 | 0     | `.cache/5-1-followup-confirm-typecheck.log`      |
| `npm.cmd run lint`                                             | 10:34:38                 | 10:34:45 | 0     | `.cache/5-1-followup-confirm-lint.log`           |
| `npm.cmd run format:check`                                     | 10:34:45                 | 10:34:54 | 0     | `.cache/5-1-followup-confirm-format.log`         |
| `npm.cmd run build`                                            | 10:34:54                 | 10:35:04 | 0     | `.cache/5-1-followup-confirm-build.log`          |
| `node scripts/verify-package.mjs`                              | 10:35:04                 | 10:35:04 | 0     | `.cache/5-1-followup-confirm-verify-package.log` |

## Arquivos deste complemento

- `electron/main/lifecycle.ts`: coordenação do relaunch e diagnóstico local.
- `electron/main/index.ts`: fase da abertura, classificação e fechamento em falha.
- `scripts/dev.mjs`: supervisão do sucessor mantendo o mesmo Angular.
- `scripts/backup-restauracao-smoke.mjs`: A/B, primeira/segunda/terceira abertura,
  proteção B e modo supervisionado.
- `tests/startup-lifecycle.test.cjs`: três testes novos.
- `package.json`: recorte de backup inclui testes e supervisor real.
- README, relatório inicial da 5.1 e este complemento: instruções/evidências.

Nenhuma dependência nova, migração, regra financeira, cálculo de custo, contrato
comercial ou formato de backup foi modificado.

## Repetição da validação manual

1. Encerre a execução antiga de desenvolvimento e inicie o código atualizado com
   `npm.cmd run dev`, mantendo esse terminal aberto.
2. Para conferir o estado atual já preservado, abra normalmente e consulte
   Configurações → Backup e Restauração, histórico e fotografias. Não apague
   journals/gerações e não repita restauração apenas para corrigir o antigo aviso.
3. Para repetir A/B sem dados reais, use uma sessão PowerShell com perfil novo:

```powershell
$env:MNR_UI_TEST_RUN = 'ui-validacao-51-' + (Get-Date -Format 'yyyyMMddHHmmss')
npm.cmd run dev
```

4. Nesse perfil fictício, crie A e backup A; depois crie o produto “Exclusivo B”.
5. Restaure A e confira a PRIMEIRA abertura automática: interface normal, última
   restauração validada, produto B ausente, dados/fotos de A presentes.
6. Feche normalmente e inicie novamente no mesmo terminal/perfil; confira A de
   novo. Consulte a proteção anterior pelo aplicativo para verificar B, caso
   deseje ensaiar sua recuperação no perfil fictício.
7. Ao terminar o ensaio, remova somente a variável desta sessão, sem apagar dados:

```powershell
Remove-Item Env:MNR_UI_TEST_RUN
```

Para executável, utilize apenas o ambiente isolado de testes ou homologação;
o smoke `node scripts/backup-restauracao-smoke.mjs --package` prepara a raiz
dedicada automaticamente. Não ensaiar substituições no banco real.

Se houver outra falha, preserve o novo `startup-error-*.json` e os arquivos de
recuperação. Fase/código/PID distinguem erro de dados, fotos e interface. Não
apague arquivos para tentar fazer o aplicativo abrir.

Logs ficam em `.local-data/development/logs` no desenvolvimento habitual; em
perfil de teste, `.local-data/test/<perfil>/logs`; no executável, normalmente em
`%LOCALAPPDATA%/MNR Software/MNR Perfumes/logs`.

## Limites

O erro histórico original não foi persistido pelo código antigo; foi recuperada
a exceção equivalente em reprodução isolada do lançador. Não se afirmou que um
arquivo de backup manual não localizado foi comparado integralmente. Os ensaios
A/B fornecem essa prova para arquivos gerados e restaurados sob controle.

SO disponível: Windows 10 19045. Offline é emulado, não desconexão física;
Windows 11 e mídia externa física permanecem no checklist de homologação.
Não foram implementados instalador/Etapa 5.2 ou homologação final/5.3.
Sem commit ou push. Validação manual do proprietário continua necessária.
