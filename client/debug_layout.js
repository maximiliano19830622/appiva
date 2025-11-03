// Inject debug layout behavior without touching app.js
(() => {
  const d = document;
  function $(s){ return d.querySelector(s); }
  function ready(fn){ if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', fn); else fn(); }

  ready(() => {
    const chk = $('#debugLayout');
    const btnView = $('#verPdfInline');
    const btnGen = $('#generarPdf');
    const numero = $('#numero');

    if (!chk) return;

    // Helper: ensure certificate with current number exists; returns id
    async function ensureCert(num){
      let lookup = await fetch(`/api/certificados-by-numero?numero=${encodeURIComponent(num)}`);
      if (!lookup.ok) {
        const quick = await fetch('/api/certificados', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ numero_forzado:num, proveedor_id:null, total_base:0, total_iva:0, total_abonado:0, lineas:[] }) });
        if (quick.ok) lookup = await fetch(`/api/certificados-by-numero?numero=${encodeURIComponent(num)}`);
        else if (quick.status !== 409) throw new Error('No se pudo crear/ubicar certificado');
      }
      const found = await lookup.json();
      return found.id;
    }

    if (btnView) btnView.addEventListener('click', async (ev) => {
      if (!chk.checked) return; // Only intercept when enabled
      ev.preventDefault(); ev.stopImmediatePropagation();
      const num = parseInt((numero&&numero.value||'').replace(/\D/g,''),10);
      if (!Number.isFinite(num) || num <= 0) { alert('Número inválido'); return; }
      try {
        const id = await ensureCert(num);
        const href = `/api/certificados/${id}/pdf?preview=1&debug=layout-grid`;
        const win = window.open(href, '_blank'); if (!win) window.location.href = href;
      } catch (e) { alert(String(e.message||e)); }
    }, true);

    if (btnGen) btnGen.addEventListener('click', async (ev) => {
      if (!chk.checked) return; // Only intercept when enabled
      ev.preventDefault(); ev.stopImmediatePropagation();
      const num = parseInt((numero&&numero.value||'').replace(/\D/g,''),10);
      if (!Number.isFinite(num) || num <= 0) { alert('Número de certificado inválido'); return; }
      try {
        const id = await ensureCert(num);
        const pdf = await fetch(`/api/certificados/${id}/pdf?download=1&debug=layout-grid`);
        if (!pdf.ok) { let e={}; try{e=await pdf.json()}catch{} throw new Error('Error generando PDF: '+(e.error||pdf.status)+(e.detail? ('\nDetalle: '+e.detail):'')); }
        const blob = await pdf.blob(); const url = URL.createObjectURL(blob);
        const a = d.createElement('a'); a.href = url; a.download = `certificado_${num}.pdf`; d.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } catch (e) { alert(String(e.message||e)); }
    }, true);
  });
})();

