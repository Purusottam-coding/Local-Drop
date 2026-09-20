const { v4: uuidv4 } = require("uuid");
const Device = require("../models/Device");
const Transfer = require("../models/Transfer");
const Session = require("../models/Session");
const { sanitizeFilename, sanitizeFilesMetadata } = require("../utils/security");

// In-memory pending PIN pairing requests: key = `${targetDeviceId}:${senderDeviceId}`
// Value: { pin, senderSocketId, senderDeviceId, targetDeviceId, expiresAt }
const pendingPairings = new Map();

// In-memory set for active pairings: `${deviceIdA}:${deviceIdB}`
const activePairingsCache = new Set();

function registerPairing(devA, devB) {
  if (!devA || !devB) return;
  activePairingsCache.add(`${devA}:${devB}`);
  activePairingsCache.add(`${devB}:${devA}`);
}

function unregisterPairing(devA, devB) {
  if (!devA || !devB) return;
  activePairingsCache.delete(`${devA}:${devB}`);
  activePairingsCache.delete(`${devB}:${devA}`);
}

async function areDevicesPaired(devA, devB) {
  if (!devA || !devB) return false;
  if (activePairingsCache.has(`${devA}:${devB}`)) return true;
  const deviceA = await Device.findOne({ deviceId: devA });
  if (deviceA && Array.isArray(deviceA.trustedDevices) && deviceA.trustedDevices.includes(devB)) {
    const deviceB = await Device.findOne({ deviceId: devB });
    if (deviceB && Array.isArray(deviceB.trustedDevices) && deviceB.trustedDevices.includes(devA)) {
      registerPairing(devA, devB);
      return true;
    }
  }
  return false;
}

// Helper to clean up any pairing state when a device leaves
function cleanupDevicePairingState(deviceId) {
  if (!deviceId) return;
  for (const key of activePairingsCache) {
    if (key.startsWith(`${deviceId}:`) || key.endsWith(`:${deviceId}`)) {
      activePairingsCache.delete(key);
    }
  }
  for (const [key, val] of pendingPairings.entries()) {
    if (val.senderDeviceId === deviceId || val.targetDeviceId === deviceId) {
      pendingPairings.delete(key);
    }
  }
}

function setupSocketIO(io, getLANIp) {
  io.on("connection", (socket) => {
    let currentDeviceId = null;

    const rawIp =
      (socket.handshake.headers["x-forwarded-for"] || socket.handshake.address || "")
        .split(",")[0]
        .trim();
    const clientIp = !rawIp || rawIp === "::1" ? "127.0.0.1" : rawIp;

    console.log(`[Socket Connected] ID: ${socket.id} from IP: ${clientIp}`);

    // 1. Device Registration / Heartbeat
    socket.on("device:register", async (payload = {}) => {
      try {
        const deviceId = payload.deviceId || uuidv4();
        const name = payload.name || `Device-${deviceId.slice(0, 5)}`;
        const type = payload.type || "browser";
        const serverLanIp = getLANIp ? getLANIp() : "127.0.0.1";

        currentDeviceId = deviceId;

        // Upsert device in MongoDB (start with clean paired sessions for this new connection)
        const device = await Device.findOneAndUpdate(
          { deviceId },
          {
            name,
            type,
            ip: clientIp,
            socketId: socket.id,
            isOnline: true,
            trustedDevices: [],
            isTrusted: false,
            lastSeen: new Date(),
          },
          { new: true, upsert: true }
        );

        const formatPeer = (d) => ({
          id: d.socketId,
          deviceId: d.deviceId,
          name: d.name,
          type: d.type,
          ip: d.ip,
          socketId: d.socketId,
          lastSeen: d.lastSeen,
          isTrusted: d.isTrusted,
        });

        // Acknowledge back to the current device
        socket.emit("device:registered", {
          deviceId: device.deviceId,
          name: device.name,
          type: device.type,
          ip: device.ip,
          lanIp: serverLanIp,
          isTrusted: device.isTrusted,
        });
        socket.emit("device:info", {
          name: device.name,
          ip: device.ip,
          lanIp: serverLanIp,
          deviceId: device.deviceId,
        });

        // Broadcast to everyone else that this device is online
        const peerPayload = formatPeer(device);
        socket.broadcast.emit("device:online", peerPayload);
        socket.broadcast.emit("peer:joined", peerPayload);

        // Send list of currently online devices to this socket
        const onlineDevices = await Device.find({
          isOnline: true,
          deviceId: { $ne: deviceId },
        }).select("deviceId name type ip socketId lastSeen isTrusted");

        const formattedList = onlineDevices.map(formatPeer);
        socket.emit("devices:list", formattedList);
        socket.emit("peers:list", formattedList);

        console.log(`[Device Registered] ${device.name} (${device.deviceId})`);
      } catch (err) {
        console.error("Error in device:register:", err);
        socket.emit("error", { message: "Failed to register device" });
      }
    });

    // 2. Request active peer list (supports both devices:refresh and peers:scan)
    const sendPeerList = async () => {
      try {
        const onlineDevices = await Device.find({
          isOnline: true,
          deviceId: { $ne: currentDeviceId },
        }).select("deviceId name type ip socketId lastSeen isTrusted");

        const formatted = onlineDevices.map((d) => ({
          id: d.socketId,
          deviceId: d.deviceId,
          name: d.name,
          type: d.type,
          ip: d.ip,
          socketId: d.socketId,
          lastSeen: d.lastSeen,
          isTrusted: d.isTrusted,
        }));

        socket.emit("devices:list", formatted);
        socket.emit("peers:list", formatted);
      } catch (err) {
        console.error("Error refreshing devices:", err);
      }
    };

    socket.on("devices:refresh", sendPeerList);
    socket.on("peers:scan", sendPeerList);

    // 3. WebRTC Signaling Relays (Secured: mutually paired check)
    socket.on("webrtc:offer", async ({ targetSocketId, to, offer, transferId }) => {
      const recipient = targetSocketId || to;
      if (!recipient) return;

      try {
        const sender = await Device.findOne({
          $or: [
            ...(currentDeviceId ? [{ deviceId: currentDeviceId }] : []),
            { socketId: socket.id },
          ],
        });
        const receiver = await Device.findOne({
          $or: [{ socketId: recipient }, { deviceId: recipient }],
        });

        if (!sender || !receiver) {
          return socket.emit("webrtc:error", { message: "Target peer not found" });
        }

        const paired = await areDevicesPaired(sender.deviceId, receiver.deviceId);
        if (!paired) {
          console.warn(`[WebRTC Blocked] Unauthorized offer attempt: ${sender.deviceId} -> ${receiver.deviceId}`);
          return socket.emit("transfer:rejected", {
            reason: "Unauthorized WebRTC connection: devices must be paired first.",
          });
        }

        io.to(receiver.socketId).emit("webrtc:offer", {
          fromSocketId: socket.id,
          fromDeviceId: currentDeviceId || sender.deviceId,
          offer,
          transferId,
        });
      } catch (err) {
        console.error("Error relaying webrtc:offer:", err);
      }
    });

    socket.on("webrtc:answer", async ({ targetSocketId, to, answer, transferId }) => {
      const recipient = targetSocketId || to;
      if (!recipient) return;

      try {
        const sender = await Device.findOne({
          $or: [
            ...(currentDeviceId ? [{ deviceId: currentDeviceId }] : []),
            { socketId: socket.id },
          ],
        });
        const receiver = await Device.findOne({
          $or: [{ socketId: recipient }, { deviceId: recipient }],
        });

        if (!sender || !receiver) return;

        const paired = await areDevicesPaired(sender.deviceId, receiver.deviceId);
        if (!paired) {
          console.warn(`[WebRTC Blocked] Unauthorized answer attempt: ${sender.deviceId} -> ${receiver.deviceId}`);
          return;
        }

        io.to(receiver.socketId).emit("webrtc:answer", {
          fromSocketId: socket.id,
          fromDeviceId: currentDeviceId || sender.deviceId,
          answer,
          transferId,
        });
      } catch (err) {
        console.error("Error relaying webrtc:answer:", err);
      }
    });

    socket.on("webrtc:ice-candidate", async ({ targetSocketId, to, candidate, transferId }) => {
      const recipient = targetSocketId || to;
      if (!recipient) return;

      try {
        const sender = await Device.findOne({
          $or: [
            ...(currentDeviceId ? [{ deviceId: currentDeviceId }] : []),
            { socketId: socket.id },
          ],
        });
        const receiver = await Device.findOne({
          $or: [{ socketId: recipient }, { deviceId: recipient }],
        });

        if (!sender || !receiver) return;

        const paired = await areDevicesPaired(sender.deviceId, receiver.deviceId);
        if (!paired) return;

        io.to(receiver.socketId).emit("webrtc:ice-candidate", {
          fromSocketId: socket.id,
          fromDeviceId: currentDeviceId || sender.deviceId,
          candidate,
          transferId,
        });
      } catch (err) {
        console.error("Error relaying webrtc:ice-candidate:", err);
      }
    });

    // 4. File Transfer Requests and Handshake
    socket.on("transfer:request", async (data) => {
      try {
        const targetSocketId = data.targetSocketId || data.to;
        const targetDeviceId = data.targetDeviceId;
        const rawFiles = data.files || [];
        // Sanitize incoming file metadata against path traversal & control characters
        const files = sanitizeFilesMetadata(rawFiles);

        const sender = await Device.findOne({ socketId: socket.id });
        const receiver = await Device.findOne({
          $or: [
            { socketId: targetSocketId },
            ...(targetDeviceId ? [{ deviceId: targetDeviceId }] : []),
          ],
        });

        if (!receiver && !targetSocketId) {
          return socket.emit("transfer:error", { message: "Target device not found or offline" });
        }

        // Enforce: only able to send/receive if paired and accepted
        const isPaired =
          sender &&
          receiver &&
          (await areDevicesPaired(sender.deviceId, receiver.deviceId));

        if (!isPaired) {
          return socket.emit("transfer:rejected", {
            by: receiver ? { name: receiver.name, socketId: receiver.socketId } : null,
            reason: "Devices must be paired before transferring files. Please click Pair first.",
          });
        }

        const receiverSocketId = receiver ? receiver.socketId : targetSocketId;
        const transferId = data.transferId || uuidv4();
        const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);

        // Record in MongoDB
        await Transfer.create({
          transferId,
          sender: {
            deviceId: sender ? sender.deviceId : currentDeviceId || "sender",
            name: sender ? sender.name : "Sender",
            ip: clientIp,
          },
          receiver: {
            deviceId: receiver ? receiver.deviceId : "receiver",
            name: receiver ? receiver.name : "Receiver",
            ip: receiver ? receiver.ip : clientIp,
          },
          files,
          totalSize,
          status: "pending",
        });

        const payload = {
          transferId,
          from: {
            deviceId: sender ? sender.deviceId : currentDeviceId,
            name: sender ? sender.name : "Unknown Device",
            socketId: socket.id,
            id: socket.id,
          },
          files,
          totalSize,
        };

        // Notify target device (supports both transfer:incoming and transfer:request)
        io.to(receiverSocketId).emit("transfer:incoming", payload);
        io.to(receiverSocketId).emit("transfer:request", payload);

        // Confirm to sender that request was sent
        socket.emit("transfer:sent", { transferId, status: "pending" });
        console.log(`[Transfer Request] ${transferId} to socket ${receiverSocketId}`);
      } catch (err) {
        console.error("Error creating transfer request:", err);
        socket.emit("transfer:error", { message: "Failed to initiate transfer request" });
      }
    });

    socket.on("transfer:accept", async (payload = {}) => {
      try {
        const { transferId } = payload;
        const senderSocketId = payload.senderSocketId || payload.from;

        const transfer = await Transfer.findOne({ transferId });
        if (!transfer) {
          return socket.emit("transfer:error", { message: "Transfer request not found" });
        }

        const receiverDevice = await Device.findOne({
          $or: [
            ...(currentDeviceId ? [{ deviceId: currentDeviceId }] : []),
            { socketId: socket.id },
          ],
        });

        // Security check: verify receiver identity matches designated receiver
        if (receiverDevice && transfer.receiver && transfer.receiver.deviceId && receiverDevice.deviceId) {
          if (transfer.receiver.deviceId !== receiverDevice.deviceId) {
            return socket.emit("transfer:error", {
              message: "Unauthorized: You are not the designated recipient of this transfer.",
            });
          }
        }

        // Verify devices are still mutually paired
        if (transfer.sender?.deviceId && transfer.receiver?.deviceId) {
          const isPaired = await areDevicesPaired(transfer.sender.deviceId, transfer.receiver.deviceId);
          if (!isPaired) {
            return socket.emit("transfer:error", {
              message: "Cannot accept transfer: devices are no longer paired.",
            });
          }
        }

        await Transfer.findOneAndUpdate(
          { transferId },
          { status: "accepted", respondedAt: new Date() }
        );

        if (senderSocketId) {
          io.to(senderSocketId).emit("transfer:accepted", {
            transferId,
            receiverSocketId: socket.id,
            by: {
              socketId: socket.id,
              name: receiverDevice ? receiverDevice.name : "Receiver",
            },
          });
        }
        console.log(`[Transfer Accepted] ${transferId}`);
      } catch (err) {
        console.error("Error accepting transfer:", err);
      }
    });

    socket.on("transfer:reject", async (payload = {}) => {
      try {
        const { transferId, reason } = payload;
        const senderSocketId = payload.senderSocketId || payload.from;

        await Transfer.findOneAndUpdate(
          { transferId },
          {
            status: "rejected",
            respondedAt: new Date(),
            completedAt: new Date(),
            errorMessage: reason || "Transfer rejected by receiver",
          }
        );

        const receiverDevice = await Device.findOne({ socketId: socket.id });

        if (senderSocketId) {
          io.to(senderSocketId).emit("transfer:rejected", {
            transferId,
            reason: reason || "Transfer declined",
            by: {
              socketId: socket.id,
              name: receiverDevice ? receiverDevice.name : "Receiver",
            },
          });
        }
        console.log(`[Transfer Rejected] ${transferId}`);
      } catch (err) {
        console.error("Error rejecting transfer:", err);
      }
    });

    socket.on("transfer:complete", async ({ transferId }) => {
      try {
        await Transfer.findOneAndUpdate(
          { transferId },
          { status: "completed", completedAt: new Date() }
        );
        console.log(`[Transfer Completed] ${transferId}`);
      } catch (err) {
        console.error("Error completing transfer:", err);
      }
    });

    socket.on("transfer:failed", async ({ transferId, error }) => {
      try {
        await Transfer.findOneAndUpdate(
          { transferId },
          {
            status: "failed",
            completedAt: new Date(),
            errorMessage: error || "Transfer failed",
          }
        );
        console.log(`[Transfer Failed] ${transferId}: ${error}`);
      } catch (err) {
        console.error("Error recording transfer failure:", err);
      }
    });

    // 5. Instant Text & Clipboard Sharing
    socket.on("text:send", async ({ targetSocketId, targetDeviceId, to, text }) => {
      try {
        const recipient = targetSocketId || to;
        const sender = await Device.findOne({ socketId: socket.id });

        if (recipient && text) {
          io.to(recipient).emit("text:receive", {
            from: {
              socketId: socket.id,
              name: sender ? sender.name : "Device",
              deviceId: currentDeviceId,
            },
            text,
            timestamp: new Date().toISOString(),
          });
          console.log(`[Text Sent] from ${sender?.name || socket.id} to ${recipient}`);
        }
      } catch (err) {
        console.error("Error relaying text:", err);
      }
    });

    // 6. Device Pairing & Trusted Devices Handshake
    socket.on("pairing:request", async ({ targetSocketId, targetDeviceId }) => {
      try {
        const sender = await Device.findOne({
          $or: [
            ...(currentDeviceId ? [{ deviceId: currentDeviceId }] : []),
            { socketId: socket.id },
          ],
        });
        const receiver = await Device.findOne({
          $or: [
            ...(targetSocketId ? [{ socketId: targetSocketId }] : []),
            ...(targetDeviceId ? [{ deviceId: targetDeviceId }] : []),
          ],
        });

        if (!receiver || !sender) {
          return socket.emit("pairing:error", { message: "Target device not found" });
        }

        // Generate 6-digit PIN
        const pin = Math.floor(100000 + Math.random() * 900000).toString();

        // Store pending pairing with 60-second TTL
        const key = `${receiver.deviceId}:${sender.deviceId}`;
        pendingPairings.set(key, {
          pin,
          senderSocketId: socket.id,
          senderDeviceId: sender.deviceId,
          targetDeviceId: receiver.deviceId,
          expiresAt: Date.now() + 60000,
        });

        // Send to receiver
        io.to(receiver.socketId).emit("pairing:incoming", {
          from: {
            socketId: socket.id,
            name: sender ? sender.name : "Nearby Device",
            deviceId: sender.deviceId,
            type: sender?.type || "browser",
          },
          pin,
        });

        // Notify sender of initiated pairing
        socket.emit("pairing:pending", {
          targetDeviceName: receiver.name,
          targetDeviceId: receiver.deviceId,
          pin,
        });

        console.log(`[Pairing Request] PIN: ${pin} from ${sender?.name} to ${receiver?.name}`);
      } catch (err) {
        console.error("Error initiating pairing:", err);
      }
    });

    socket.on("pairing:accept", async ({ senderSocketId, senderDeviceId, pin }) => {
      try {
        const receiver = await Device.findOne({
          $or: [
            ...(currentDeviceId ? [{ deviceId: currentDeviceId }] : []),
            { socketId: socket.id },
          ],
        });
        const sender = await Device.findOne({
          $or: [
            ...(senderSocketId ? [{ socketId: senderSocketId }] : []),
            ...(senderDeviceId ? [{ deviceId: senderDeviceId }] : []),
          ],
        });

        if (!receiver || !sender) {
          return socket.emit("pairing:error", { message: "Device not found" });
        }

        const key = `${receiver.deviceId}:${sender.deviceId}`;
        const pending = pendingPairings.get(key);

        if (!pending) {
          return socket.emit("pairing:error", {
            message: "No pending pairing request found or request has expired.",
          });
        }

        if (Date.now() > pending.expiresAt) {
          pendingPairings.delete(key);
          return socket.emit("pairing:error", {
            message: "Pairing PIN expired. Please request pairing again.",
          });
        }

        // Enforce PIN verification
        if (!pin || String(pin).trim() !== String(pending.pin).trim()) {
          console.warn(`[Pairing Failed] PIN mismatch for ${receiver.name} <-> ${sender.name}`);
          return socket.emit("pairing:error", {
            message: "Invalid pairing PIN. Connection rejected.",
          });
        }

        // Successfully verified PIN! Clear pending request
        pendingPairings.delete(key);

        // Add to trusted devices in MongoDB for both parties
        await Device.findOneAndUpdate(
          { deviceId: receiver.deviceId },
          { $addToSet: { trustedDevices: sender.deviceId } }
        );

        await Device.findOneAndUpdate(
          { deviceId: sender.deviceId },
          { $addToSet: { trustedDevices: receiver.deviceId } }
        );

        registerPairing(receiver.deviceId, sender.deviceId);

        // Notify both devices of successful pairing
        io.to(sender.socketId).emit("pairing:success", {
          pairedDevice: {
            deviceId: receiver.deviceId,
            name: receiver.name,
            isTrusted: true,
          },
        });

        socket.emit("pairing:success", {
          pairedDevice: {
            deviceId: sender.deviceId,
            name: sender.name,
            isTrusted: true,
          },
        });

        console.log(`[Pairing Success] Verified PIN: ${receiver.name} <-> ${sender.name} are now connected`);
      } catch (err) {
        console.error("Error accepting pairing:", err);
      }
    });

    socket.on("pairing:cancel", async ({ targetSocketId, targetDeviceId }) => {
      try {
        const sender = await Device.findOne({
          $or: [
            ...(currentDeviceId ? [{ deviceId: currentDeviceId }] : []),
            { socketId: socket.id },
          ],
        });
        const receiver = await Device.findOne({
          $or: [
            ...(targetSocketId ? [{ socketId: targetSocketId }] : []),
            ...(targetDeviceId ? [{ deviceId: targetDeviceId }] : []),
          ],
        });

        if (receiver && sender) {
          const key = `${receiver.deviceId}:${sender.deviceId}`;
          pendingPairings.delete(key);
          io.to(receiver.socketId).emit("pairing:cancelled", {
            from: {
              socketId: socket.id,
              deviceId: sender.deviceId,
              name: sender.name,
            },
            message: "Pairing request was cancelled by the sender.",
          });
          console.log(`[Pairing Cancelled] ${sender.name} cancelled pairing to ${receiver.name}`);
        }
      } catch (err) {
        console.error("Error cancelling pairing:", err);
      }
    });

    socket.on("pairing:reject", async ({ senderSocketId, senderDeviceId, reason }) => {
      try {
        const receiver = await Device.findOne({
          $or: [
            ...(currentDeviceId ? [{ deviceId: currentDeviceId }] : []),
            { socketId: socket.id },
          ],
        });
        const sender = await Device.findOne({
          $or: [
            ...(senderSocketId ? [{ socketId: senderSocketId }] : []),
            ...(senderDeviceId ? [{ deviceId: senderDeviceId }] : []),
          ],
        });

        if (receiver && sender) {
          const key = `${receiver.deviceId}:${sender.deviceId}`;
          pendingPairings.delete(key);
        }

        const targetSocket = sender ? sender.socketId : senderSocketId;
        if (targetSocket) {
          io.to(targetSocket).emit("pairing:rejected", {
            reason: reason || "Pairing request was declined",
          });
        }
      } catch (err) {
        console.error("Error rejecting pairing:", err);
      }
    });

    // Mutual unpair / disconnect between paired devices
    socket.on("pairing:disconnect", async ({ targetDeviceId, targetSocketId }) => {
      try {
        const myDevice = await Device.findOne({
          $or: [{ socketId: socket.id }, { deviceId: currentDeviceId }],
        });
        if (!myDevice) return;

        // Mutually disconnect both sides in MongoDB
        await Device.findOneAndUpdate(
          { deviceId: myDevice.deviceId },
          { $pull: { trustedDevices: targetDeviceId }, isTrusted: false }
        );
        await Device.findOneAndUpdate(
          { deviceId: targetDeviceId },
          { $pull: { trustedDevices: myDevice.deviceId }, isTrusted: false }
        );

        unregisterPairing(myDevice.deviceId, targetDeviceId);

        // Find target socket
        let destSocketId = targetSocketId;
        const targetDev = await Device.findOne({ deviceId: targetDeviceId });
        if (targetDev && targetDev.socketId) {
          destSocketId = targetDev.socketId;
        }

        // Notify target device that pairing was disconnected
        if (destSocketId) {
          io.to(destSocketId).emit("pairing:disconnected", {
            disconnectedBy: {
              deviceId: myDevice.deviceId,
              name: myDevice.name,
            },
            targetDeviceId: myDevice.deviceId,
          });
        }

        // Acknowledge back to sender
        socket.emit("pairing:disconnected", {
          disconnectedBy: {
            deviceId: myDevice.deviceId,
            name: myDevice.name,
          },
          targetDeviceId: targetDeviceId,
        });

        console.log(`[Pairing Disconnect] ${myDevice.name} <-> ${targetDev?.name || targetDeviceId} disconnected mutually`);
      } catch (err) {
        console.error("Error in pairing:disconnect:", err);
      }
    });

    // 6.2 Instant QR Code Pairing Handshake
    socket.on("qr:pair", async ({ hostDeviceId, pin }) => {
      try {
        console.log(`[QR Pair Request] Scanner socket ${socket.id} attempting to pair with host ${hostDeviceId}`);

        let scannerDevice = await Device.findOne({ socketId: socket.id });
        if (!scannerDevice && currentDeviceId) {
          scannerDevice = await Device.findOne({ deviceId: currentDeviceId });
        }

        const hostDevice = await Device.findOne({ deviceId: hostDeviceId });

        if (!hostDevice) {
          return socket.emit("qr:error", { message: "Host device not found or offline" });
        }

        const scannerId = scannerDevice ? scannerDevice.deviceId : currentDeviceId;

        if (scannerId && hostDevice.deviceId) {
          // Mutually add to trusted devices in MongoDB
          await Device.findOneAndUpdate(
            { deviceId: hostDevice.deviceId },
            { $addToSet: { trustedDevices: scannerId } }
          );

          await Device.findOneAndUpdate(
            { deviceId: scannerId },
            { $addToSet: { trustedDevices: hostDevice.deviceId } }
          );

          registerPairing(scannerId, hostDevice.deviceId);

          const scannerPayload = {
            id: socket.id,
            socketId: socket.id,
            deviceId: scannerDevice?.deviceId || scannerId,
            name: scannerDevice?.name || "Scanner Device",
            type: scannerDevice?.type || "mobile",
            ip: clientIp,
            isTrusted: true,
          };

          const hostPayload = {
            id: hostDevice.socketId,
            socketId: hostDevice.socketId,
            deviceId: hostDevice.deviceId,
            name: hostDevice.name,
            type: hostDevice.type,
            ip: hostDevice.ip,
            isTrusted: true,
          };

          // Notify host device that QR was scanned and paired
          if (hostDevice.socketId) {
            io.to(hostDevice.socketId).emit("qr:paired", {
              pairedDevice: scannerPayload,
              message: `✓ Connected to ${scannerPayload.name} via QR scan!`,
            });
            io.to(hostDevice.socketId).emit("pairing:success", {
              pairedDevice: scannerPayload,
            });
          }

          // Notify scanner device that pairing succeeded
          socket.emit("qr:paired", {
            pairedDevice: hostPayload,
            message: `✓ Connected to ${hostPayload.name} via QR scan!`,
          });
          socket.emit("pairing:success", {
            pairedDevice: hostPayload,
          });

          console.log(`[QR Pair Success] Host: ${hostDevice.name} <-> Scanner: ${scannerPayload.name}`);
        }
      } catch (err) {
        console.error("Error in qr:pair:", err);
        socket.emit("qr:error", { message: "QR pairing failed" });
      }
    });

    // 7. Temporary File-Sharing Sessions
    socket.on("session:join", async ({ sessionCode, deviceId, name }) => {
      try {
        const code = (sessionCode || "").trim().toUpperCase();
        const roomKey = `session:${code}`;
        socket.join(roomKey);

        const session = await Session.findOne({ sessionCode: code });
        if (session && session.status === "active" && session.expiresAt.getTime() > Date.now()) {
          const idx = session.participants.findIndex((p) => p.deviceId === deviceId);
          if (idx >= 0) {
            session.participants[idx].socketId = socket.id;
            session.participants[idx].name = name;
          } else {
            session.participants.push({
              deviceId,
              name,
              socketId: socket.id,
              isHost: session.creator.deviceId === deviceId,
              joinedAt: new Date(),
            });
          }
          await session.save();

          const remainingSeconds = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
          const sessionData = {
            ...session.toObject(),
            remainingSeconds,
          };

          // Notify room with full session state
          io.to(roomKey).emit("session:updated", sessionData);
          console.log(`[Session Join] Device ${name} joined session ${code}`);
        } else {
          socket.emit("session:error", { message: "Session expired or not found" });
        }
      } catch (err) {
        console.error("Error in session:join:", err);
      }
    });

    socket.on("session:leave", async ({ sessionCode, deviceId }) => {
      try {
        const code = (sessionCode || "").trim().toUpperCase();
        const roomKey = `session:${code}`;
        socket.leave(roomKey);

        const session = await Session.findOne({ sessionCode: code });
        if (session) {
          session.participants = session.participants.filter((p) => p.deviceId !== deviceId);
          await session.save();

          io.to(roomKey).emit("session:updated", {
            ...session.toObject(),
            remainingSeconds: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
          });
        }
      } catch (err) {
        console.error("Error in session:leave:", err);
      }
    });

    socket.on("session:file-share", async ({ sessionCode, fileMeta }) => {
      try {
        const code = (sessionCode || "").trim().toUpperCase();
        const roomKey = `session:${code}`;

        const session = await Session.findOne({ sessionCode: code });
        if (session && session.status === "active" && session.expiresAt.getTime() > Date.now()) {
          session.files.push(fileMeta);
          await session.save();

          io.to(roomKey).emit("session:file-added", {
            sessionCode: code,
            file: fileMeta,
            files: session.files,
          });
          console.log(`[Session File] Shared "${fileMeta.name}" in session ${code}`);
        }
      } catch (err) {
        console.error("Error in session:file-share:", err);
      }
    });

    // Relay binary file data to all participants in session room
    socket.on("session:file-binary", async ({ sessionCode, fileId, name, size, type, buffer, senderName, senderDeviceId }) => {
      try {
        const code = (sessionCode || "").trim().toUpperCase();
        const roomKey = `session:${code}`;

        const session = await Session.findOne({ sessionCode: code });
        if (session && session.status === "active" && session.expiresAt.getTime() > Date.now()) {
          // Check if file metadata is already in session
          if (!session.files.some((f) => f.fileId === fileId)) {
            session.files.push({
              fileId,
              name,
              size,
              type: type || "",
              senderName: senderName || "Member",
              senderDeviceId: senderDeviceId || "",
              uploadedAt: new Date(),
            });
            await session.save();
          }

          // Broadcast file payload with binary buffer to other participants in room
          socket.to(roomKey).emit("session:file-received", {
            sessionCode: code,
            fileId,
            name,
            size,
            type,
            senderName,
            senderDeviceId,
            buffer,
          });

          // Also announce metadata update
          io.to(roomKey).emit("session:file-added", {
            sessionCode: code,
            file: { fileId, name, size, type, senderName, senderDeviceId },
            files: session.files,
          });

          console.log(`[Session Binary] Transferred "${name}" (${size} bytes) in session ${code}`);
        }
      } catch (err) {
        console.error("Error in session:file-binary:", err);
      }
    });

    // Request file on demand if peer missed the initial broadcast
    socket.on("session:request-file", ({ sessionCode, fileId }) => {
      const code = (sessionCode || "").trim().toUpperCase();
      const roomKey = `session:${code}`;
      socket.to(roomKey).emit("session:file-pull-request", {
        sessionCode: code,
        fileId,
        requesterSocketId: socket.id,
      });
    });

    // Uploader sends requested file to specific requester socket
    socket.on("session:fulfill-file-request", ({ targetSocketId, fileId, name, size, type, buffer }) => {
      if (targetSocketId) {
        io.to(targetSocketId).emit("session:file-received", {
          fileId,
          name,
          size,
          type,
          buffer,
        });
      }
    });

    socket.on("session:destroy", async ({ sessionCode, deviceId }) => {
      try {
        const code = (sessionCode || "").trim().toUpperCase();
        const roomKey = `session:${code}`;

        const session = await Session.findOne({ sessionCode: code });
        if (session) {
          if (deviceId && session.creator.deviceId !== deviceId) {
            return socket.emit("session:error", { message: "Only the host can end this session" });
          }
          await Session.deleteOne({ sessionCode: code });
          io.to(roomKey).emit("session:closed", {
            sessionCode: code,
            message: "Temporary session ended by the host.",
          });
          console.log(`[Session Destroyed] ${code}`);
        }
      } catch (err) {
        console.error("Error in session:destroy:", err);
      }
    });

    // 8. Disconnect handling
    socket.on("disconnect", async () => {
      console.log(`[Socket Disconnected] ID: ${socket.id}`);
      try {
        // Clean up any session participation for this socket
        const activeSessions = await Session.find({
          "participants.socketId": socket.id,
          status: "active",
        });

        for (const sess of activeSessions) {
          sess.participants = sess.participants.filter((p) => p.socketId !== socket.id);
          await sess.save();
          io.to(`session:${sess.sessionCode}`).emit("session:updated", {
            ...sess.toObject(),
            remainingSeconds: Math.max(0, Math.floor((sess.expiresAt.getTime() - Date.now()) / 1000)),
          });
        }

        // Find the disconnecting device
        const disconnectingDev = await Device.findOne({
          $or: [
            ...(currentDeviceId ? [{ deviceId: currentDeviceId }] : []),
            { socketId: socket.id },
          ],
        });

        if (disconnectingDev) {
          const devId = disconnectingDev.deviceId;

          // Find ALL devices paired with this device and disconnect them mutually
          const pairedDevices = await Device.find({ trustedDevices: devId });
          for (const pairedDev of pairedDevices) {
            await Device.findOneAndUpdate(
              { deviceId: pairedDev.deviceId },
              { $pull: { trustedDevices: devId }, isTrusted: false }
            );

            if (pairedDev.socketId) {
              io.to(pairedDev.socketId).emit("pairing:disconnected", {
                disconnectedBy: {
                  deviceId: devId,
                  name: disconnectingDev.name,
                },
                targetDeviceId: devId,
                reason: "Peer closed their tab",
              });
            }
          }

          // Clear this device's own trustedDevices and mark offline
          disconnectingDev.trustedDevices = [];
          disconnectingDev.isTrusted = false;
          disconnectingDev.isOnline = false;
          disconnectingDev.socketId = null;
          disconnectingDev.lastSeen = new Date();
          await disconnectingDev.save();

          cleanupDevicePairingState(devId);

          const offlinePayload = { deviceId: disconnectingDev.deviceId, name: disconnectingDev.name, id: socket.id };
          io.emit("device:offline", offlinePayload);
          io.emit("peer:left", offlinePayload);
          console.log(`[Device Offline & Paired Sessions Cleared] ${disconnectingDev.name}`);
        }
      } catch (err) {
        console.error("Error updating offline device status:", err);
      }
    });
  });
}

module.exports = setupSocketIO;
