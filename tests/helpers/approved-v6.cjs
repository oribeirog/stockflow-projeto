// Frozen, owner-approved pre-branding runtime. Never check out or rewrite history.
const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
function approvedRuntime6() {
  const root = path.resolve(__dirname, '../..'),
    base = path.join(root, '.cache/pre52b-approved-v6');
  if (fs.existsSync(path.join(base, 'dist/electron/services/backup/controller.js'))) return base;
  fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
  if (fs.existsSync(base)) throw Error('Incomplete approved runtime preserved');
  const stage = fs.mkdtempSync(path.join(root, '.cache/pre52b-approved-v6-preparing-'));
  const archive = stage + '.tar';
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, 'd359480'], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', stage], { cwd: root });
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules/typescript/bin/tsc'),
      '-p',
      path.join(stage, 'tsconfig.electron.json'),
    ],
    {
      cwd: root,
      env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    },
  );
  fs.renameSync(stage, base);
  return base;
}
async function legacyFixture6() {
  const metadata = path.resolve('.cache/pre52b-legacy6-fixture.json');
  if (fs.existsSync(metadata)) return JSON.parse(fs.readFileSync(metadata, 'utf8'));
  const base = approvedRuntime6();
  const { backupFixture } = require(path.join(base, 'tests/helpers/backup-fixture.cjs'));
  const { snapshot } = require(path.join(base, 'tests/helpers/financeiro-consulta-fixture.cjs'));
  const { BackupController } = require(path.join(base, 'dist/electron/services/backup/controller'));
  const { recoverAndOpen, selection, selectedPaths } = require(
    path.join(base, 'dist/electron/services/backup/control'),
  );
  const { hashFile } = require(path.join(base, 'dist/electron/services/backup/io'));
  const f = await backupFixture(undefined, true),
    archive = path.join(f.outputs, 'MNR-Perfumes-schema6-d359480.mnrbackup');
  const controller = new BackupController({
    root: f.root,
    db: f.db,
    photos: f.photos,
    version: '0.1.0',
    protectedRoots: [f.root],
    chooseBackup: async () => archive,
    chooseRestore: async () => archive,
    restart: () => {},
    openProtections: async () => {},
  });
  await controller.create();
  const review = await controller.inspect();
  await controller.restore({ token: review.token, confirmacao: 'RESTAURAR' });
  f.db.close();
  const opened = await recoverAndOpen(f.root, '0.1.0');
  const result = {
    commit: 'd359480',
    schema: 6,
    root: f.root,
    archive,
    archiveSha256: (await hashFile(archive)).sha256,
    stateA: snapshot(opened.db),
    sequencesA: opened.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),
    active: await selection(f.root),
    paths: selectedPaths(f.root, await selection(f.root)),
  };
  opened.db.close();
  fs.writeFileSync(metadata, JSON.stringify(result, null, 2));
  return result;
}
module.exports = { approvedRuntime6, legacyFixture6 };
async function legacyProfile6(root) {
  const old = await legacyFixture6();
  if (fs.readdirSync(root).length) throw Error('Legacy profile requires an exclusive empty root');
  for (const entry of fs.readdirSync(old.root))
    fs.cpSync(path.join(old.root, entry), path.join(root, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  const { selection, selectedPaths } = require('../../dist/electron/services/backup/control');
  const paths = selectedPaths(root, await selection(root));
  const Database = require('better-sqlite3'),
    crypto = require('node:crypto');
  const db = new Database(path.join(paths.data, 'mnr-perfumes.db'), {
    readonly: true,
    fileMustExist: true,
  });
  const product = db.prepare("SELECT * FROM produtos WHERE sku='CICLO'").get();
  const manual = db.prepare("SELECT id FROM produtos WHERE sku='AJ-CICLO'").get();
  const sale = db
    .prepare(
      "SELECT id,cliente_id FROM documentos WHERE tipo='VENDA' AND estado='CONFIRMADO' ORDER BY id LIMIT 1",
    )
    .get();
  const command = (dados) => ({
    operacaoId: crypto.randomUUID(),
    motivo: 'Perfil anterior aprovado',
    dados,
  });
  const productData = {
    sku: product.sku,
    nome: product.nome,
    marcaId: product.marca_id,
    categoriaId: product.categoria_id,
    precoVendaCentavos: product.preco_venda_centavos,
    estoqueMinimo: product.estoque_minimo,
    unidadeComercial: product.unidade_comercial,
  };
  return {
    root,
    ...paths,
    db,
    outputs: fs.mkdtempSync(path.resolve('.local-data/test/pre52b-outputs-')),
    command,
    png: require('./backup-fixture.cjs').png,
    cycle: {
      productId: product.id,
      productData,
      manual,
      clienteId: sale.cliente_id,
      state: { sale },
      stockCommand: (dados) => ({ ...command(dados), dataEfetiva: '2026-11-01' }),
    },
  };
}
module.exports.legacyProfile6 = legacyProfile6;
