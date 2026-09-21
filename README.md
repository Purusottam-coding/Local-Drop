#  LocalDrop

> **Fast, private, and secure peer-to-peer file sharing across your local network.**  
> Transfer files, folders, and text messages directly between phones, tablets, laptops, and PCs over Wi-Fi without cloud uploads, registration, or file size limits.

---

## 🌟 Key Features

- **Direct P2P Transfers (WebRTC)**: Files stream directly browser-to-browser over encrypted `RTCDataChannel` using 64 KB binary chunks with backpressure handling. No server storage or third-party cloud involved.
- **Zero-Config Local Discovery**: Automatically discovers devices on the same Wi-Fi or LAN via WebSocket signaling.
- **Secure Mutual Pairing & PIN Verification**:
  - Connection pairing requires a 6-digit PIN verification handshake with a 60-second expiration.
  - Quick connect via QR Code scanner for mobile devices.
  - WebRTC signaling relays (SDP & ICE candidates) are strictly blocked for unpaired or unauthenticated sockets.
- **Bilateral Disconnect**: When either peer closes their tab or clicks disconnect, the paired session is instantly terminated on both sides.
- **Manual Download Controls**: Files never download automatically without consent. Receivers preview files, check sizes, preview images inline, and selectively download single files or click **Download All**.
- **Temporary File-Sharing Sessions**: Create or join self-expiring group rooms with simple room codes (`DROP-XXXX`). Ideal for quick collaborative drops.
- **24-Hour History**: Transfer records are retained locally and in the database for 24 hours (with automatic MongoDB TTL cleanup) unless cleared manually.
- **Instant Text & Clipboard Sharing**: Share notes, links, and code snippets with one-click copy to clipboard.
- **Built-in Security Hardening**:
  - Filename sanitization against path traversal (`../`, `..\`), null bytes, control characters, and OS-reserved names (`CON`, `PRN`, `AUX`, `NUL`).
  - Express security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`).
  - Chunk buffer limit guards preventing memory exhaustion attacks.



- **Frontend**:
  - [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
  - [Socket.IO Client](https://socket.io/) (Signaling & Session State)
  - WebRTC (`RTCPeerConnection`, `RTCDataChannel`)
  - [QRCode](https://github.com/soldair/node-qrcode) for quick mobile pairing
  - Custom responsive CSS with dark/light visual cues
- **Backend**:
  - [Node.js](https://nodejs.org/) & [Express 5](https://expressjs.com/)
  - [Socket.IO 4](https://socket.io/) (Real-time LAN signaling)
  - [MongoDB](https://www.mongodb.com/) via [Mongoose](https://mongoosejs.com/) (Device state, transfer logs, session TTLs)

---

## Prerequisites

Make sure you have installed:
- [Node.js](https://nodejs.org/) (version 18 or newer recommended)
- [npm](https://www.npmjs.com/) (bundled with Node.js)
- [MongoDB](https://www.mongodb.com/try/download/community) running locally (default: `mongodb://127.0.0.1:27017/localdrop`) or a remote MongoDB URI

---

##  Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/Local-Drop.git
cd Local-Drop
```

### 2. Backend Setup
Navigate to the `backend` folder, install dependencies, and configure environment variables:

```bash
cd backend
npm install
```

Create a `.env` file in the `backend` directory:
```env
PORT=7000
MONGO_URI=mongodb://127.0.0.1:27017/localdrop
```

Start the backend server:
```bash
# Production / standard mode
npm start

# Development mode (auto-reloads on code changes)
npm run dev
```
> The signaling server will start on port `7000` and display your local network IP (e.g. `http://192.168.x.x:7000`).

---

### 3. Frontend Setup
In a new terminal window, navigate to the `frontend` folder and install dependencies:

```bash
cd frontend
npm install
```

Start the Vite development server:
```bash
npm run dev
```
> The development server will run on port `5173` (accessible on `http://localhost:5173` and `http://<your-lan-ip>:5173`).

---

##  Using LocalDrop Across Multiple Devices

1. Connect both devices (e.g., your laptop and your smartphone) to the **same Wi-Fi network**.
2. Open `http://<your-computer-ip>:5173` in the browser on both devices.
3. Both devices will appear in the **Nearby Devices** panel.
4. Click **Pair** or scan the **QR Code** on screen.
5. Verify that the 6-digit PIN matches and accept the connection.
6. Once connected, drag-and-drop files or type a text message to send!
7. The recipient can review and click **Download** to save files to their device.

---

##  Security Principles

- **No Remote Cloud Relays**: Your files never travel across external servers; data travels directly over your local Wi-Fi.
- **Pairing Authentication**: Unpaired devices cannot initiate file transfers or stream WebRTC data.
- **Path Traversal Protection**: Uploaded and incoming filenames are sanitized against directory traversal sequences (`../`, `..\`), null bytes (`\0`), and prohibited characters.
- **Zero Auto-Execution / Auto-Download**: Download triggers are governed explicitly by user actions in the modal UI.

---

##  License

This project is licensed under the [ISC License](backend/package.json).
