const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

let SQL; // sql.js module
let sqliteDb; // sql.js Database instance
let readyPromise;

// Simple adapter to mimic better-sqlite3 API used in server/index.js
const adapter = {
  prepare(sql) {
    const isWrite = /^\s*(insert|update|delete|create|drop|alter|replace)/i.test(sql);
    return {
      all: (...params) => {
        const stmt = sqliteDb.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      get: (...params) => {
        const stmt = sqliteDb.prepare(sql);
        stmt.bind(params);
        const has = stmt.step();
        const row = has ? stmt.getAsObject() : undefined;
        stmt.free();
        return row;
      },
      run: (...params) => {
        const stmt = sqliteDb.prepare(sql);
        stmt.bind(params);
        // step until done (for statements that might yield multiple steps)
        while (stmt.step()) { /* no-op */ }
        stmt.free();
        if (isWrite) saveToDisk();
        const last = adapter.prepare('SELECT last_insert_rowid() AS id').get();
        return { lastInsertRowid: last ? last.id : undefined };
      }
    };
  },
  exec(sql) {
    sqliteDb.exec(sql);
    saveToDisk();
  }
};

function saveToDisk() {
  const data = sqliteDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function loadFromDisk() {
  if (fs.existsSync(DB_PATH)) {
    const filebuffer = fs.readFileSync(DB_PATH);
    sqliteDb = new SQL.Database(new Uint8Array(filebuffer));
  } else {
    sqliteDb = new SQL.Database();
    // Initialize schema
    const initSqlPath = path.join(__dirname, '..', 'scripts', 'sqlite-init.sql');
    const initSql = fs.readFileSync(initSqlPath, 'utf8');
    sqliteDb.exec(initSql);
    saveToDisk();
  }
}

function ensureSqlWasm() {
  // Ensure sql-wasm.wasm can be located
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const baseDir = path.dirname(wasmPath);
  return initSqlJs({ locateFile: (f) => path.join(baseDir, f) });
}

function initDb() {
  if (readyPromise) return;
  if (!fs.existsSync(path.join(__dirname, '..', 'data'))) {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
  }
  if (!fs.existsSync(path.join(__dirname, 'assets'))) {
    fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
  }
  readyPromise = (async () => {
    SQL = await ensureSqlWasm();
    loadFromDisk();
    ensureSchemaUpgrades();
  })();
}

function ready() {
  return readyPromise || Promise.resolve();
}

function tx(fn) {
  // sql.js tiene limitaciones con COMMIT/ROLLBACK cuando se exporta frecuentemente.
  // Simplificamos: ejecutamos la función y persistimos, sin transacción explícita.
  return (...args) => {
    const result = fn(...args);
    saveToDisk();
    return result;
  };
}

module.exports = { db: adapter, initDb, tx, ready };

// --- Schema upgrades for existing DBs ---
function ensureSchemaUpgrades() {
  try {
    const res = sqliteDb.exec("PRAGMA table_info('proveedores')");
    const cols = (res && res[0] && res[0].values) ? res[0].values.map(v => v[1]) : [];
    if (!cols.includes('cuit')) {
      sqliteDb.exec("ALTER TABLE proveedores ADD COLUMN cuit TEXT");
    }
    if (!cols.includes('codigo_postal')) {
      sqliteDb.exec("ALTER TABLE proveedores ADD COLUMN codigo_postal TEXT");
    }
    if (!cols.includes('telefono')) {
      sqliteDb.exec("ALTER TABLE proveedores ADD COLUMN telefono TEXT");
    }
    if (!cols.includes('correo')) {
      sqliteDb.exec("ALTER TABLE proveedores ADD COLUMN correo TEXT");
    }
    const resC = sqliteDb.exec("PRAGMA table_info('certificados')");
    const colsC = (resC && resC[0] && resC[0].values) ? resC[0].values.map(v => v[1]) : [];
    if (!colsC.includes('numero_fact')) {
      sqliteDb.exec("ALTER TABLE certificados ADD COLUMN numero_fact TEXT");
    }
    // Numeradores: inicializar certificados en 26485 (valor_actual=26484)
    const certCountRes = sqliteDb.exec("SELECT COUNT(1) AS c FROM certificados");
    const certCount = (certCountRes && certCountRes[0] && certCountRes[0].values && certCountRes[0].values[0]) ? certCountRes[0].values[0][0] : 0;
    const numRes = sqliteDb.exec("SELECT nombre, valor_actual FROM numeradores WHERE nombre='certificados'");
    if (!numRes || !numRes[0] || !numRes[0].values || numRes[0].values.length === 0) {
      sqliteDb.exec("INSERT INTO numeradores (nombre, valor_actual) VALUES ('certificados', 26484)");
    } else if (certCount === 0) {
      const current = numRes[0].values[0][1];
      if (typeof current === 'number' && current < 26484) {
        sqliteDb.exec("UPDATE numeradores SET valor_actual=26484 WHERE nombre='certificados'");
      }
    }
    saveToDisk();
  } catch (_) {
    // ignore
  }
}
