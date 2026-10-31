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
    description: 'Espaço reservado para o catálogo de perfumes.',
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
    description: 'Espaço reservado para o cadastro de clientes.',
  },
  {
    path: 'fornecedores',
    title: 'Fornecedores',
    icon: 'suppliers',
    description: 'Espaço reservado para o cadastro de fornecedores.',
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
  ...navigation.map((item) => ({
    path: item.path,
    title: `${item.title} • MNR Perfumes`,
    data: item,
    loadComponent:
      item.path === 'dashboard'
        ? () => import('../features/dashboard/dashboard').then((m) => m.Dashboard)
        : item.path === 'configuracoes'
          ? () => import('../features/settings/settings').then((m) => m.Settings)
          : () => import('../features/module/module').then((m) => m.ModulePage),
  })),
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
