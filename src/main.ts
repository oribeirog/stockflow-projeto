import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { provideRouter, withHashLocation, RouteReuseStrategy } from '@angular/router';
import { MnrRouteReuseStrategy } from './app/core/route-reuse';
import { routes } from './app/core/navigation';
bootstrapApplication(App, {
  providers: [
    provideRouter(routes, withHashLocation()),
    { provide: RouteReuseStrategy, useClass: MnrRouteReuseStrategy },
  ],
}).catch(console.error);
