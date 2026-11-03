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
    description: 'Visão geral do aplicativo e do design system.',
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
    description: 'Espaço reservado para o acompanhamento do estoque.',
  },
  {
    path: 'vendas',
    title: 'Vendas',
    icon: 'sales',
    description: 'Espaço reservado para o registro e acompanhamento de vendas.',
  },
  {
    path: 'compras',
    title: 'Compras',
    icon: 'purchases',
    description: 'Espaço reservado para o acompanhamento de compras.',
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
    description: 'Espaço reservado para relatórios do negócio.',
  },
  {
    path: 'configuracoes',
    title: 'Configurações',
    icon: 'settings',
    description: 'Diagnóstico do ambiente desktop local.',
  },
];
export const routes: Routes = [
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
  ...navigation.map((item) => ({
    path: item.path,
    title: `${item.title} • MNR Perfumes`,
    data: { ...item, pessoa: item.path === 'fornecedores' ? 'fornecedor' : 'cliente' },
    loadComponent:
      item.path === 'dashboard'
        ? () => import('../features/dashboard/dashboard').then((m) => m.Dashboard)
        : item.path === 'perfumes'
          ? () => import('../features/perfumes/perfumes').then((m) => m.Perfumes)
          : item.path === 'configuracoes'
            ? () => import('../features/settings/settings').then((m) => m.Settings)
            : ['clientes', 'fornecedores'].includes(item.path)
              ? () => import('../features/pessoas/pessoas').then((m) => m.Pessoas)
              : () => import('../features/module/module').then((m) => m.ModulePage),
  })),
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
