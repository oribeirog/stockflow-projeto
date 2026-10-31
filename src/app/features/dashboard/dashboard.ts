import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { navigation } from '../../core/navigation';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { ContentState } from '../../shared/ui/content-state';
import { Field } from '../../shared/ui/field';
import { Icon } from '../../shared/ui/icon';

@Component({
  selector: 'mnr-dashboard',
  imports: [RouterLink, Badge, Button, Card, ContentState, Field, Icon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  readonly modules = navigation.filter(
    (item) => !['dashboard', 'configuracoes'].includes(item.path),
  );
  readonly demoMessage = signal('Nenhuma ação de demonstração executada.');
  readonly example = signal('');
}
