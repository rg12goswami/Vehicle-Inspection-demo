const $ = (id) => document.getElementById(id);
const loginCard = $('login-card');
const dashboard = $('dashboard');
const detailCard = $('detail-card');
const rows = $('inspection-rows');
const form = $('details-form');
let currentInspectionId = null;
let currentInspection = null;
let listTimer = null;
let detailTimer = null;

const fields = [
  'companyName','companyAddress','reportReference','reportDate','bankName','inspectorName','customerName','customerAddress','inspectionLocation',
  'vehicleCategory','registrationNumber','manufacturer','model','manufactureYear','registrationDate','chassisNumber','engineNumber',
  'vehicleType','bodyType','fuelType','colour','odometer','invoiceCost','valuationAmount','estimatedRepairCost','remainingLife',
  'insuranceDetails','fitnessStatus','permitStatus','taxStatus','overallCondition','engineCondition','transmissionCondition','brakesCondition',
  'steeringCondition','suspensionCondition','electricalCondition','batteryCondition','tyreCondition','bodyCondition','chassisCondition','interiorCondition',
  'inspectorSignatureName','remarks','disclaimer'
];

async function api(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  let payload = {};
  try { payload = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
  return payload;
}
function toast(message) {
  const el = $('toast'); el.textContent = message; el.hidden = false;
  window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => { el.hidden = true; }, 2600);
}
function showLogin() { stopTimers(); loginCard.hidden = false; dashboard.hidden = true; $('logout-btn').hidden = true; }
function showDashboard() { loginCard.hidden = true; dashboard.hidden = false; $('logout-btn').hidden = false; if (!listTimer) listTimer = setInterval(() => { if (!document.hidden && dashboard.hidden === false) loadInspections(); }, 5000); }
async function checkAuth() {
  try { const state = await api('/api/admin/me'); if (state.authenticated) { showDashboard(); await loadInspections(); } else showLogin(); }
  catch (_) { showLogin(); }
}
$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault(); $('login-error').textContent = '';
  try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('admin-password').value }) }); $('admin-password').value=''; showDashboard(); await loadInspections(); }
  catch (err) { $('login-error').textContent = err.message; }
});
$('logout-btn').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (_) {}
  stopTimers(); showLogin(); detailCard.hidden = true;
});
function stopTimers() { if (listTimer) clearInterval(listTimer); if (detailTimer) clearInterval(detailTimer); listTimer = null; detailTimer = null; }
function statusClass(status) {
  if (status === 'Report Generated') return 'status-good';
  if (status === 'Media Complete' || status === 'Details Saved') return 'status-info';
  return 'status-wait';
}
async function loadInspections() {
  try {
    const list = await api('/api/admin/inspections');
    rows.innerHTML = '';
    if (!list.length) { rows.innerHTML = '<tr><td colspan="5" class="muted">No inspections yet. Create one above.</td></tr>'; return; }
    list.forEach(i => {
      const tr = document.createElement('tr');
      const values = [i.id, i.status, new Date(i.createdAt).toLocaleString(), `${i.media.length} files`];
      values.forEach((value, idx) => { const td = document.createElement('td'); td.textContent = value; if (idx === 1) { const span = document.createElement('span'); span.className = `pill ${statusClass(value)}`; span.textContent = value; td.textContent=''; td.appendChild(span); } tr.appendChild(td); });
      const action = document.createElement('td'); const button = document.createElement('button'); button.className = 'btn btn-small'; button.textContent = 'Open'; button.addEventListener('click', () => openInspection(i.id)); action.appendChild(button); tr.appendChild(action); rows.appendChild(tr);
    });
  } catch (err) { rows.innerHTML = `<tr><td colspan="5" class="error">${escapeText(err.message)}</td></tr>`; if (err.message.includes('sign in')) showLogin(); }
}
function escapeText(s) { const el = document.createElement('span'); el.textContent = String(s); return el.innerHTML; }
$('create-btn').addEventListener('click', async () => {
  $('create-error').textContent = ''; $('create-btn').disabled = true;
  try {
    const i = await api('/api/admin/inspections', { method: 'POST', body: JSON.stringify({}) });
    $('new-id').textContent = i.id; $('upload-link').value = i.uploadLink; $('new-link-box').hidden = false;
    await loadInspections(); await openInspection(i.id); toast('Inspection link created.');
  } catch (err) { $('create-error').textContent = err.message; }
  finally { $('create-btn').disabled = false; }
});
$('copy-btn').addEventListener('click', () => copyText($('upload-link').value, $('copy-msg')));
$('open-btn').addEventListener('click', () => window.open($('upload-link').value, '_blank', 'noopener'));
$('refresh-list-btn').addEventListener('click', loadInspections);
$('close-detail-btn').addEventListener('click', () => { detailCard.hidden = true; currentInspectionId = null; if (detailTimer) clearInterval(detailTimer); detailTimer = null; });
$('copy-detail-link-btn').addEventListener('click', () => copyText($('detail-upload-link').value, $('detail-copy-msg')));
$('open-detail-link-btn').addEventListener('click', () => window.open($('detail-upload-link').value, '_blank', 'noopener'));
async function copyText(value, target) {
  try { await navigator.clipboard.writeText(value); } catch (_) { const temp=document.createElement('textarea'); temp.value=value; document.body.appendChild(temp); temp.select(); document.execCommand('copy'); temp.remove(); }
  target.textContent = 'Copied!'; setTimeout(() => target.textContent = '', 1800);
}
async function openInspection(id) {
  fields.forEach(name => { const input = form.elements.namedItem(name); if (input) { delete input.dataset.touched; delete input.dataset.touchedAtLoad; } });
  currentInspectionId = id; detailCard.hidden = false; $('detail-title').textContent = id; $('media-grid').innerHTML = '<p class="muted">Loading media…</p>';
  await refreshDetail(); detailCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (detailTimer) clearInterval(detailTimer);
  detailTimer = setInterval(() => { if (currentInspectionId === id && !document.hidden) refreshDetail(true); }, 2500);
}
async function refreshDetail(silent = false) {
  if (!currentInspectionId) return;
  try {
    const i = await api(`/api/admin/inspections/${encodeURIComponent(currentInspectionId)}`);
    currentInspection = i;
    $('detail-title').textContent = i.id;
    $('detail-status').textContent = `Status: ${i.status} · Created ${new Date(i.createdAt).toLocaleString()}`;
    $('detail-upload-link').value = i.uploadLink;
    $('media-progress').textContent = `${i.media.length} file${i.media.length === 1 ? '' : 's'}`;
    $('missing-photos').hidden = !i.missing.length;
    $('missing-photos').textContent = i.missing.length ? `Required photos still missing: ${i.missing.map(k => ({FRONT:'Front',REAR:'Rear',LEFT:'Left',RIGHT:'Right',CHASSIS_NUMBER:'Chassis number',ENGINE_IMAGE:'Engine image',ODOMETER:'Odometer'}[k] || k)).join(', ')}` : '';
    renderMedia(i);
    fields.forEach(name => { const input = form.elements.namedItem(name); if (input && (!input.dataset.touched || !input.dataset.touchedAtLoad)) { input.value = i.details?.[name] ?? ''; input.dataset.touchedAtLoad = 'true'; } });
    $('report-stale').hidden = !i.reportOutOfDate;
    $('download-pdf-btn').hidden = !i.report;
    $('generate-pdf-btn').textContent = i.report ? 'Regenerate PDF report' : 'Generate PDF report';
    if (!silent) $('save-status').textContent = '';
  } catch (err) { if (!silent) toast(err.message); if (err.message.includes('sign in')) showLogin(); }
}
function renderMedia(i) {
  const grid = $('media-grid'); grid.innerHTML = '';
  if (!i.media.length) { grid.innerHTML = '<p class="muted">No files uploaded yet. Send the link to the field worker.</p>'; return; }
  const ordered = i.media.slice().sort((a,b) => a.label.localeCompare(b.label));
  for (const m of ordered) {
    const card = document.createElement('article'); card.className = 'media-card';
    const mediaUrl = `/api/admin/inspections/${encodeURIComponent(i.id)}/media/${encodeURIComponent(m.id)}`;
    let element;
    if (m.mimeType.startsWith('video/')) { element = document.createElement('video'); element.controls = true; element.preload = 'metadata'; }
    else { element = document.createElement('img'); element.alt = m.label; }
    element.src = mediaUrl; card.appendChild(element);
    const label = document.createElement('strong'); label.textContent = m.label; card.appendChild(label);
    const meta = document.createElement('span'); meta.className = 'muted small'; meta.textContent = `${(m.size / (1024*1024)).toFixed(2)} MB`; card.appendChild(meta);
    grid.appendChild(card);
  }
}
form.addEventListener('input', ev => { if (ev.target.name) { ev.target.dataset.touched = 'true'; $('save-status').textContent = 'Unsaved changes'; $('report-stale').hidden = false; } });
form.addEventListener('submit', async ev => {
  ev.preventDefault(); if (!currentInspectionId) return;
  $('details-error').textContent = ''; $('save-status').textContent = 'Saving…';
  const payload = {}; fields.forEach(name => { const el = form.elements.namedItem(name); if (el) payload[name] = el.value; });
  try {
    await api(`/api/admin/inspections/${encodeURIComponent(currentInspectionId)}/details`, { method: 'PUT', body: JSON.stringify(payload) });
    fields.forEach(name => { const el = form.elements.namedItem(name); if (el) { delete el.dataset.touched; el.dataset.touchedAtLoad = 'true'; } });
    $('save-status').textContent = 'Details saved'; await refreshDetail(true); toast('Details saved.'); await loadInspections();
  } catch (err) { $('save-status').textContent = ''; $('details-error').textContent = err.message; }
});
$('generate-pdf-btn').addEventListener('click', async () => {
  if (!currentInspectionId) return;
  $('details-error').textContent = '';
  try {
    $('generate-pdf-btn').disabled = true; $('generate-pdf-btn').textContent = 'Generating…';
    const result = await api(`/api/admin/inspections/${encodeURIComponent(currentInspectionId)}/generate-pdf`, { method: 'POST', body: JSON.stringify({}) });
    await refreshDetail(true); await loadInspections(); toast('PDF generated successfully.');
    if (result.pdfUrl) { const opened = window.open(result.pdfUrl, '_blank', 'noopener'); if (!opened) toast('PDF ready. Use Download PDF to open it.'); }
  } catch (err) { $('details-error').textContent = err.message; }
  finally { $('generate-pdf-btn').disabled = false; if (currentInspection) $('generate-pdf-btn').textContent = currentInspection.report ? 'Regenerate PDF report' : 'Generate PDF report'; }
});
$('download-pdf-btn').addEventListener('click', () => { if (currentInspectionId) window.location.href = `/api/admin/inspections/${encodeURIComponent(currentInspectionId)}/pdf`; });
$('download-zip-btn').addEventListener('click', () => { if (currentInspectionId) window.location.href = `/api/admin/inspections/${encodeURIComponent(currentInspectionId)}/download-zip`; });
checkAuth();
