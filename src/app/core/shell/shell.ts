import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { navigation } from '../navigation';
import { Icon } from '../../shared/ui/icon';

@Component({
  selector: 'mnr-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly injector = inject(Injector);
  readonly navigation = navigation;
  readonly expanded = signal(false);
  readonly current = signal(navigation[0]);
  readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');
  readonly content = viewChild<ElementRef<HTMLElement>>('content');
  readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  toggleNavigation() {
    this.expanded.update((value) => !value);
    afterNextRender(
      () => (this.expanded() ? this.closeButton() : this.menuButton())?.nativeElement.focus(),
      { injector: this.injector },
    );
  }
  closeNavigation() {
    this.expanded.set(false);
    this.menuButton()?.nativeElement.focus();
  }
  leaveNavigation(event: FocusEvent) {
    if (
      event.relatedTarget instanceof Node &&
      !(event.currentTarget as HTMLElement).contains(event.relatedTarget)
    ) {
      this.expanded.set(false);
    }
  }
  constructor() {
    const router = inject(Router);
    router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.current.set(
          navigation.find((item) => '/' + item.path === event.urlAfterRedirects) ?? navigation[0],
        );
        this.expanded.set(false);
        afterNextRender(
          () => {
            this.content()?.nativeElement.scrollTo(0, 0);
            this.heading()?.nativeElement.focus();
          },
          { injector: this.injector },
        );
      }
    });
  }
}
