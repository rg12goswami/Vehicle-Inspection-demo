const STEPS = [
  {key:'FRONT', label:'Front View', help:'Take a clear photo of the front of the vehicle.', kind:'photo', required:true},
  {key:'REAR', label:'Rear View', help:'Capture the complete rear view.', kind:'photo', required:true},
  {key:'LEFT', label:'Left Side', help:'Capture the complete left side.', kind:'photo', required:true},
  {key:'RIGHT', label:'Right Side', help:'Capture the complete right side.', kind:'photo', required:true},
  {key:'CHASSIS_IMPRINT', label:'Chassis Imprint', help:'Capture the chassis imprint if available.', kind:'photo'},
  {key:'CHASSIS_NUMBER', label:'Chassis Number', help:'Capture the chassis number clearly.', kind:'photo', required:true},
  {key:'DAMAGE_1', label:'Damage Photo 1', help:'Capture visible damage, if any.', kind:'photo'},
  {key:'DAMAGE_2', label:'Damage Photo 2', help:'Capture another damage area, if any.', kind:'photo'},
  {key:'DAMAGE_3', label:'Damage Photo 3', help:'Capture another damage area, if any.', kind:'photo'},
  {key:'DAMAGE_4', label:'Damage Photo 4', help:'Capture another damage area, if any.', kind:'photo'},
  {key:'ENGINE_PLATE', label:'Engine Registration Plate', help:'Capture the engine registration plate, if available.', kind:'photo'},
  {key:'ENGINE_IMAGE', label:'Engine Image', help:'Capture the engine compartment clearly.', kind:'photo', required:true},
  {key:'ODOMETER', label:'Odometer', help:'Capture the odometer reading clearly.', kind:'photo', required:true},
  {key:'INTERIOR', label:'Interior / Cabin', help:'Capture the interior or cabin.', kind:'photo'},
  {key:'SHORT_VIDEO', label:'Short Walk-around Video', help:'Upload a short walk-around video.', kind:'video'}
];
const $ = id => document.getElementById(id);
const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
let inspection = null;
let currentStep = 0;
let busy = false;

async function api(url, options = {}) {
  const res = await fetch(url, options);
  let data = {}; try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
async function init() {
  try {
    inspection = await api(`/api/public/inspection/${encodeURIComponent(token)}`);
    $('upload-panel').hidden = false; $('inspection-id').textContent = inspection.id;
    renderStepList(); renderStep();
  } catch (_) { $('invalid-panel').hidden = false; }
}
function findMedia(key) { return (inspection?.media || []).find(m => m.category === key); }
function renderStepList() {
  const list = $('step-list'); list.innerHTML = '';
  STEPS.forEach((step, index) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'step-chip' + (index === currentStep ? ' active' : '') + (findMedia(step.key) ? ' complete' : '');
    const mark = document.createElement('span'); mark.className = 'step-chip-mark'; mark.textContent = findMedia(step.key) ? '✓' : String(index+1).padStart(2,'0');
    const name = document.createElement('span'); name.textContent = step.label;
    b.append(mark,name); b.addEventListener('click', () => { if (!busy) { currentStep = index; renderStep(); } }); list.appendChild(b);
  });
  const completed = STEPS.filter(s => findMedia(s.key)).length;
  $('progress-fill').style.width = `${completed / STEPS.length * 100}%`;
  $('progress-text').textContent = `${completed} of ${STEPS.length} steps complete`;
  $('upload-status').textContent = inspection.status;
}
function renderStep() {
  const step = STEPS[currentStep]; const media = findMedia(step.key);
  $('step-index').textContent = String(currentStep+1).padStart(2,'0'); $('step-title').textContent = step.label;
  $('step-instruction').textContent = step.help + (step.required ? ' Required photo.' : ' Optional step.');
  const input = $('file-input'); input.value = ''; input.accept = step.kind === 'video' ? 'video/mp4,video/quicktime,video/webm' : 'image/jpeg,image/png'; input.setAttribute('capture', 'environment');
  $('capture-btn').textContent = step.kind === 'video' ? 'Record / Choose Video' : 'Capture / Choose Photo';
  $('replace-btn').hidden = !media;
  $('prev-btn').disabled = currentStep === 0; $('next-btn').textContent = currentStep === STEPS.length-1 ? 'Finish' : 'Next Step';
  const area = $('preview-area'); area.innerHTML = '';
  if (!media) { const placeholder = document.createElement('div'); placeholder.className='preview-placeholder'; placeholder.innerHTML='<span class="camera-icon">◎</span><p>No file uploaded for this step yet.</p>'; area.appendChild(placeholder); }
  else {
    const el = document.createElement(media.mimeType.startsWith('video/') ? 'video' : 'img'); el.src = media.url; if (el.tagName === 'VIDEO') { el.controls = true; el.playsInline = true; }
    el.className='preview-media'; area.appendChild(el);
    const done=document.createElement('p'); done.className='uploaded-badge'; done.textContent=`✓ Uploaded ${(media.size/(1024*1024)).toFixed(2)} MB`; area.appendChild(done);
  }
  $('upload-message').textContent = '';
  renderStepList();
}
function pickFile() { if (!busy) $('file-input').click(); }
$('capture-btn').addEventListener('click', pickFile);
$('replace-btn').addEventListener('click', pickFile);
$('file-input').addEventListener('change', async () => {
  const file = $('file-input').files[0]; if (!file) return;
  const step = STEPS[currentStep];
  if (step.kind === 'photo' && !file.type.startsWith('image/')) return showMessage('Choose an image for this step.', true);
  if (step.kind === 'video' && !file.type.startsWith('video/')) return showMessage('Choose a video for this step.', true);
  if (file.size > 45 * 1024 * 1024) return showMessage('File must be smaller than 45 MB.', true);
  busy = true; toggleBusy(true); showMessage('Uploading…', false);
  try {
    const body = new FormData(); body.append('file', file, file.name);
    const result = await api(`/api/public/inspection/${encodeURIComponent(token)}/media?category=${encodeURIComponent(step.key)}`, { method:'POST', body });
    inspection = result.inspection; renderStep(); showMessage('Upload saved successfully.', false);
  } catch (err) { showMessage(err.message, true); }
  finally { busy = false; toggleBusy(false); }
});
function toggleBusy(value) { $('capture-btn').disabled = value; $('replace-btn').disabled = value; $('next-btn').disabled = value; $('prev-btn').disabled = value; }
function showMessage(message, error) { const el=$('upload-message'); el.textContent=message; el.className=error?'message error':'message ok'; }
$('prev-btn').addEventListener('click', () => { if (currentStep > 0 && !busy) { currentStep--; renderStep(); } });
$('next-btn').addEventListener('click', () => {
  if (busy) return;
  if (currentStep < STEPS.length-1) { currentStep++; renderStep(); return; }
  const missing = STEPS.filter(s => s.required && !findMedia(s.key));
  if (missing.length) showMessage(`Upload required photos before finishing: ${missing.map(s=>s.label).join(', ')}`, true);
  else showMessage('All required photos are uploaded. You can close this page; the admin can now complete the report.', false);
});
init();
