import type { ComandoCadastro } from './catalogos';
import type { ResultadoCadastro } from './cadastros-ipc';
export interface ImagemFoto {
  fotoId: string;
  mime: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  largura: number;
  altura: number;
}
export interface PreparacaoFoto {
  token: string;
  previa: ImagemFoto;
}
export interface EntradaFoto {
  produtoId: number;
  token: string;
}
export interface VinculoFoto {
  produtoId: number;
  fotoId: string | null;
}
export interface FotosApi {
  selecionar(): Promise<ResultadoCadastro<PreparacaoFoto | null>>;
  descartar(token: string): Promise<ResultadoCadastro<null>>;
  obter(entrada: {
    produtoId: number;
    variante: 'miniatura' | 'imagem';
  }): Promise<ResultadoCadastro<ImagemFoto | null>>;
  salvar(comando: ComandoCadastro<EntradaFoto>): Promise<ResultadoCadastro<VinculoFoto>>;
  remover(comando: ComandoCadastro<{ produtoId: number }>): Promise<ResultadoCadastro<VinculoFoto>>;
}
export const CANAIS_FOTOS = {
  selecionar: 'fotos:selecionar',
  descartar: 'fotos:descartar',
  obter: 'fotos:obter',
  salvar: 'fotos:salvar',
  remover: 'fotos:remover',
} as const;
