const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
const { ipcMain, app } = require('electron');
const Database = require('better-sqlite3');
const { resolve } = require('node:path');
const {
  prepararVinculos,
  snapshotVinculos,
  conferirVinculos,
  cmd,
} = require('./pessoas-fixture.cjs');
const { createCatalogService } = require('../dist/electron/services/catalogos.js');

module.exports = async function pessoasUi({
  window,
  evaluate,
  until,
  click,
  fill,
  buttonText,
  route,
  screenshot,
  noOverflow,
  key,
}) {
  for (const [path, singular, title] of [
    ['clientes', 'cliente', 'Clientes'],
    ['fornecedores', 'fornecedor', 'Fornecedores'],
  ]) {
    await route(path, title);
    await until(
      `document.querySelector('mnr-pessoas')?.textContent.includes('Nenhum ${singular} encontrado')`,
    );
    await click(`a[href="#/${path}/novo"]`);
    await until(`document.querySelector('#pessoa-nome') !== null`);
    await buttonText(`Salvar ${singular}`);
    await until(`document.activeElement.id === 'pessoa-nome'`);
    const original = {
      nome: `Pessoa ${singular} interface`,
      documento: '52998224725',
      telefone: '+55 11 99999-0000',
      email: 'pessoa@example.com',
      endereco: 'Rua Um\nNúmero 10',
      observacoes: 'Observação original',
    };
    await evaluate(
      `document.querySelector('#pessoa-tipoPessoa').value='PF'; document.querySelector('#pessoa-tipoPessoa').dispatchEvent(new Event('change', {bubbles:true}))`,
    );
    for (const [key, value] of Object.entries(original)) await fill(`#pessoa-${key}`, value);
    const channel = `cadastros:${path}:salvar`;
    const handler = ipcMain._invokeHandlers.get(channel);
    const commands = [];
    let loseReply = true;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (...args) => {
      commands.push(JSON.stringify(args[1]));
      const result = await handler(...args);
      if (result.ok && loseReply) {
        loseReply = false;
        throw new Error('Test-only lost person reply after commit');
      }
      return result;
    });
    await evaluate(
      `(() => {const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Salvar ${singular}'); b.click(); b.click();})()`,
    );
    await until(
      `document.querySelector('mnr-pessoa-editor')?.textContent.includes('Tentar confirmar novamente')`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('#pessoa-nome').disabled || document.querySelector('#pessoa-nome').closest('fieldset').disabled`,
      ),
      true,
    );
    await pause(350);
    assert.equal(commands.length, 1, 'No automatic retry');
    await click(`nav a[href="#/dashboard"]`);
    assert.equal(
      await evaluate('location.hash'),
      `#/${path}/novo`,
      'Uncertain operation blocks navigation',
    );
    await buttonText('Tentar confirmar novamente');
    await until(
      `location.hash.startsWith('#/${path}/') && location.hash.endsWith('/editar') && document.querySelector('.feedback.success') !== null && document.querySelector('#pessoa-nome') !== null`,
    );
    const id = await evaluate(`Number(location.hash.split('/')[2])`);
    assert.equal(commands.length, 2);
    assert.equal(commands[0], commands[1], 'Retry reuses UUID, reason and payload');
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
    const read = () =>
      evaluate(
        `window.mnrApi.cadastros.${path}.obter(${id}).then(r=>{if(!r.ok)throw Error(r.error.message);return r.data})`,
      );
    assert.equal((await read()).nome, original.nome);
    const changes = {
      nome: 'Nome corrigido',
      documento: '11144477735',
      telefone: '+55 21 2222-0000',
      email: 'novo@example.com',
      endereco: 'Endereço corrigido\nComplemento',
      observacoes: 'Outra observação',
    };
    const expected = { ...original };
    for (const [field, value] of Object.entries(changes)) {
      const readChannel = `cadastros:${path}:obter`;
      const healthyRead = ipcMain._invokeHandlers.get(readChannel);
      if (field === 'nome') {
        let fail = true;
        ipcMain.removeHandler(readChannel);
        ipcMain.handle(readChannel, (...args) => {
          if (fail) {
            fail = false;
            return {
              ok: false,
              error: { code: 'IPC_UNAVAILABLE', message: 'Resposta perdida de leitura' },
            };
          }
          return healthyRead(...args);
        });
      }
      await fill(`#pessoa-${field}`, value);
      await fill('#pessoa-motivo', `Correção de ${field}`);
      await buttonText(`Salvar ${singular}`);
      await until(
        `document.querySelector('.feedback.success') !== null && !document.querySelector('fieldset').disabled`,
      );
      if (field === 'nome') {
        assert.equal(
          await evaluate(
            `document.querySelector('.feedback').textContent.includes('Cadastro salvo.')`,
          ),
          true,
        );
        ipcMain.removeHandler(readChannel);
        ipcMain.handle(readChannel, healthyRead);
        await buttonText('Consultar cadastro novamente');
        await until(
          `document.querySelector('.feedback')?.textContent.includes('Cadastro atualizado.')`,
        );
      }
      expected[field] = value;
      const saved = await read();
      for (const [key, data] of Object.entries(expected))
        assert.equal(saved[key], data, `${path} change ${field} preserves ${key}`);
      if (field !== 'nome') {
        await fill(`#pessoa-${field}`, '');
        await fill('#pessoa-motivo', `Limpeza explícita de ${field}`);
        await buttonText(`Salvar ${singular}`);
        await until(
          `document.querySelector('.feedback.success') !== null && !document.querySelector('fieldset').disabled`,
        );
        expected[field] = null;
        const cleared = await read();
        for (const [key, data] of Object.entries(expected))
          assert.equal(cleared[key], data, `${path} clear ${field} preserves ${key}`);
      }
    }
    for (const active of [false, true]) {
      await buttonText(`${active ? 'Reativar' : 'Inativar'} ${singular}`);
      await until(`document.querySelector('dialog[open]') !== null`);
      assert.equal(
        await evaluate(
          `Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.trim()==='Confirmar').disabled`,
        ),
        true,
      );
      await fill(
        '#confirm-reason',
        active ? 'Retorno ao cadastro ativo' : 'Suspensão de atendimento',
      );
      await buttonText('Confirmar');
      await until(
        `document.querySelector('.feedback.success') !== null && !document.querySelector('fieldset').disabled`,
      );
      const updated = await read();
      assert.equal(updated.ativo, active);
      for (const [key, data] of Object.entries(expected)) assert.equal(updated[key], data);
    }
    await click(`a[href="#/${path}"]`);
    await until(`document.querySelector('mnr-pessoas tbody tr') !== null`);
    await fill('#pessoa-search', 'nome corrigido');
    await pause(350);
    await until(`document.querySelectorAll('tbody tr').length === 1`);
  }
  console.log('PESSOAS_EDITOR_OK: each field changed/cleared independently through the UI');
  const db = new Database(resolve(app.getPath('userData'), 'data/mnr-perfumes.db'));
  try {
    const linked = prepararVinculos(db);
    const before = snapshotVinculos(db);
    const catalog = createCatalogService(db, 'ui-4c');
    for (const [path, singular, title, person, kind] of [
      ['clientes', 'cliente', 'Clientes', linked.cliente, 'CLIENTE'],
      ['fornecedores', 'fornecedor', 'Fornecedores', linked.fornecedor, 'FORNECEDOR'],
    ]) {
      for (let index = 0; index < 26; index++)
        catalog.savePerson(
          kind,
          cmd({ nome: `Página ${String(index).padStart(2, '0')}`, ativo: index !== 25 }),
        );
      await route(path, title);
      await until(`document.querySelectorAll('tbody tr').length === 25`);
      const failureChannel = `cadastros:${path}:listar`;
      const healthyList = ipcMain._invokeHandlers.get(failureChannel);
      ipcMain.removeHandler(failureChannel);
      ipcMain.handle(failureChannel, () => ({
        ok: false,
        error: { code: 'DATABASE_BUSY', message: 'Banco ocupado. Tente novamente.' },
      }));
      await buttonText('Pesquisar');
      await until(
        `document.querySelector('mnr-content-state')?.textContent.includes('Banco ocupado')`,
      );
      ipcMain.removeHandler(failureChannel);
      ipcMain.handle(failureChannel, healthyList);
      await buttonText('Tentar novamente');
      await until(`document.querySelectorAll('tbody tr').length === 25`);
      await buttonText('Próxima');
      await until(`document.querySelector('.pagination')?.textContent.includes('Página 2')`);
      await fill('#pessoa-search', 'vinculo');
      await until(
        `document.querySelectorAll('tbody tr').length === 1 && document.querySelector('.pagination').textContent.includes('Página 1')`,
      );
      // Delay a previous list call while a newer filter completes.
      const listChannel = `cadastros:${path}:listar`;
      const originalList = ipcMain._invokeHandlers.get(listChannel);
      let release;
      ipcMain.removeHandler(listChannel);
      ipcMain.handle(listChannel, (...args) =>
        args[1].busca === 'anterior'
          ? new Promise((resolveReply) => {
              release = () => resolveReply(originalList(...args));
            })
          : originalList(...args),
      );
      await fill('#pessoa-search', 'anterior');
      await pause(400);
      assert(release);
      await fill('#pessoa-search', 'vinculo');
      await until(
        `document.querySelectorAll('tbody tr').length === 1 && !document.querySelector('.loading')`,
      );
      release();
      await pause(100);
      assert.equal(
        await evaluate(`document.querySelector('tbody tr strong').textContent`),
        person.nome,
      );
      ipcMain.removeHandler(listChannel);
      ipcMain.handle(listChannel, originalList);
      for (const [width, height] of [
        [1366, 768],
        [1000, 700],
        [640, 480],
      ]) {
        window.setSize(width, height);
        for (const zoom of [1, 1.25, 1.5]) {
          window.webContents.setZoomFactor(zoom);
          await pause(70);
          await noOverflow();
          await screenshot(`${path}-list-${width}-${height}-${zoom}`);
          await evaluate(`document.querySelector('tbody tr').scrollIntoView({block:'start'})`);
          await screenshot(`${path}-list-row-${width}-${height}-${zoom}`);
          await evaluate(`document.querySelector('main').scrollTop=0`);
        }
      }
      window.setSize(1000, 700);
      window.webContents.setZoomFactor(1);
      await click(`a[href="#/${path}/${person.id}/editar"]`);
      await until(
        `document.querySelector('#pessoa-nome')?.value === ${JSON.stringify(person.nome)}`,
      );
      await evaluate(`document.querySelector('#pessoa-nome').focus()`);
      await key('Tab');
      assert.equal(await evaluate('document.activeElement.id'), 'pessoa-documento');
      await key('Tab', ['shift']);
      assert.equal(await evaluate('document.activeElement.id'), 'pessoa-nome');
      assert.equal(await evaluate(`document.querySelector('#pessoa-documento').labels.length`), 1);
      for (const [width, height] of [
        [1366, 768],
        [1000, 700],
        [640, 480],
      ]) {
        window.setSize(width, height);
        for (const zoom of [1, 1.25, 1.5]) {
          window.webContents.setZoomFactor(zoom);
          await pause(70);
          await noOverflow();
          await screenshot(`${path}-editor-${width}-${height}-${zoom}`);
          await evaluate(`document.querySelector('form .row').scrollIntoView({block:'end'})`);
          await screenshot(`${path}-editor-actions-${width}-${height}-${zoom}`);
          await evaluate(`document.querySelector('main').scrollTop=0`);
        }
      }
      window.setSize(1000, 700);
      window.webContents.setZoomFactor(1);
      await fill('#pessoa-nome', person.nome + ' corrigido');
      await click(`nav a[href="#/dashboard"]`);
      await until(`document.querySelector('dialog[open]') !== null`);
      await key('Escape');
      await until(`document.activeElement.id === 'pessoa-nome'`);
      assert.equal(await evaluate('location.hash'), `#/${path}/${person.id}/editar`);
      await fill('#pessoa-motivo', 'Correção sem alterar histórico vinculado');
      await buttonText(`Salvar ${singular}`);
      await until(
        `document.querySelector('.feedback.success') !== null && !document.querySelector('fieldset').disabled`,
      );
      conferirVinculos(db, before);
      // A delayed get from the destroyed editor must never replace the next ID.
      await click(`a[href="#/${path}"]`);
      await until(`document.querySelector('mnr-pessoas') !== null`);
      const other = catalog.listPeople(kind, { busca: 'Página 00' })[0];
      const getChannel = `cadastros:${path}:obter`;
      const originalGet = ipcMain._invokeHandlers.get(getChannel);
      let releaseGet;
      ipcMain.removeHandler(getChannel);
      ipcMain.handle(getChannel, (...args) =>
        args[1] === person.id
          ? new Promise((resolveReply) => {
              releaseGet = () => resolveReply(originalGet(...args));
            })
          : originalGet(...args),
      );
      await evaluate(`location.hash='/${path}/${person.id}/editar'`);
      for (let attempt = 0; attempt < 100 && !releaseGet; attempt++) await pause(20);
      assert(releaseGet);
      await evaluate(`location.hash='/${path}/${other.id}/editar'`);
      await until(
        `document.querySelector('#pessoa-nome')?.value === ${JSON.stringify(other.nome)}`,
      );
      releaseGet();
      await pause(100);
      assert.equal(await evaluate(`document.querySelector('#pessoa-nome').value`), other.nome);
      ipcMain.removeHandler(getChannel);
      ipcMain.handle(getChannel, originalGet);
      const otherPath = path === 'clientes' ? 'fornecedores' : 'clientes';
      const otherPerson = path === 'clientes' ? linked.fornecedor : linked.cliente;
      await fill('#pessoa-nome', 'Rascunho protegido');
      await evaluate(`location.hash='/${otherPath}/${otherPerson.id}/editar'`);
      await until(`document.querySelector('dialog[open]') !== null`);
      await key('Escape');
      await until(`location.hash === '#/${path}/${other.id}/editar'`);
      assert.equal(
        await evaluate(`document.querySelector('#pessoa-nome').value`),
        'Rascunho protegido',
      );
      await evaluate(`location.hash='/${otherPath}/${otherPerson.id}/editar'`);
      await until(`document.querySelector('dialog[open]') !== null`);
      await buttonText('Confirmar');
      await until(
        `location.hash === '#/${otherPath}/${otherPerson.id}/editar' && document.querySelector('#pessoa-nome')?.value.startsWith('Vínculo')`,
      );
      await evaluate(`location.hash='/${path}/0/editar'`);
      await until(
        `document.querySelector('mnr-content-state')?.textContent.includes('Identificador')`,
      );
      assert.equal(await evaluate(`document.querySelector('form') === null`), true);
      await evaluate(`location.hash='/${path}/${person.id}/editar'`);
      await until(
        `document.querySelector('#pessoa-nome')?.value === ${JSON.stringify(person.nome + ' corrigido')}`,
      );
      for (const active of [false, true]) {
        await buttonText(`${active ? 'Reativar' : 'Inativar'} ${singular}`);
        await until(`document.querySelector('dialog[open]') !== null`);
        await key('Escape');
        await until(`document.activeElement.closest('mnr-button')?.hasAttribute('data-status')`);
        await buttonText(`${active ? 'Reativar' : 'Inativar'} ${singular}`);
        await until(`document.querySelector('dialog[open]') !== null`);
        await key('Tab');
        await key('Tab');
        assert.equal(
          await evaluate(`document.activeElement.closest('dialog') !== null`),
          true,
          'Dialog traps focus',
        );
        await fill('#confirm-reason', 'Situação com documento confirmado');
        const saveChannel = `cadastros:${path}:salvar`;
        const healthySave = ipcMain._invokeHandlers.get(saveChannel);
        let first = true;
        const statusCommands = [];
        ipcMain.removeHandler(saveChannel);
        ipcMain.handle(saveChannel, async (...args) => {
          statusCommands.push(JSON.stringify(args[1]));
          if (first) {
            first = false;
            if (active)
              return {
                ok: false,
                error: { code: 'DATABASE_BUSY', message: 'Banco ocupado. Repita o mesmo comando.' },
              };
            const result = await healthySave(...args);
            assert.equal(result.ok, true);
            throw new Error('Test-only lost status reply after commit');
          }
          return healthySave(...args);
        });
        await buttonText('Confirmar');
        await until(
          `document.querySelector('mnr-pessoa-editor')?.textContent.includes('Tentar confirmar novamente')`,
        );
        const auditBeforeRetry = db.prepare('SELECT count(*) n FROM eventos_auditoria').get().n;
        await pause(200);
        assert.equal(statusCommands.length, 1);
        await buttonText('Tentar confirmar novamente');
        await until(
          `document.querySelector('.feedback.success') !== null && !document.querySelector('fieldset').disabled`,
        );
        assert.equal(statusCommands.length, 2);
        assert.equal(statusCommands[0], statusCommands[1]);
        assert.equal(
          db.prepare('SELECT count(*) n FROM eventos_auditoria').get().n,
          auditBeforeRetry + (active ? 1 : 0),
        );
        ipcMain.removeHandler(saveChannel);
        ipcMain.handle(saveChannel, healthySave);
        const saved = catalog.getPerson(kind, person.id);
        assert.equal(saved.ativo, active);
        for (const field of ['documento', 'telefone', 'email', 'endereco', 'observacoes'])
          assert.equal(saved[field], person[field]);
        conferirVinculos(db, before);
      }
      // Do not invert an already applied target state after the confirming reread.
      await buttonText(`Inativar ${singular}`);
      await until(`document.querySelector('dialog[open]') !== null`);
      const { criadoEm, atualizadoEm, ...data } = catalog.getPerson(kind, person.id);
      assert(criadoEm && atualizadoEm);
      catalog.savePerson(kind, cmd({ ...data, ativo: false }));
      const operations = db.prepare('SELECT count(*) n FROM operacoes').get().n;
      await fill('#confirm-reason', 'Alvo já aplicado');
      await buttonText('Confirmar');
      await until(`document.querySelector('.feedback')?.textContent.includes('já está aplicada')`);
      assert.equal(db.prepare('SELECT count(*) n FROM operacoes').get().n, operations);
      assert.equal(catalog.getPerson(kind, person.id).ativo, false);
      await click(`a[href="#/${path}"]`);
      await until(`document.querySelector('mnr-pessoas') !== null`);
      await evaluate(
        `document.querySelector('#pessoa-active').value='false'; document.querySelector('#pessoa-active').dispatchEvent(new Event('change', {bubbles:true}))`,
      );
      await fill('#pessoa-search', 'vinculo');
      await until(`document.querySelectorAll('tbody tr').length === 1`);
      await evaluate(
        `document.querySelector('#pessoa-active').value='all'; document.querySelector('#pessoa-active').dispatchEvent(new Event('change', {bubbles:true}))`,
      );
      await until(`document.querySelectorAll('tbody tr').length === 1`);
      conferirVinculos(db, before);
    }
    console.log(
      'PESSOAS_LINKS_UI_OK: confirmed documents, payments, installments and stock unchanged',
    );
  } finally {
    db.close();
  }
};
