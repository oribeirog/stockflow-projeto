import type { EntradaPessoa, Pessoa } from '../../../../shared/catalogos';
import { documentoCanonico } from '../../../../shared/pessoa-values';

export const camposPessoa = [
  { key: 'nome', label: 'Nome', max: 200, required: true },
  { key: 'documento', label: 'CPF ou CNPJ', max: 40 },
  { key: 'telefone', label: 'Telefone', max: 40 },
  { key: 'email', label: 'E-mail', max: 254 },
  { key: 'endereco', label: 'Endereço', max: 4000, multiline: true },
  { key: 'observacoes', label: 'Observações', max: 4000, multiline: true },
] as const;
export type CampoPessoa = (typeof camposPessoa)[number]['key'];
export type FormularioPessoa = Record<CampoPessoa | 'tipoPessoa' | 'motivo', string>;
export const textoInvalido = (value: string, max: number, required = false) => {
  const normalized = value.trim().normalize('NFC');
  return (
    (required && !normalized) ||
    normalized.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
  );
};

export function formularioPessoa(p?: Pessoa): FormularioPessoa {
  return {
    nome: p?.nome ?? '',
    tipoPessoa: p?.tipoPessoa ?? '',
    documento: p?.documento ?? '',
    telefone: p?.telefone ?? '',
    email: p?.email ?? '',
    endereco: p?.endereco ?? '',
    observacoes: p?.observacoes ?? '',
    motivo: '',
  };
}

// Updates are full replacements: every optional field is deliberately included.
export function entradaPessoa(p: Pessoa): EntradaPessoa {
  return {
    id: p.id,
    nome: p.nome,
    ativo: p.ativo,
    tipoPessoa: p.tipoPessoa,
    documento: p.documento,
    telefone: p.telefone,
    email: p.email,
    endereco: p.endereco,
    observacoes: p.observacoes,
  };
}

export function validarPessoa(f: FormularioPessoa, pessoa: Pessoa | null) {
  const errors: Record<string, string> = {};
  for (const field of camposPessoa) {
    if (textoInvalido(f[field.key], field.max, field.key === 'nome'))
      errors[field.key] =
        `Confira este campo (até ${field.max.toLocaleString('pt-BR')} caracteres).`;
  }
  if (!f.nome.normalize('NFD').replace(/\p{M}/gu, '').trim()) errors['nome'] = 'Informe um nome.';
  const tipoPessoa = f.tipoPessoa === '' ? null : f.tipoPessoa;
  if (tipoPessoa !== null && tipoPessoa !== 'PF' && tipoPessoa !== 'PJ')
    errors['tipoPessoa'] = 'Selecione PF, PJ ou não informado.';
  const optional = (key: CampoPessoa) => f[key].trim().normalize('NFC') || null;
  let documento = optional('documento');
  if (!errors['documento'] && !errors['tipoPessoa']) {
    try {
      documento = documentoCanonico(documento, tipoPessoa as 'PF' | 'PJ' | null);
    } catch {
      if (!tipoPessoa) errors['tipoPessoa'] = 'Selecione PF ou PJ para informar um documento.';
      else
        errors['documento'] =
          `Informe um ${tipoPessoa === 'PF' ? 'CPF' : 'CNPJ'} válido ou deixe vazio.`;
    }
  }
  const email = optional('email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors['email'] = 'Informe um e-mail válido ou deixe vazio.';
  if (pessoa && textoInvalido(f.motivo, 4000, true))
    errors['motivo'] = 'Informe a justificativa da alteração (até 4.000 caracteres).';
  const dados: EntradaPessoa = {
    id: pessoa?.id,
    nome: f.nome.trim().normalize('NFC'),
    tipoPessoa: tipoPessoa as 'PF' | 'PJ' | null,
    documento,
    telefone: optional('telefone'),
    email,
    endereco: optional('endereco'),
    observacoes: optional('observacoes'),
    ativo: pessoa?.ativo ?? true,
  };
  return { errors, dados };
}
