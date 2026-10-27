async function loadStatus() {
  const statusEl = document.getElementById('status');
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Server error');
    statusEl.textContent = 'Server is running.';
    statusEl.className = 'ok';
    document.getElementById('vehicle-count').textContent = data.vehicles;
    document.getElementById('inspection-count').textContent = data.inspections;
  } catch (err) {
    statusEl.textContent = 'Could not reach the server: ' + err.message;
    statusEl.className = 'error';
  }
}

loadStatus();
