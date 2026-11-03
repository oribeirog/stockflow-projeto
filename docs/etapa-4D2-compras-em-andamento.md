# Etapa 4D.2 — Compras de fornecedores

Compras oferece listagem filtrada, rascunhos versionados, revisão oficial,
pagamentos múltiplos, confirmação com entrada em estoque e descarte lógico.
Formas de pagamento são configuradas pelo proprietário, sem sementes. Compras
confirmadas e descartadas apresentam histórico somente para leitura.

O renderer usa cinco canais restritos a compras e três canais cadastrais de formas
de pagamento. O processo principal fixa o tipo e reutiliza os serviços existentes.
As migrações 0001–0005 foram preservadas. Intenções idempotentes em memória permitem
repetir o mesmo comando após resposta perdida; encerramento abrupto não recupera
automaticamente a intenção.

## Validação

Em Windows 10 build 19045, após recuperação do teste interrompido por falta de
espaço: typecheck, lint, format:check, build, `npm.cmd test`, `npm.cmd run test:ui`,
empacotamento limpo e verificação do ASAR passaram. O pacote anterior incompleto
foi removido antes da geração. O smoke padrão do executável também passou.

O teste `scripts/compras-ui-smoke.mjs` passou com Electron, preload e IPC reais,
SQLite isolado e origens `mnr://` e HTTP de desenvolvimento. Cobriu primeira forma
em banco vazio, inativação/reativação, dois perfumes, descontos, frete, despesas,
rateios, pagamentos múltiplos, revisão invalidada, versão concorrente, descarte,
estoque, custo histórico e resposta perdida seguida de repetição idêntica offline.
A falha de resposta é injetada somente no processo de teste.

O teste externo `scripts/compras-package-smoke.mjs` passou no executável Windows
com ASAR e handlers reais: primeira forma, revisão e confirmação offline pela
interface, saldo atualizado e repetição de comandos idempotentes por IPC. Não
substitui handlers nem acrescenta canais ao pacote.

As capturas de três tamanhos e três níveis de zoom foram inspecionadas em conjunto.
O ensaio verifica foco inicial no diálogo de formas, Tab, Shift+Tab, Enter, Escape,
retorno de foco, associação de erro aos campos e bloqueio de navegação com alterações
pendentes. As capturas abrangem regiões visíveis, não cada posição de rolagem.

Windows 11, instalação NSIS e máquina limpa fisicamente offline não foram testados.
A rede offline foi emulada; o pacote não está assinado. O teste visual existente
apresentou falha intermitente de navegação em Perfumes numa execução anterior,
mas passou na repetição e na execução final. O build informa aviso Angular sobre
importação RouterLink não utilizada. Não foram feitos commit ou push.
