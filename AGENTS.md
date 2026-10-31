# Conven??es do MNR Perfumes

- Aplicativo Windows 10/11 x64, local, de um usu?rio.
- Angular usa somente a API tipada do preload; nunca importa Electron, Node ou SQLite.
- Contratos compartilhados n?o dependem de Angular/Electron. IPC deve validar remetente e entrada.
- Manter contextIsolation e sandbox habilitados e nodeIntegration desabilitado.
- SQLite e filesystem s?o responsabilidade do processo principal. Dados nunca ficam na instala??o.
- N?o criar tabelas comerciais ou migra??es sem escopo aprovado. A pasta de migra??es est? reservada.
- N?o adicionar depend?ncias sem justificar; fixar vers?es e atualizar o lockfile.
- N?o alterar arquivos fora do reposit?rio sem autoriza??o. N?o fazer commit ou push automaticamente.
- Usar npm.cmd no PowerShell. Executar typecheck, lint, format:check, build e teste desktop ap?s mudan?as relevantes.
- Mudan?as no Electron/preload exigem reiniciar `npm.cmd run dev`; Angular tem recarregamento autom?tico.
- Preservar bancos existentes. Nunca recriar banco como tratamento de erro.
