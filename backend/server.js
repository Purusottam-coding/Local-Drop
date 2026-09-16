'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const os         = require('os');
const path       = require('path');
const fs         = require('fs');

/* ─────────────────────────────────────────────────────────────
   App setup
───────────────────────────────────────────────────────────── */
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ─────────────────────────────────────────────────────────────
   Static frontend (production build)
   DEV:  Vite runs on :5173 and proxies /socket.io → here
   PROD: npm run build → frontend/dist is served from here
───────────────────────────────────────────────────────────── */
const DIST = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(DIST));

/* ─────────────────────────────────────────────────────────────
   Transfer history — persisted to transfers.json
───────────────────────────────────────────────────────────── */
const HISTORY_FILE = path.join(__dirname, 'transfers.json');

// Load existing history from disk, or start fresh
function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Save history to disk
function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

let transferHistory = loadHistory();

// Add a new transfer record and persist it
function recordTransfer(record) {
  transferHistory.unshift(record);          // newest first
  if (transferHistory.length > 500) {       // keep max 500 records
    transferHistory = transferHistory.slice(0, 500);
  }
  saveHistory(transferHistory);
}

/* ─────────────────────────────────────────────────────────────
   REST API — Transfer history
───────────────────────────────────────────────────────────── */

// GET /api/transfers — return full history
app.get('/api/transfers', (_req, res) => {
  res.json(transferHistory);
});

// GET /api/transfers/:id — return a single record
app.get('/api/transfers/:id', (req, res) => {
  const record = transferHistory.find(t => t.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Transfer not found' });
  res.json(record);
});

// DELETE /api/transfers — clear all history
app.delete('/api/transfers', (_req, res) => {
  transferHistory = [];
  saveHistory(transferHistory);
  res.json({ message: 'History cleared' });
});

/* ─────────────────────────────────────────────────────────────
   SPA fallback (must come after API routes)
───────────────────────────────────────────────────────────── */
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) res.status(200).send('Backend running. Open http://localhost:5173 in dev mode.');
  });
});

/* ─────────────────────────────────────────────────────────────
   Utilities
───────────────────────────────────────────────────────────── */
function getLANIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function makeDeviceName() {
  const adj  = ['Swift', 'Bright', 'Cool', 'Fast', 'Sharp', 'Pixel', 'Turbo'];
  const noun = ['Eagle', 'Falcon', 'Hawk', 'Panda', 'Tiger', 'Wolf', 'Fox'];
  return `${adj[Math.floor(Math.random() * adj.length)]} ${noun[Math.floor(Math.random() * noun.length)]}`;
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ─────────────────────────────────────────────────────────────
   In-memory peer registry   Map<socketId, { id, name, ip }>
   Pending transfers          Map<transferId, transferRecord>
───────────────────────────────────────────────────────────── */
const peers   = new Map();
const pending = new Map();   // transfers that are requested but not yet resolved

/* ─────────────────────────────────────────────────────────────
   Socket.IO
───────────────────────────────────────────────────────────── */
io.on('connection', (socket) => {
  // Determine IP
  const rawIp = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '')
    .split(',')[0].trim();
  const ip = (!rawIp || rawIp === '::1') ? '127.0.0.1' : rawIp;

  // Register device
  const me = { id: socket.id, name: makeDeviceName(), ip };
  peers.set(socket.id, me);
  console.log(`[+] ${me.name} connected (${me.ip})`);

  // Tell this socket who it is
  socket.emit('device:info', { name: me.name, ip: me.ip });

  // Send current peer list (excluding self)
  socket.emit('peers:list', [...peers.values()].filter(p => p.id !== socket.id));

  // Tell everyone else a new peer arrived
  socket.broadcast.emit('peer:joined', me);

  /* ── Rescan ─────────────────────────────────────────────── */
  socket.on('peers:scan', () => {
    socket.emit('peers:list', [...peers.values()].filter(p => p.id !== socket.id));
  });

  /* ── Transfer: request ──────────────────────────────────── */
  socket.on('transfer:request', ({ to, files }) => {
    const receiver = peers.get(to);
    if (!receiver) return socket.emit('transfer:error', { msg: 'Device not found' });

    // Create a transfer record
    const transfer = {
      id:          makeId(),
      status:      'pending',
      sender:      { id: me.id, name: me.name, ip: me.ip },
      receiver:    { id: receiver.id, name: receiver.name, ip: receiver.ip },
      files:       files,                      // [{ name, size, type }]
      requestedAt: new Date().toISOString(),
      respondedAt: null,
      completedAt: null,
    };

    pending.set(transfer.id, transfer);

    // Forward the request to the receiver with the transfer ID attached
    io.to(to).emit('transfer:request', { from: me, files, transferId: transfer.id });

    console.log(`[→] ${me.name} → ${receiver.name}  ${files.length} file(s)  [${transfer.id}]`);
  });

  /* ── Transfer: accept ───────────────────────────────────── */
  socket.on('transfer:accept', ({ from, transferId }) => {
    const sender = peers.get(from);
    if (!sender) return;

    // Update the pending record
    const transfer = pending.get(transferId);
    if (transfer) {
      transfer.status      = 'accepted';
      transfer.respondedAt = new Date().toISOString();
    }

    // Notify the sender
    io.to(from).emit('transfer:accepted', { by: me, transferId });

    console.log(`[✓] ${me.name} accepted transfer from ${sender.name}  [${transferId}]`);
  });

  /* ── Transfer: reject ───────────────────────────────────── */
  socket.on('transfer:reject', ({ from, transferId }) => {
    const sender = peers.get(from);
    if (!sender) return;

    // Finalise the record as rejected and save
    const transfer = pending.get(transferId);
    if (transfer) {
      transfer.status      = 'rejected';
      transfer.respondedAt = new Date().toISOString();
      transfer.completedAt = new Date().toISOString();
      recordTransfer(transfer);
      pending.delete(transferId);
    }

    io.to(from).emit('transfer:rejected', { by: me, transferId });

    console.log(`[✗] ${me.name} rejected transfer from ${sender.name}  [${transferId}]`);
  });

  /* ── Transfer: complete ─────────────────────────────────── */
  // Frontend emits this when all file bytes have been sent
  socket.on('transfer:complete', ({ transferId }) => {
    const transfer = pending.get(transferId);
    if (transfer) {
      transfer.status      = 'completed';
      transfer.completedAt = new Date().toISOString();
      recordTransfer(transfer);
      pending.delete(transferId);

      // Notify both sides
      io.to(transfer.sender.id).emit('transfer:done',   { transferId });
      io.to(transfer.receiver.id).emit('transfer:done', { transferId });

      console.log(`[✔] Transfer complete  [${transferId}]`);
    }
  });

  /* ── WebRTC signaling stubs (Phase 2) ───────────────────── */
  socket.on('webrtc:offer',  ({ to, sdp })       => io.to(to).emit('webrtc:offer',  { from: socket.id, sdp }));
  socket.on('webrtc:answer', ({ to, sdp })       => io.to(to).emit('webrtc:answer', { from: socket.id, sdp }));
  socket.on('webrtc:ice',    ({ to, candidate }) => io.to(to).emit('webrtc:ice',    { from: socket.id, candidate }));

  /* ── Disconnect ─────────────────────────────────────────── */
  socket.on('disconnect', () => {
    peers.delete(socket.id);
    io.emit('peer:left', { id: socket.id, name: me.name });
    console.log(`[-] ${me.name} disconnected`);
  });
});

/* ─────────────────────────────────────────────────────────────
   Start
───────────────────────────────────────────────────────────── */
server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLANIp();
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║          LocalDrop  •  v0.1.0            ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Local  →  http://localhost:${PORT}         ║`);
  console.log(`║  LAN    →  http://${lanIp}:${PORT}   ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`  History file: ${HISTORY_FILE}`);
  console.log(`  Loaded ${transferHistory.length} existing record(s)\n`);
});
