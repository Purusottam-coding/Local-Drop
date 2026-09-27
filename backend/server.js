const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const cors = require("cors");
const os = require("os");

const connectDB = require("./config/db");
const deviceRoutes = require("./routes/deviceRoutes");
const transferRoutes = require("./routes/transferRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const setupSocketIO = require("./websocket/socketHandler");

dotenv.config();

// Prevent server process termination on unexpected promise rejections or socket errors
process.on("unhandledRejection", (reason) => {
  console.error("[Unhandled Rejection]:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]:", err);
});

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  maxHttpBufferSize: 1e8, // 100 MB buffer for temporary session files
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

const Device = require("./models/Device");

// Connect Database & Purge stale online devices from previous runs
connectDB().then(async () => {
  try {
    const res = await Device.updateMany(
      { isOnline: true },
      { isOnline: false, socketId: null, trustedDevices: [] }
    );
    if (res.modifiedCount > 0) {
      console.log(`[Startup] Cleared ${res.modifiedCount} stale online device(s) from database`);
    }
  } catch (err) {
    console.warn("[Startup] Notice:", err.message);
  }
});

// Security headers middleware
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Routes
app.use("/api/devices", deviceRoutes);
app.use("/api/transfers", transferRoutes);
app.use("/api/sessions", sessionRoutes);

// Test & Health Route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "LocalDrop Backend API & WebRTC Signaling Server is running",
    database: "MongoDB",
    timestamp: new Date().toISOString(),
  });
});

// Utility to get local LAN IPv4
function getLANIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

const PORT = process.env.PORT || 7000;

// Network info route for QR code & mobile device discovery
app.get("/api/network-info", (_req, res) => {
  const lanIp = getLANIp();
  res.json({
    success: true,
    lanIp,
    port: PORT,
  });
});

// Setup WebSocket / WebRTC Signaling
setupSocketIO(io, getLANIp);

server.listen(PORT, "0.0.0.0", () => {
  const lanIp = getLANIp();
  console.log("\n==========================================");
  console.log("   LocalDrop Backend Server (MongoDB)     ");
  console.log("==========================================");
  console.log(`Local URL : http://localhost:${PORT}`);
  console.log(`LAN URL   : http://${lanIp}:${PORT}`);
  console.log(`API Docs  : http://localhost:${PORT}/api/devices`);
  console.log("==========================================\n");
});