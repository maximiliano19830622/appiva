
const path = require('path');
const fs = require('fs');
const express = require('express');
const net = require('net');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const cp = require('child_process');
const os = require('os');
const { PDFDocument: PDFLibDocument, StandardFonts, rgb } = require('pdf-lib');
require('dotenv').config();

const { db, initDb, tx, ready } = require('./sqlite');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, '..', 'client')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

let PRIMARY_FONT_FAMILY = 'Times-Roman';
function ensureFonts(doc) {
  try {
    const candidates = [
      path.join(__dirname, 'assets', 'fonts', 'TimesNewRoman.ttf'),
      path.join(__dirname, 'assets', 'fonts', 'Times New Roman.ttf'),
      path.join(__dirname, 'assets', 'TimesNewRoman.ttf'),
      path.join(__dirname, 'assets', 'Times New Roman.ttf'),
      path.join(__dirname, 'assets', 'times.ttf'),
      path.join(__dirname, 'assets', 'fonts', 'times.ttf'),
      path.join(__dirname, 'assets', 'TimesNewRomanPSMT.ttf'),
      path.join(__dirname, 'assets', 'fonts', 'TimesNewRomanPSMT.ttf')
    ];
    const fontPath = candidates.find(p => fs.existsSync(p));
    if (fontPath) { doc.registerFont('TNR', fontPath); PRIMARY_FONT_FAMILY = 'TNR'; }
    else { PRIMARY_FONT_FAMILY = 'Times-Roman'; }
  } catch (_) { PRIMARY_FONT_FAMILY = 'Times-Roman'; }
}

// Read image pixel size (PNG/JPEG minimal parser)
function getImagePixelSize(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    // PNG
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504E47) {
      // IHDR at byte 12..29: width (4), height (4)
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // JPEG
    if (buf.length > 10 && buf[0] === 0xFF && buf[1] === 0xD8) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xFF) { offset++; continue; }
        const marker = buf[offset + 1];
        // SOF0/1/2 etc (0xC0..0xC3 typically contain size)
        if (marker >= 0xC0 && marker <= 0xC3) {
          const blockLen = buf.readUInt16BE(offset + 2);
          const height = buf.readUInt16BE(offset + 5);
          const width = buf.readUInt16BE(offset + 7);
          return { width, height };
        }
        // Skip segment
        const len = buf.readUInt16BE(offset + 2);
        if (!len) break;
        offset += 2 + len;
      }
    }
  } catch (_) {}
  return null;
}

// DOT support removido: se usa solo CSV

app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Numeración preview y set
app.get('/api/numeracion/certificados/next', (req, res) => {
  const row = db.prepare("SELECT valor_actual FROM numeradores WHERE nombre='certificados'").get();
  const current = row ? Number(row.valor_actual) : 26484; // primera próxima 26485
  res.json({ next: current + 1 });
});

app.post('/api/numeracion/certificados/set', (req, res) => {
  const n = Number((req.body && req.body.next) || 0);
  if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'Número inválido' });
  const maxRow = db.prepare('SELECT MAX(numero) AS m FROM certificados').get();
  const maxUsed = Number(maxRow && maxRow.m || 0);
  if (n <= maxUsed) return res.status(409).json({ error: 'Número ya utilizado o menor al máximo existente' });
  const rn = db.prepare("SELECT valor_actual FROM numeradores WHERE nombre='certificados'").get();
  if (!rn) db.prepare("INSERT INTO numeradores (nombre, valor_actual) VALUES ('certificados', ?)").run(n - 1);
  else db.prepare("UPDATE numeradores SET valor_actual=? WHERE nombre='certificados'").run(n - 1);
  res.json({ ok: true, next: n });
});

// Proveedores (búsqueda simple o paginada)
app.get('/api/proveedores', (req, res) => {
  const q = (req.query.q || '').trim();
  const paged = req.query.paged === '1' || typeof req.query.page !== 'undefined';
  if (!paged) {
    if (!q) return res.json(db.prepare('SELECT id, nombre, direccion, ciudad, cuit, codigo_postal, telefono, correo FROM proveedores ORDER BY nombre ASC LIMIT 100').all());
    return res.json(db.prepare('SELECT id, nombre, direccion, ciudad, cuit, codigo_postal, telefono, correo FROM proveedores WHERE nombre LIKE ? ORDER BY nombre ASC LIMIT 50').all(`%${q}%`));
  }
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
  const sortBy = String(req.query.sortBy || 'nombre');
  const sortDir = (String(req.query.sortDir || 'asc').toLowerCase() === 'desc') ? 'DESC' : 'ASC';
  const sortMap = { nombre:'nombre', ciudad:'ciudad', direccion:'direccion', cuit:'cuit', codigo_postal:'codigo_postal', telefono:'telefono', correo:'correo', creado_en:'creado_en' };
  const sortCol = sortMap[sortBy] || 'nombre';
  const offset = (page - 1) * pageSize;
  const total = (q ? db.prepare('SELECT COUNT(1) AS c FROM proveedores WHERE nombre LIKE ?').get(`%${q}%`) : db.prepare('SELECT COUNT(1) AS c FROM proveedores').get()).c || 0;
  const items = q
    ? db.prepare(`SELECT id, nombre, direccion, ciudad, cuit, codigo_postal, telefono, correo FROM proveedores WHERE nombre LIKE ? ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`).all(`%${q}%`, pageSize, offset)
    : db.prepare(`SELECT id, nombre, direccion, ciudad, cuit, codigo_postal, telefono, correo FROM proveedores ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`).all(pageSize, offset);
  res.json({ items, total, page, pageSize, sortBy, sortDir: sortDir.toLowerCase() });
});

app.post('/api/proveedores', (req, res) => {
  const { nombre, direccion, ciudad, cuit, codigo_postal, telefono, correo } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const info = db.prepare('INSERT INTO proveedores (nombre, direccion, ciudad, cuit, codigo_postal, telefono, correo) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(nombre.trim(), direccion || '', ciudad || '', cuit || '', codigo_postal || '', telefono || '', correo || '');
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'Proveedor ya existe' });
    res.status(500).json({ error: 'Error al crear proveedor' });
  }
});

app.put('/api/proveedores/:id', (req, res) => {
  const id = Number(req.params.id);
  const { nombre, direccion, ciudad, cuit, codigo_postal, telefono, correo } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    db.prepare('UPDATE proveedores SET nombre=?, direccion=?, ciudad=?, cuit=?, codigo_postal=?, telefono=?, correo=? WHERE id=?')
      .run(nombre || '', direccion || '', ciudad || '', cuit || '', codigo_postal || '', telefono || '', correo || '', id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error al actualizar' }); }
});

app.delete('/api/proveedores/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
  db.prepare('DELETE FROM proveedores WHERE id=?').run(id);
  res.json({ ok: true });
});

// Export CSV proveedores
app.get('/api/proveedores/export', (req, res) => {
  const q = (req.query.q || '').trim();
  const rows = q
    ? db.prepare('SELECT nombre, direccion, ciudad, cuit, codigo_postal, telefono, correo FROM proveedores WHERE nombre LIKE ? ORDER BY nombre ASC').all(`%${q}%`)
    : db.prepare('SELECT nombre, direccion, ciudad, cuit, codigo_postal, telefono, correo FROM proveedores ORDER BY nombre ASC').all();
  const header = ['Nombre','Direccion','Ciudad','CUIT','CodigoPostal','Telefono','Correo'];
  const esc = (v)=>{ const s= v==null ? '' : String(v); return /[",\n\r]/.test(s)? '"'+s.replace(/"/g,'""')+'"' : s; };
  const csv = [header.join(',')].concat(rows.map(r=>[r.nombre,r.direccion,r.ciudad,r.cuit,r.codigo_postal,r.telefono,r.correo].map(esc).join(','))).join('\r\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename="proveedores.csv"'); res.send('\uFEFF'+csv);
});

// Numeración autoincremental
const nextNumberTx = tx((nombre) => {
  const row = db.prepare('SELECT valor_actual FROM numeradores WHERE nombre=?').get(nombre);
  if (!row) {
    const initial = (nombre === 'certificados') ? 26484 : 0;
    db.prepare('INSERT INTO numeradores (nombre, valor_actual) VALUES (?, ?)').run(nombre, initial);
  }
  const current = row ? row.valor_actual : ((nombre === 'certificados') ? 26484 : 0);
  const next = current + 1;
  db.prepare('UPDATE numeradores SET valor_actual=? WHERE nombre=?').run(next, nombre);
  return next;
});

// Certificados list paginado o simple
app.get('/api/certificados', (req, res) => {
  const q = (req.query.q || '').trim();
  const year = (req.query.year || '').trim();
  const month = (req.query.month || '').trim();
  const estado = (req.query.estado || '').trim();
  const paged = req.query.paged === '1' || typeof req.query.page !== 'undefined';
  const where = [];
  const params = [];
  if (q) { where.push('p.nombre LIKE ?'); params.push(`%${q}%`); }
  if (year) { where.push("substr(c.fecha_cert,1,4)=?"); params.push(year); }
  if (month) { where.push("substr(c.fecha_cert,6,2)=?"); params.push(month.padStart(2,'0')); }
  if (estado) { where.push('c.estado=?'); params.push(estado); }
  const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
  if (!paged) {
    const limit = Math.min(500, Number(req.query.limit || 100));
    const rows = db.prepare(`SELECT c.id,c.numero,c.fecha_cert,c.fecha_fact,c.numero_fact,c.total_base,c.total_iva,c.total_abonado,c.estado,p.nombre AS proveedor_nombre FROM certificados c JOIN proveedores p ON p.id=c.proveedor_id ${whereSql} ORDER BY c.id DESC LIMIT ?`).all(...params, limit);
    return res.json(rows);
  }
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
  const sortBy = String(req.query.sortBy || 'numero');
  const sortDir = (String(req.query.sortDir || 'desc').toLowerCase() === 'asc') ? 'ASC' : 'DESC';
  const sortMap = { numero:'c.numero', fecha_cert:'c.fecha_cert', fecha_fact:'c.fecha_fact', numero_fact:'c.numero_fact', proveedor:'p.nombre', base:'c.total_base', iva:'c.total_iva', abonado:'c.total_abonado' };
  const sortCol = sortMap[sortBy] || 'c.numero';
  const offset = (page - 1) * pageSize;
  const total = (db.prepare(`SELECT COUNT(1) AS c FROM certificados c JOIN proveedores p ON p.id=c.proveedor_id ${whereSql}`).get(...params).c) || 0;
  const items = db.prepare(`SELECT c.id,c.numero,c.fecha_cert,c.fecha_fact,c.numero_fact,c.total_base,c.total_iva,c.total_abonado,c.estado,p.nombre AS proveedor_nombre FROM certificados c JOIN proveedores p ON p.id=c.proveedor_id ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  res.json({ items, total, page, pageSize, sortBy, sortDir: sortDir.toLowerCase() });
});

app.get('/api/certificados/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
  const row = db.prepare('SELECT * FROM certificados WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  res.json(row);
});

// Buscar certificado por número exacto
app.get('/api/certificados-by-numero', (req, res) => {
  const num = Number(req.query.numero);
  if (!Number.isFinite(num) || num <= 0) return res.status(400).json({ error: 'Número inválido' });
  const row = db.prepare('SELECT id, numero FROM certificados WHERE numero=?').get(num);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  res.json(row);
});

app.post('/api/certificados', (req, res) => {
  const { fecha_cert, fecha_fact, numero_fact, proveedor_id, total_base, total_iva, total_abonado, lineas, numero_forzado } = req.body || {};
  // Proveedor opcional: crear placeholder
  let proveedorId = proveedor_id;
  if (!proveedorId) {
    try { db.prepare("INSERT INTO proveedores (nombre, direccion, ciudad) VALUES ('Sin proveedor', '', '')").run(); } catch(_){}
    const r = db.prepare("SELECT id FROM proveedores WHERE nombre='Sin proveedor'").get();
    proveedorId = r ? r.id : null;
  }
  if ([total_base, total_iva].some(v => typeof v !== 'number' || v < 0)) return res.status(400).json({ error: 'Montos inválidos' });

  try {
    const abonado_calc = Math.max(0, Number(total_base) - Number(total_iva));
    let numeroAsignado;
    if (typeof numero_forzado === 'number' && isFinite(numero_forzado) && numero_forzado > 0) {
      const exists = db.prepare('SELECT id FROM certificados WHERE numero=?').get(numero_forzado);
      if (exists) return res.status(409).json({ error: 'Número de certificado ya usado' });
      numeroAsignado = numero_forzado;
    } else {
      // No avanzar numeración automáticamente desde aquí
      return res.status(400).json({ error: 'Número requerido' });
    }
    const info = db.prepare(`INSERT INTO certificados (numero, fecha_cert, fecha_fact, numero_fact, proveedor_id, total_base, total_iva, total_abonado, lineas_json, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador')`)
      .run(numeroAsignado, fecha_cert || null, fecha_fact || null, numero_fact || null, proveedorId, total_base, total_iva, abonado_calc, JSON.stringify(lineas || []));
    res.status(201).json({ id: info.lastInsertRowid, numero: numeroAsignado });
  } catch (e) {
    console.error('Error al crear certificado:', e);
    res.status(500).json({ error: 'Error al crear certificado', detail: String(e && e.message ? e.message : e) });
  }
});

// PDF generar (preview o final)
app.get('/api/certificados/:id/pdf', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
  const cert = db.prepare(`SELECT c.*, p.nombre as proveedor_nombre, p.direccion as proveedor_direccion, p.ciudad as proveedor_ciudad, p.cuit as proveedor_cuit, p.codigo_postal as proveedor_codigo_postal FROM certificados c JOIN proveedores p ON p.id=c.proveedor_id WHERE c.id=?`).get(id);
  if (!cert) return res.status(404).json({ error: 'No encontrado' });

  const asDownload = req.query.download === '1';
  const isPreview = req.query.preview === '1';
  const debugMode = String(req.query.debug || '').toLowerCase();

  // Render directo con PDFKit + CSV (sin motores alternativos)
  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${asDownload ? 'attachment' : 'inline'}; filename=certificado_${cert.numero}.pdf`);

    const doc = new PDFDocument({ size: 'LETTER', layout: 'portrait', margin: 0 });
    ensureFonts(doc);
    // Important: pipe before drawing to avoid empty PDFs on some setups
    doc.pipe(res);

    const bgCandidates = [
      path.join(__dirname, 'assets', 'background_letter.png'),
      path.join(__dirname, 'assets', 'background_letter.jpg'),
      path.join(__dirname, 'assets', 'background.png'),
      path.join(__dirname, 'assets', 'background.jpg'),
      path.join(__dirname, 'assets', 'background_a4.png')
    ];
    const skipBg = String(req.query.no_bg || '').trim() === '1';
    const bgPath = skipBg ? null : bgCandidates.find(p => fs.existsSync(p));
    if (bgPath) {
      try { doc.image(bgPath, 0, 0, { width: doc.page.width, height: doc.page.height }); } catch(_){}
    }

    // Debug overlay options
    if (debugMode === 'layout-grid' || debugMode === 'grid') { try { drawGrid(doc, 10); } catch(_){} }
    if (debugMode === 'layout' || debugMode === 'layout-grid') { try { renderCsvDebug(doc); } catch(e){ console.error('layout debug error', e); } }

    const q = req.query || {};
    const tplOpt = {
      fontName: q.tpl_font,
      monospace: /^(1|true|yes)$/i.test(String(q.tpl_monospace || '')),
      fontPt: Number(q.tpl_font_pt || ''),
      lineGapPt: Number(q.tpl_line_gap_pt || ''),
      charSpacingPt: Number(q.tpl_char_spacing_pt || ''),
      leftMm: Number(q.tpl_left_mm || ''),
      topMm: Number(q.tpl_top_mm || ''),
      tabSize: Number(q.tpl_tab_size || ''),
      scaleX: Number(q.tpl_scale_x || ''),
      scaleY: Number(q.tpl_scale_y || ''),
      // Ajustes globales de layout (opcionales)
      offsetXmm: Number(q.offset_x_mm || process.env.LAYOUT_OFFSET_X_MM || 0),
      offsetYmm: Number(q.offset_y_mm || process.env.LAYOUT_OFFSET_Y_MM || 0),
      layoutScaleX: (Number(q.layout_scale_x || process.env.LAYOUT_SCALE_X || 1) || 1),
      layoutScaleY: (Number(q.layout_scale_y || process.env.LAYOUT_SCALE_Y || 1) || 1)
    };

    if (!renderWithCsvLayout(doc, cert, bgPath, tplOpt)) { /*
      doc.font(PRIMARY_FONT_FAMILY).fontSize(11).text(Certificado N° , { align: 'right' });
      */
      doc.font(PRIMARY_FONT_FAMILY).fontSize(12).text('Certificado Nº', { align: 'right' });
      doc.moveDown();
      doc.font(PRIMARY_FONT_FAMILY).fontSize(12);
      doc.text(`Fecha Certificado: ${cert.fecha_cert || ''}`);
      doc.text(`Fecha Factura: ${cert.fecha_fact || ''}`);
      doc.text(`Proveedor: ${cert.proveedor_nombre}`);
    }

    doc.end();

    if (!isPreview && cert.estado !== 'impreso') {
      try { db.prepare("UPDATE certificados SET estado='impreso' WHERE id=?").run(id); } catch(_){}
    }
  } catch (e) {
    console.error('Error generando PDF:', e);
    // Limpia headers PDF para devolver JSON de error
    try { res.removeHeader('Content-Type'); res.removeHeader('Content-Disposition'); } catch(_){}
    res.status(500).json({ error: 'Error generando PDF', detail: String(e && e.message ? e.message : e) });
  }
});

// Texto por plantilla eliminado: el render se basa únicamente en CSV

// CSV layout (mm -> pt)
function renderWithCsvLayout(doc, cert, bgPath, tplOpt) {
  try {
    const layout = loadCsvLayout();
    if (!layout) return false;
    // Tratar SIEMPRE como milímetros (mm -> pt). Eliminamos heurísticas px
    const convX = (v) => (Number(v)||0) * 72 / 25.4;
    const convY = (v) => (Number(v)||0) * 72 / 25.4;
    const pt = (mm) => Number(mm) * 72 / 25.4;
    const offsetPtX = pt(Number(tplOpt.offsetXmm || 0));
    const offsetPtY = pt(Number(tplOpt.offsetYmm || 0));
    const sX = Number(tplOpt.layoutScaleX || 1) || 1;
    const sY = Number(tplOpt.layoutScaleY || 1) || 1;
    const writeField = (key, value) => {
      const f = layout.fields[key]; if (!f) return;
      const anchorX = offsetPtX + sX * convX(f.x);
      const y = offsetPtY + sY * convY(f.y);
      const size = 12; // fijo, ignorar CSV
      const width = Number(f.width_pt || 0) > 0 ? Number(f.width_pt) : 240;
      const align = (f.align || 'left');
      // Importante: X siempre se interpreta como borde izquierdo del bloque
      // para coincidir con la herramienta de calibración visual.
      const x = anchorX;
      doc.font(PRIMARY_FONT_FAMILY).fontSize(size).text(String(value ?? ''), Math.max(0, x), y, { align, width });
    };
    const tBase = Number(cert.total_base || 0); const tIva = Number(cert.total_iva || 0); const tAbonado = Math.max(0, tBase - tIva);
    writeField('numero', cert.numero);
    writeField('numero2', cert.numero);
    writeField('fecha_cert', cert.fecha_cert || '');
    writeField('numero_fact', cert.numero_fact || '');
    writeField('numero_fact2', cert.numero_fact || '');
    writeField('fecha_fact', cert.fecha_fact || '');
    writeField('proveedor_nombre', cert.proveedor_nombre || '');
    writeField('proveedor_direccion', cert.proveedor_direccion || '');
    writeField('proveedor_ciudad', cert.proveedor_ciudad || '');
    writeField('proveedor_cuit', cert.proveedor_cuit || '');
    writeField('proveedor_codigo_postal', cert.proveedor_codigo_postal || '');
    writeField('total_base', tBase.toFixed(2));
    writeField('total_abonado', tAbonado.toFixed(2));
    writeField('total_iva', tIva.toFixed(2));
    return true;
  } catch (e) { console.error('CSV layout error', e); return false; }
}

let _csvLayoutCache = null; let _csvLayoutMtime = 0;
function loadCsvLayout() {
  const candidates = [
    path.join(__dirname, 'assets', 'layout_fields.csv'),
    path.join(__dirname, '..', 'coordenadas.csv'),
    path.join(process.cwd(), 'coordenadas.csv')
  ];
  let filePath = null; for (const p of candidates) { if (fs.existsSync(p)) { filePath = p; break; } }
  if (!filePath) return null;
  const stat = fs.statSync(filePath); if (_csvLayoutCache && stat.mtimeMs === _csvLayoutMtime) return _csvLayoutCache;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length <= 1) return null;
  const header = lines[0].split(',');
  const idxX = header.findIndex(h => /x/i.test(h)); const idxY = header.findIndex(h => /y/i.test(h));
  const idxName = header.findIndex(h => /name/i.test(h)); const idxFont = header.findIndex(h => /font/i.test(h));
  const idxAlign = header.findIndex(h => /align|aline/i.test(h));
  const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
    const mapKey = (n) => { const k = normalize(n);
      if (/(^|_)numero2(_|$)/.test(k)) return 'numero2';
      if (/(^|_)numero(_|$)/.test(k)) return 'numero';
      if (k.includes('numero_fact2') || k.endsWith('numerofact2')) return 'numero_fact2';
      if (k.includes('numero_fact')) return 'numero_fact';
      if (k.includes('fecha_cert')) return 'fecha_cert';
      if (k.includes('fecha_fact')) return 'fecha_fact';
      if (k.includes('proveedor_nombre')) return 'proveedor_nombre';
      if (k.includes('proveedor_direccion')) return 'proveedor_direccion';
      if (k.includes('proveedor_ciudad')) return 'proveedor_ciudad';
      if (k.includes('proveedor_cuit') || k === 'cuit') return 'proveedor_cuit';
      if (k.includes('codigo_postal') || k.includes('proveedor_cp') || k === 'cp') return 'proveedor_codigo_postal';
      if (k.replace(/_/g,'') === 'montodelafactura' || k.includes('monto_de_factura') || k.includes('monto_factura')) return 'total_base';
      if (k.replace(/_/g,'') === 'montoabonado') return 'total_abonado';
      if (k === 'iva') return 'total_iva';
      return null; };
  const parseNum = (v) => { const s = String(v||'').trim().replace(/"/g,'').replace(/\./g,'').replace(',', '.'); const n = Number(s); return isNaN(n)? undefined : n; };
  const fields = {};
  for (let i=1;i<lines.length;i++) {
    const row = lines[i].split(','); if (!row[idxName]) continue; const key = mapKey(row[idxName]); if (!key) continue;
    const x = parseNum(row[idxX]); const y = parseNum(row[idxY]); if (x==null || y==null) continue;
    const fstr = row[idxFont] || ''; const fsize = Number(String(fstr).match(/(\d+(?:\.\d+)?)/)?.[1] || '12');
    const alignRaw = String(row[idxAlign] || '').toLowerCase();
    const align = /der/.test(alignRaw) ? 'right' : (/cent/.test(alignRaw) ? 'center' : 'left');
    // Normalizamos: X se interpreta como borde izquierdo del bloque
    fields[key] = { x, y, font_pt: fsize, align: align || 'left', units: 'mm' };
  }
  _csvLayoutCache = { fields }; _csvLayoutMtime = stat.mtimeMs; return _csvLayoutCache;
}

// (Deprecated) Legacy layout API removed in favor of calibration API below.

// Debug: draw field anchors and labels at CSV coordinates
function renderCsvDebug(doc) {
  const layout = loadCsvLayout(); if (!layout) return;
  const convX = (v) => (Number(v)||0) * 72 / 25.4;
  const convY = (v) => (Number(v)||0) * 72 / 25.4;
  const keys = Object.keys(layout.fields);
  doc.save();
  keys.forEach((k) => {
    const f = layout.fields[k]; if (!f) return;
    const x = convX(f.x); const y = convY(f.y);
    try {
      doc.lineWidth(0.5).strokeColor('#FF5555').fillColor('#FF5555');
      doc.circle(x, y, 2).fill();
      const label = String(k);
      const size = Math.max(8, Math.min(12, Number(f.font_pt || 12)));
      doc.fontSize(size).fillColor('#FF0000');
      doc.text(label, x + 4, y - size - 2, { width: 200, continued: false });
      doc.strokeColor('#FF9999').lineWidth(0.5).rect(x - 2, y - size - 4, 220, size + 8).stroke();
    } catch(_){}
  });
  doc.restore();
}

// Debug: draw grid every stepMm (default 10mm)
function drawGrid(doc, stepMm = 10) {
  const pt = (mm) => Number(mm) * 72 / 25.4;
  const step = pt(stepMm);
  const w = doc.page.width; const h = doc.page.height;
  doc.save();
  doc.lineWidth(0.2).strokeColor('#CCCCCC');
  for (let x = 0; x <= w; x += step) { doc.moveTo(x, 0).lineTo(x, h).stroke(); }
  for (let y = 0; y <= h; y += step) { doc.moveTo(0, y).lineTo(w, y).stroke(); }
  doc.lineWidth(0.8).strokeColor('#AAAAAA');
  doc.moveTo(0, 0).lineTo(w, 0).stroke();
  doc.moveTo(0, 0).lineTo(0, h).stroke();
  doc.restore();
}

// Static and root
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'index.html')));

function ensureDirs() {
  const dataDir = path.join(__dirname, '..', 'data'); if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const assetsDir = path.join(__dirname, 'assets'); if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
}

// (no-op helper removed; usamos dimensiones de página directamente)

async function findOpenPort(preferred) {
  const base = Number(preferred) || 3000;
  const candidates = [base, base + 1, base + 2, base + 3, base + 4, base + 5, base + 6, base + 7, base + 8, base + 9, 0];
  for (const p of candidates) {
    const free = await new Promise(resolve => {
      const srv = net.createServer()
        .once('error', () => resolve(null))
        .once('listening', function() {
          const port = srv.address().port; srv.close(() => resolve(port));
        })
        .listen(p);
    });
    if (free != null) return free;
  }
  return base;
}

async function start() {
  ensureDirs(); initDb(); if (typeof ready === 'function') await ready();
  const port = await findOpenPort(PORT);
  app.listen(port, () => console.log(`Servidor escuchando en http://localhost:${port}`));
}

start();

// Utilidad: generar un PDF de fondo desde PNG/JPG si no existe background_letter.pdf
async function ensureBackgroundPdf() {
  try {
    const assetsDir = path.join(__dirname, 'assets');
    const pdfOut = path.join(assetsDir, 'background_letter.pdf');
    if (fs.existsSync(pdfOut)) return pdfOut;
    const imgCandidates = [
      path.join(assetsDir, 'background_letter.png'),
      path.join(assetsDir, 'background_letter.jpg'),
      path.join(assetsDir, 'background.png'),
      path.join(assetsDir, 'background.jpg')
    ];
    const imgPath = imgCandidates.find(p => fs.existsSync(p));
    if (!imgPath) return null;
    const bytes = fs.readFileSync(imgPath);
    const doc = await PDFLibDocument.create();
    // Letter 612x792 pt
    const page = doc.addPage([612, 792]);
    let imgRef;
    if (/\.png$/i.test(imgPath)) imgRef = await doc.embedPng(bytes); else imgRef = await doc.embedJpg(bytes);
    page.drawImage(imgRef, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    const out = await doc.save();
    fs.writeFileSync(pdfOut, Buffer.from(out));
    return pdfOut;
  } catch (_) { return null; }
}


// ---- Layout calibration API (JSON <-> CSV) ----
app.get('/api/layout', (req, res) => {
  try {
    const layout = loadCsvLayout();
    if (!layout) return res.json({ fields: {} });
    res.json({ fields: layout.fields });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo leer layout', detail: String(e && e.message ? e.message : e) });
  }
});

// Probe: dibuja cruces y reglas en mm para validar mapeo sin depender del CSV
app.get('/api/probe/pdfkit', (req, res) => {
  try {
    const pt = (mm) => Number(mm) * 72 / 25.4;
    const xMm = Number(req.query.x_mm || 10);
    const yMm = Number(req.query.y_mm || 10);
    const drawGrid = String(req.query.grid||'1')==='1';
    const noBg = String(req.query.no_bg||'1')==='1';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=probe.pdf');
    const doc = new PDFDocument({ size: 'LETTER', layout: 'portrait', margin: 0 });
    ensureFonts(doc);
    doc.pipe(res);

    if (!noBg) {
      const bgCandidates = [
        path.join(__dirname, 'assets', 'background_letter.png'),
        path.join(__dirname, 'assets', 'background_letter.jpg')
      ];
      const bgPath = bgCandidates.find(p => fs.existsSync(p));
      if (bgPath) { try { doc.image(bgPath, 0, 0, { width: doc.page.width, height: doc.page.height }); } catch(_){} }
    }
    if (drawGrid) { try { drawGridFn(doc, 10); } catch(_){} }

    const x = pt(xMm), y = pt(yMm);
    doc.save();
    doc.strokeColor('#FF0000').lineWidth(1);
    doc.moveTo(0, y).lineTo(doc.page.width, y).stroke();
    doc.moveTo(x, 0).lineTo(x, doc.page.height).stroke();
    doc.circle(x, y, 4).fillAndStroke('#FF0000', '#CC0000');
    doc.font(PRIMARY_FONT_FAMILY).fontSize(12).fillColor('#000').text(`${xMm} mm, ${yMm} mm`, x+6, y+6);
    doc.restore();
    doc.end();
  } catch (e) {
    res.status(500).json({ error: 'Probe error', detail: String(e && e.message ? e.message : e) });
  }
});

// Internal alias to existing drawGrid
function drawGridFn(doc, stepMm){ try { drawGrid(doc, stepMm); } catch(_){} }

// --- Nuevo: PDF con pdf-lib usando fondo PDF/PNG y CSV (mm) ---
app.get('/api/certificados/:id/pdf-lib', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
    const cert = db.prepare(`SELECT c.*, p.nombre as proveedor_nombre, p.direccion as proveedor_direccion, p.ciudad as proveedor_ciudad, p.cuit as proveedor_cuit, p.codigo_postal as proveedor_codigo_postal FROM certificados c JOIN proveedores p ON p.id=c.proveedor_id WHERE c.id=?`).get(id);
    if (!cert) return res.status(404).json({ error: 'No encontrado' });

    // Cargar layout CSV (mm)
    const layout = loadCsvLayout();
    if (!layout) return res.status(400).json({ error: 'Layout CSV no encontrado' });

    // Cargar plantilla PDF si existe; si no, crear en blanco Letter
    const assetsDir = path.join(__dirname, 'assets');
    const pdfCandidates = [
      path.join(assetsDir, 'background_letter.pdf'),
      path.join(assetsDir, 'plantilla_fondo.pdf')
    ];
    let pdfTpl = pdfCandidates.find(p => fs.existsSync(p));
    if (!pdfTpl) {
      // Intentar generar automáticamente desde PNG/JPG
      try { pdfTpl = await ensureBackgroundPdf(); } catch(_) {}
    }

    let pdfDoc;
    let page;
    if (pdfTpl && String(req.query.no_bg || '') !== '1') {
      const bytes = fs.readFileSync(pdfTpl);
      pdfDoc = await PDFLibDocument.load(bytes);
      page = pdfDoc.getPage(0);
    } else {
      pdfDoc = await PDFLibDocument.create();
      // Letter: 612x792 pt
      page = pdfDoc.addPage([612, 792]);
      // Intentar fondo PNG/JPG si existe
      const imgCandidates = [
        path.join(assetsDir, 'background_letter.png'),
        path.join(assetsDir, 'background_letter.jpg'),
        path.join(assetsDir, 'background.png'),
        path.join(assetsDir, 'background.jpg')
      ];
      const bg = (String(req.query.no_bg || '') === '1') ? null : imgCandidates.find(p => fs.existsSync(p));
      if (bg) {
        const buf = fs.readFileSync(bg);
        let ref;
        if (/\.png$/i.test(bg)) ref = await pdfDoc.embedPng(buf); else ref = await pdfDoc.embedJpg(buf);
        page.drawImage(ref, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      }
    }

    // Fuente: Times New Roman si existe, si no Times-Roman estándar
    let fontRef;
    try {
      const fontPaths = [
        path.join(assetsDir, 'fonts', 'TimesNewRoman.ttf'),
        path.join(assetsDir, 'TimesNewRoman.ttf'),
        path.join(assetsDir, 'times.ttf')
      ];
      const fp = fontPaths.find(p => fs.existsSync(p));
      if (fp) fontRef = await pdfDoc.embedFont(fs.readFileSync(fp));
    } catch(_) {}
    if (!fontRef) fontRef = await pdfDoc.embedFont(StandardFonts.TimesRoman);

    // Conversión mm -> pt (origen arriba-izquierda). pdf-lib usa origen abajo-izquierda
    const mmToPt = (mm) => Number(mm) * 72 / 25.4;
    const pageH = page.getHeight();

    // Offsets/escala global opcional
    const q = req.query || {};
    const offsetXmm = Number(q.offset_x_mm || process.env.LAYOUT_OFFSET_X_MM || 0);
    const offsetYmm = Number(q.offset_y_mm || process.env.LAYOUT_OFFSET_Y_MM || 0);
    const scaleX = Number(q.layout_scale_x || process.env.LAYOUT_SCALE_X || 1) || 1;
    const scaleY = Number(q.layout_scale_y || process.env.LAYOUT_SCALE_Y || 1) || 1;
    const offX = mmToPt(offsetXmm);
    const offY = mmToPt(offsetYmm);

    const writeField = (key, value) => {
      const f = layout.fields[key]; if (!f) return;
      const x = offX + scaleX * mmToPt(f.x);
      // Convertir Y desde top-left a bottom-left
      const yTop = offY + scaleY * mmToPt(f.y);
      const y = pageH - yTop; // texto ancla en baseline-top aproximado
      const fontSize = Number(f.font_pt || 12);
      const width = Number(f.width_pt || 240) || 240;
      const text = String(value ?? '');

      // Alineación: pdf-lib no tiene align nativo; ajustamos x para right/center
      let drawX = x;
      if (f.align === 'right') {
        const textW = fontRef.widthOfTextAtSize(text, fontSize);
        drawX = Math.max(0, x + width - textW);
      } else if (f.align === 'center') {
        const textW = fontRef.widthOfTextAtSize(text, fontSize);
        drawX = Math.max(0, x + (width - textW) / 2);
      }

      page.drawText(text, {
        x: drawX,
        y: y,
        size: fontSize,
        font: fontRef,
        color: rgb(0, 0, 0)
      });
    };

    const tBase = Number(cert.total_base || 0); const tIva = Number(cert.total_iva || 0); const tAbonado = Math.max(0, tBase - tIva);
    writeField('numero', cert.numero);
    writeField('numero2', cert.numero);
    writeField('fecha_cert', cert.fecha_cert || '');
    writeField('numero_fact', cert.numero_fact || '');
    writeField('numero_fact2', cert.numero_fact || '');
    writeField('fecha_fact', cert.fecha_fact || '');
    writeField('proveedor_nombre', cert.proveedor_nombre || '');
    writeField('proveedor_direccion', cert.proveedor_direccion || '');
    writeField('proveedor_ciudad', cert.proveedor_ciudad || '');
    writeField('proveedor_cuit', cert.proveedor_cuit || '');
    writeField('proveedor_codigo_postal', cert.proveedor_codigo_postal || '');
    writeField('total_base', tBase.toFixed(2));
    writeField('total_abonado', tAbonado.toFixed(2));
    writeField('total_iva', tIva.toFixed(2));

    const bytesOut = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${(req.query.download==='1')?'attachment':'inline'}; filename=certificado_${cert.numero}_pdflib.pdf`);
    res.end(Buffer.from(bytesOut));
  } catch (e) {
    console.error('pdf-lib error', e);
    res.status(500).json({ error: 'Error generando PDF con pdf-lib', detail: String(e && e.message ? e.message : e) });
  }
});

// --- Nuevo: PDF desde plantilla PowerPoint con tokens #KEY# ---
app.get('/api/certificados/:id/pdf-ppt', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
    const cert = db.prepare(`SELECT c.*, p.nombre as proveedor_nombre, p.direccion as proveedor_direccion, p.ciudad as proveedor_ciudad, p.cuit as proveedor_cuit, p.codigo_postal as proveedor_codigo_postal FROM certificados c JOIN proveedores p ON p.id=c.proveedor_id WHERE c.id=?`).get(id);
    if (!cert) return res.status(404).json({ error: 'No encontrado' });

    const templates = [
      path.join(__dirname, 'assets', 'plantilla_cert.pptx'),
      path.join(__dirname, 'assets', 'plantilla_cert.ppt')
    ];
    const tplPath = templates.find(p => fs.existsSync(p));
    if (!tplPath) return res.status(404).json({ error: 'No se encontró plantilla PPT/PPTX en server/assets' });

    const dataDir = path.join(__dirname, '..', 'data'); if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const tmpJson = path.join(dataDir, 'ppt_tokens.json');
    const outPdf = path.join(dataDir, `ppt_cert_${Date.now()}.pdf`);

    const tBase = Number(cert.total_base || 0);
    const tIva = Number(cert.total_iva || 0);
    const tAbonado = Math.max(0, tBase - tIva);
    const money = (n) => {
      const f = (Number(n)||0).toFixed(2);
      const parts = f.split('.');
      let int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return `${int},${parts[1]}`;
    };
    const map = {
      'NUMERO': String(cert.numero || ''),
      'FECHA_CERT': cert.fecha_cert || '',
      'NUMERO_FACT': cert.numero_fact || '',
      'FECHA_FACT': cert.fecha_fact || '',
      'PROVEEDOR_NOMBRE': cert.proveedor_nombre || '',
      'CUIT': cert.proveedor_cuit || '',
      'PROVEEDOR_DIRECCION': cert.proveedor_direccion || '',
      'CP': cert.proveedor_codigo_postal || '',
      'PROVEEDOR_CIUDAD': cert.proveedor_ciudad || '',
      'MONTO_TOTAL': money(tBase),
      'MONTO_NETO': money(tAbonado),
      'MONTO_IVA': money(tIva)
    };
    fs.writeFileSync(tmpJson, JSON.stringify(map), 'utf8');

    const psPath = path.join(__dirname, 'ppt_render.ps1');
    if (!fs.existsSync(psPath)) return res.status(500).json({ error: 'Falta script ppt_render.ps1 en server' });
    const args = ['-NoProfile','-ExecutionPolicy','Bypass','-File', psPath, '-Template', tplPath, '-OutputPdf', outPdf, '-DataJson', tmpJson];
    const r = cp.spawnSync('powershell', args, { windowsHide: true, timeout: 120000 });
    if (r.error) return res.status(500).json({ error: 'No se pudo ejecutar PowerPoint', detail: String(r.error) });
    if (!fs.existsSync(outPdf)) return res.status(500).json({ error: 'PowerPoint no generó salida PDF' });

    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition', `${(req.query.download==='1')?'attachment':'inline'}; filename=certificado_${cert.numero}_ppt.pdf`);
    fs.createReadStream(outPdf).pipe(res);
  } catch (e) {
    console.error('ppt render error', e);
    res.status(500).json({ error: 'Error generando PDF desde PPT', detail: String(e && e.message ? e.message : e) });
  }
});

app.post('/api/layout', express.json(), (req, res) => {
  try {
    const fields = (req.body && req.body.fields) || {};
    const csvPath = path.join(__dirname, 'assets', 'layout_fields.csv');
    const rows = [ 'name,X (mm),Y (mm),font_pt,align,width_pt' ];
    const keys = Object.keys(fields);
    const mm = (n)=> String(n).replace('.', ',');
    for (const k of keys) {
      const f = fields[k] || {};
      const x = Number(f.x)||0; const y = Number(f.y)||0;
      const w = (f.width_pt!=null)? Number(f.width_pt): '';
      const align = String(f.align || 'left');
      const font = Number(f.font_pt || 12);
      rows.push(`${k},"${mm(x)}","${mm(y)}",${font},${align},${w}`);
    }
    if (!fs.existsSync(path.dirname(csvPath))) fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    fs.writeFileSync(csvPath, rows.join('\r\n'), 'utf8');
    // Invalidate cache so next render picks new positions
    _csvLayoutCache = null; _csvLayoutMtime = 0;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar layout', detail: String(e && e.message ? e.message : e) });
  }
});

// Endpoint de preview DOT eliminado (solo CSV)











// Motores alternativos retirados: render con PDFKit + CSV únicamente

// --- Importador: leer PPTX en assets y volcar posiciones #KEY# -> CSV ---
app.post('/api/layout/import-pptx', async (req, res) => {
  try {
    const assetsDir = path.join(__dirname, 'assets');
    const candidates = [
      path.join(assetsDir, 'plantilla_cert.pptx'),
      // cualquier pptx en assets
      ...(fs.readdirSync(assetsDir).filter(n => /\.pptx$/i.test(n)).map(n => path.join(assetsDir, n)))
    ];
    const pptxPath = candidates.find(p => fs.existsSync(p));
    if (!pptxPath) return res.status(404).json({ error: 'No se encontró PPTX en server/assets' });

    const tmpRoot = path.join(__dirname, '..', 'data', `pptx_tmp_${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Extraer ZIP (PPTX) usando .NET; compatibilidad con distintas versiones (sin parámetro Encoding)
    const ps = [ '-NoProfile', '-Command', `try { Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory(\"${pptxPath}\", \"${tmpRoot}\"); exit 0 } catch { Write-Output $_.Exception.Message; exit 1 }` ];
    const r = cp.spawnSync('powershell', ps, { windowsHide: true, timeout: 120000 });
    if (r.error || r.status !== 0) return res.status(500).json({ error: 'No se pudo extraer PPTX', detail: String((r.stdout||'').toString() || (r.stderr||'').toString() || r.error) });

    const walk = (dir) => {
      let out = [];
      for (const n of fs.readdirSync(dir)) {
        const p = path.join(dir, n);
        const st = fs.statSync(p);
        if (st.isDirectory()) out = out.concat(walk(p)); else out.push(p);
      }
      return out;
    };
    const allXml = walk(tmpRoot).filter(p => /\.xml$/i.test(p));
    // Solo archivos bajo carpeta ppt/ (case-insensitive)
    const slideXml = allXml.filter(p => /[\\\/]ppt[\\\/].*(slides[\\\/]slide\d+\.xml|slideLayouts[\\\/]slideLayout\d+\.xml|slideMasters[\\\/]slideMaster\d+\.xml)/i.test(p));
    if (!slideXml.length) return res.status(400).json({ error: 'PPTX sin slides/slide*.xml' });

    const emuToMm = (emu) => (Number(emu)||0) * 25.4 / 914400;
    const parseSlide = (xml) => {
      const out = [];
      // cortar por shapes p:sp
      const spRegex = /<p:sp[\s\S]*?<\/p:sp>/g;
      let m;
      while ((m = spRegex.exec(xml)) !== null) {
        const block = m[0];
        const off = /<a:off[^>]*\bx=\"(\d+)\"[^>]*\by=\"(\d+)\"/i.exec(block);
        const ext = /<a:ext[^>]*\bcx=\"(\d+)\"[^>]*\bcy=\"(\d+)\"/i.exec(block);
        if (!off) continue;
        const xMm = emuToMm(off[1]);
        const yMm = emuToMm(off[2]);
        const wPt = ext ? ((emuToMm(ext[1]) * 72 / 25.4) || 0) : 0;
        // texto: concatenar todos los a:t
        const texts = Array.from(block.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map(mm => mm[1]);
        if (!texts.length) continue;
        const textJoined = texts.join(' ');
        const tokenRegex = /#([A-Z0-9_]+)#/g;
        const tokens = Array.from(textJoined.matchAll(tokenRegex)).map(mm => String(mm[1]).toUpperCase());
        if (!tokens.length) continue;
        // alineación
        let align = 'left';
        const algnM = /<a:algn>([^<]+)<\/a:algn>|<a:jc[^>]*val=\"([^\"]+)\"/i.exec(block);
        const aVal = ((algnM && (algnM[1] || algnM[2])) || '').toLowerCase();
        if (aVal.includes('ctr')) align = 'center'; else if (aVal.includes('r')) align = 'right';
        tokens.forEach(t => out.push({ token: t, xMm, yMm, widthPt: wPt, align }));
      }
      return out;
    };

    const fields = {};
    const files = slideXml.sort();
    files.forEach(full => {
      const xml = fs.readFileSync(full, 'utf8');
      parseSlide(xml).forEach((f) => {
        const map = {
          'NUMERO':'numero','NUMERO2':'numero2','NUMERO_FACT':'numero_fact','NUMERO_FACT2':'numero_fact2',
          'FECHA_CERT':'fecha_cert','FECHA_FACT':'fecha_fact',
          'PROVEEDOR_NOMBRE':'proveedor_nombre','PROVEEDOR_DIRECCION':'proveedor_direccion','PROVEEDOR_CIUDAD':'proveedor_ciudad',
          'CUIT':'proveedor_cuit','PROVEEDOR_CUIT':'proveedor_cuit','CP':'proveedor_codigo_postal','CODIGO_POSTAL':'proveedor_codigo_postal',
          'MONTO_TOTAL':'total_base','MONTO_BASE':'total_base','TOTAL_ABONADO':'total_abonado','MONTO_NETO':'total_abonado','MONTO_IVA':'total_iva','IVA':'total_iva'
        };
        const key = map[f.token] || f.token.toLowerCase();
        if (!fields[key]) fields[key] = { x: +f.xMm.toFixed(2), y: +f.yMm.toFixed(2), font_pt: 12, align: f.align, width_pt: Math.round(f.widthPt) };
      });
    });

    if (!Object.keys(fields).length) return res.status(400).json({ error: 'No se encontraron tokens #KEY# en el PPTX' });

    // Escribir CSV
    const csvPath = path.join(__dirname, 'assets', 'layout_fields.csv');
    const rows = [ 'name,X (mm),Y (mm),font_pt,align,width_pt' ];
    Object.keys(fields).forEach(k => {
      const f = fields[k];
      const mmv = (n)=> String(n).replace('.', ',');
      rows.push(`${k},"${mmv(f.x)}","${mmv(f.y)}",${f.font_pt||12},${f.align||'left'},${f.width_pt||''}`);
    });
    fs.writeFileSync(csvPath, rows.join('\r\n'), 'utf8');
    _csvLayoutCache = null; _csvLayoutMtime = 0;

    // Limpiar temporal (best-effort)
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch(_){}

    res.json({ ok: true, fields: Object.keys(fields).length, csv: csvPath });
  } catch (e) {
    console.error('import pptx error', e);
    res.status(500).json({ error: 'Error importando PPTX', detail: String(e && e.message ? e.message : e) });
  }
});

// Alias GET para invocar desde el navegador sin herramienta REST
app.get('/api/layout/import-pptx', async (req, res) => {
  try {
    const resp = await (async () => {
      const assetsDir = path.join(__dirname, 'assets');
      const candidates = [
        path.join(assetsDir, 'plantilla_cert.pptx'),
        ...(fs.readdirSync(assetsDir).filter(n => /\.pptx$/i.test(n)).map(n => path.join(assetsDir, n)))
      ];
      const pptxPath = candidates.find(p => fs.existsSync(p));
      if (!pptxPath) return { status:404, body:{ error:'No se encontró PPTX en server/assets' } };

      const tmpRoot = path.join(__dirname, '..', 'data', `pptx_tmp_${Date.now()}`);
      fs.mkdirSync(tmpRoot, { recursive: true });
      const ps = [ '-NoProfile', '-Command', `try { Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory(\"${pptxPath}\", \"${tmpRoot}\"); exit 0 } catch { Write-Output $_.Exception.Message; exit 1 }` ];
      const r = cp.spawnSync('powershell', ps, { windowsHide: true, timeout: 120000 });
      if (r.error || r.status !== 0) return { status:500, body:{ error:'No se pudo extraer PPTX', detail:String((r.stdout||'').toString() || (r.stderr||'').toString() || r.error) } };
      const walk = (dir)=>{ let out=[]; for(const n of fs.readdirSync(dir)){ const p=path.join(dir,n); const st=fs.statSync(p); if(st.isDirectory()) out=out.concat(walk(p)); else out.push(p);} return out; };
      const allXml = walk(tmpRoot).filter(p=>/\.xml$/i.test(p));
      const slideXml = allXml.filter(p=>/[\\\/]ppt[\\\/].*(slides[\\\/]slide\d+\.xml|slideLayouts[\\\/]slideLayout\d+\.xml|slideMasters[\\\/]slideMaster\d+\.xml)/i.test(p));
    if (!slideXml.length) return { status:400, body:{ error:'PPTX sin slides/slide*.xml' } };
      const emuToMm = (emu)=> (Number(emu)||0) * 25.4 / 914400;
      const parseSlide = (xml)=>{
        const out=[]; const spRegex=/<p:sp[\s\S]*?<\/p:sp>/g; let m;
        while((m=spRegex.exec(xml))!==null){ const block=m[0];
          const off=/<a:off[^>]*\bx=\"(\d+)\"[^>]*\by=\"(\d+)\"/i.exec(block);
          const ext=/<a:ext[^>]*\bcx=\"(\d+)\"[^>]*\bcy=\"(\d+)\"/i.exec(block);
          if(!off) continue; const xMm=emuToMm(off[1]); const yMm=emuToMm(off[2]);
          const wPt=ext?((emuToMm(ext[1])*72/25.4)||0):0; const texts=Array.from(block.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map(mm=>mm[1]); if(!texts.length) continue;
          const tokenRegex=/#([A-Z0-9_]+)#/g; const tokens=Array.from(texts.join(' ').matchAll(tokenRegex)).map(mm=>String(mm[1]).toUpperCase()); if(!tokens.length) continue;
        let align='left'; const algnM=/<a:algn>([^<]+)<\/a:algn>|<a:jc[^>]*val=\"([^\"]+)\"/i.exec(block); const aVal=((algnM&&(algnM[1]||algnM[2]))||'').toLowerCase(); if(aVal.includes('ctr')) align='center'; else if(aVal.includes('r')) align='right';
          tokens.forEach(t=> out.push({ token:t, xMm, yMm, widthPt:wPt, align }));
        } return out; };
      const fields={}; const files=slideXml.sort();
      files.forEach(full=>{ const xml=fs.readFileSync(full,'utf8'); parseSlide(xml).forEach(f=>{ const map={ 'NUMERO':'numero','NUMERO2':'numero2','NUMERO_FACT':'numero_fact','NUMERO_FACT2':'numero_fact2','FECHA_CERT':'fecha_cert','FECHA_FACT':'fecha_fact','PROVEEDOR_NOMBRE':'proveedor_nombre','PROVEEDOR_DIRECCION':'proveedor_direccion','PROVEEDOR_CIUDAD':'proveedor_ciudad','CUIT':'proveedor_cuit','PROVEEDOR_CUIT':'proveedor_cuit','CP':'proveedor_codigo_postal','CODIGO_POSTAL':'proveedor_codigo_postal','MONTO_TOTAL':'total_base','MONTO_BASE':'total_base','TOTAL_ABONADO':'total_abonado','MONTO_NETO':'total_abonado','MONTO_IVA':'total_iva','IVA':'total_iva' }; const key=map[f.token]||f.token.toLowerCase(); if(!fields[key]) fields[key]={ x:+f.xMm.toFixed(2), y:+f.yMm.toFixed(2), font_pt:12, align:f.align, width_pt:Math.round(f.widthPt) }; }); });
      if (!Object.keys(fields).length) return { status:400, body:{ error:'No se encontraron tokens #KEY# en el PPTX' } };
      const csvPath=path.join(__dirname,'assets','layout_fields.csv'); const rows=['name,X (mm),Y (mm),font_pt,align,width_pt']; Object.keys(fields).forEach(k=>{ const f=fields[k]; const mmv=(n)=>String(n).replace('.',','); rows.push(`${k},"${mmv(f.x)}","${mmv(f.y)}",${f.font_pt||12},${f.align||'left'},${f.width_pt||''}`); }); fs.writeFileSync(csvPath, rows.join('\r\n'),'utf8'); _csvLayoutCache=null; _csvLayoutMtime=0; try{ fs.rmSync(tmpRoot,{recursive:true,force:true}); }catch{};
      return { status:200, body:{ ok:true, fields:Object.keys(fields).length, csv: csvPath } };
    })();
    res.status(resp.status).json(resp.body);
  } catch (e) {
    res.status(500).json({ error:'Error importando PPTX', detail:String(e&&e.message?e.message:e) });
  }
});
