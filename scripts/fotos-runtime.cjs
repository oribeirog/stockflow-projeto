// Test-only Electron codec, native-dialog cancellation and real secure IPC.
const { app, BrowserWindow, dialog, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const { createCatalogService } = require('../dist/electron/services/catalogos.js');
const { createFotoService } = require('../dist/electron/services/fotos.js');
const { normalizeFoto } = require('../dist/electron/services/foto-codec.js');
const { registerFotos } = require('../dist/electron/ipc/fotos.js');
mkdirSync('.local-data/test', { recursive: true });
const directory = mkdtempSync(resolve('.local-data/test/fotos-runtime-'));
app.setPath('userData', directory);
app.setPath('sessionData', directory);
let db;
const command = (dados) => ({ operacaoId: randomUUID(), motivo: 'Foto runtime', dados });
app
  .whenReady()
  .then(async () => {
    db = await openDatabase(directory, 'test');
    const c = createCatalogService(db, 'test');
    const brand = c.saveReference('MARCA', command({ nome: 'Marca' })),
      category = c.saveReference('CATEGORIA', command({ nome: 'Categoria' }));
    const p = c.saveProduct(
      command({
        nome: 'Perfume',
        sku: 'RUNTIME',
        marcaId: brand.id,
        categoriaId: category.id,
        volumeMicrolitros: 1000,
        precoVendaCentavos: 0,
        estoqueMinimo: 0,
      }),
    );
    let now = Date.now();
    const photos = createFotoService(db, join(directory, 'images'), 'test', normalizeFoto, {
      now: () => now,
    });
    const image = nativeImage.createFromBitmap(Buffer.alloc(4 * 4 * 4, 255), {
      width: 4,
      height: 4,
    });
    for (const bytes of [image.toPNG(), image.toJPEG(90)]) {
      const encoded = normalizeFoto(bytes);
      assert.equal(encoded.size.width, 4);
      assert.ok(encoded.thumb.length);
    }
    assert.throws(
      () => normalizeFoto(Buffer.from('fake JPEG')),
      (e) => e.code === 'PHOTO_INVALID',
    );
    const wide = nativeImage.createFromBitmap(Buffer.alloc(3000 * 2000 * 4, 255), {
      width: 3000,
      height: 2000,
    });
    const resized = normalizeFoto(wide.toJPEG(90));
    assert.equal(resized.size.width, 2048);
    assert.equal(resized.thumbSize.width, 160);
    const bomb = Buffer.from(image.toPNG());
    bomb.writeUInt32BE(9000, 16);
    assert.throws(
      () => normalizeFoto(bomb),
      (e) => e.code === 'PHOTO_INVALID',
    );
    const path = join(directory, 'photo.png');
    writeFileSync(path, image.toPNG());
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: resolve('dist/electron/preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const url = 'data:text/html,<h1>Isolated photo test</h1>';
    registerFotos(window, url, photos);
    await window.loadURL(url);
    const invoke = (expression) => window.webContents.executeJavaScript(expression);
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    assert.deepEqual(await invoke('window.mnrApi.fotos.selecionar()'), { ok: true, data: null });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    const selected = await invoke('window.mnrApi.fotos.selecionar()');
    assert.equal(selected.ok, true);
    const save = command({ produtoId: p.id, token: selected.data.token });
    const saved = await invoke(`window.mnrApi.fotos.salvar(${JSON.stringify(save)})`);
    assert.equal(saved.ok, true);
    assert.deepEqual(await invoke(`window.mnrApi.fotos.salvar(${JSON.stringify(save)})`), saved);
    const read = await invoke(
      `window.mnrApi.fotos.obter({produtoId:${p.id},variante:'miniatura'})`,
    );
    assert.equal(read.ok, true);
    assert.ok(read.data.bytes.length);
    assert.equal(
      (await invoke(`window.mnrApi.fotos.obter({produtoId:${p.id},variante:'../../data'})`)).error
        .code,
      'PHOTO_INVALID',
    );
    const expired = await invoke('window.mnrApi.fotos.selecionar()');
    now += 31 * 60_000;
    assert.equal(
      (
        await invoke(
          `window.mnrApi.fotos.salvar(${JSON.stringify(command({ produtoId: p.id, token: expired.data.token }))})`,
        )
      ).error.code,
      'PHOTO_EXPIRED',
    );
    writeFileSync(path, 'fake .png');
    assert.equal((await invoke('window.mnrApi.fotos.selecionar()')).error.code, 'PHOTO_INVALID');
    writeFileSync(path, Buffer.alloc(10 * 1024 * 1024 + 1));
    assert.equal((await invoke('window.mnrApi.fotos.selecionar()')).error.code, 'PHOTO_INVALID');
    await window.loadURL('data:text/html,<h1>Untrusted</h1>');
    await assert.rejects(
      invoke(`window.mnrApi.fotos.obter({produtoId:${p.id},variante:'imagem'})`),
      /não autorizada/,
    );
    assert.equal(db.prepare('SELECT count(*) n FROM produto_fotos').get().n, 1);
    db.close();
    db = undefined;
    window.destroy();
    console.log('FOTOS_RUNTIME_OK');
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    db?.close();
    app.exit(1);
  });
