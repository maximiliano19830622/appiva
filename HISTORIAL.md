# Historial de cambios y decisiones (Oct–Nov 2025)

Este documento resume los cambios aplicados para que otras IAs o futuras intervenciones no reviertan decisiones ni reintroduzcan problemas ya resueltos.

## Estado actual (backend + frontend)
- Render de PDF: SOLO PDFKit + CSV (sin motores alternativos).
- Fondo: `server/assets/background_letter.png` (o `..._a4.png` si se cambia más adelante).
- Calibración: desde `http://localhost:3000/static/layout.html` se guarda `server/assets/layout_fields.csv`.
- Endpoints relevantes:
  - `GET /api/certificados/:id/pdf` → genera PDF usando el CSV (sin `engine=`).
  - Opcional debug visual: `?debug=layout-grid`.

## Cambios principales
- Eliminado soporte alternativo de render:
  - Quitadas funciones y rutas relacionadas con `engine=word` y `engine=chrome` en `server/index.js`.
  - Borrados archivos: `server/word_render.ps1` y `server/word_list_tokens.ps1`.
  - Eliminada importación de `child_process`.
- Eliminado soporte de plantillas de texto/HTML:
  - Removida la función `renderFromHashTemplate(...)` y toda referencia a `plantilla_cert.*` y `layout_fields.txt`.
  - Borrado `tools/convert_txt_to_html.js`.
- Eliminado soporte y preview de DOT:
  - Quitada la ruta `GET /api/layout/preview-dot` y la función `loadDotLayout(...)`.
  - Confirmado que no existe `server/assets/layout_fields.dot` y agregado a `.gitignore`.
- Ajustes de UI:
  - Botón “Buscar CP” agregado solo en `client/proveedores.html`, retirado de `client/index.html`.
  - Footer agregado en la página principal con la leyenda de versión.
- Infra / housekeeping:
  - Creado `.gitignore` (incluye `server/assets/layout_fields.dot`, `node_modules/`, artefactos en `data/`, `.env`, etc.).
  - Arreglo de sintaxis en `server/index.js` (llave suelta al remover DOT).

## Decisiones que NO deben revertirse
- No reintroducir `engine=word` ni `engine=chrome` ni plantillas (`plantilla_cert.*`).
- No usar archivos DOT para posiciones; la única verdad es `server/assets/layout_fields.csv`.
- Mantener el nombre del fondo como `background_letter.png` (o `background_a4.png` si se migra a A4) para que lo cargue automáticamente.

## Flujo esperado para generar PDFs
1) Colocar el fondo en `server/assets/background_letter.png`.
2) Calibrar en `/static/layout.html` y “Guardar CSV” (genera/actualiza `server/assets/layout_fields.csv`).
3) Generar/visualizar: `GET /api/certificados/:id/pdf` (opcional `?debug=layout-grid`).

## Notas sobre alineación
- El CSV usa milímetros; el servidor convierte mm→pt y, si detecta valores grandes (px), escala contra el tamaño real del fondo.
- El punto X del CSV se interpreta como el “borde izquierdo del bloque”, consistente con el calibrador.
- Tras guardar el CSV, el servidor invalida caché y lo vuelve a leer automáticamente; recargar el navegador si es necesario.

## Pendientes conocidos (si persiste desalineación)
- Verificar que el certificado tenga datos en todos los campos (si un valor está vacío, no se verá texto; con `debug=layout` se ven las anclas/etiquetas igualmente).
- Confirmar tamaño de página: por defecto Letter; si el fondo es A4, cambiar el tamaño de página en `server/index.js` (opción `size: 'LETTER'`).

---
Última actualización: Noviembre 2025.
