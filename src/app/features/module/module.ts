import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Badge } from '../../shared/ui/badge';
import { Card } from '../../shared/ui/card';
import { ContentState } from '../../shared/ui/content-state';
@Component({
  selector: 'mnr-module-page',
  imports: [Badge, Card, ContentState],
  templateUrl: './module.html',
  styleUrl: './module.scss',
})
export class ModulePage {
  readonly page = toSignal(inject(ActivatedRoute).data);
}
