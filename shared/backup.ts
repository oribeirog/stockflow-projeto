import type { Result } from './contracts';
export interface BackupSummary {
  criadoEm: string;
  formato: 1;
  schema: number;
  versaoAplicativo: string;
  produtos: number;
  clientes: number;
  fornecedores: number;
  vendas: number;
  compras: number;
  fotografias: number;
  bytes: number;
}
export interface BackupReview extends BackupSummary {
  token: string;
}
export interface BackupStatus {
  ocupado: boolean;
  fase: string;
  bloqueado: boolean;
  resultado?: { situacao: 'restaurado' | 'recuperado'; criadoEm: string; protecao: string };
  protecoes: number;
  aviso?: string;
}
export interface BackupApi {
  estado(): Promise<Result<BackupStatus>>;
  criar(): Promise<Result<null | { nome: string; criadoEm: string; bytes: number }>>;
  selecionar(): Promise<Result<BackupReview | null>>;
  descartar(input: { token: string }): Promise<Result<null>>;
  restaurar(input: {
    token: string;
    confirmacao: 'RESTAURAR';
  }): Promise<Result<{ reiniciando: true }>>;
  abrirProtecoes(): Promise<Result<null>>;
}
export const CANAIS_BACKUP = {
  estado: 'backup:estado',
  criar: 'backup:criar',
  selecionar: 'backup:selecionar',
  descartar: 'backup:descartar',
  restaurar: 'backup:restaurar',
  abrirProtecoes: 'backup:abrir-protecoes',
} as const;
