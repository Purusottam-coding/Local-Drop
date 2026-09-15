/**
 * LocalDrop – app.js  (browser-side)
 * Handles: Socket.IO signaling, device list, file selection,
 * drag-and-drop, queue, fake progress simulation, history, toasts.
 *
 * NOTE: WebRTC DataChannel wiring will be added in the next phase.
 *       For now, transfers are simulated so the UI can be tested end-to-end.
 */

/* ── Socket.IO connection ──────────────────────────────────── */
const socket = io();

/* ── DOM refs ──────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

const connectionDot      = $('connectionDot');
const connectionLabel    = $('connectionLabel');
const myDeviceName       = $('myDeviceName');
const myDeviceIP         = $('myDeviceIP');
const deviceList         = $('deviceList');
const scanBtn            = $('scanBtn');
const transferPlaceholder = $('transferPlaceholder');
const transferActive     = $('transferActive');
const targetAvatar       = $('targetAvatar');
const targetDeviceName   = $('targetDeviceName');
const targetDeviceStatus = $('targetDeviceStatus');
const disconnectBtn      = $('disconnectBtn');
const dropZone           = $('dropZone');
const browseBtn          = $('browseBtn');
const fileInput          = $('fileInput');
const fileQueue          = $('fileQueue');
const queueList          = $('queueList');
const clearQueueBtn      = $('clearQueueBtn');
const sendBtn            = $('sendBtn');
const progressSection    = $('progressSection');
const progressList       = $('progressList');
const historyList        = $('historyList');
const incomingModal      = $('incomingModal');
const modalBody          = $('modalBody');
const senderName         = $('senderName');
const modalFileList      = $('modalFileList');
const acceptBtn          = $('acceptBtn');
const rejectBtn          = $('rejectBtn');
const clearHistoryBtn    = $('clearHistoryBtn');
const toastContainer     = $('toastContainer');

/* ── State ─────────────────────────────────────────────────── */
let myId           = null;
let selectedPeer   = null;      // { id, name, ip }
let queuedFiles    = [];        // File objects waiting to be sent
let transferHistory = [];       // { name, size, direction, status, ts }

/* ══════════════════════════════════════════════════════════════
   SOCKET EVENTS
══════════════════════════════════════════════════════════════ */

socket.on('connect', () => {
  myId = socket.id;
  setConnected(true);
  showToast('Connected to LocalDrop server', 'success');
});

socket.on('disconnect', () => {
  setConnected(false);
  showToast('Disconnected from server', 'error');
});

/* Server tells us our device info */
socket.on('device:info', ({ name, ip }) => {
  myDeviceName.textContent = name;
  myDeviceIP.textContent   = ip;
});

/* Full peer list from server */
socket.on('peers:list', (peers) => {
  renderPeerList(peers);
});

/* A new peer joined */
socket.on('peer:joined', (peer) => {
  showToast(`${peer.name} joined the network`, 'info');
  appendPeer(peer);
});

/* A peer left */
socket.on('peer:left', ({ id, name }) => {
  removePeer(id);
  showToast(`${name} left the network`, 'info');
  if (selectedPeer && selectedPeer.id === id) {
    deselectPeer();
  }
});

/* Incoming transfer request */
socket.on('transfer:request', ({ from, files }) => {
  openIncomingModal(from, files);
});

/* The other side accepted our request */
socket.on('transfer:accepted', ({ by }) => {
  showToast(`${by.name} accepted the transfer`, 'success');
  targetDeviceStatus.textContent = 'Receiving…';
  startSimulatedTransfer(queuedFiles, 'sent', by.name);
});

/* The other side rejected our request */
socket.on('transfer:rejected', ({ by }) => {
  showToast(`${by.name} declined the transfer`, 'error');
  targetDeviceStatus.textContent = 'Ready to receive files';
});

/* ══════════════════════════════════════════════════════════════
   CONNECTION STATUS
══════════════════════════════════════════════════════════════ */
function setConnected(yes) {
  connectionDot.classList.toggle('connected', yes);
  connectionLabel.textContent = yes ? 'Online' : 'Disconnected';
}

/* ══════════════════════════════════════════════════════════════
   DEVICE / PEER LIST RENDERING
══════════════════════════════════════════════════════════════ */
function renderPeerList(peers) {
  deviceList.innerHTML = '';
  if (!peers || peers.length === 0) {
    deviceList.innerHTML = `
      <li class="device-empty">
        <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg></div>
        <p>No other devices found</p>
      </li>`;
    return;
  }
  peers.forEach(appendPeer);
}

function appendPeer(peer) {
  // Remove empty state if present
  const empty = deviceList.querySelector('.device-empty');
  if (empty) empty.remove();

  // Avoid duplicates
  if (document.getElementById(`peer-${peer.id}`)) return;

  const li = document.createElement('li');
  li.classList.add('device-item');
  li.id = `peer-${peer.id}`;
  li.innerHTML = `
    <div class="device-avatar peer">${peer.name.charAt(0).toUpperCase()}</div>
    <div class="device-info">
      <p class="device-name">${escHtml(peer.name)}</p>
      <p class="device-ip">${escHtml(peer.ip)}</p>
    </div>
    <div class="device-online-dot"></div>`;
  li.addEventListener('click', () => selectPeer(peer, li));
  deviceList.appendChild(li);
}

function removePeer(id) {
  const el = document.getElementById(`peer-${id}`);
  if (el) el.remove();
  if (deviceList.children.length === 0) {
    deviceList.innerHTML = `
      <li class="device-empty">
        <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg></div>
        <p>No other devices found</p>
      </li>`;
  }
}

/* ══════════════════════════════════════════════════════════════
   PEER SELECTION
══════════════════════════════════════════════════════════════ */
function selectPeer(peer, liEl) {
  // Deselect previous
  document.querySelectorAll('.device-item').forEach(el => el.classList.remove('active'));
  liEl.classList.add('active');

  selectedPeer = peer;
  targetAvatar.textContent       = peer.name.charAt(0).toUpperCase();
  targetDeviceName.textContent   = peer.name;
  targetDeviceStatus.textContent = 'Ready to receive files';

  // Reset queue & progress
  clearQueue();
  progressSection.style.display = 'none';
  progressList.innerHTML = '';

  transferPlaceholder.style.display = 'none';
  transferActive.style.display      = 'flex';
}

function deselectPeer() {
  selectedPeer = null;
  document.querySelectorAll('.device-item').forEach(el => el.classList.remove('active'));
  clearQueue();
  transferActive.style.display      = 'none';
  transferPlaceholder.style.display = 'flex';
}

disconnectBtn.addEventListener('click', deselectPeer);

/* ══════════════════════════════════════════════════════════════
   SCAN / REFRESH
══════════════════════════════════════════════════════════════ */
scanBtn.addEventListener('click', () => {
  scanBtn.classList.add('spinning');
  deviceList.innerHTML = `
    <li style="list-style:none">
      <div class="scan-overlay">
        <div class="scan-ring"></div>
        <p>Scanning network…</p>
      </div>
    </li>`;
  socket.emit('peers:scan');
  setTimeout(() => scanBtn.classList.remove('spinning'), 1500);
});

/* ══════════════════════════════════════════════════════════════
   FILE SELECTION – DRAG & DROP + BROWSE
══════════════════════════════════════════════════════════════ */
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => addFilesToQueue(Array.from(fileInput.files)));

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files);
  if (files.length) addFilesToQueue(files);
});

function addFilesToQueue(files) {
  files.forEach(f => {
    if (!queuedFiles.find(q => q.name === f.name && q.size === f.size)) {
      queuedFiles.push(f);
    }
  });
  renderQueue();
}

function renderQueue() {
  queueList.innerHTML = '';
  queuedFiles.forEach((f, i) => {
    const li = document.createElement('li');
    li.classList.add('queue-item');
    li.innerHTML = `
      <div class="file-icon">${fileEmoji(f.name)}</div>
      <span class="queue-file-name">${escHtml(f.name)}</span>
      <span class="queue-file-size">${formatBytes(f.size)}</span>
      <button class="queue-remove" data-idx="${i}" title="Remove">×</button>`;
    queueList.appendChild(li);
  });

  // Remove buttons
  queueList.querySelectorAll('.queue-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      queuedFiles.splice(+btn.dataset.idx, 1);
      renderQueue();
    });
  });

  fileQueue.style.display = queuedFiles.length ? 'flex' : 'none';
}

function clearQueue() {
  queuedFiles = [];
  queueList.innerHTML = '';
  fileQueue.style.display = 'none';
  fileInput.value = '';
}

clearQueueBtn.addEventListener('click', clearQueue);

/* ══════════════════════════════════════════════════════════════
   SEND
══════════════════════════════════════════════════════════════ */
sendBtn.addEventListener('click', () => {
  if (!selectedPeer || !queuedFiles.length) return;

  const fileMeta = queuedFiles.map(f => ({ name: f.name, size: f.size, type: f.type }));
  socket.emit('transfer:request', { to: selectedPeer.id, files: fileMeta });

  targetDeviceStatus.textContent = 'Waiting for acceptance…';
  sendBtn.disabled = true;
  sendBtn.textContent = 'Waiting…';

  // Re-enable send button after 15s if no response (for demo)
  setTimeout(() => {
    sendBtn.disabled = false;
    sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg> Send Files`;
  }, 15000);
});

/* ══════════════════════════════════════════════════════════════
   INCOMING MODAL
══════════════════════════════════════════════════════════════ */
function openIncomingModal(from, files) {
  senderName.textContent = from.name;
  modalFileList.innerHTML = files.map(f =>
    `<li><span class="icon">${fileEmoji(f.name)}</span>
     <span>${escHtml(f.name)}</span>
     <span style="margin-left:auto;color:var(--text-muted);font-size:11px">${formatBytes(f.size)}</span>
    </li>`
  ).join('');

  incomingModal.style.display = 'flex';

  acceptBtn.onclick = () => {
    socket.emit('transfer:accept', { from: from.id });
    incomingModal.style.display = 'none';
    showToast('Transfer accepted', 'success');
    startSimulatedTransfer(files, 'received', from.name);
  };

  rejectBtn.onclick = () => {
    socket.emit('transfer:reject', { from: from.id });
    incomingModal.style.display = 'none';
    showToast('Transfer declined', 'info');
  };
}

/* ══════════════════════════════════════════════════════════════
   SIMULATED PROGRESS  (placeholder until WebRTC DataChannel)
══════════════════════════════════════════════════════════════ */
function startSimulatedTransfer(files, direction, peerName) {
  clearQueue();
  sendBtn.disabled = false;
  sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg> Send Files`;

  progressSection.style.display = 'flex';
  progressList.innerHTML = '';

  const items = files.map(f => ({ name: f.name, size: f.size || 0, pct: 0 }));

  items.forEach((item, idx) => {
    const div = document.createElement('div');
    div.classList.add('progress-item');
    div.id = `prog-${idx}`;
    div.innerHTML = `
      <div class="progress-item-header">
        <span class="progress-file-name">${escHtml(item.name)}</span>
        <span class="progress-pct" id="pct-${idx}">0%</span>
      </div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" id="bar-${idx}" style="width:0%"></div>
      </div>
      <div class="progress-meta">
        <span id="speed-${idx}">–</span>
        <span id="remain-${idx}">–</span>
      </div>`;
    progressList.appendChild(div);

    simulateFile(idx, item, direction, peerName);
  });
}

function simulateFile(idx, item, direction, peerName) {
  let pct   = 0;
  const dur = 1500 + Math.random() * 3000;   // 1.5 – 4.5 s
  const step = 100 / (dur / 80);             // ~80 ms ticks

  const interval = setInterval(() => {
    pct = Math.min(100, pct + step + Math.random() * step * 0.5);
    const p = Math.round(pct);

    $(`pct-${idx}`).textContent = `${p}%`;
    $(`bar-${idx}`).style.width = `${p}%`;
    $(`speed-${idx}`).textContent = `${(Math.random() * 4 + 1).toFixed(1)} MB/s`;
    $(`remain-${idx}`).textContent = p < 100 ? `${Math.ceil((100 - p) / step * 0.08)}s left` : 'Done';

    if (pct >= 100) {
      clearInterval(interval);
      $(`bar-${idx}`).classList.add('done');
      addHistory({ name: item.name, size: item.size, direction, status: 'done', peer: peerName });
      showToast(`${direction === 'sent' ? 'Sent' : 'Received'}: ${item.name}`, 'success');
    }
  }, 80);
}

/* ══════════════════════════════════════════════════════════════
   HISTORY
══════════════════════════════════════════════════════════════ */
function addHistory(entry) {
  transferHistory.unshift({ ...entry, ts: Date.now() });
  renderHistory();
}

function renderHistory() {
  const empty = historyList.querySelector('.history-empty');
  if (empty) empty.remove();

  historyList.innerHTML = '';
  transferHistory.forEach(h => {
    const li = document.createElement('li');
    li.classList.add('history-item');
    const badge = h.direction === 'sent' ? 'sent' : 'received';
    li.innerHTML = `
      <div class="history-item-header">
        <span class="history-item-name" title="${escHtml(h.name)}">${escHtml(h.name)}</span>
        <span class="history-badge ${badge}">${badge.toUpperCase()}</span>
      </div>
      <p class="history-meta">${formatBytes(h.size)} · ${h.peer} · ${timeAgo(h.ts)}</p>`;
    historyList.appendChild(li);
  });
}

clearHistoryBtn.addEventListener('click', () => {
  transferHistory = [];
  historyList.innerHTML = `
    <li class="history-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="12 8 12 12 14 14"/>
        <path d="M3.05 11A9 9 0 1 0 5 5.6"/>
        <polyline points="3 3 3.05 11 11 11"/>
      </svg>
      <p>No transfers yet</p>
    </li>`;
});

/* ══════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
══════════════════════════════════════════════════════════════ */
function showToast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const div = document.createElement('div');
  div.classList.add('toast', type);
  div.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-msg">${escHtml(msg)}</span>
    <button class="toast-close">×</button>`;
  div.querySelector('.toast-close').addEventListener('click', () => div.remove());
  toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

/* ══════════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════════ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(b) {
  if (!b) return '–';
  if (b < 1024)         return `${b} B`;
  if (b < 1024 ** 2)   return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)   return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5)   return 'just now';
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.round(s/60)}m ago`;
  return `${Math.round(s/3600)}h ago`;
}

function fileEmoji(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📑', pptx:'📑',
    jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', webp:'🖼️', svg:'🎨',
    mp4:'🎬', mov:'🎬', avi:'🎬', mkv:'🎬', mp3:'🎵', wav:'🎵', flac:'🎵',
    zip:'📦', rar:'📦', '7z':'📦', tar:'📦', gz:'📦',
    js:'💻', ts:'💻', py:'💻', html:'💻', css:'💻', json:'💻', xml:'💻',
    txt:'📃', md:'📃', csv:'📊',
  };
  return map[ext] || '📁';
}
