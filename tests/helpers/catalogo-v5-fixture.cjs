const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const base = require('./approved-v5.cjs').approvedRuntime();
const { backupFixture } = require(path.join(base, 'tests/helpers/backup-fixture.cjs'));
const { snapshot } = require(path.join(base, 'tests/helpers/financeiro-consulta-fixture.cjs'));
const { BackupController } = require(path.join(base, 'dist/electron/services/backup/controller'));
async function legacyFixture() {
  const metadata = path.resolve('.cache/pre52a-legacy-fixture.json');
  if (fs.existsSync(metadata)) return JSON.parse(fs.readFileSync(metadata, 'utf8'));
  const f = await backupFixture(undefined, true),
    archive = path.join(f.outputs, 'schema5-aprovado-026daa0.mnrbackup');
  const legacyCommand = f.command({
      ...f.cycle.productData,
      sku: 'LEGADO-PRE52A',
      codigoBarras: '0000123456789',
      volumeMicrolitros: 50000,
      concentracao: 'EDP',
    }),
    legacyResult = f.cycle.cat.saveProduct(legacyCommand);
  const stateA = snapshot(f.db),
    sequencesA = f.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),
    productRowsA = f.db.prepare('SELECT * FROM produtos ORDER BY id').all();
  const controller = new BackupController({
    root: f.root,
    db: f.db,
    photos: f.photos,
    version: '0.1.0',
    protectedRoots: [f.root],
    chooseBackup: async () => archive,
    chooseRestore: async () => undefined,
    restart: () => {},
    openProtections: async () => {},
  });
  const backup = await controller.create();
  f.cycle.cat.saveProduct(
    f.command({
      ...f.cycle.productData,
      sku: 'LEGACY-B-ONLY',
      nome: 'Perfume exclusivo B antes da migração',
      volumeMicrolitros: 30000,
    }),
  );
  const stateB = snapshot(f.db),
    sequencesB = f.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
  f.db.close();
  const data = {
    commit: '026daa0',
    schema: 5,
    root: f.root,
    data: f.data,
    images: f.images,
    archive,
    archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    backup,
    stateA,
    stateB,
    sequencesA,
    sequencesB,
    productRowsA,
    legacyCommand,
    legacyResult,
  };
  fs.writeFileSync('.cache/pre52a-legacy-fixture.json', JSON.stringify(data, null, 2), {
    flag: 'wx',
  });
  console.log('LEGITIMATE_APPROVED_SCHEMA5_BACKUP_CREATED', archive);
  return data;
}
module.exports = { legacyFixture };
async function legacyUiFixture(root) {
  const old = await legacyFixture();
  if (fs.readdirSync(root).length)
    throw Error('Legacy fixture requires a fresh exclusive test root');
  for (const dir of ['data', 'images'])
    fs.cpSync(path.join(old.root, dir), path.join(root, dir), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  const Database = require('better-sqlite3'),
    db = new Database(path.join(root, 'data/mnr-perfumes.db'), {
      readonly: true,
      fileMustExist: true,
    });
  const product = db.prepare("SELECT * FROM produtos WHERE sku='CICLO'").get(),
    manual = db.prepare("SELECT id FROM produtos WHERE sku='AJ-CICLO'").get(),
    sale = db
      .prepare(
        "SELECT id,cliente_id FROM documentos WHERE tipo='VENDA' AND estado='CONFIRMADO' ORDER BY id LIMIT 1",
      )
      .get();
  const command = (dados) => ({
    operacaoId: crypto.randomUUID(),
    motivo: 'Fixture legado legítimo',
    dados,
  });
  const productData = {
    sku: product.sku,
    nome: product.nome,
    marcaId: product.marca_id,
    categoriaId: product.categoria_id,
    precoVendaCentavos: product.preco_venda_centavos,
    estoqueMinimo: product.estoque_minimo,
    unidadeComercial: 'UN',
  };
  const outputs = fs.mkdtempSync(path.resolve('.local-data/test/catalogo-legacy-outputs-'));
  return {
    root,
    data: path.join(root, 'data'),
    images: path.join(root, 'images'),
    db,
    outputs,
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
module.exports.legacyUiFixture = legacyUiFixture;
