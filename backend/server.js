const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const cors = require("cors");
const os = require("os");

const connectDB = require("./config/db");
const deviceRoutes = require("./routes/deviceRoutes");
const transferRoutes = require("./routes/transferRoutes");
const setupSocketIO = require("./websocket/socketHandler");

dotenv.config();

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

// Connect Database
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/devices", deviceRoutes);
app.use("/api/transfers", transferRoutes);

// Test & Health Route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "LocalDrop Backend API & WebRTC Signaling Server is running",
    database: "MongoDB",
    timestamp: new Date().toISOString(),
  });
});

// Setup WebSocket / WebRTC Signaling
setupSocketIO(io);

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