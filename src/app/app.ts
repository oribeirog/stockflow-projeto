import { Component } from '@angular/core';
import { Shell } from './core/shell/shell';
@Component({
  selector: 'app-root',
  imports: [Shell],
  template: '<mnr-shell />',
})
export class App {}
