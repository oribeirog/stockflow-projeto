// UI-only photo flow shared with the complete restore/relaunch harness.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export async function fotosScenario({
  e,
  m,
  until,
  click,
  key,
  call,
  mode,
  productData,
  db,
  internet = false,
}) {
  const corpus = resolve('.cache/pre52b-fotos'),
    products = [];
  const fill = async (id, value) =>
    e(
      `(()=>{const x=document.getElementById(${JSON.stringify(id)});x.value=${JSON.stringify(value)};x.dispatchEvent(new Event(x.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
  const select = async (name) => {
    if (name) await m(`__open.push(${JSON.stringify(join(corpus, name))})`);
    await click('Selecionar fotografia');
  };
  const image = async (id) => {
    const r = await e(
      `window.mnrApi.fotos.obter({produtoId:${id},variante:'imagem'}).then(r=>({ok:r.ok,data:r.ok&&r.data?{...r.data,bytes:Array.from(r.data.bytes)}:null}))`,
    );
    assert(r.ok && r.data);
    return {
      ...r.data,
      hash: createHash('sha256').update(Buffer.from(r.data.bytes)).digest('hex'),
    };
  };
  const openPhoto = async () => {
    await until(`!!document.querySelector('mnr-photo-editor mnr-photo .thumbnail')`);
    const start = performance.now();
    await e(
      `(()=>{const b=document.querySelector('mnr-photo-editor mnr-photo .thumbnail');b.focus();b.click();})()`,
    );
    await until(
      `document.querySelector('mnr-photo-editor dialog[open] img.large')?.complete && document.querySelector('mnr-photo-editor dialog[open] img.large')?.naturalWidth>0`,
    );
    const ms = performance.now() - start;
    await key('Escape');
    await until(`!document.querySelector('mnr-photo-editor dialog[open]')`);
    assert(await e(`document.activeElement.matches('button.thumbnail')`));
    return ms;
  };
  const saved = async () => {
    await click('Salvar produto');
    await until(
      `document.querySelector('mnr-photo-editor')?.innerText.includes('Fotografia atualizada com sucesso.')`,
    );
  };
  for (const [index, name] of [
    [0, 'JPEG comum.jpg'],
    [1, 'orientacao-6.JPG'],
  ]) {
    await e(`location.hash='#/produtos'`);
    await until(`!!document.getElementById('produto-search')`);
    await e(`location.hash='#/produtos/novo'`);
    await until(`!!document.getElementById('produto-nome')`);
    await fill('produto-nome', 'Fotografia sintética ' + index);
    await fill('produto-sku', 'FOTO-COMPAT-' + index);
    await until(`!!document.querySelector('#marca-select option[value="${productData.marcaId}"]')`);
    await fill('marca-select', String(productData.marcaId));
    await fill('categoria-select', String(productData.categoriaId));
    await fill('produto-preco', '20,00');
    await select(name);
    await until(`!!document.querySelector('mnr-photo-editor img[alt^="Prévia"]')`);
    if (index === 0) {
      await m(
        `globalThis.__photoRename=process.mainModule.require('node:fs').renameSync;process.mainModule.require('node:fs').renameSync=()=>{throw Object.assign(Error('external test write failure'),{code:'ENOSPC'})}`,
      );
      try {
        await click('Salvar produto');
        await until(
          `document.querySelector('mnr-photo-editor [role="alert"]')?.textContent.includes('gravar')`,
        );
        assert(
          await e(
            `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Tentar confirmar fotografia novamente'&&!b.disabled)`,
          ),
        );
      } finally {
        await m(
          `process.mainModule.require('node:fs').renameSync=__photoRename;delete globalThis.__photoRename`,
        );
      }
      await click('Tentar confirmar fotografia novamente');
      await until(
        `document.querySelector('mnr-photo-editor')?.innerText.includes('Fotografia atualizada com sucesso.')`,
      );
    } else await saved();
    const p = await e(
      `window.mnrApi.cadastros.produtos.listar({busca:'FOTO-COMPAT-${index}'}).then(r=>r.data[0])`,
    );
    assert(p?.id);
    if (index === 0) {
      await fill('produto-motivo', 'Substituir pela fotografia transparente');
      await select('transparência com espaço.png');
      await until(
        `document.querySelector('mnr-photo-editor')?.innerText.includes('Fotografia selecionada.')`,
      );
      await saved();
      const png = await image(p.id);
      assert.equal(png.mime, 'image/png');
      await click('Remover fotografia ao salvar');
      await fill('produto-motivo', 'Remover fotografia de teste');
      await saved();
      assert.equal(
        await e(`window.mnrApi.fotos.obter({produtoId:${p.id},variante:'imagem'}).then(r=>r.data)`),
        null,
      );
      await select('transparência com espaço.png');
      await until(
        `document.querySelector('mnr-photo-editor')?.innerText.includes('Fotografia selecionada.')`,
      );
      await fill('produto-motivo', 'Restabelecer fotografia para testar backup');
      await saved();
      const previous = await image(p.id);
      const bad = join(corpus, 'arquivo inválido.jpg');
      writeFileSync(bad, 'texto');
      await select('arquivo inválido.jpg');
      await until(
        `document.querySelector('mnr-photo-editor [role="alert"]')?.textContent.includes('não é uma imagem válida')`,
      );
      writeFileSync(join(corpus, 'muito grande.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
      await select('muito grande.png');
      await until(
        `document.querySelector('mnr-photo-editor [role="alert"]')?.textContent.includes('10 MiB')`,
      );
      await select(null); // Native cancellation must preserve the linked object.
      await until(
        `document.querySelector('mnr-photo-editor > .stack > p[role="status"]')?.textContent.includes('Seleção cancelada')`,
      );
      assert.equal((await image(p.id)).hash, previous.hash);
      await m(
        `globalThis.__photoDecode=__e.nativeImage.createFromBuffer;__e.nativeImage.createFromBuffer=()=>{throw Error('external test processing failure')}`,
      );
      try {
        await select('JPEG comum.jpg');
        await until(
          `document.querySelector('mnr-photo-editor [role="alert"]')?.textContent.includes('processar')`,
        );
      } finally {
        await m(`__e.nativeImage.createFromBuffer=__photoDecode;delete globalThis.__photoDecode`);
      }
      assert.equal((await image(p.id)).hash, previous.hash);
      await key('Tab');
      await key('Tab', 8);
      assert(await e('!!document.activeElement'));
      for (const [width, height] of [
        [1366, 768],
        [1000, 700],
        [640, 480],
      ])
        for (const zoom of [1, 1.25, 1.5]) {
          await m(
            `__e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#/produtos')).setContentSize(${width},${height})`,
          );
          await call('Emulation.setDeviceMetricsOverride', {
            width: Math.round(width / zoom),
            height: Math.round(height / zoom),
            deviceScaleFactor: zoom,
            mobile: false,
          });
          await e(`document.querySelector('mnr-photo-editor').scrollIntoView({block:'start'})`);
          assert(await e('document.documentElement.scrollWidth<=innerWidth'));
          if (zoom === 1 || width === 640) {
            const r = await call('Page.captureScreenshot', { format: 'png' });
            writeFileSync(
              `.cache/ui/pre52b-foto-${mode}-${width}-${zoom}.png`,
              Buffer.from(r.data, 'base64'),
            );
          }
        }
      await call('Emulation.setDeviceMetricsOverride', {
        width: 1366,
        height: 768,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await m(
        `__e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#/produtos')).setContentSize(1366,768)`,
      );
    }
    const photo = await image(p.id);
    if (index === 1) assert.deepEqual([photo.largura, photo.altura], [80, 120]);
    products.push({
      id: p.id,
      mime: photo.mime,
      width: photo.largura,
      height: photo.altura,
      hash: photo.hash,
      openUiMs: await openPhoto(),
    });
  }
  assert((await e('document.title')).includes('MNR Gestão'));
  assert((await e('document.querySelector(".brand").innerText')).includes('MNR Gestão'));
  assert.equal(await m('__e.app.getName()'), 'MNR Gestão');
  // Non-tiny inputs through the actual application's decoder, including ASAR.
  // Avoid sending multi-megabyte originals through the inspector just to time them.
  const command = {
    operacaoId: crypto.randomUUID(),
    motivo: 'Benchmark isolado de fotografias',
    dados: { ...productData, sku: 'PHOTO-LARGE', nome: 'Produto com fotografia detalhada' },
  };
  const created = await e(`window.mnrApi.cadastros.produtos.salvar(${JSON.stringify(command)})`);
  assert(created.ok);
  await e(`location.hash='#/produtos/${created.data.id}/editar'`);
  await until(
    `document.getElementById('produto-nome')?.value==='Produto com fotografia detalhada'`,
  );
  const timings = [];
  for (const source of [
    'grande-detalhada.jpg',
    'png-grande.png',
    'png-ruido-rgb.png',
    'rgba-detalhada.png',
  ]) {
    const start = performance.now();
    await select(source);
    await until(
      `document.querySelector('mnr-photo-editor')?.innerText.includes('Fotografia selecionada.')`,
    );
    const selectionMs = performance.now() - start;
    await fill('produto-motivo', 'Importação sintética para medição');
    await saved();
    timings.push({
      source,
      selectionMs,
      totalUiMs: performance.now() - start,
      memory: await m('({rss:process.memoryUsage().rss,maxRssKiB:process.resourceUsage().maxRSS})'),
    });
  }
  const row = db
    .prepare(
      'SELECT a.* FROM foto_arquivos a JOIN produto_fotos p ON a.id=p.foto_id WHERE p.produto_id=?',
    )
    .get(created.data.id);
  assert.deepEqual([row.largura, row.altura], [1620, 1080]);
  products.push({
    id: created.data.id,
    mime: row.mime,
    width: row.largura,
    height: row.altura,
    hash: row.hash,
    large: true,
    openUiMs: await openPhoto(),
  });
  let importedVariants = 0;
  for (const c of JSON.parse(readFileSync(join(corpus, 'cases.json'), 'utf8'))) {
    await m(`__open.push(${JSON.stringify(join(corpus, c.name))})`);
    const r = await e(
      `window.mnrApi.fotos.selecionar().then(r=>({ok:r.ok,error:r.error,data:r.ok&&r.data?{token:r.data.token,width:r.data.previa.largura,height:r.data.previa.altura,bytes:r.data.previa.bytes.length}:null}))`,
    );
    assert(r.ok && r.data, JSON.stringify({ source: c.name, ...r }));
    assert(r.data.bytes > 0 && Math.max(r.data.width, r.data.height) <= 160);
    assert((await e(`window.mnrApi.fotos.descartar(${JSON.stringify(r.data.token)})`)).ok);
    importedVariants++;
  }
  const internetProducts = [];
  if (internet) {
    const internetRoot = resolve('.cache/pre52b-internet');
    for (const [index, name] of ['transparente.webp', 'orientado.JFIF'].entries()) {
      await e(`location.hash='#/produtos/novo'`);
      await until(`!!document.getElementById('produto-nome')`);
      await fill('produto-nome', 'Fotografia baixada sintética ' + index);
      await fill('produto-sku', 'FOTO-INTERNET-' + index);
      await until(
        `!!document.querySelector('#marca-select option[value="${productData.marcaId}"]')`,
      );
      await fill('marca-select', String(productData.marcaId));
      await fill('categoria-select', String(productData.categoriaId));
      await fill('produto-preco', '25,00');
      await m(`__open.push(${JSON.stringify(join(internetRoot, name))})`);
      await click('Selecionar fotografia');
      await until(`!!document.querySelector('mnr-photo-editor img[alt^="Prévia"]')`);
      await saved();
      const p = await e(
        `window.mnrApi.cadastros.produtos.listar({busca:'FOTO-INTERNET-${index}'}).then(r=>r.data[0])`,
      );
      assert(p?.id);
      const stored = await image(p.id);
      assert.equal(stored.mime, index === 0 ? 'image/png' : 'image/jpeg');
      assert.equal(stored.largura, index === 0 ? 120 : 80);
      assert.equal(stored.altura, index === 0 ? 80 : 120);
      const record = {
        id: p.id,
        source: name,
        mime: stored.mime,
        hash: stored.hash,
        width: stored.largura,
        height: stored.altura,
      };
      products.push(record);
      internetProducts.push(record);
      await e(`location.hash='#/produtos'`);
      await until(`!!document.getElementById('produto-search')`);
      await fill('produto-search', 'FOTO-INTERNET-' + index);
      await until(
        `(()=>{const r=Array.from(document.querySelectorAll('mnr-perfumes tbody tr')).find(r=>r.innerText.includes('FOTO-INTERNET-${index}'));const i=r?.querySelector('.thumbnail img');return i?.complete&&i.naturalWidth>0;})()`,
      );
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(
        `.cache/ui/pre52b-internet-${index}-${mode}.png`,
        Buffer.from(shot.data, 'base64'),
      );
    }
    // Real dialog configuration is observed, not assumed from source text.
    assert.deepEqual(await m('__lastPhotoFilter'), ['jpg', 'jpeg', 'jfif', 'png', 'webp']);
  }
  await e(`location.hash='#/produtos'`);
  await until(`!!document.getElementById('produto-search')`);
  await fill('produto-search', 'PHOTO-LARGE');
  await until(
    `(()=>{const rows=Array.from(document.querySelectorAll('mnr-perfumes tbody tr'));const row=rows.find(r=>r.innerText.includes('PHOTO-LARGE'));const img=row?.querySelector('.thumbnail img');return rows.length===1&&img?.complete&&img.naturalWidth>0;})()`,
  );
  await e(`document.querySelector('mnr-perfumes').scrollIntoView({block:'start'})`);
  const catalogue = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`.cache/ui/pre52b-catalogo-${mode}.png`, Buffer.from(catalogue.data, 'base64'));
  return { products, timings, importedVariants, catalogueThumbnail: true, internetProducts };
}
