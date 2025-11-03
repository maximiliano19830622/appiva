Generador de Certificados IVA (A4, SQLite)

Requisitos
- Node.js 18+ en el servidor Windows.
- No se necesita instalar MySQL. Base de datos embebida SQLite con `sql.js` (WebAssembly, sin compilaciÃ³n nativa).

InstalaciÃ³n
1) Abrir una consola en la carpeta del proyecto.
2) Instalar dependencias: `npm install`
3) (Opcional) Copiar `.env.example` a `.env` y ajustar `PORT`/`DB_PATH`.

Uso
- Iniciar: `npm start` o `start_server.bat`
- Interfaz: abrir `http://localhost:3000` en el navegador de la red local apuntando al servidor.

Datos y NumeraciÃ³n
- La DB se crea en `data/app.db` en el primer arranque.
- NumeraciÃ³n simple 1,2,3â€¦ serializada en el servidor.

PDF Letter
- Endpoint `GET /api/certificados/:id/pdf` genera un PDF Letter (vertical, mÃ¡rgenes ~20mm).
- Fondo opcional: ubicar `server/assets/background_letter.png` (2550 x 3300 px recomendado) y se aplicarÃ¡ automÃ¡ticamente.

Auto-Inicio en Windows
- Usa `start_server.bat` con el Programador de Tareas (al iniciar sesiÃ³n) o carpeta `shell:startup`.

Notas
- ValidaciÃ³n de montos con coma decimal en el frontend; el backend almacena valores numÃ©ricos (REAL) y valida no-negativos.
- Para entorno con mucha concurrencia o requisitos avanzados, evaluar migrar a PostgreSQL/MySQL.

