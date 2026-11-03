import { inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ClientesService } from '../../core/cadastros/clientes.service';
import { FornecedoresService } from '../../core/cadastros/fornecedores.service';

export function contextoPessoa() {
  const clientes = inject(ClientesService);
  const fornecedores = inject(FornecedoresService);
  const fornecedor = inject(ActivatedRoute).snapshot.data['pessoa'] === 'fornecedor';
  return {
    service: fornecedor ? fornecedores : clientes,
    singular: fornecedor ? 'fornecedor' : 'cliente',
    plural: fornecedor ? 'fornecedores' : 'clientes',
    titulo: fornecedor ? 'Fornecedores' : 'Clientes',
    path: fornecedor ? '/fornecedores' : '/clientes',
  };
}
