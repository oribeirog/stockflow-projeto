# Etapa 4A — Integração segura dos cadastros

Implementação validada em 02/11/2026, Windows 10 build 19045 x64, Node 26.13.0,
Electron 43.8.6 e SQLite 3.53.4. Sem novas dependências. Não houve commit ou push.

## Contratos e limites

`DesktopApi.cadastros` contém somente `produtos`, `marcas`, `categorias`, `clientes`
e `fornecedores`. Cada um expõe:

```ts
listar(consulta: ConsultaCadastro): Promise<ResultadoCadastro<T[]>>;
obter(id: number): Promise<ResultadoCadastro<T>>;
salvar(comando: ComandoCadastro<Entrada>): Promise<ResultadoCadastro<T>>;
```

| Cadastro     | Canais registrados                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------ |
| Produtos     | `cadastros:produtos:listar`, `cadastros:produtos:obter`, `cadastros:produtos:salvar`             |
| Marcas       | `cadastros:marcas:listar`, `cadastros:marcas:obter`, `cadastros:marcas:salvar`                   |
| Categorias   | `cadastros:categorias:listar`, `cadastros:categorias:obter`, `cadastros:categorias:salvar`       |
| Clientes     | `cadastros:clientes:listar`, `cadastros:clientes:obter`, `cadastros:clientes:salvar`             |
| Fornecedores | `cadastros:fornecedores:listar`, `cadastros:fornecedores:obter`, `cadastros:fornecedores:salvar` |

DTOs reutilizados de `shared/catalogos.ts`. Resultado discriminado: sucesso com
`data`, falha com `error.code` e `error.message`. O diagnóstico existente mantém
seu contrato. Canais de histórico de preços, formas de pagamento, estoque,
financeiro, fotos, SQL e filesystem não foram acrescentados.

Listar exige um objeto explícito; `{}` utiliza os padrões existentes: limite 50,
máximo 200 e deslocamento zero. Busca de até 200 caracteres, literal e sem acentos;
produtos pesquisam nome/SKU. Ativo opcional; ordenação por nome/ID. Resultado em
array, sem total, filtros de marca/categoria ou leitura automática de todas as páginas.

Salvar mantém a semântica existente: sem ID cria, com ID atualiza; atualização
completa e opcionais omitidos limpos, exceto ativo. Inativar/reativar usa salvar.
SKU imutável, dinheiro em centavos, volumes em microlitros, referências inativas
e auditoria/histórico continuam sob as regras originais dos serviços.

## Segurança e erros

O main registra somente os 15 canais fixos e o diagnóstico. Cada handler confere
o `webContents` da janela, a identidade do frame principal e sua URL exata, ignorando
apenas o hash. Quantidade de argumentos cadastrais deve ser exatamente um; diagnóstico
continua sem argumentos. Tipos, objetos, campos desconhecidos, tamanhos, IDs e regras
de negócio são validados em runtime pelos validadores existentes. O tipo de cadastro
é fixado no main, nunca recebido do renderer. `undefined` não substitui `{}` na listagem.

O preload expõe apenas funções com canais fixos, sem eventos Electron ou invoke
genérico. Contratos não importam Angular, Node ou Electron. Renderer não importa
SQLite, Node ou filesystem. Context isolation, sandbox, Node desabilitado, CSP,
protocolo local e navegação restrita foram mantidos.

| Código público         | Significado                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `VALIDATION`           | Estrutura, argumento ou valor inválido                           |
| `NOT_FOUND`            | Cadastro ou referência inexistente                               |
| `CONFLICT`             | Duplicidade ou restrição de integridade já agrupada pelo serviço |
| `INACTIVE_REFERENCE`   | Nova associação a classificação inativa                          |
| `IDEMPOTENCY_CONFLICT` | Chave reaproveitada com conteúdo diferente                       |
| `DATABASE_BUSY`        | SQLite ocupado/bloqueado                                         |
| `INTEGRITY`            | SQLite identifica corrupção ou arquivo que não é banco           |
| `INTERNAL_ERROR`       | Falha inesperada                                                 |
| `DESKTOP_UNAVAILABLE`  | API desktop ausente, detectada no Angular                        |
| `IPC_UNAVAILABLE`      | Rejeição de transporte, detectada no Angular                     |

Mensagens vêm de catálogo fixo em português. Códigos de negócio são preservados;
mensagens nativas de exceção não atravessam a API cadastral. Não retornam SQL,
stack, caminho local, documento pessoal ou detalhes internos do Electron.
Remetentes não autorizados são rejeitados antes do serviço. Não se registra o
conteúdo dos comandos nem se recria/repara banco ao falhar.

O serviço original transforma constraints em `CONFLICT`, portanto esta entrega
não promete distinguir duplicidade de outras constraints. Falhas na abertura e
reconciliação continuam impedindo a inicialização antes de disponibilizar o IPC.

## Serviços Angular e idempotência

Cinco serviços injetáveis usam `DesktopService` como acesso único à API. Métodos
`listar`, `obter` e `salvar` são tipados. `novaConsulta()` e `novaGravacao()` criam
controladores por consumidor, sem estado global compartilhado entre futuras telas.

Estados: `inicial`, `carregando`, `sucesso` e `erro`. Consulta vazia é sucesso com
array vazio. Mudança de busca, ativo ou limite reinicia deslocamento; respostas de
consultas anteriores são ignoradas. Isso não cancela o trabalho no processo principal.

Exemplo para uma futura tela:

```ts
const gravacao = produtos.novaGravacao(dadosCompletos, motivo);
const primeiraResposta = await gravacao.executar();
// Se uma repetição for necessária, conservar esta mesma instância:
const respostaRepetida = await gravacao.executar();
```

Cada intenção gera UUID uma única vez, usando `crypto.randomUUID()`, e guarda uma
cópia privada do comando completo. Cada envio clona essa cópia. Alterar o objeto de
entrada após criar a intenção não modifica a repetição. Chamadas simultâneas de
`executar()` compartilham a promise pendente. Não há repetição automática. Alterar
o conteúdo exige criar outra intenção; chamadas diretas a `salvar` devem conservar
o comando completo para repetir. O resultado idempotente é o resultado original
armazenado pelo serviço, podendo ser anterior a alterações posteriores do cadastro.

Nenhuma página de produção importa a entrada de testes ou dispara consultas
cadastrais novas. Componentes, tokens, rotas e telas reservadas foram preservados.

## Testes e evidências

| Verificação                                                      | Resultado                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm.cmd run typecheck`                                          | Aprovado; inclui a entrada de integração                     |
| `npm.cmd run lint`                                               | Aprovado                                                     |
| `npm.cmd run format:check`                                       | Aprovado                                                     |
| `npm.cmd run build`                                              | Aprovado, renderer e Electron/preload                        |
| `npm.cmd test`                                                   | 84 testes aprovados, integração em duas origens e `SMOKE_OK` |
| `npm.cmd run test:cadastros`                                     | `CADASTROS_ANGULAR_OK` em HTTP local e `mnr://app`           |
| `npm.cmd run test:ui`                                            | `DESKTOP_UI_OK`                                              |
| `npm.cmd run pack`                                               | Pacote Windows descompactado gerado                          |
| `node scripts/verify-package.mjs`                                | `PACKAGE_ISOLATION_OK`, seis bundles de produção             |
| `node scripts/smoke.mjs "release/win-unpacked/MNR Perfumes.exe"` | `SMOKE_OK`                                                   |
| Desenvolvimento reiniciado com `MNR_SMOKE=1`                     | `SMOKE_OK`, HTTP real em 127.0.0.1:4200                      |

Oito testes novos em `tests/cadastros-ipc.test.cjs` cobrem os 15 handlers, preload
compilado, registro efetivo com eventos simulados, remetente/frame/URL, aridade,
campos inesperados, IDs/tipos/limites, busca literal, paginação, duplicidade,
referência inativa, idempotência, sanitização e ocupação real por segunda conexão.
Bloqueio não deixa operação provisória; repetir o comando após liberação funciona.

A entrada Angular exclusiva usa os cinco serviços reais, preload compilado,
handlers de produção e SQLite real. Executa criação, consulta, edição,
inativação/reativação, consultas vazias, estados de sucesso/erro/carregamento,
isolamento de consumidores, respostas antigas, transporte rejeitado e ausência da
API desktop. Simula resposta perdida somente na fixture, depois de gravar de verdade;
reenvia exatamente a mesma chave/dados/motivo mesmo após alterar a entrada original.
Confere um único produto, um histórico de preço e uma auditoria por intenção efetiva.

As duas origens verificam contexto seguro e UUID. O smoke da entrada real também
exige `isSecureContext`, presença de `crypto.randomUUID()` e UUID válido, tanto no
desenvolvimento quanto no executável empacotado usando `mnr://app`.

Novos testes de gravação criam diretórios únicos em `.local-data/test`, nunca usam
bancos de produção/desenvolvimento. A fixture Angular é compilada em
`.cache/cadastros-renderer`, sem trocar o entrypoint ou output de produção. O host de
teste usa HTTP loopback e protocolo seguro, aplica CSP e isolamento, sem acrescentar
canais de depuração. O ASAR final foi inspecionado: sem a entrada Angular, scripts,
tests ou cache de integração; sem marcadores da fixture nos bundles distribuídos.

A suíte visual existente foi mantida: nove rotas, foco/seleção/títulos, diagnóstico,
carregamento/falha/repetição, teclado, três dimensões × três zooms, sidebar e protocolo
offline. Como antes, esse teste visual abre o banco de desenvolvimento sem realizar
gravações cadastrais. O smoke da entrada normal usa a base de teste já prevista.

As suítes 3A–3D continuam passando. Diff confirmou ausência de alterações nas
migrações, serviços/domínio comerciais e financeiros, componentes/tokens e páginas.
Schema permanece v4, checksums verificados na abertura. O trigger existente cria
saldo zerado para produto novo; os testes comprovam ausência de movimentos de estoque.

Durante a implementação, foram corrigidos problemas exclusivos do executor de teste:
preservação de Content-Type ao aplicar CSP e manutenção do host entre as duas janelas.
A inspeção ASAR também passou a normalizar separadores de caminho no Windows.
O build exigiu execução autorizada fora da sandbox por restrição de leitura de
diretórios ancestrais. Nenhuma política de segurança do aplicativo foi relaxada.

## Arquivos criados e modificados

Criados:

- `shared/cadastros-ipc.ts`
- `electron/ipc/cadastros.ts`
- `src/app/core/cadastros/base.ts`
- `src/app/core/cadastros/estado.ts`
- `src/app/core/cadastros/produtos.service.ts`
- `src/app/core/cadastros/marcas.service.ts`
- `src/app/core/cadastros/categorias.service.ts`
- `src/app/core/cadastros/clientes.service.ts`
- `src/app/core/cadastros/fornecedores.service.ts`
- `tests/cadastros-ipc.test.cjs`
- `tests/angular/main.ts`
- `scripts/cadastros-desktop.cjs`
- `scripts/cadastros-smoke.mjs`
- `scripts/verify-package.mjs`
- `tsconfig.integration.json`
- `docs/etapa-4A-integracao-cadastros.md`

Modificados:

- `shared/contracts.ts`
- `electron/ipc/index.ts`
- `electron/ipc/trust.ts`
- `electron/preload/index.ts`
- `electron/main/index.ts` (checagem UUID no smoke existente)
- `src/app/core/desktop.service.ts`
- `angular.json`
- `package.json` (scripts; dependências e lockfile intactos)
- `README.md`

## Limitações preservadas

Não há telas completas, fotografias ou consultas cadastrais visíveis ao usuário
nesta etapa. Integração foi preparada e testada separadamente das páginas reservadas.
Consulta não informa total nem garante snapshot entre páginas durante gravações.
Busca literal e OFFSET podem exigir varredura no SQLite em bases grandes, embora
retornem no máximo 200 registros; índices/otimizações futuros exigirão escopo próprio.
Atualizações continuam completas, sem controle otimista de versão. O SQLite síncrono
mantém timeout de cinco segundos e pode bloquear temporariamente o main em contenção.
Windows 11, instalação NSIS e ensaio offline em máquina limpa continuam pendentes.
