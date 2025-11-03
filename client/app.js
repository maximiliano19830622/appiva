// Clean, resilient client script
(() => {
  const d = document;
  const $ = (s) => d.querySelector(s);

  // Elements (may be missing on some pages)
  const themeSwitch = $('#themeSwitch');
  const numero = $('#numero');
  const numInc = $('#numInc');
  const numDec = $('#numDec');
  const fechaCert = $('#fecha_cert');
  const fechaFact = $('#fecha_fact');
  const numeroFact = $('#numero_fact');
  const proveedor = $('#proveedor');
  const provSug = $('#proveedorSugerencias');
  const direccion = $('#direccion');
  const ciudad = $('#ciudad');
  const cuit = $('#cuit');
  const codigoPostal = $('#codigo_postal');
  const lineas = $('#lineas');
  const addLinea = $('#addLinea');
  const totalBase = $('#totalBase');
  const totalIva = $('#totalIva');
  const totalAbonado = $('#totalAbonado');
  const nuevoCertificado = $('#nuevoCertificado');
  const generarPdf = $('#generarPdf');
  const verPdfInline = $('#verPdfInline');
  const tooltip = $('#tooltip');

  // Theme
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);
  if (themeSwitch) {
    themeSwitch.checked = savedTheme === 'dark';
    themeSwitch.addEventListener('change', () => setTheme(themeSwitch.checked ? 'dark' : 'light'));
  }
  function setTheme(mode) { d.documentElement.setAttribute('data-theme', mode); localStorage.setItem('theme', mode); }

  // Number handling (no auto increment on generate/view)
  let currentNumeroAuto = null;
  let manualNumberAdjust = 0;
  function reflectNumber(){ if (numero && currentNumeroAuto != null) numero.value = String(currentNumeroAuto + manualNumberAdjust); }
  if (numero) {
    fetch('/api/numeracion/certificados/next').then(r=>r.json()).then(j=>{ if (typeof j.next==='number'){ currentNumeroAuto=j.next; manualNumberAdjust=0; reflectNumber(); }}).catch(()=>{});
    numero.addEventListener('input', ()=>{ const v=parseInt(numero.value.replace(/\D/g,''),10); if(Number.isFinite(v) && v>0){ currentNumeroAuto=v; manualNumberAdjust=0; persistNextDebounced(); }});
    numero.addEventListener('blur', ()=>{ const v=parseInt(numero.value.replace(/\D/g,''),10); if(!Number.isFinite(v)||v<=0) reflectNumber(); });
  }
  if (numInc) numInc.onclick = () => { manualNumberAdjust++; reflectNumber(); persistNextDebounced(); };
  if (numDec) numDec.onclick = () => { manualNumberAdjust--; reflectNumber(); persistNextDebounced(); };
  let persistT; function persistNextDebounced(){ clearTimeout(persistT); persistT=setTimeout(persistNext,300); }
  async function persistNext(){ if(!numero) return; const next=parseInt(numero.value.replace(/\D/g,''),10); if(!Number.isFinite(next)||next<=0) return; try{ await fetch('/api/numeracion/certificados/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({next})}); }catch(_){} }

  // Numeric utils (comma decimal)
  function parseCommaDecimal(str){ if(typeof str!=='string') return NaN; const s=str.trim().replace(/\./g,'').replace(',', '.'); if(!/^[-]?\d*(?:\.\d{0,2})?$/.test(s)) return NaN; const n=Number(s); return isNaN(n)?NaN:n; }
  function formatComma(n){ const parts=n.toFixed(2).split('.'); let int=parts[0]; const dec=parts[1]; int=int.replace(/\B(?=(\d{3})+(?!\d))/g,'.'); return `${int},${dec}`; }
  function showTooltip(el,msg){ if(!tooltip||!el) return; const r=el.getBoundingClientRect(); tooltip.textContent=msg; tooltip.style.left=`${r.left+window.scrollX}px`; tooltip.style.top=`${r.bottom+6+window.scrollY}px`; tooltip.hidden=false; }
  function hideTooltip(){ if(tooltip) tooltip.hidden=true; }

  // Calculator
  function lineaTpl(){ const div=d.createElement('div'); div.className='linea'; div.innerHTML=`<input class="base" placeholder="Monto base (1.000,00)" /><input class="porc" placeholder="% IVA (ej 16,00)" /><input class="iva" placeholder="IVA" disabled /><button class="remove" type="button">×</button>`; const base=div.querySelector('.base'); const porc=div.querySelector('.porc'); const iva=div.querySelector('.iva'); const remove=div.querySelector('.remove'); function validate(el){ const v=parseCommaDecimal(el.value); if(isNaN(v)||v<0){ showTooltip(el,'Formato inválido. Use "1.000,00" y no negativo.'); el.setAttribute('aria-invalid','true'); } else { hideTooltip(); el.removeAttribute('aria-invalid'); } compute(); } function compute(){ const b=parseCommaDecimal(base.value); const p=parseCommaDecimal(porc.value); if(!isNaN(b)&&!isNaN(p)&&b>=0&&p>=0){ const iv=b*(p/100); iva.value=formatComma(iv);} else { iva.value=''; } recalcTotals(); } base.addEventListener('input',()=>validate(base)); porc.addEventListener('input',()=>validate(porc)); remove.onclick=()=>{ div.remove(); recalcTotals(); }; return div; }
  function recalcTotals(){ if(!lineas||!totalBase||!totalIva||!totalAbonado) return; let bSum=0,iSum=0; for(const ln of Array.from(lineas.querySelectorAll('.linea'))){ const b=parseCommaDecimal(ln.querySelector('.base').value); const p=parseCommaDecimal(ln.querySelector('.porc').value); if(!isNaN(b)&&!isNaN(p)&&b>=0&&p>=0){ bSum+=b; iSum+=b*(p/100);} } totalBase.textContent=formatComma(bSum); totalIva.textContent=formatComma(iSum); totalAbonado.textContent=formatComma(Math.max(0,bSum-iSum)); }
  if (addLinea && lineas){ addLinea.onclick=()=>lineas.appendChild(lineaTpl()); if(!lineas.querySelector('.linea')) lineas.appendChild(lineaTpl()); }

  // Autocomplete providers
  if (proveedor){ proveedor.addEventListener('input', async ()=>{ const q=proveedor.value.trim(); if(!q){ if(provSug) provSug.innerHTML=''; return; } const res=await fetch(`/api/proveedores?q=${encodeURIComponent(q)}`); const data=await res.json(); if(!provSug) return; const ul=d.createElement('ul'); data.forEach(p=>{ const li=d.createElement('li'); li.textContent=`${p.nombre} – ${p.ciudad||''}`; li.onclick=()=>{ proveedor.value=p.nombre; if(direccion) direccion.value=p.direccion||''; if(ciudad) ciudad.value=p.ciudad||''; if(cuit) cuit.value=p.cuit||''; if(codigoPostal) codigoPostal.value=p.codigo_postal||''; proveedor.dataset.id=p.id; provSug.innerHTML=''; }; ul.appendChild(li); }); provSug.innerHTML=''; provSug.appendChild(ul); }); }

  // Nuevo Certificado: reset form y avanzar número, sin guardar
  if (nuevoCertificado){ nuevoCertificado.onclick=async ()=>{ const v=parseInt((numero&&numero.value||'').replace(/\D/g,''),10); const next=Number.isFinite(v)? v+1 : null; if(next){ currentNumeroAuto=next; manualNumberAdjust=0; reflectNumber(); await fetch('/api/numeracion/certificados/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({next})}).catch(()=>{}); } if (fechaCert) fechaCert.value=''; if (fechaFact) fechaFact.value=''; if (numeroFact) numeroFact.value=''; if (proveedor){ proveedor.value=''; proveedor.removeAttribute('data-id'); } if (direccion) direccion.value=''; if (ciudad) ciudad.value=''; if (cuit) cuit.value=''; if (codigoPostal) codigoPostal.value=''; if (provSug) provSug.innerHTML=''; if (lineas){ lineas.innerHTML=''; lineas.appendChild(lineaTpl()); recalcTotals(); } } }

  // Generar PDF (usa número visible, no cambia numeración)
  if (generarPdf){ generarPdf.onclick=async ()=>{ const pid=proveedor&&proveedor.dataset&&proveedor.dataset.id? Number(proveedor.dataset.id):null; const lns=Array.from(lineas? lineas.querySelectorAll('.linea'):[]).map(ln=>{ const b=parseCommaDecimal(ln.querySelector('.base').value); const p=parseCommaDecimal(ln.querySelector('.porc').value); if(isNaN(b)||isNaN(p)||b<0||p<0) return null; return {base:b, porcentaje:p}; }).filter(Boolean); const bSum=lns.reduce((a,c)=>a+c.base,0); const iSum=lns.reduce((a,c)=>a+(c.base*(c.porcentaje/100)),0); const aSum=Math.max(0,bSum-iSum); const num=parseInt((numero&&numero.value||'').replace(/\D/g,''),10); if(!Number.isFinite(num)||num<=0){ alert('Número de certificado inválido'); return; } const payload={ fecha_cert: fechaCert? (fechaCert.value||null):null, fecha_fact: fechaFact? (fechaFact.value||null):null, numero_fact: (numeroFact&&numeroFact.value)? numeroFact.value:null, proveedor_id: pid||null, total_base:Number(bSum.toFixed(2)), total_iva:Number(iSum.toFixed(2)), total_abonado:Number(aSum.toFixed(2)), lineas: lns, numero_forzado:num };
    let id=null; let resp=await fetch('/api/certificados',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); if(!resp.ok){ if(resp.status===409){ const lookup=await fetch(`/api/certificados-by-numero?numero=${encodeURIComponent(num)}`); if(!lookup.ok){ alert('Número en uso y no localizado'); return; } const found=await lookup.json(); id=found.id; } else { let e={}; try{e=await resp.json()}catch{} alert('Error al crear certificado: '+(e.error||resp.status)+(e.detail? ('\nDetalle: '+e.detail):'')); return; } } else { const created=await resp.json(); id=created.id; }
    const pdf=await fetch(`/api/certificados/${id}/pdf?download=1`); if(!pdf.ok){ let e={}; try{e=await pdf.json()}catch{} alert('Error generando PDF: '+(e.error||pdf.status)+(e.detail? ('\nDetalle: '+e.detail):'')); return; } const blob=await pdf.blob(); const url=URL.createObjectURL(blob); const a=d.createElement('a'); a.href=url; a.download=`certificado_${num}.pdf`; d.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); } }

  // Ver PDF (preview, sin marcar emitido); crea con ese número si no existe
  if (verPdfInline){ verPdfInline.onclick=async ()=>{ const num=parseInt((numero&&numero.value||'').replace(/\D/g,''),10); if(!Number.isFinite(num)||num<=0){ alert('Número inválido'); return; } let lookup=await fetch(`/api/certificados-by-numero?numero=${encodeURIComponent(num)}`); if(!lookup.ok){ const quick=await fetch('/api/certificados',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ numero_forzado:num, proveedor_id:null, total_base:0, total_iva:0, total_abonado:0, lineas:[] })}); if(quick.ok) lookup=await fetch(`/api/certificados-by-numero?numero=${encodeURIComponent(num)}`); else if(quick.status!==409){ alert('No se pudo crear/ubicar certificado'); return; } }
    const found=await lookup.json(); const href=`/api/certificados/${found.id}/pdf?preview=1`; const win=window.open(href,'_blank'); if(!win) window.location.href=href; } }
})();
