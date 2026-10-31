const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { Pool, types } = require('pg');
const { parse } = require('csv-parse/sync');

// BIGINT -> number, NUMERIC -> number (si no, pg los devuelve como texto)
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));

const app = express();
const PORT = process.env.PORT || 3000;

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('Falta la variable de entorno DATABASE_URL');
  process.exit(1);
}
const pool = new Pool({
  connectionString: dbUrl,
  ssl: /localhost|127\.0\.0\.1/.test(dbUrl) ? false : { rejectUnauthorized: false },
});

app.use(express.json({ limit: '5mb' }));

/* ---------- Clave de acceso (opcional pero recomendada) ----------
   Si defines APP_PASSWORD en Render, el navegador pedirá usuario/clave.
   Usuario: cualquiera (ej. "dolce"). Clave: el valor de APP_PASSWORD.  */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
app.use((req, res, next) => {
  const pass = process.env.APP_PASSWORD;
  if (!pass) return next();
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString();
    const given = decoded.slice(decoded.indexOf(':') + 1);
    if (safeEqual(given, pass)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Dolce"');
  res.status(401).send('Acceso restringido');
});

/* ---------- Base de datos ---------- */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id         TEXT PRIMARY KEY,
      fecha      TEXT NOT NULL,
      cliente    TEXT NOT NULL,
      lugar      TEXT,
      producto   TEXT,
      sabor      TEXT,
      cantidad   NUMERIC DEFAULT 1,
      precio     NUMERIC DEFAULT 0,
      total      NUMERIC DEFAULT 0,
      estado     TEXT DEFAULT 'pagado',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS lugares (
      nombre     TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS compras (
      id         TEXT PRIMARY KEY,
      fecha      TEXT NOT NULL,
      categoria  TEXT,
      proveedor  TEXT,
      insumo     TEXT,
      cantidad   TEXT,
      monto      NUMERIC DEFAULT 0,
      nota       TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

async function getAllData() {
  const [pedidos, lugares, compras] = await Promise.all([
    pool.query(`SELECT id, fecha, cliente, lugar, producto, sabor, cantidad, precio, total, estado
                FROM pedidos ORDER BY fecha DESC, created_at DESC`),
    pool.query(`SELECT nombre FROM lugares ORDER BY created_at`),
    pool.query(`SELECT id, fecha, categoria, proveedor, insumo, cantidad, monto, nota
                FROM compras ORDER BY fecha DESC, created_at DESC`),
  ]);
  return {
    pedidos: pedidos.rows,
    lugares: lugares.rows.map((r) => r.nombre),
    compras: compras.rows,
  };
}

const str = (v) => (v === undefined || v === null ? '' : String(v));
const num = (v) => Number(v) || 0;

async function upsertPedido(p) {
  await pool.query(
    `INSERT INTO pedidos (id, fecha, cliente, lugar, producto, sabor, cantidad, precio, total, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       fecha=$2, cliente=$3, lugar=$4, producto=$5, sabor=$6,
       cantidad=$7, precio=$8, total=$9, estado=$10`,
    [str(p.id), str(p.fecha), str(p.cliente), str(p.lugar), str(p.producto), str(p.sabor),
     num(p.cantidad), num(p.precio), num(p.total), p.estado === 'fiado' ? 'fiado' : 'pagado']
  );
}

async function upsertCompra(c) {
  await pool.query(
    `INSERT INTO compras (id, fecha, categoria, proveedor, insumo, cantidad, monto, nota)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       fecha=$2, categoria=$3, proveedor=$4, insumo=$5, cantidad=$6, monto=$7, nota=$8`,
    [str(c.id), str(c.fecha), str(c.categoria), str(c.proveedor), str(c.insumo),
     str(c.cantidad), num(c.monto), str(c.nota)]
  );
}

/* ---------- API ---------- */
app.get('/api/data', async (req, res, next) => {
  try { res.json(await getAllData()); } catch (e) { next(e); }
});

app.post('/api/action', async (req, res, next) => {
  try {
    const { action, payload } = req.body || {};
    const p = payload || {};
    switch (action) {
      case 'add':
      case 'update':
        await upsertPedido(p); break;
      case 'delete':
        await pool.query('DELETE FROM pedidos WHERE id=$1', [str(p.id)]); break;
      case 'addLugar':
        if (str(p.nombre).trim())
          await pool.query('INSERT INTO lugares (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [str(p.nombre).trim()]);
        break;
      case 'addCompra':
      case 'updateCompra':
        await upsertCompra(p); break;
      case 'deleteCompra':
        await pool.query('DELETE FROM compras WHERE id=$1', [str(p.id)]); break;
      default:
        return res.status(400).json({ error: 'Acción desconocida' });
    }
    res.json(await getAllData());
  } catch (e) { next(e); }
});

/* ---------- Importar desde el Google Sheet (CSV) ----------
   Se usa desde /importar.html. Es seguro repetirlo: si un id ya existe,
   se actualiza en vez de duplicarse. */
function csvRows(text) {
  if (!text || !String(text).trim()) return [];
  return parse(String(text), { skip_empty_lines: true, bom: true, relax_column_count: true }).slice(1);
}
function normFecha(v) {
  v = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return v;
}
function normNum(v) {
  return Number(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0;
}

app.post('/api/import', async (req, res, next) => {
  try {
    const { pedidos, lugares, compras } = req.body || {};
    const P = csvRows(pedidos).filter((r) => r[0]);
    const L = csvRows(lugares).filter((r) => r[0]);
    const C = csvRows(compras).filter((r) => r[0]);
    let sumP = 0, sumC = 0;

    for (const r of P) {
      const total = normNum(r[8]);
      sumP += total;
      await upsertPedido({
        id: r[0], fecha: normFecha(r[1]), cliente: r[2], lugar: r[3], producto: r[4], sabor: r[5],
        cantidad: normNum(r[6]), precio: normNum(r[7]), total,
        estado: String(r[9] || '').trim().toLowerCase() === 'fiado' ? 'fiado' : 'pagado',
      });
    }
    for (const r of L) {
      await pool.query('INSERT INTO lugares (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [String(r[0]).trim()]);
    }
    for (const r of C) {
      const monto = normNum(r[6]);
      sumC += monto;
      await upsertCompra({
        id: r[0], fecha: normFecha(r[1]), categoria: r[2], proveedor: r[3],
        insumo: r[4], cantidad: r[5], monto, nota: r[7] || '',
      });
    }
    res.json({
      pedidos: P.length, sumaPedidos: sumP,
      lugares: L.length,
      compras: C.length, sumaCompras: sumC,
    });
  } catch (e) { next(e); }
});

/* ---------- Frontend ---------- */
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error del servidor' });
});

initDb()
  .then(() => app.listen(PORT, () => console.log('Dolce corriendo en puerto ' + PORT)))
  .catch((e) => { console.error('No se pudo iniciar la base de datos:', e.message); process.exit(1); });
