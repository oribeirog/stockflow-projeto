import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app/core/navigation';
bootstrapApplication(App, { providers: [provideRouter(routes, withHashLocation())] }).catch(
  console.error,
);
