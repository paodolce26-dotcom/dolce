# Dolce · Control de pedidos

Ventas, Compras y Resumen como página web propia: Node/Express + PostgreSQL (Neon) + Render.
Todo se hace desde GitHub, Neon y Render; no hay que correr nada en tu computador.

## Estructura

```
dolce-app/
├── package.json
├── server.js            ← API + crea las tablas solo al arrancar
├── .gitignore
└── public/
    ├── index.html       ← la app
    └── importar.html    ← pasa tus datos del Sheet (una sola vez)
```

## 1. Base de datos en Neon

1. En neon.tech crea un proyecto nuevo (por ejemplo `dolce`).
2. Copia la **connection string** (`postgresql://...`). Esa es tu `DATABASE_URL`.

Las tablas se crean solas la primera vez que arranca el servidor.

## 2. Repositorio en GitHub

Crea un repo (por ejemplo `dolce-app`) y sube estos archivos tal cual, respetando la carpeta `public/`.

## 3. Publicar en Render

1. **New → Web Service**, conecta el repo.
   - Build command: `npm install`
   - Start command: `npm start`
2. En **Environment** agrega:
   - `DATABASE_URL` = la de Neon
   - `APP_PASSWORD` = una clave que elijas

Con `APP_PASSWORD`, el navegador pide usuario y clave al abrir la página (usuario: el que quieras, ej. `dolce`; clave: la que pusiste). Sin eso, cualquiera con el link vería tus ventas y quién te debe.

## 4. Pasar tus datos del Sheet

1. En el Google Sheet: **Archivo → Descargar → CSV**, una vez por pestaña (Pedidos, Lugares, Compras).
2. Abre `https://TU-APP.onrender.com/importar.html`, sube los tres CSV y toca **Importar**.
3. Compara las sumas que te muestra con las de tu Sheet. Si lo repites no duplica nada.

Cuando termines, puedes borrar `public/importar.html` del repo.

## Nota sobre Render gratis

El servicio se "duerme" tras un rato sin uso y la primera carga puede tardar ~30-50 segundos. Después va normal.
