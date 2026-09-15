/**
 * LocalDrop – server.js
 *
 * Express + Socket.IO signaling server.
 * Handles:
 *  - Serving static frontend
 *  - Device registration / discovery on the LAN
 *  - Relaying transfer requests, accept / reject signals between peers
 *
 * WebRTC offer/answer/ICE relay will be added in Phase 2.
 */

'use strict';

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const os       = require('os');
const path     = require('path');

/* ── App setup ─────────────────────────────────────────────── */
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

/* ── Static frontend (production) ──────────────────────────── */
// In development: React runs on Vite dev server (port 5173),
//                 which proxies /socket.io → this server (port 3000).
// In production:  run `npm run build` → serves client/dist here.
const DIST = path.join(__dirname, 'client', 'dist');
app.use(express.static(DIST));
// SPA fallback – return index.html for any non-API route
app.get('*', (_req, res) => {
  const index = path.join(DIST, 'index.html');
  res.sendFile(index, (err) => {
    if (err) res.status(200).send('LocalDrop API server running. Open http://localhost:5173 in dev mode.');
  });
});

/* ── Utility: get local LAN IPv4 ────────────────────────────── */
function getLANIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/* ── Generate a friendly device name ───────────────────────── */
function deviceName() {
  const adjectives = ['Swift', 'Bright', 'Cool', 'Fast', 'Sharp', 'Pixel', 'Turbo'];
  const nouns      = ['Eagle', 'Falcon', 'Hawk', 'Panda', 'Tiger', 'Wolf', 'Fox'];
  const adj  = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

/* ── In-memory peer registry ────────────────────────────────── */
// Map<socketId, { id, name, ip }>
const peers = new Map();

/* ── Socket.IO events ───────────────────────────────────────── */
io.on('connection', (socket) => {
  const ip   = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim() || getLANIp();
  const name = deviceName();

  const me = { id: socket.id, name, ip: ip === '::1' ? '127.0.0.1' : ip };
  peers.set(socket.id, me);

  console.log(`[+] ${name} connected  (${socket.id.slice(0,8)}…) from ${me.ip}`);

  /* 1. Send this socket its own info */
  socket.emit('device:info', { name: me.name, ip: me.ip });

  /* 2. Send existing peers list (exclude self) */
  const otherPeers = [...peers.values()].filter(p => p.id !== socket.id);
  socket.emit('peers:list', otherPeers);

  /* 3. Broadcast new peer to everyone else */
  socket.broadcast.emit('peer:joined', me);

  /* ── Re-scan request ──────────────────────────────────────── */
  socket.on('peers:scan', () => {
    const list = [...peers.values()].filter(p => p.id !== socket.id);
    socket.emit('peers:list', list);
  });

  /* ── Transfer: request ────────────────────────────────────── */
  socket.on('transfer:request', ({ to, files }) => {
    const target = peers.get(to);
    if (!target) return socket.emit('error', { msg: 'Target device not found' });

    io.to(to).emit('transfer:request', { from: me, files });
    console.log(`[→] Transfer request: ${me.name} → ${target.name}  (${files.length} file(s))`);
  });

  /* ── Transfer: accept ─────────────────────────────────────── */
  socket.on('transfer:accept', ({ from }) => {
    const sender = peers.get(from);
    if (!sender) return;

    io.to(from).emit('transfer:accepted', { by: me });
    console.log(`[✓] ${me.name} accepted transfer from ${sender.name}`);
  });

  /* ── Transfer: reject ─────────────────────────────────────── */
  socket.on('transfer:reject', ({ from }) => {
    const sender = peers.get(from);
    if (!sender) return;

    io.to(from).emit('transfer:rejected', { by: me });
    console.log(`[✗] ${me.name} rejected transfer from ${sender.name}`);
  });

  /* ── WebRTC signaling (Phase 2 stubs) ─────────────────────── */
  socket.on('webrtc:offer',     ({ to, sdp })       => io.to(to).emit('webrtc:offer',     { from: socket.id, sdp }));
  socket.on('webrtc:answer',    ({ to, sdp })       => io.to(to).emit('webrtc:answer',    { from: socket.id, sdp }));
  socket.on('webrtc:ice',       ({ to, candidate }) => io.to(to).emit('webrtc:ice',       { from: socket.id, candidate }));

  /* ── Disconnect ────────────────────────────────────────────── */
  socket.on('disconnect', () => {
    peers.delete(socket.id);
    io.emit('peer:left', { id: socket.id, name: me.name });
    console.log(`[-] ${me.name} disconnected`);
  });
});

/* ── Start ──────────────────────────────────────────────────── */
server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLANIp();
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║          LocalDrop  •  v0.1.0            ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Local  →  http://localhost:${PORT}         ║`);
  console.log(`║  LAN    →  http://${lanIp}:${PORT}   ║`);
  console.log('║                                          ║');
  console.log('║  Open the LAN URL on other devices to   ║');
  console.log('║  see them appear in the device list.    ║');
  console.log('╚══════════════════════════════════════════╝\n');
});
