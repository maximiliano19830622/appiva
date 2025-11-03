-- Tablas base
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  direccion TEXT,
  ciudad TEXT,
  cuit TEXT,
  codigo_postal TEXT,
  telefono TEXT,
  correo TEXT,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS certificados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE,
  fecha_cert TEXT,
  fecha_fact TEXT,
  numero_fact TEXT,
  proveedor_id INTEGER NOT NULL,
  total_base REAL NOT NULL DEFAULT 0,
  total_iva REAL NOT NULL DEFAULT 0,
  total_abonado REAL NOT NULL DEFAULT 0,
  lineas_json TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador',
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
);

CREATE TABLE IF NOT EXISTS numeradores (
  nombre TEXT PRIMARY KEY,
  valor_actual INTEGER NOT NULL
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_certificados_proveedor ON certificados(proveedor_id);
