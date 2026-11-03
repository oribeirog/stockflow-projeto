import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from '@angular/router';

@Injectable()
export class MnrRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(
    future: ActivatedRouteSnapshot,
    current: ActivatedRouteSnapshot,
  ): boolean {
    // Recreate editors when the ID/query changes so deactivation guards protect the old intention.
    if (future.data['perfumeEditor'] || current.data['perfumeEditor']) return false;
    return super.shouldReuseRoute(future, current);
  }
}
