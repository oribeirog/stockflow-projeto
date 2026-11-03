import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from '@angular/router';

@Injectable()
export class MnrRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(
    future: ActivatedRouteSnapshot,
    current: ActivatedRouteSnapshot,
  ): boolean {
    if (future.data['financeiroConsulta'] || current.data['financeiroConsulta']) return false;
    if (future.data['vendaEditor'] || current.data['vendaEditor']) return false;
    if (future.data['compraEditor'] || current.data['compraEditor']) return false;
    if (future.data['formasEditor'] || current.data['formasEditor']) return false;
    // Recreate editors when the ID/query changes so deactivation guards protect the old intention.
    if (future.data['perfumeEditor'] || current.data['perfumeEditor']) return false;
    if (future.data['pessoaEditor'] || current.data['pessoaEditor']) return false;
    if (future.data['estoqueEditor'] || current.data['estoqueEditor']) return false;
    return super.shouldReuseRoute(future, current);
  }
}
