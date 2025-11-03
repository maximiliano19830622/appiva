(() => {
  const d = document; const $ = (s) => d.querySelector(s);
  const provLista = $('#provLista'); if (!provLista) return;
  const provNombre = $('#provNombre');
  const provDireccion = $('#provDireccion');
  const provCiudad = $('#provCiudad');
  const provCuit = $('#provCuit');
  const provCodigoPostal = $('#provCodigoPostal');
  const provTelefono = $('#provTelefono');
  const provCorreo = $('#provCorreo');
  const provGuardar = $('#provGuardar');
  const provBuscar = $('#provBuscar');
  const provPrev = $('#provPrev');
  const provNext = $('#provNext');
  const provPageInfo = $('#provPageInfo');
  const provPageSize = $('#provPageSize');
  const provExportCsv = $('#provExportCsv');

  let state = { page: 1, total: 0, pageSize: 10, q: '', sortBy: 'nombre', sortDir: 'asc' };
  function getPageSize(){ const v=parseInt((provPageSize&&provPageSize.value)||'10',10); return Number.isFinite(v)? v:10; }
  function render(items){
    provLista.innerHTML = '';
    const table = d.createElement('table');
    table.className = 'prov-table';
    const thead = d.createElement('thead');
    const thr = d.createElement('tr');
    const headers = [
      { key:'nombre', label:'Nombre' },
      { key:'direccion', label:'Dirección' },
      { key:'ciudad', label:'Ciudad' },
      { key:'cuit', label:'CUIT' },
      { key:'codigo_postal', label:'Código Postal' },
      { key:'telefono', label:'Teléfono' },
      { key:'correo', label:'Correo electrónico' }
    ];
    headers.forEach(h=>{ const th=d.createElement('th'); th.textContent=h.label; th.dataset.sort=h.key; thr.appendChild(th); });
    const thAcc = d.createElement('th'); thAcc.textContent = 'Acciones'; thr.appendChild(thAcc);
    thead.appendChild(thr);
    const tbody = d.createElement('tbody');
    items.forEach(p=>{
      const tr = d.createElement('tr'); tr.dataset.id = p.id;
      const tdNombre = d.createElement('td'); tdNombre.textContent = p.nombre || '';
      const tdDir = d.createElement('td'); tdDir.textContent = p.direccion || '';
      const tdCiudad = d.createElement('td'); tdCiudad.textContent = p.ciudad || '';
      const tdCuit = d.createElement('td'); tdCuit.textContent = p.cuit || '';
      const tdCp = d.createElement('td'); tdCp.textContent = p.codigo_postal || '';
      const tdTel = d.createElement('td'); tdTel.textContent = p.telefono || '';
      const tdMail = d.createElement('td');
      const mail = (p.correo || '').trim();
      if (mail) { const a = d.createElement('a'); a.href = `mailto:${mail}`; a.textContent = mail; tdMail.appendChild(a); } else { tdMail.textContent = ''; }
      const tdAcc = d.createElement('td');
      const btnEdit = d.createElement('button'); btnEdit.textContent='Editar'; btnEdit.className='prov-edit'; btnEdit.dataset.id = String(p.id);
      const btnDel = d.createElement('button'); btnDel.textContent='Eliminar'; btnDel.className='prov-del'; btnDel.dataset.id = String(p.id);
      const actWrap = d.createElement('div'); actWrap.className='prov-actions'; actWrap.appendChild(btnEdit); actWrap.appendChild(btnDel); tdAcc.appendChild(actWrap);
      tr.appendChild(tdNombre); tr.appendChild(tdDir); tr.appendChild(tdCiudad); tr.appendChild(tdCuit); tr.appendChild(tdCp); tr.appendChild(tdTel); tr.appendChild(tdMail); tr.appendChild(tdAcc);
      tbody.appendChild(tr);
    });
    table.appendChild(thead); table.appendChild(tbody);
    provLista.appendChild(table);
    if (items.length === 0) {
      const empty = d.createElement('div'); empty.className = 'prov-empty'; empty.textContent = 'Sin resultados'; provLista.appendChild(empty);
    }

    // Sorting handlers
    thead.addEventListener('click', (ev)=>{
      const th = ev.target.closest('th'); if (!th) return;
      const key = th.dataset.sort; if (!key) return;
      if (state.sortBy === key) { state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { state.sortBy = key; state.sortDir = 'asc'; }
      state.page = 1; load();
    });
  }

  // Delegated actions: edit/delete
  provLista.addEventListener('click', async (ev)=>{
    const btn = ev.target.closest('button'); if (!btn) return;
    const id = Number(btn.dataset.id);
    if (!Number.isInteger(id)) return;
    if (btn.classList.contains('prov-del')) {
      if (!confirm('¿Eliminar este proveedor?')) return;
      const resp = await fetch(`/api/proveedores/${id}`, { method:'DELETE' });
      if (!resp.ok) { alert('No se pudo eliminar'); return; }
      load();
    } else if (btn.classList.contains('prov-edit')) {
      const tr = btn.closest('tr'); if (!tr) return;
      // Convert row to editable inputs
      const tds = tr.querySelectorAll('td');
      const cur = {
        nombre: tds[0].textContent || '',
        direccion: tds[1].textContent || '',
        ciudad: tds[2].textContent || '',
        telefono: tds[5].textContent || '',
        correo: (tds[6].querySelector('a')?.textContent || tds[6].textContent || ''),
        cuit: tds[3].textContent || '',
        codigo_postal: tds[4].textContent || ''
      };
      tds[0].innerHTML = `<input type="text" value="${escapeHtml(cur.nombre)}">`;
      tds[1].innerHTML = `<input type="text" value="${escapeHtml(cur.direccion)}">`;
      tds[2].innerHTML = `<input type="text" value="${escapeHtml(cur.ciudad)}">`;
      tds[3].innerHTML = `<input type="text" value="${escapeHtml(cur.cuit)}">`;
      tds[4].innerHTML = `<input type="text" value="${escapeHtml(cur.codigo_postal)}">`;
      tds[5].innerHTML = `<input type="text" value="${escapeHtml(cur.telefono)}">`;
      tds[6].innerHTML = `<input type="email" value="${escapeHtml(cur.correo)}">`;
      const actions = tds[7]; actions.innerHTML = '';
      const btnSave = d.createElement('button'); btnSave.textContent='Guardar';
      const btnCancel = d.createElement('button'); btnCancel.textContent='Cancelar';
      const wrap = d.createElement('div'); wrap.className='prov-actions'; wrap.appendChild(btnSave); wrap.appendChild(btnCancel); actions.appendChild(wrap);
      btnSave.onclick = async ()=>{
        const payload = {
          nombre: tds[0].querySelector('input').value.trim(),
          direccion: tds[1].querySelector('input').value,
          ciudad: tds[2].querySelector('input').value,
          cuit: tds[3].querySelector('input').value,
          codigo_postal: tds[4].querySelector('input').value,
          telefono: tds[5].querySelector('input').value,
          correo: tds[6].querySelector('input').value
        };
        if (!payload.nombre) { alert('Nombre requerido'); return; }
        const resp = await fetch(`/api/proveedores/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        if (!resp.ok) { alert('No se pudo guardar'); return; }
        load();
      };
      btnCancel.onclick = ()=> load();
    }
  });

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); }
  async function load(){ state.pageSize=getPageSize(); const params=new URLSearchParams({ paged:'1', page:String(state.page), pageSize:String(state.pageSize), sortBy:state.sortBy, sortDir:state.sortDir }); if(state.q) params.set('q',state.q); const res=await fetch(`/api/proveedores?${params.toString()}`); const data=await res.json(); const items=(data&&data.items)||data||[]; state.total=(data&&data.total)!=null? data.total: items.length; render(items); const totalPages=Math.max(1, Math.ceil((state.total||0)/state.pageSize)); if(provPageInfo) provPageInfo.textContent=`Página ${Math.min(state.page,totalPages)} de ${totalPages}`; if(provPrev) provPrev.disabled=state.page<=1; if(provNext) provNext.disabled=state.page>=totalPages; }

  if (provGuardar){ provGuardar.onclick=async ()=>{ const payload={ nombre:(provNombre&&provNombre.value||'').trim(), direccion:provDireccion?provDireccion.value:'', ciudad:provCiudad?provCiudad.value:'', cuit:provCuit?provCuit.value:'', codigo_postal:provCodigoPostal?provCodigoPostal.value:'', telefono:provTelefono?provTelefono.value:'', correo:provCorreo?provCorreo.value:'' }; if(!payload.nombre){ alert('Nombre requerido'); return; } const resp=await fetch('/api/proveedores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); if(!resp.ok){ let e={}; try{e=await resp.json()}catch{} alert('Error al guardar: '+(e.error||resp.status)); return; } if(provNombre) provNombre.value=''; if(provDireccion) provDireccion.value=''; if(provCiudad) provCiudad.value=''; if(provCuit) provCuit.value=''; if(provCodigoPostal) provCodigoPostal.value=''; if(provTelefono) provTelefono.value=''; if(provCorreo) provCorreo.value=''; state.page=1; await load(); }; }

  let t; if (provBuscar){ provBuscar.addEventListener('input', ()=>{ clearTimeout(t); t=setTimeout(()=>{ state.q=(provBuscar.value||'').trim(); state.page=1; load(); }, 250); }); }
  if (provPrev){ provPrev.onclick=()=>{ if(state.page>1){ state.page--; load(); } }; }
  if (provNext){ provNext.onclick=()=>{ state.page++; load(); }; }
  if (provPageSize){ provPageSize.addEventListener('change', ()=>{ state.page=1; load(); }); }
  if (provExportCsv){ provExportCsv.onclick=()=>{ const q=(provBuscar&&provBuscar.value||'').trim(); const href=q? `/api/proveedores/export?q=${encodeURIComponent(q)}` : '/api/proveedores/export'; window.location.href=href; }; }

  load();
})();
