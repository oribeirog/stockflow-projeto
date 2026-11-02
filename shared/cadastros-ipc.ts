import type {
  CodigoErroCadastro,
  ComandoCadastro,
  ConsultaCadastro,
  EntradaPessoa,
  EntradaProduto,
  EntradaReferencia,
  Pessoa,
  Produto,
  Referencia,
} from './catalogos';

export type CodigoErroDesktopCadastro =
  | CodigoErroCadastro
  | 'DATABASE_BUSY'
  | 'INTEGRITY'
  | 'INTERNAL_ERROR'
  | 'DESKTOP_UNAVAILABLE'
  | 'IPC_UNAVAILABLE';
export type ResultadoCadastro<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CodigoErroDesktopCadastro; message: string } };
export interface ApiCadastro<T, E> {
  listar(consulta: ConsultaCadastro): Promise<ResultadoCadastro<T[]>>;
  obter(id: number): Promise<ResultadoCadastro<T>>;
  salvar(comando: ComandoCadastro<E>): Promise<ResultadoCadastro<T>>;
}
export interface CadastrosApi {
  produtos: ApiCadastro<Produto, EntradaProduto>;
  marcas: ApiCadastro<Referencia, EntradaReferencia>;
  categorias: ApiCadastro<Referencia, EntradaReferencia>;
  clientes: ApiCadastro<Pessoa, EntradaPessoa>;
  fornecedores: ApiCadastro<Pessoa, EntradaPessoa>;
}
export const CANAIS_CADASTROS = {
  produtos: {
    listar: 'cadastros:produtos:listar',
    obter: 'cadastros:produtos:obter',
    salvar: 'cadastros:produtos:salvar',
  },
  marcas: {
    listar: 'cadastros:marcas:listar',
    obter: 'cadastros:marcas:obter',
    salvar: 'cadastros:marcas:salvar',
  },
  categorias: {
    listar: 'cadastros:categorias:listar',
    obter: 'cadastros:categorias:obter',
    salvar: 'cadastros:categorias:salvar',
  },
  clientes: {
    listar: 'cadastros:clientes:listar',
    obter: 'cadastros:clientes:obter',
    salvar: 'cadastros:clientes:salvar',
  },
  fornecedores: {
    listar: 'cadastros:fornecedores:listar',
    obter: 'cadastros:fornecedores:obter',
    salvar: 'cadastros:fornecedores:salvar',
  },
} as const;
export const MENSAGENS_CADASTRO: Record<CodigoErroDesktopCadastro, string> = {
  VALIDATION: 'Confira os campos e os limites informados.',
  NOT_FOUND: 'Cadastro ou referência não encontrado.',
  CONFLICT: 'Já existe um cadastro com esses identificadores ou há uma restrição de integridade.',
  INACTIVE_REFERENCE: 'Marca ou categoria inativa para uma nova associação.',
  IDEMPOTENCY_CONFLICT: 'Esta chave de operação já foi utilizada com outro conteúdo.',
  DATABASE_BUSY: 'Banco ocupado. Aguarde e tente novamente com o mesmo comando.',
  INTEGRITY: 'Não foi possível concluir por uma falha de integridade. Os dados foram preservados.',
  INTERNAL_ERROR: 'Não foi possível concluir a operação.',
  DESKTOP_UNAVAILABLE: 'Abra pelo aplicativo desktop.',
  IPC_UNAVAILABLE:
    'Não foi possível confirmar a resposta do aplicativo. Para repetir, use o mesmo comando.',
};
