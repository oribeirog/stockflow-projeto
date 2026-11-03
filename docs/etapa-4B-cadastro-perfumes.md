# Etapa 4B — Cadastro e gestão de perfumes

Entrega local para Windows 10/11 x64, implementada após aprovação do planejamento,
da migração 0005 e da infraestrutura de fotografias. Validação nesta máquina:
Windows 10 build 19045, Node 26.13.0 e Electron 43.8.6. Windows 11 e instalação
NSIS não foram executados. Sem dependências novas, commit ou push.

## Interface e fluxos

- A rota Perfumes deixou de usar a página reservada. Listagem real com pesquisa
  por nome/SKU, filtro de ativos/inativos/todos e páginas de 25 registros.
- Consulta 26 registros para identificar próxima página; não apresenta total
  inexistente no contrato. Busca/filtro reinicia a página. Respostas antigas são
  ignoradas. Uma página esvaziada por alterações retorna à anterior.
- Tabela em telas maiores e cartões em telas compactas. Miniaturas somente dos
  produtos apresentados, imagem maior apenas ao ampliar. Tema, tokens, sidebar,
  atalhos de teclado, foco e redução de movimento permanecem preservados.
- Editor em `#/perfumes/novo` e `#/perfumes/:id/editar`, com identificação,
  classificação, apresentação, cadastro comercial, justificativa e fotografia.
- Marca/categoria usam busca, páginas e seleção nativa. Cadastro rápido pelo
  nome usa os serviços existentes. Referência inativa vinculada pode ser mantida;
  novas associações continuam limitadas a referências ativas.
- Edição mantém o SKU somente para leitura. Campos opcionais são enviados
  explicitamente para preservar a semântica de atualização completa da 4A.
- Alterações, inativação e reativação exigem justificativa. A mudança de situação
  obtém os dados atuais, envia comando completo e preserva histórico e fotografia.
- Guardas protegem alterações não salvas e operações sem confirmação. Editores
  não são reutilizados entre IDs, evitando exibir/salvar o produto anterior após
  uma troca direta de rota. Há proteção adicional para recarga/fechamento normal.

Não foram criadas telas ou operações de estoque, compras, vendas ou financeiro.
Estoque mínimo é apenas o parâmetro cadastral existente. O trigger anterior que
cria saldo zerado permanece; cadastrar produto não cria movimento de estoque.

## Valores e intenções de gravação

Campos reais: nome, SKU, código de barras, marca, categoria, volume, concentração,
descrição, preço de venda, estoque mínimo e situação. Não há campos de custo,
saldo disponível ou propriedades comerciais novas.

Os conversores compõem dígitos inteiros: `129,90` torna-se 12990 centavos;
`100,125` mL torna-se 100125 microlitros. Aceitam vírgula ou ponto decimal sem
agrupamento de milhares. Rejeitam casas excedentes, notação exponencial,
valores negativos, limites excedidos e arredondamento implícito.

Limites: preço de zero a 9.000.000.000.000 centavos; volume de 1 a
1.000.000.000 microlitros; estoque mínimo inteiro entre zero e 1.000.000.000.
Os demais limites e regras continuam sendo validados pelo serviço cadastral.

Cada submissão válida cria uma intenção imutável com UUID, conteúdo e motivo.
Duplo envio é bloqueado. Resposta incerta, banco ocupado ou erro inesperado
conservam a intenção para repetição explícita com o mesmo comando. Não há
repetição automática. Erros definitivos permitem correção e nova intenção.
Após confirmação, uma consulta atualiza o produto, pois o resultado idempotente
pode representar um estado anterior.

As intenções permanecem em memória durante a sessão protegida pelas guardas.
Não há recuperação de rascunho/UUID do formulário após encerramento abrupto do
processo. A idempotência já confirmada continua persistida em SQLite.

## Fotografias: contrato e segurança

Uma foto opcional por produto. O main abre o seletor nativo; nenhum caminho
escolhido é recebido do Angular ou devolvido a ele. Cancelamento retorna sucesso
com seleção nula e mantém a fotografia/seleção anterior.

`window.mnrApi.fotos` expõe somente cinco canais fixos:

| Método     | Entrada                                         | Resultado                                                  |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------- |
| selecionar | Sem argumentos                                  | Cancelamento ou token, metadados e miniatura binária       |
| descartar  | Token opaco                                     | Confirmação de descarte da preparação pertencente à janela |
| obter      | Produto e variante `miniatura`/`imagem`         | Ausência ou bytes, MIME e dimensões                        |
| salvar     | Comando idempotente com produto, token e motivo | Identificador do vínculo confirmado                        |
| remover    | Comando idempotente com produto e motivo        | Confirmação de vínculo removido                            |

Todos os canais verificam remetente, frame principal, URL, quantidade de
argumentos e entrada. Erros são sanitizados e usam o catálogo público, incluindo
PHOTO_INVALID, PHOTO_EXPIRED e PHOTO_UNAVAILABLE. Não expõem caminhos, SQL ou stack.
Context isolation e sandbox continuam habilitados; Node permanece desabilitado
no renderer. Contratos compartilhados não importam Angular, Electron ou Node.

São aceitos JPEG/PNG estáticos, até 10 MiB, 24 milhões de pixels e 8192 pixels por
dimensão. A assinatura, estrutura e dimensões são verificadas antes da
decodificação. PNG animado é rejeitado. A decodificação real e recodificação usam
nativeImage no main. Arquivos falsos, vazios, truncados e dimensões incompatíveis
são rejeitados. O tamanho efetivamente lido é limitado, além do stat inicial.

A imagem normalizada tem dimensão máxima de 2048 pixels e até 8 MiB; miniatura
de até 160 pixels e 256 KiB. Não se conserva o original escolhido. Arquivos usam
UUIDs gerados pelo main; tokens são vinculados à janela e expiram em 30 minutos.

Os arquivos ficam em `paths.images`, sob o diretório persistente de dados em
produção, fora da instalação. Não há file://, protocolo genérico, envio de paths
ou imagens base64 nos cadastros. A API retorna bytes; Angular cria URLs blob e
as revoga ao trocar a imagem, fechar a ampliação ou destruir o componente.
A CSP ganhou apenas `blob:` em img-src. Não houve liberação de rede ou scripts.

## Migração 0005 e recuperação de arquivos

Schema v5, sem alterar as migrações 0001–0004:

- `foto_arquivos`: registro dos arquivos administrados, MIME, dimensões,
  tamanhos, hashes SHA-256, datas e estado PREPARADA/PUBLICADA/RETIRADA.
- `produto_fotos`: vínculo único por produto e por fotografia.
- Triggers protegem os metadados, exigem publicação antes do vínculo e impedem
  retirar um arquivo ainda vinculado. O inspetor exige tabelas e proteções da v5.
- Auditoria e resultados idempotentes usam as estruturas anteriores. Produto e
  EntradaProduto não receberam campos de filesystem ou imagens.

O registro de arquivos é necessário para comprovar sua propriedade durante a
limpeza; nome/extensão isolados nunca autorizam exclusão. Arquivos parciais,
desconhecidos, com hash divergente ou estado inconclusivo são preservados para
inspeção. Não há limpeza genérica de diretório.

Na substituição: escrever/sincronizar arquivos preparados; publicar cada arquivo
com nome imutável; verificar ambos; atualizar vínculo, operação e auditoria em
transação SQLite; limpar o anterior somente depois do commit. Até o commit, o
vínculo e os arquivos anteriores continuam válidos. Uma interrupção entre as
publicações permite verificar/reaproveitar o arquivo já publicado na repetição.

Limpeza e reconciliação compartilham a fila de exclusão mútua das gravações e dos
snapshots. A limpeza exige registro conhecido, estado elegível, ausência de
vínculo, arquivo regular, tamanho e hash correspondentes. Referências são
verificadas novamente antes de remover. Falha na limpeza não desfaz o vínculo
novo; a próxima reconciliação pode concluir a retirada com segurança.

Na abertura, a reconciliação detecta imagens vinculadas ausentes/corrompidas e
preserva seus vínculos; a interface informa a falha. Preparações expiradas e
arquivos retirados são limpos quando comprovadamente seguros. Arquivos sem
registro não são apagados. Não existe transação atômica entre SQLite e filesystem;
a ordem de publicação e a recuperação tratam essa limitação explicitamente.

Cadastro e fotografia são operações separadas. Se o cadastro funcionar e a foto
falhar, a tela informa sucesso parcial e conserva a intenção da fotografia.
Repetir sua confirmação não recria nem reenvia o perfume. A consulta do resultado
idempotente ocorre antes de exigir um token que já pode ter sido consumido.

## Snapshot e restauração completos

Infraestrutura interna, sem interface de backup/restauração ao usuário nesta etapa.
O snapshot adquire a mesma fila usada pelas fotografias, realiza backup SQLite
compatível com WAL e abre essa cópia para obter exatamente os vínculos capturados.
Copia somente a imagem e miniatura de cada vínculo, verificando hashes e tamanhos.

O conjunto contém `data/mnr-perfumes.db`, `images/objects/` e `manifest.json` com
identidade do banco, schema, versão do aplicativo, datas, tamanhos e SHA-256.
É validado integralmente e publicado por renomeação do diretório temporário.
Preparações e arquivos retirados não integram o conjunto. Falhas não publicam um
backup como completo; diretórios parciais são preservados, sem exclusão genérica.

A restauração interna exige destino novo. Valida caminhos fechados, duplicidades,
arquivos regulares, hashes, integridade/FKs/schema/identidade do SQLite e a
correspondência exata entre manifesto e vínculos. Copia os arquivos, valida de
novo e publica o diretório. Não usa links nem caminhos para a origem.

Para migrações futuras sobre v5, o backup pré-migração acrescenta um conjunto
completo `pre-migration-*.db.assets/`. O .db e manifesto antigos continuam sendo
gerados por compatibilidade; **o .db isolado não é backup completo das fotografias**.
Em produção a composição passa explicitamente o diretório correto de imagens.
O upgrade inicial de v4 não possui fotografias anteriores para copiar.

## Validação por fases

1. Isolamento do test:ui verificado antes das gravações: raiz única sob
   `.local-data/test/ui-*`, banco, imagens e Chromium próprios. O teste compara
   SHA-256 do banco de desenvolvimento antes/depois. A opção de raiz aceita
   somente identificador fechado e é rejeitada em aplicativo empacotado.
2. Listagem validada com estado vazio, navegação e paginação; posteriormente
   exercitada com 27 produtos, busca e retorno à primeira página.
3. Cadastro, conversores e referências rápidas validados por typecheck, testes
   cadastrais e gravações reais pela interface.
4. Edição, inativação e reativação verificadas contra SQLite real: um produto,
   histórico de preço sem duplicação, nenhum movimento de estoque. Guardas,
   justificativa e SKU somente para leitura exercitados.
5. Fotografias verificadas com interrupções após cada publicação, antes/depois
   do commit, durante limpeza e após recriar o serviço/reconciliar. Testes também
   cobrem corrupção, arquivos desconhecidos, tokens estrangeiros/expirados,
   descarte, remoção idempotente e preservação de bases populadas v1–v4.
6. Integração visual cobre seleção antes do primeiro cadastro, cancelamento, prévia, sucesso parcial após commit com
   resposta perdida, repetição somente da foto, ampliação/Escape, liberação de
   todas as URLs blob e limite de 25 solicitações de miniatura na página.
   A integração Angular também verifica que uma leitura atrasada anterior à
   substituição não é reaproveitada nem remove a requisição da fotografia atual.
7. Snapshot testado com substituição concorrente enfileirada durante a captura.
   A restauração é aberta somente depois de tornar indisponíveis tanto a pasta
   original de imagens quanto a pasta do backup, comprovando sua independência.
   Testes rejeitam corrupção, traversal, destino existente e cópia incompleta.

Suíte: 102 testes automatizados, incluindo Electron real; integração Angular em
HTTP loopback e mnr://app; interface com 3 dimensões × 3 zooms (100/125/150%).
Capturas sob `.cache/ui/`: listagem, linhas compactas, editor, fotografia,
validação, sucesso parcial e fotografia offline. Foram inspecionadas visualmente;
o alinhamento de nome/SKU no cartão compacto foi corrigido após a inspeção.

Os testes simulam respostas perdidas apenas no processo de teste. Mensagens de
erro correspondentes no terminal são esperadas e verificadas pela repetição com
o mesmo comando. Fixtures, seletores simulados e interceptações de IPC ficam nos
scripts de teste, fora do pacote. Os pontos internos de injeção de falha do serviço
não têm IPC nem configuração pelo renderer; a composição de produção não fornece
esses callbacks.

## Arquivos criados e modificados

Criados:

- `electron/infrastructure/database/migrations/0005-fotografias.ts`
- `electron/ipc/fotos.ts`
- `electron/services/foto-validation.ts`, `foto-codec.ts`, `fotos.ts`, `media-snapshot.ts`
- `shared/fotos.ts`, `shared/perfume-values.ts`
- `src/app/core/cadastros/fotos.service.ts`, `src/app/core/route-reuse.ts`
- `src/app/features/perfumes/perfumes.ts`, `perfumes.html`, `perfumes.scss`
- `src/app/features/perfumes/editor.ts`, `editor.html`, `editor.scss`
- `src/app/features/perfumes/photo.ts`, `photo-editor.ts`
- `src/app/shared/ui/reference-picker.ts`, `src/app/shared/ui/confirm.ts`
- `scripts/fotos-runtime.cjs`
- `tests/fotos.test.cjs`, `tests/fotos-runtime.test.cjs`, `tests/perfume-values.test.cjs`
- Este relatório.

Modificados:

- Banco: `electron/infrastructure/database/index.ts`, `migrate.ts`.
- Composição/segurança: `electron/infrastructure/paths/index.ts`, `electron/main/index.ts`,
  `electron/preload/index.ts`, `electron/ipc/index.ts`, `electron/ipc/cadastros.ts`.
- Contratos: `shared/contracts.ts`, `shared/cadastros-ipc.ts`.
- Angular: `src/main.ts`, `src/app/core/navigation.ts`, `desktop.service.ts`,
  `src/app/core/shell/shell.ts`, `src/app/shared/ui/field.ts`, `field.html`, `field.scss`.
- Executores: `scripts/ui-smoke.mjs`, `ui-desktop.cjs`, `cadastros-desktop.cjs`,
  `database-runtime.cjs`; expectativas de schema nos testes cadastrais, de banco,
  migrações e migrações financeiras; `tests/angular/main.ts` cobre a corrida de
  leitura/substituição de fotografia. Nenhuma regra financeira foi modificada.
- README.md.

## Limitações preservadas

- Não há interface de backup/restauração, galeria, recorte manual ou armazenamento
  da fotografia original. O histórico registra os IDs das substituições, não uma
  galeria permanente das imagens retiradas.
- A reconciliação de imagens verifica arquivos/hashes; seu custo cresce com a
  quantidade e tamanho dos arquivos. SQLite e decodificação limitada continuam
  no main. Não foi introduzido processamento paralelo ou dependência de imagens.
- Paginação OFFSET não garante snapshot entre páginas enquanto o catálogo muda.
  Não há controle otimista de versão cadastral, conforme a 4A.
- Atualizações preservam imagens por estarem fora da instalação. Ensaio de
  instalação/atualização NSIS e máquina limpa offline permanecem externos.
- Windows 11 não foi validado. Falha elétrica real, disco defeituoso e terminação
  do sistema operacional não são reproduzidos pelos hooks determinísticos de
  interrupção; integridade e recuperação foram exercitadas em software.
- Schema v5 não deve ser aberto por versões antigas. Nunca recriar o banco como
  recuperação de erro; preservar dados e usar o conjunto consistente de backup.

## Verificações finais

| Verificação                                  | Resultado                                                  |
| -------------------------------------------- | ---------------------------------------------------------- |
| `npm.cmd run typecheck`                      | Aprovado                                                   |
| `npm.cmd run lint`                           | Aprovado                                                   |
| `npm.cmd run format:check`                   | Aprovado                                                   |
| `npm.cmd run build`                          | Aprovado, incluindo Electron/preload                       |
| `npm.cmd test`                               | 102 testes aprovados, integração cadastral e smoke desktop |
| `npm.cmd run test:cadastros`                 | Aprovado dentro da suíte completa, HTTP e mnr://app        |
| `npm.cmd run test:ui`                        | DESKTOP_UI_OK, gravações isoladas e capturas verificadas   |
| `npm.cmd run pack`                           | Pacote Windows x64 gerado                                  |
| `node scripts/verify-package.mjs`            | PACKAGE_ISOLATION_OK, 13 bundles de produção               |
| Smoke do executável empacotado               | SMOKE_OK e PERFUMES_OFFLINE_OK                             |
| Desenvolvimento reiniciado com `MNR_SMOKE=1` | SMOKE_OK e PERFUMES_DEVELOPMENT_OK                         |
| `git diff --check`                           | Aprovado                                                   |

Na verificação final de arquivos, migrações 0001–0004, serviço cadastral do main,
serviços comerciais/financeiros/estoque, package.json e lockfile permaneceram sem alterações.
Os ajustes nos testes anteriores limitam-se à nova versão de schema, API de
fotografias, isolamento e novos cenários. Não houve alteração de regras comerciais.

O teste nativo de fotografias inicialmente encontrou restrição ACL da sandbox de
automação do Windows ao abrir o Electron. Foi repetido com execução autorizada;
nenhuma ACL do Windows ou configuração de sandbox do aplicativo foi alterada.
O ensaio offline do pacote usa rede emulada indisponível no Chromium e protocolo
local; não substitui o ensaio de instalação em máquina limpa.
