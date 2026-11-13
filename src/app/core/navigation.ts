import { Routes } from '@angular/router';
import { IconName } from '../shared/ui/icon';

export const navigation: readonly {
  path: string;
  title: string;
  icon: IconName;
  description: string;
}[] = [
  {
    path: 'dashboard',
    title: 'Dashboard',
    icon: 'dashboard',
    description: 'Indicadores comerciais, financeiros e posição atual de estoque.',
  },
  {
    path: 'perfumes',
    title: 'Perfumes',
    icon: 'perfumes',
    description: 'Cadastro e gestão do catálogo de perfumes.',
  },
  {
    path: 'estoque',
    title: 'Estoque',
    icon: 'stock',
    description: 'Saldos, movimentações e ajustes de estoque.',
  },
  {
    path: 'vendas',
    title: 'Vendas',
    icon: 'sales',
    description: 'Registro, confirmação e histórico de vendas.',
  },
  {
    path: 'financeiro',
    title: 'Financeiro',
    icon: 'finance',
    description: 'Contas a receber, movimentos e obrigações de reembolso.',
  },
  {
    path: 'compras',
    title: 'Compras',
    icon: 'purchases',
    description: 'Compras, devoluções a fornecedores e cancelamentos elegíveis.',
  },
  {
    path: 'clientes',
    title: 'Clientes',
    icon: 'clients',
    description: 'Cadastro e gestão de clientes.',
  },
  {
    path: 'fornecedores',
    title: 'Fornecedores',
    icon: 'suppliers',
    description: 'Cadastro e gestão de fornecedores.',
  },
  {
    path: 'relatorios',
    title: 'Relatórios',
    icon: 'reports',
    description: 'Relatórios oficiais e exportações Excel/PDF offline.',
  },
  {
    path: 'configuracoes',
    title: 'Configurações',
    icon: 'settings',
    description: 'Diagnóstico do ambiente desktop local.',
  },
];
export const routes: Routes = [
  ...['devolver', 'cancelar'].map((action) => ({
    path: `compras/:id/${action}`,
    title: 'Correções de Compras • MNR Perfumes',
    data: { compraEditor: true, cancelamento: action === 'cancelar' },
    loadComponent: () => import('../features/compras/correcao').then((m) => m.CorrecaoCompra),
    canDeactivate: [(c: { canLeave(): boolean | Promise<boolean> }) => c.canLeave()],
  })),
  {
    path: 'compras/:id/correcoes',
    title: 'Histórico de Compras • MNR Perfumes',
    data: { compraEditor: true },
    loadComponent: () => import('../features/compras/correcoes').then((m) => m.CompraCorrecoes),
  },
  {
    path: 'relatorios',
    title: 'Relatórios • MNR Perfumes',
    loadComponent: () => import('../features/relatorios/relatorios').then((m) => m.Relatorios),
    canDeactivate: [(c: { canLeave(): boolean }) => c.canLeave()],
  },
  ...[
    ['financeiro/reembolsos/:id/pagar', 'pagar'],
    ['financeiro/vendas/:vendaId/movimentos/:id/estornar', 'movimento'],
    ['vendas/correcoes/:id/estornar', 'devolucao'],
  ].map(([path, operacaoFinanceira]) => ({
    path,
    title: 'Reembolsos e Estornos • MNR Perfumes',
    data: { financeiroConsulta: true, operacaoFinanceira },
    loadComponent: () =>
      import('../features/financeiro/operacao').then((m) => m.OperacaoFinanceira),
    canDeactivate: [(c: { canLeave(): boolean | Promise<boolean> }) => c.canLeave()],
  })),
  ...['devolver', 'cancelar'].map((action) => ({
    path: `vendas/:id/${action}`,
    title: 'Correções de Vendas • MNR Perfumes',
    data: { vendaEditor: true, cancelamento: action === 'cancelar' },
    loadComponent: () => import('../features/vendas/correcao').then((m) => m.CorrecaoVenda),
    canDeactivate: [(c: { canLeave(): boolean | Promise<boolean> }) => c.canLeave()],
  })),
  {
    path: 'financeiro/vendas/:id/receber',
    title: 'Recebimentos • MNR Perfumes',
    data: { financeiroConsulta: true },
    loadComponent: () => import('../features/financeiro/receber').then((m) => m.Receber),
    canDeactivate: [(c: { canLeave(): boolean | Promise<boolean> }) => c.canLeave()],
  },
  { path: 'financeiro', pathMatch: 'full', redirectTo: 'financeiro/parcelas' },
  ...['parcelas', 'reembolsos'].map((kind) => ({
    path: `financeiro/${kind}`,
    title: 'Financeiro • MNR Perfumes',
    data: { financeiroTipo: kind, financeiroConsulta: true },
    loadComponent: () => import('../features/financeiro/lista').then((m) => m.FinanceiroLista),
  })),
  ...[
    ['financeiro/parcelas/:id', 'parcela'],
    ['financeiro/reembolsos/:id', 'reembolso'],
    ['financeiro/vendas/:vendaId/movimentos/:id', 'movimento'],
    ['financeiro/vendas/:id', 'venda'],
    ['vendas/correcoes/:id', 'correcao'],
  ].map(([path, kind]) => ({
    path,
    title: 'Financeiro • MNR Perfumes',
    data: { financeiroTipo: kind, financeiroConsulta: true },
    loadComponent: () => import('../features/financeiro/detalhe').then((m) => m.FinanceiroDetalhe),
  })),
  ...['vendas/nova', 'vendas/:id'].map((path) => ({
    path,
    title: 'Vendas ? MNR Perfumes',
    data: { vendaEditor: true },
    loadComponent: () => import('../features/vendas/editor').then((m) => m.VendaEditor),
    canDeactivate: [
      (component: { canLeave(): boolean | Promise<boolean> }) => component.canLeave(),
    ],
  })),
  {
    path: 'configuracoes/formas-pagamento',
    title: 'Configurações • MNR Perfumes',
    data: { formasEditor: true },
    loadComponent: () => import('../features/compras/formas').then((m) => m.FormasPagamento),
    canDeactivate: [(component: { canLeave(): boolean }) => component.canLeave()],
  },
  ...['compras/nova', 'compras/:id'].map((path) => ({
    path,
    title: 'Compras • MNR Perfumes',
    data: { compraEditor: true },
    loadComponent: () => import('../features/compras/editor').then((m) => m.CompraEditor),
    canDeactivate: [
      (component: { canLeave(): boolean | Promise<boolean> }) => component.canLeave(),
    ],
  })),
  {
    path: 'estoque/:id',
    title: 'Estoque • MNR Perfumes',
    data: { estoqueEditor: true },
    loadComponent: () => import('../features/estoque/detalhe').then((m) => m.EstoqueDetalhe),
    canDeactivate: [
      (component: { canLeave(): boolean | Promise<boolean> }) => component.canLeave(),
    ],
  },
  ...(['clientes', 'fornecedores'] as const).flatMap((path) =>
    ['novo', ':id/editar'].map((suffix) => ({
      path: `${path}/${suffix}`,
      title: `${path === 'clientes' ? 'Clientes' : 'Fornecedores'} • MNR Perfumes`,
      data: { pessoaEditor: true, pessoa: path === 'clientes' ? 'cliente' : 'fornecedor' },
      loadComponent: () => import('../features/pessoas/editor').then((m) => m.PessoaEditor),
      canDeactivate: [
        (component: { canLeave(): boolean | Promise<boolean> }) => component.canLeave(),
      ],
    })),
  ),
  ...['perfumes/novo', 'perfumes/:id/editar'].map((path) => ({
    path,
    title: 'Perfumes • MNR Perfumes',
    data: { perfumeEditor: true },
    loadComponent: () => import('../features/perfumes/editor').then((m) => m.PerfumeEditor),
    canDeactivate: [
      (component: { canLeave(): boolean | Promise<boolean> }) => component.canLeave(),
    ],
  })),
  ...navigation
    .filter((item) => !['financeiro', 'relatorios'].includes(item.path))
    .map((item) => ({
      path: item.path,
      title: `${item.title} • MNR Perfumes`,
      data: { ...item, pessoa: item.path === 'fornecedores' ? 'fornecedor' : 'cliente' },
      loadComponent:
        item.path === 'dashboard'
          ? () => import('../features/dashboard/dashboard').then((m) => m.Dashboard)
          : item.path === 'perfumes'
            ? () => import('../features/perfumes/perfumes').then((m) => m.Perfumes)
            : item.path === 'estoque'
              ? () => import('../features/estoque/estoque').then((m) => m.Estoque)
              : item.path === 'configuracoes'
                ? () => import('../features/settings/settings').then((m) => m.Settings)
                : item.path === 'vendas'
                  ? () => import('../features/vendas/lista').then((m) => m.Vendas)
                  : item.path === 'compras'
                    ? () => import('../features/compras/lista').then((m) => m.Compras)
                    : ['clientes', 'fornecedores'].includes(item.path)
                      ? () => import('../features/pessoas/pessoas').then((m) => m.Pessoas)
                      : () => import('../features/module/module').then((m) => m.ModulePage),
    })),
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
