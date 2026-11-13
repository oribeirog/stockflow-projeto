import type Database from 'better-sqlite3';
import { ComercialError } from './comercial';
import { identifier, integer, record } from './catalog-validation';
import { effectiveDate } from './estoque-validation';
import { somar } from '../domain/comercial';
import { reversaoAcumulada } from '../domain/correcoes';
import { custoSaida } from '../domain/custeio';
import { aplicarMovimentoNaTransacao } from './estoque';
import {
  comandoFinanceiro,
  one,
  many,
  total,
  lista,
  pagamentos,
  reject,
  inserirDinheiro,
  estornarMovimento,
  parcelasFinanceiras,
  resumoFinanceiro,
  validarFormaAtiva,
  type MovimentoFinanceiro,
} from './financeiro';
import type { PagamentoFinanceiro } from '../../shared/financeiro';
import type { NaturezaEstoque } from '../../shared/estoque';

interface Documento {
  id: number;
  numero: string;
  tipo: string;
  estado: string;
  versao: number;
  cliente_id: number | null;
  fornecedor_id: number | null;
  contraparte_nome: string | null;
  contraparte_documento: string | null;
  modalidade_venda: string | null;
  data_comercial: string;
  total_centavos: number;
  documento_origem_id: number | null;
  operacao_confirmacao_id: string;
}
interface Item {
  id: number;
  documento_id: number;
  sequencia: number;
  produto_id: number;
  sku_historico: string;
  descricao_historica: string;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_bruto_centavos: number;
  desconto_item_centavos: number;
  desconto_global_rateado_centavos: number;
  frete_rateado_centavos: number;
  despesas_rateadas_centavos: number;
  valor_liquido_centavos: number;
  valor_custo_estoque_centavos: number;
  quantidade_perda: number;
}
interface Movimento {
  id: number;
  produto_id: number;
  quantidade_delta: number;
  valor_delta_centavos: number;
  natureza: string;
  versao_apos: number;
}
interface Dados {
  documentoId: number;
  dataEfetiva: string;
  itens?: { itemId: number; quantidade: number; quantidadePerda: number }[];
  pagamentos: PagamentoFinanceiro[];
}
export function createCorrectionService(
  db: Database.Database,
  appVersion: string,
  clock: () => Date = () => new Date(),
) {
  function documento(id: number): Documento {
    const d = one<Documento>(db, 'SELECT * FROM documentos WHERE id=?', id);
    if (!d) throw new ComercialError('NOT_FOUND', 'Documento inexistente.');
    return d;
  }
  const itens = (id: number) =>
    many<Item>(db, 'SELECT * FROM itens_documento WHERE documento_id=? ORDER BY sequencia', id);
  function normalize(raw: unknown, now: Date, returns: boolean): Dados {
    const v = record(
      raw,
      returns
        ? ['documentoId', 'dataEfetiva', 'itens', 'pagamentos']
        : ['documentoId', 'dataEfetiva'],
    );
    const result: Dados = {
      documentoId: identifier(v['documentoId']),
      dataEfetiva: effectiveDate(v['dataEfetiva'], now),
      pagamentos: returns ? pagamentos(v['pagamentos'] ?? []) : [],
    };
    if (returns) {
      result.itens = lista(v['itens']).map((raw) => {
        const i = record(raw, ['itemId', 'quantidade', 'quantidadePerda']);
        return {
          itemId: identifier(i['itemId']),
          quantidade: integer(i['quantidade'], 'quantidade', 1, 1_000_000_000),
          quantidadePerda: integer(i['quantidadePerda'] ?? 0, 'quantidadePerda', 0, 1_000_000_000),
        };
      });
      if (
        !result.itens.length ||
        new Set(result.itens.map((i) => i.itemId)).size !== result.itens.length
      )
        reject('Itens vazios ou repetidos.');
    }
    return result;
  }
  function createDocument(
    origin: Documento,
    tipo: string,
    data: string,
    op: string,
    now: string,
    reason: string,
  ): number {
    const next = one<{ id: number }>(
      db,
      "SELECT coalesce((SELECT seq FROM sqlite_sequence WHERE name='documentos'),0)+1 id",
    )!.id;
    return Number(
      db
        .prepare(
          `INSERT INTO documentos(numero,tipo,estado,versao,cliente_id,fornecedor_id,contraparte_nome,contraparte_documento,modalidade_venda,data_comercial,subtotal_centavos,desconto_itens_centavos,desconto_global_centavos,frete_centavos,despesas_diretas_centavos,total_centavos,observacoes,criado_em,documento_origem_id) VALUES (?,?,'RASCUNHO',1,?,?,?,?,?,?,0,0,0,0,0,0,?,?,?)`,
        )
        .run(
          `${tipo}-${next}`,
          tipo,
          origin.cliente_id,
          origin.fornecedor_id,
          origin.contraparte_nome,
          origin.contraparte_documento,
          origin.modalidade_venda,
          data,
          reason,
          now,
          origin.id,
        ).lastInsertRowid,
    );
  }
  function prepareDocument(id: number, op: string) {
    db.prepare('UPDATE documentos SET operacao_confirmacao_id=?,versao=versao+1 WHERE id=?').run(
      op,
      id,
    );
  }
  function finish(id: number, now: string) {
    const rows = itens(id),
      sum = (key: keyof Item) => somar(rows.map((i) => i[key] as number));
    db.prepare(
      `UPDATE documentos SET subtotal_centavos=?,desconto_itens_centavos=?,desconto_global_centavos=?,frete_centavos=?,despesas_diretas_centavos=?,total_centavos=?,versao=versao+1 WHERE id=?`,
    ).run(
      sum('valor_bruto_centavos'),
      sum('desconto_item_centavos'),
      sum('desconto_global_rateado_centavos'),
      sum('frete_rateado_centavos'),
      sum('despesas_rateadas_centavos'),
      somar([
        sum('valor_liquido_centavos'),
        sum('frete_rateado_centavos'),
        sum('despesas_rateadas_centavos'),
      ]),
      id,
    );
    db.prepare(
      "UPDATE documentos SET estado='CONFIRMADO',confirmado_em=?,versao=versao+1 WHERE id=?",
    ).run(now, id);
  }
  function stock(
    itemId: number,
    origin: Movimento,
    natureza: NaturezaEstoque,
    q: number,
    cost: number,
    data: Dados,
    op: string,
    reason: string,
    now: string,
  ) {
    const m = aplicarMovimentoNaTransacao(db, {
      produtoId: origin.produto_id,
      natureza,
      quantidade: q,
      custoTotalCentavos: cost,
      movimentacaoOrigemId: origin.id,
      operacaoId: op,
      motivo: reason,
      dataEfetiva: data.dataEfetiva,
      registradoEm: now,
    });
    db.prepare('INSERT INTO vinculos_estoque_comercial VALUES (?,?)').run(m.movimentacaoId, itemId);
    return one<Movimento>(db, 'SELECT * FROM movimentacoes_estoque WHERE id=?', m.movimentacaoId!)!;
  }
  function movements(d: Documento) {
    return many<Movimento>(
      db,
      'SELECT * FROM movimentacoes_estoque WHERE operacao_id=? ORDER BY id',
      d.operacao_confirmacao_id,
    );
  }
  function noLater(d: Documento) {
    const ms = movements(d);
    if (!ms.length)
      throw new ComercialError('INVALID_STATE', 'Documento não tem movimentos reversíveis.');
    for (const p of new Set(ms.map((m) => m.produto_id))) {
      const last = Math.max(...ms.filter((m) => m.produto_id === p).map((m) => m.id));
      if (
        one(db, 'SELECT 1 FROM movimentacoes_estoque WHERE produto_id=? AND id>? LIMIT 1', p, last)
      )
        throw new ComercialError('INVALID_STATE', 'Produto tem movimentação posterior.');
    }
  }
  function insertItem(
    documentId: number,
    source: Item,
    q: number,
    loss: number,
    previous: number,
    copyAll: boolean,
    reason: string,
    shipping: boolean,
  ): number {
    const part = (value: number) =>
      copyAll ? value : reversaoAcumulada(value, source.quantidade, previous, q);
    const net = part(source.valor_liquido_centavos),
      di = part(source.desconto_item_centavos),
      dg = part(source.desconto_global_rateado_centavos),
      frete = shipping ? part(source.frete_rateado_centavos) : 0,
      despesas = shipping ? part(source.despesas_rateadas_centavos) : 0;
    return Number(
      db
        .prepare(
          `INSERT INTO itens_documento(documento_id,sequencia,produto_id,sku_historico,descricao_historica,quantidade,valor_unitario_centavos,valor_bruto_centavos,desconto_item_centavos,desconto_global_rateado_centavos,frete_rateado_centavos,despesas_rateadas_centavos,valor_liquido_centavos,valor_custo_estoque_centavos,motivo,item_origem_id,quantidade_perda) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          documentId,
          source.sequencia,
          source.produto_id,
          source.sku_historico,
          source.descricao_historica,
          q,
          source.valor_unitario_centavos,
          somar([net, di, dg]),
          di,
          dg,
          frete,
          despesas,
          net,
          part(source.valor_custo_estoque_centavos),
          reason,
          source.id,
          loss,
        ).lastInsertRowid,
    );
  }
  function prepararAbatimento(venda: Documento, amount: number, data: string) {
    const ps = parcelasFinanceiras(db, venda.id, data).reverse();
    let left = amount;
    const abat = new Map<number, number>();
    for (const p of ps) {
      const v = Math.min(left, p.saldoCentavos);
      abat.set(p.id, v);
      left -= v;
    }
    const refund = left;
    for (const p of ps) {
      const current = abat.get(p.id) ?? 0;
      const v = Math.min(left, p.valorOriginalCentavos - p.abatimentosCentavos - current);
      abat.set(p.id, current + v);
      left -= v;
    }
    if (left) reject('Correção excede dívida original.');
    const origens: { alocacaoId: number; valor: number }[] = [];
    left = refund;
    for (const p of ps) {
      const after = { ...p, abatimentosCentavos: p.abatimentosCentavos + (abat.get(p.id) ?? 0) };
      let needed =
        Math.max(
          after.recebimentosCentavos - (after.valorOriginalCentavos - after.abatimentosCentavos),
          0,
        ) -
        total(
          db,
          "SELECT o.valor_centavos valor FROM origens_reembolso o JOIN alocacoes_recebimento a ON a.id=o.alocacao_recebimento_id JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id WHERE a.parcela_id=? AND d.estado='CONFIRMADO'",
          p.id,
        );
      for (const a of many<{ id: number; valor_centavos: number }>(
        db,
        "SELECT a.* FROM alocacoes_recebimento a WHERE a.parcela_id=? AND a.natureza='APLICACAO' AND NOT EXISTS(SELECT 1 FROM alocacoes_recebimento e WHERE e.estorna_alocacao_id=a.id) ORDER BY a.id",
        p.id,
      )) {
        const used = total(
          db,
          "SELECT o.valor_centavos valor FROM origens_reembolso o JOIN reembolsos_cliente r ON r.id=o.reembolso_id JOIN documentos d ON d.id=r.documento_correcao_id WHERE o.alocacao_recebimento_id=? AND d.estado='CONFIRMADO'",
          a.id,
        );
        const v = Math.min(left, needed, a.valor_centavos - used);
        if (v > 0) {
          origens.push({ alocacaoId: a.id, valor: v });
          left -= v;
          needed -= v;
        }
      }
    }
    if (left) throw new ComercialError('INTEGRITY', 'Reembolso sem origem disponível.');
    return { ps, abat, refund, origens };
  }
  function abatimento(venda: Documento, correctionId: number, amount: number, data: string) {
    const { abat, refund, origens } = prepararAbatimento(venda, amount, data);
    for (const [p, v] of abat)
      if (v)
        db.prepare(
          "INSERT INTO abatimentos_parcela(documento_correcao_id,parcela_id,valor_centavos,natureza) VALUES (?,?,?,'ABATIMENTO')",
        ).run(correctionId, p, v);
    if (!refund) return;
    const rid = Number(
      db
        .prepare(
          'INSERT INTO reembolsos_cliente(documento_correcao_id,valor_centavos) VALUES (?,?)',
        )
        .run(correctionId, refund).lastInsertRowid,
    );
    for (const o of origens)
      db.prepare(
        'INSERT INTO origens_reembolso(reembolso_id,alocacao_recebimento_id,valor_centavos) VALUES (?,?,?)',
      ).run(rid, o.alocacaoId, o.valor);
  }
  function prepararVenda(data: Dados, cancel: boolean) {
    const d = documento(data.documentoId);
    if (d.tipo !== 'VENDA' || d.estado !== 'CONFIRMADO')
      throw new ComercialError('INVALID_STATE', 'Venda não está confirmada.');
    if (data.dataEfetiva < d.data_comercial) reject('Correção anterior à origem.');
    if (data.pagamentos.length) reject('Reembolso ao cliente exige comando separado.');
    if (
      cancel &&
      one(db, "SELECT id FROM documentos WHERE documento_origem_id=? AND estado='CONFIRMADO'", d.id)
    )
      throw new ComercialError('INVALID_STATE', 'Documento tem devolução anterior.');
    const originals = itens(d.id);
    const chosen = cancel
      ? originals.map((i) => ({ itemId: i.id, quantidade: i.quantidade, quantidadePerda: 0 }))
      : data.itens!;
    const estoque: {
      produtoId: number;
      natureza: NaturezaEstoque;
      quantidadeDelta: number;
      valorDeltaCentavos: number;
    }[] = [];
    const rows = chosen.map((selection) => {
      const source = originals.find((i) => i.id === selection.itemId);
      if (!source) return reject('Item de outra origem.');
      if (selection.quantidadePerda > selection.quantidade) reject('Condição física inválida.');
      const previous = total(
        db,
        "SELECT i.quantidade valor FROM itens_documento i JOIN documentos d ON d.id=i.documento_id WHERE i.item_origem_id=? AND d.estado='CONFIRMADO'",
        source.id,
      );
      if (previous + selection.quantidade > source.quantidade)
        reject('Quantidade devolvida excedente.');
      const part = (value: number, start = previous, q = selection.quantidade) =>
        cancel ? value : reversaoAcumulada(value, source.quantidade, start, q);
      const aptas = selection.quantidade - selection.quantidadePerda;
      if (aptas)
        estoque.push({
          produtoId: source.produto_id,
          natureza: cancel ? 'REVERSAO_ENTRADA' : 'DEV_VENDA',
          quantidadeDelta: aptas,
          valorDeltaCentavos: part(source.valor_custo_estoque_centavos, previous, aptas),
        });
      if (selection.quantidadePerda) {
        const cost = part(
          source.valor_custo_estoque_centavos,
          previous + aptas,
          selection.quantidadePerda,
        );
        estoque.push(
          {
            produtoId: source.produto_id,
            natureza: 'DEV_VENDA',
            quantidadeDelta: selection.quantidadePerda,
            valorDeltaCentavos: cost,
          },
          {
            produtoId: source.produto_id,
            natureza: 'PERDA_DEVOLUCAO',
            quantidadeDelta: -selection.quantidadePerda,
            valorDeltaCentavos: -cost,
          },
        );
      }
      return {
        ...selection,
        descricao: source.descricao_historica,
        sku: source.sku_historico,
        valorCentavos: part(source.valor_liquido_centavos),
        custoCentavos: part(source.valor_custo_estoque_centavos),
      };
    });
    // Check intermediate limits, including the return immediately preceding a linked loss.
    const balances = new Map<number, { quantidade: bigint; valor: bigint }>();
    for (const m of estoque) {
      let balance = balances.get(m.produtoId);
      if (!balance) {
        const b = one<{ quantidade: number; valor_total_centavos: number }>(
          db,
          'SELECT * FROM saldos_estoque WHERE produto_id=?',
          m.produtoId,
        );
        if (!b) throw new ComercialError('INTEGRITY', 'Saldo ausente.');
        balance = { quantidade: BigInt(b.quantidade), valor: BigInt(b.valor_total_centavos) };
        balances.set(m.produtoId, balance);
      }
      balance.quantidade += BigInt(m.quantidadeDelta);
      balance.valor += BigInt(m.valorDeltaCentavos);
      if (
        balance.quantidade < 0n ||
        balance.quantidade > 1_000_000_000n ||
        balance.valor < 0n ||
        balance.valor > 9_000_000_000_000n
      )
        reject('Limite de estoque excedido.');
    }
    const valorCentavos = somar(rows.map((i) => i.valorCentavos));
    return {
      d,
      rows,
      estoque,
      valorCentavos,
      financeiro: prepararAbatimento(d, valorCentavos, data.dataEfetiva),
    };
  }
  // Read-only preparation shared by the purchase review and the original 3D command.
  // Cost arithmetic remains owned by custoSaida/reversaoAcumulada.
  function prepararCompra(data: Dados, cancel: boolean) {
    const d = documento(data.documentoId);
    if (d.tipo !== 'COMPRA' || d.estado !== 'CONFIRMADO')
      throw new ComercialError('INVALID_STATE', 'Compra não confirmada.');
    if (data.dataEfetiva < d.data_comercial) reject('Correção anterior à origem.');
    if (cancel) {
      if (
        one(
          db,
          "SELECT id FROM documentos WHERE documento_origem_id=? AND estado='CONFIRMADO'",
          d.id,
        )
      )
        throw new ComercialError('INVALID_STATE', 'Documento tem devolução anterior.');
      noLater(d);
    }
    const originals = itens(d.id);
    const chosen = cancel
      ? originals.map((i) => ({ itemId: i.id, quantidade: i.quantidade, quantidadePerda: 0 }))
      : data.itens!;
    const rows = chosen.map((selection) => {
      const source = originals.find((i) => i.id === selection.itemId);
      if (!source) return reject('Item de outra origem.');
      if (selection.quantidadePerda) reject('Condição física inválida.');
      const previous = total(
        db,
        "SELECT i.quantidade valor FROM itens_documento i JOIN documentos d ON d.id=i.documento_id WHERE i.item_origem_id=? AND d.estado='CONFIRMADO'",
        source.id,
      );
      if (previous + selection.quantidade > source.quantidade)
        reject('Quantidade devolvida excedente.');
      const b = one<{ quantidade: number; valor_total_centavos: number }>(
        db,
        'SELECT * FROM saldos_estoque WHERE produto_id=?',
        source.produto_id,
      );
      if (!b) throw new ComercialError('INTEGRITY', 'Saldo ausente.');
      if (selection.quantidade > b.quantidade)
        throw new ComercialError('INSUFFICIENT_STOCK', 'Estoque insuficiente.');
      const custoCentavos = cancel
        ? source.valor_custo_estoque_centavos
        : Number(
            custoSaida(
              BigInt(b.valor_total_centavos),
              BigInt(b.quantidade),
              BigInt(selection.quantidade),
            ),
          );
      const quantidadeApos = b.quantidade - selection.quantidade;
      const valorAposCentavos = b.valor_total_centavos - custoCentavos;
      if (valorAposCentavos < 0 || (quantidadeApos === 0 && valorAposCentavos !== 0))
        reject('Limite de estoque excedido.');
      const valorCentavos = cancel
        ? source.valor_liquido_centavos
        : reversaoAcumulada(
            source.valor_liquido_centavos,
            source.quantidade,
            previous,
            selection.quantidade,
          );
      return {
        itemId: source.id,
        produtoId: source.produto_id,
        descricao: source.descricao_historica,
        sku: source.sku_historico,
        quantidade: selection.quantidade,
        valorCentavos,
        custoCentavos,
        ajusteCentavos: cancel ? 0 : valorCentavos - custoCentavos,
        quantidadeAntes: b.quantidade,
        valorAntesCentavos: b.valor_total_centavos,
        quantidadeApos,
        valorAposCentavos,
      };
    });
    const valorCentavos = somar(rows.map((i) => i.valorCentavos));
    if (!cancel) {
      if (somar(data.pagamentos.map((p) => p.valorCentavos)) !== valorCentavos)
        reject('Reembolso do fornecedor deve ser integral e imediato.');
      for (const p of data.pagamentos) validarFormaAtiva(db, p.formaPagamentoId);
    }
    return { d, rows, valorCentavos };
  }
  function prepararEstornoDevolucao(data: Pick<Dados, 'documentoId' | 'dataEfetiva'>) {
    const d = documento(data.documentoId);
    if (!['DEV_VENDA', 'DEV_COMPRA'].includes(d.tipo) || d.estado !== 'CONFIRMADO')
      throw new ComercialError('INVALID_STATE', 'Devolução indisponível.');
    if (data.dataEfetiva < d.data_comercial) reject('Estorno anterior à devolução.');
    noLater(d);
    if (
      total(
        db,
        "SELECT CASE a.natureza WHEN 'PAGAMENTO' THEN a.valor_centavos ELSE -a.valor_centavos END valor FROM alocacoes_reembolso a JOIN origens_reembolso o ON o.id=a.origem_reembolso_id JOIN reembolsos_cliente r ON r.id=o.reembolso_id WHERE r.documento_correcao_id=?",
        d.id,
      ) > 0
    )
      throw new ComercialError('INVALID_STATE', 'Estorne pagamentos dependentes primeiro.');
    const movimentos = movements(d).reverse();
    const saldos = new Map<number, { q: bigint; v: bigint }>();
    for (const m of movimentos) {
      let saldo = saldos.get(m.produto_id);
      if (!saldo) {
        const b = one<{ quantidade: number; valor_total_centavos: number }>(
          db,
          'SELECT * FROM saldos_estoque WHERE produto_id=?',
          m.produto_id,
        )!;
        saldo = { q: BigInt(b.quantidade), v: BigInt(b.valor_total_centavos) };
        saldos.set(m.produto_id, saldo);
      }
      saldo.q -= BigInt(m.quantidade_delta);
      saldo.v -= BigInt(m.valor_delta_centavos);
      if (saldo.q < 0n || saldo.q > 1_000_000_000n || saldo.v < 0n || saldo.v > 9_000_000_000_000n)
        reject('Limite de estoque excedido.');
    }
    return { d, movimentos };
  }
  function correction(input: unknown, buy: boolean, cancel: boolean) {
    return comandoFinanceiro(
      db,
      appVersion,
      clock,
      `CORRECAO_${cancel ? 'CANCELAR' : 'DEVOLVER'}_${buy ? 'COMPRA' : 'VENDA'}`,
      input,
      (raw, now) => normalize(raw, now, !cancel),
      (data, op, reason, now) => {
        if (buy) prepararCompra(data, cancel);
        const salePlan = !buy ? prepararVenda(data, cancel) : undefined;
        const d = documento(data.documentoId);
        if (d.tipo !== (buy ? 'COMPRA' : 'VENDA') || d.estado !== 'CONFIRMADO')
          throw new ComercialError('INVALID_STATE', 'Origem incompatível.');
        if (data.dataEfetiva < d.data_comercial) reject('Correção anterior à origem.');
        if (
          cancel &&
          one(
            db,
            "SELECT id FROM documentos WHERE documento_origem_id=? AND estado='CONFIRMADO'",
            d.id,
          )
        )
          throw new ComercialError('INVALID_STATE', 'Documento tem devolução anterior.');
        if (cancel && buy) noLater(d);
        const originals = itens(d.id),
          chosen = cancel
            ? originals.map((i) => ({ itemId: i.id, quantidade: i.quantidade, quantidadePerda: 0 }))
            : data.itens!;
        if (!buy && data.pagamentos.length) reject('Reembolso ao cliente exige comando separado.');
        const cid = createDocument(
          d,
          cancel ? 'ESTORNO' : buy ? 'DEV_COMPRA' : 'DEV_VENDA',
          data.dataEfetiva,
          op,
          now,
          reason,
        );
        prepareDocument(cid, op);
        for (const selection of chosen) {
          const source = originals.find((i) => i.id === selection.itemId);
          if (!source) reject('Item de outra origem.');
          const s = source!;
          if (
            selection.quantidadePerda > selection.quantidade ||
            (buy && selection.quantidadePerda)
          )
            reject('Condição física inválida.');
          const previous = total(
            db,
            "SELECT i.quantidade valor FROM itens_documento i JOIN documentos d ON d.id=i.documento_id WHERE i.item_origem_id=? AND d.estado='CONFIRMADO'",
            s.id,
          );
          if (previous + selection.quantidade > s.quantidade)
            reject('Quantidade devolvida excedente.');
          const iid = insertItem(
            cid,
            s,
            selection.quantidade,
            selection.quantidadePerda,
            previous,
            cancel,
            reason,
            cancel && buy,
          );
          const origin = one<Movimento>(
            db,
            'SELECT m.* FROM movimentacoes_estoque m JOIN vinculos_estoque_comercial v ON v.movimentacao_id=m.id WHERE v.item_documento_id=? ORDER BY m.id',
            s.id,
          )!;
          if (buy) {
            const m = stock(
              iid,
              origin,
              cancel ? 'REVERSAO_SAIDA' : 'DEV_COMPRA',
              selection.quantidade,
              cancel ? s.valor_custo_estoque_centavos : 0,
              data,
              op,
              reason,
              now,
            );
            const cost = -m.valor_delta_centavos;
            const item = one<Item>(db, 'SELECT * FROM itens_documento WHERE id=?', iid)!;
            db.prepare(
              'UPDATE itens_documento SET valor_custo_estoque_centavos=?,resultado_ajuste_centavos=? WHERE id=?',
            ).run(cost, cancel ? 0 : item.valor_liquido_centavos - cost, iid);
          } else {
            let returned: Movimento | undefined;
            for (const planned of salePlan!.estoque.filter((m) => m.produtoId === s.produto_id)) {
              const movement = stock(
                iid,
                planned.natureza === 'PERDA_DEVOLUCAO' ? returned! : origin,
                planned.natureza,
                Math.abs(planned.quantidadeDelta),
                Math.abs(planned.valorDeltaCentavos),
                data,
                op,
                reason,
                now,
              );
              if (planned.natureza === 'DEV_VENDA') returned = movement;
            }
          }
        }
        const commercialValue = somar(itens(cid).map((i) => i.valor_liquido_centavos));
        if (!buy) abatimento(d, cid, commercialValue, data.dataEfetiva);
        else if (cancel)
          for (const m of many<MovimentoFinanceiro>(
            db,
            "SELECT * FROM movimentos_financeiros WHERE documento_id=? AND natureza='PAGAMENTO_COMPRA'",
            d.id,
          ))
            estornarMovimento(db, m, data.dataEfetiva, op, now);
        else {
          if (somar(data.pagamentos.map((p) => p.valorCentavos)) !== commercialValue)
            reject('Reembolso do fornecedor deve ser integral e imediato.');
          for (const p of data.pagamentos)
            inserirDinheiro(
              db,
              cid,
              'REEMBOLSO_FORNECEDOR',
              'ENTRADA',
              p,
              data.dataEfetiva,
              op,
              now,
            );
        }
        if (cancel)
          db.prepare("UPDATE documentos SET estado='ESTORNADO',versao=versao+1 WHERE id=?").run(
            d.id,
          );
        finish(cid, now);
        return {
          documentoId: cid,
          origemId: d.id,
          ...(!buy ? { financeiro: resumoFinanceiro(db, d.id) } : {}),
        };
      },
    );
  }
  function normalizarEstornoAjuste(raw: unknown, now: Date) {
    const v = record(raw, ['movimentoId', 'dataEfetiva']);
    return {
      movimentoId: identifier(v['movimentoId']),
      dataEfetiva: effectiveDate(v['dataEfetiva'], now),
    };
  }
  function prepararEstornoAjuste(data: { movimentoId: number; dataEfetiva: string }) {
    const m = one<Movimento & { data_efetiva: string; operacao_id: string }>(
      db,
      'SELECT * FROM movimentacoes_estoque WHERE id=?',
      data.movimentoId,
    );
    if (!m) throw new ComercialError('NOT_FOUND', 'Ajuste não encontrado.');
    const operation = one<{ tipo: string }>(
      db,
      'SELECT tipo FROM operacoes WHERE id=?',
      m.operacao_id,
    );
    if (
      !['AJUSTE_ENTRADA', 'AJUSTE_SAIDA', 'PERDA'].includes(m.natureza) ||
      !operation ||
      ![`ESTOQUE_${m.natureza}`, 'ESTOQUE_CONTAGEM'].includes(operation.tipo)
    )
      throw new ComercialError('INVALID_STATE', 'Movimento não é ajuste manual.');
    if (
      one(
        db,
        "SELECT 1 FROM movimentacoes_estoque WHERE movimentacao_origem_id=? AND natureza IN ('REVERSAO_ENTRADA','REVERSAO_SAIDA')",
        m.id,
      )
    )
      throw new ComercialError('INVALID_STATE', 'Ajuste já estornado.');
    // Released V4 trigger independently requires the original to be the last movement.
    if (
      one(db, 'SELECT 1 FROM movimentacoes_estoque WHERE produto_id=? AND id>?', m.produto_id, m.id)
    )
      throw new ComercialError('INVALID_STATE', 'Há movimentação posterior do mesmo produto.');
    if (data.dataEfetiva < m.data_efetiva) reject('Estorno anterior ao ajuste.');
    const saldo = one<{ quantidade: number; valor_total_centavos: number; versao: number }>(
      db,
      'SELECT * FROM saldos_estoque WHERE produto_id=?',
      m.produto_id,
    );
    if (!saldo) throw new ComercialError('INTEGRITY', 'Saldo ausente.');
    const q = BigInt(saldo.quantidade) - BigInt(m.quantidade_delta),
      v = BigInt(saldo.valor_total_centavos) - BigInt(m.valor_delta_centavos);
    if (q < 0n) throw new ComercialError('INSUFFICIENT_STOCK', 'Estoque insuficiente.');
    if (q > 1_000_000_000n || v < 0n || v > 9_000_000_000_000n || (q === 0n && v !== 0n))
      reject('Reversão incompatível com o saldo monetário.');
    return {
      m,
      quantidadeDelta: -m.quantidade_delta,
      valorDeltaCentavos: -m.valor_delta_centavos,
      quantidadeAntes: saldo.quantidade,
      valorAntesCentavos: saldo.valor_total_centavos,
      versao: saldo.versao,
      quantidadeApos: Number(q),
      valorAposCentavos: Number(v),
    };
  }
  return {
    prepararEstornoAjuste,
    normalizarEstornoAjuste: (raw: unknown) => normalizarEstornoAjuste(raw, clock()),
    normalizarVenda: (raw: unknown, cancel: boolean) => normalize(raw, clock(), !cancel),
    prepararCompra,
    normalizarCompra: (raw: unknown, cancel: boolean) => normalize(raw, clock(), !cancel),
    prepararVenda,
    prepararEstornoDevolucao,
    devolverVenda: (input: unknown) => correction(input, false, false),
    cancelarVenda: (input: unknown) => correction(input, false, true),
    devolverCompra: (input: unknown) => correction(input, true, false),
    cancelarCompra: (input: unknown) => correction(input, true, true),
    estornarDevolucao: (input: unknown) =>
      comandoFinanceiro(
        db,
        appVersion,
        clock,
        'CORRECAO_ESTORNAR_DEVOLUCAO',
        input,
        (raw, now) => normalize(raw, now, false),
        (data, op, reason, now) => {
          const { d, movimentos } = prepararEstornoDevolucao(data);
          const cid = createDocument(d, 'ESTORNO', data.dataEfetiva, op, now, reason);
          prepareDocument(cid, op);
          const map = new Map<number, number>();
          for (const i of itens(d.id))
            map.set(
              i.id,
              insertItem(cid, i, i.quantidade, i.quantidade_perda, 0, true, reason, true),
            );
          for (const m of movimentos) {
            const link = one<{ item_documento_id: number }>(
              db,
              'SELECT item_documento_id FROM vinculos_estoque_comercial WHERE movimentacao_id=?',
              m.id,
            )!;
            stock(
              map.get(link.item_documento_id)!,
              m,
              m.quantidade_delta > 0 ? 'REVERSAO_SAIDA' : 'REVERSAO_ENTRADA',
              Math.abs(m.quantidade_delta),
              Math.abs(m.valor_delta_centavos),
              data,
              op,
              reason,
              now,
            );
          }
          for (const b of many<{ id: number; parcela_id: number; valor_centavos: number }>(
            db,
            "SELECT * FROM abatimentos_parcela WHERE documento_correcao_id=? AND natureza='ABATIMENTO'",
            d.id,
          ))
            db.prepare(
              "INSERT INTO abatimentos_parcela(documento_correcao_id,parcela_id,valor_centavos,natureza,estorna_abatimento_id) VALUES (?,?,?,'ESTORNO',?)",
            ).run(cid, b.parcela_id, b.valor_centavos, b.id);
          for (const m of many<MovimentoFinanceiro>(
            db,
            "SELECT * FROM movimentos_financeiros WHERE documento_id=? AND natureza='REEMBOLSO_FORNECEDOR'",
            d.id,
          ))
            estornarMovimento(db, m, data.dataEfetiva, op, now);
          db.prepare("UPDATE documentos SET estado='ESTORNADO',versao=versao+1 WHERE id=?").run(
            d.id,
          );
          finish(cid, now);
          return { documentoId: cid, origemId: d.id };
        },
      ),
    estornarAjuste: (input: unknown) =>
      comandoFinanceiro(
        db,
        appVersion,
        clock,
        'CORRECAO_ESTORNAR_AJUSTE',
        input,
        normalizarEstornoAjuste,
        (data, op, reason, now) => {
          const { m } = prepararEstornoAjuste(data);
          return aplicarMovimentoNaTransacao(db, {
            produtoId: m.produto_id,
            natureza: m.quantidade_delta > 0 ? 'REVERSAO_SAIDA' : 'REVERSAO_ENTRADA',
            quantidade: Math.abs(m.quantidade_delta),
            custoTotalCentavos: Math.abs(m.valor_delta_centavos),
            movimentacaoOrigemId: m.id,
            operacaoId: op,
            motivo: reason,
            dataEfetiva: data.dataEfetiva,
            registradoEm: now,
          });
        },
      ),
  };
}
