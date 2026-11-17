// External UI harness; clock injection affects only the policy instance, never Windows/SQLite.
import assert from 'node:assert/strict';
import { renameSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export async function recurringScenario({ e, m, until, click, key, call, mode, root, outputs }) {
  await until(`window.mnrApi.backupRecorrente.estado().then(r=>r.ok&&r.data.dias===1)`);
  const base = await m(`(()=>{const d=new Date();d.setHours(12,0,0,0);return d.toISOString()})()`);
  const clock = async (offset) => {
    const day = new Date(base);
    day.setDate(day.getDate() + offset);
    await m(
      `globalThis.__policyDay=${JSON.stringify(day.toISOString())};process.mainModule.require(__e.app.getAppPath()+'/dist/electron/services/backup/recurring.js').RecurringBackupService.prototype.now=function(){return new Date(globalThis.__policyDay)}`,
    );
  };
  await e(`location.hash='#/configuracoes/backup'`);
  await until(`!!document.getElementById('recurring-backup-title')`);
  // Native folder chooser is controlled externally, as in the existing 5.1 harness.
  await m(`__open.push(${JSON.stringify(outputs)})`);
  await click('Selecionar ou alterar pasta');
  await until(
    `document.getElementById('recurring-backup-destination')?.textContent.includes(${JSON.stringify(outputs)})`,
  );
  await until(`document.activeElement===document.querySelector('#recurring-backup-folder button')`);
  await key('Tab');
  assert(
    await e(`document.activeElement===document.querySelector('#recurring-backup-run button')`),
  );
  await key('Tab', 8);
  assert(
    await e(`document.activeElement===document.querySelector('#recurring-backup-folder button')`),
  );
  // Enter reopens the native selector; its empty queue cancels without changing destination.
  await key('Enter');
  await until(
    `document.getElementById('recurring-backup-message')?.textContent.includes('cancelada')`,
  );
  await until(`document.activeElement===document.querySelector('#recurring-backup-folder button')`);
  await key('Escape');
  assert.equal((await e(`window.mnrApi.backupRecorrente.estado()`)).data.destino, outputs);
  await clock(1);
  await key('Tab');
  await until(`window.mnrApi.backupRecorrente.estado().then(r=>r.ok&&r.data.dias===2)`);
  for (let i = 0; i < 4; i++)
    assert.equal((await e(`window.mnrApi.backupRecorrente.utilizar()`)).data.dias, 2);
  await clock(2);
  await key('Tab');
  await until(
    `window.mnrApi.backupRecorrente.estado().then(r=>r.ok&&(r.data.dias===3||r.data.ultimoBackup?.tipo==='automatico'))`,
  );
  await until(
    `window.mnrApi.backupRecorrente.estado().then(r=>r.ok&&r.data.ultimoBackup?.tipo==='automatico'&&!r.data.devido&&r.data.estado!=='executando')`,
  );
  const automatic = (await e(`window.mnrApi.backupRecorrente.estado()`)).data;
  const file = join(outputs, automatic.ultimoBackup.nome),
    hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  const local = JSON.parse(readFileSync(join(root, 'backup-policy/state.json'), 'utf8'));
  assert.equal(local.state.files[0].proof.sha256, hash);
  assert.equal(local.state.files[0].proof.size, statSync(file).size);
  const ownerId = local.id;
  // Disable unattended execution only; obligation must continue counting.
  assert((await e(`window.mnrApi.backupRecorrente.configurar({habilitado:false,retencao:3})`)).ok);
  for (const d of [3, 4, 5]) {
    await clock(d);
    await e(`window.mnrApi.backupRecorrente.utilizar()`);
  }
  await until(`!!document.getElementById('backup-policy-notice')`);
  renameSync(outputs, outputs + '-offline');
  try {
    const failed = await e(`window.mnrApi.backupRecorrente.executar()`);
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, 'ENOENT');
    await until(
      `document.getElementById('recurring-backup-state')?.textContent.includes('erro') || document.getElementById('recurring-backup-state')?.textContent.includes('Atenção')`,
    );
    await click('Continuar — mídia indisponível');
    await until(
      `window.mnrApi.backupRecorrente.estado().then(r=>r.ok&&!!r.data.adiadoEm&&r.data.devido)`,
    );
    assert(await e(`!!document.getElementById('backup-policy-notice')`));
    for (const [width, height] of [
      [1366, 768],
      [1000, 700],
      [640, 480],
    ])
      for (const zoom of [1, 1.25, 1.5]) {
        await m(
          `__e.BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().startsWith(${JSON.stringify(mode === 'http' ? 'http://127.0.0.1:4200' : 'mnr://app')})).setContentSize(${width},${height})`,
        );
        await call('Emulation.setDeviceMetricsOverride', {
          width: Math.round(width / zoom),
          height: Math.round(height / zoom),
          deviceScaleFactor: zoom,
          mobile: false,
        });
        await e(
          `document.getElementById('recurring-backup-folder').scrollIntoView({block:'center'})`,
        );
        assert(await e(`document.documentElement.scrollWidth<=innerWidth`));
        assert(
          await e(
            `(()=>{const r=document.querySelector('#recurring-backup-folder button').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`,
          ),
        );
        if (width === 640 || zoom === 1) {
          const shot = await call('Page.captureScreenshot', { format: 'png' });
          writeFileSync(
            `.cache/ui/backup-auto-${mode}-${width}-${zoom}.png`,
            Buffer.from(shot.data, 'base64'),
          );
        }
      }
  } finally {
    renameSync(outputs + '-offline', outputs);
  }
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await m(
    `__e.BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().startsWith(${JSON.stringify(mode === 'http' ? 'http://127.0.0.1:4200' : 'mnr://app')})).setContentSize(1366,768)`,
  );
  // Original manual backup flow below must clear this due cycle, then restoration
  // must preserve local destination/owner while requiring a fresh copy.
  return {
    ownerId,
    automatic: { name: automatic.ultimoBackup.nome, sha256: hash, bytes: statSync(file).size },
    pendingAfterDeferral: true,
    destination: outputs,
    clockHarness: 'policy prototype only',
    layouts: 9,
    keyboardAndCanceledSelector: true,
  };
}
