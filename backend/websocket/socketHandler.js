const { v4: uuidv4 } = require("uuid");
const Device = require("../models/Device");
const Transfer = require("../models/Transfer");

function setupSocketIO(io) {
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

        currentDeviceId = deviceId;

        // Upsert device in MongoDB
        const device = await Device.findOneAndUpdate(
          { deviceId },
          {
            name,
            type,
            ip: clientIp,
            socketId: socket.id,
            isOnline: true,
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
          isTrusted: device.isTrusted,
        });
        socket.emit("device:info", { name: device.name, ip: device.ip, deviceId: device.deviceId });

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

    // 3. WebRTC Signaling Relays
    socket.on("webrtc:offer", ({ targetSocketId, to, offer, transferId }) => {
      const recipient = targetSocketId || to;
      if (recipient) {
        io.to(recipient).emit("webrtc:offer", {
          fromSocketId: socket.id,
          fromDeviceId: currentDeviceId,
          offer,
          transferId,
        });
      }
    });

    socket.on("webrtc:answer", ({ targetSocketId, to, answer, transferId }) => {
      const recipient = targetSocketId || to;
      if (recipient) {
        io.to(recipient).emit("webrtc:answer", {
          fromSocketId: socket.id,
          fromDeviceId: currentDeviceId,
          answer,
          transferId,
        });
      }
    });

    socket.on("webrtc:ice-candidate", ({ targetSocketId, to, candidate, transferId }) => {
      const recipient = targetSocketId || to;
      if (recipient) {
        io.to(recipient).emit("webrtc:ice-candidate", {
          fromSocketId: socket.id,
          fromDeviceId: currentDeviceId,
          candidate,
          transferId,
        });
      }
    });

    // 4. File Transfer Requests and Handshake
    socket.on("transfer:request", async (data) => {
      try {
        const targetSocketId = data.targetSocketId || data.to;
        const targetDeviceId = data.targetDeviceId;
        const files = data.files || [];

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

        await Transfer.findOneAndUpdate(
          { transferId },
          { status: "accepted", respondedAt: new Date() }
        );

        const receiverDevice = await Device.findOne({ socketId: socket.id });

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
        const sender = await Device.findOne({ socketId: socket.id });
        const receiver = await Device.findOne({
          $or: [{ socketId: targetSocketId }, { deviceId: targetDeviceId }],
        });

        if (!receiver) {
          return socket.emit("pairing:error", { message: "Target device not found" });
        }

        // Generate 6-digit PIN
        const pin = Math.floor(100000 + Math.random() * 900000).toString();

        // Send to receiver
        io.to(receiver.socketId).emit("pairing:incoming", {
          from: {
            socketId: socket.id,
            name: sender ? sender.name : "Nearby Device",
            deviceId: currentDeviceId,
            type: sender?.type || "browser",
          },
          pin,
        });

        // Notify sender of initiated pairing
        socket.emit("pairing:pending", {
          targetDeviceName: receiver.name,
          pin,
        });

        console.log(`[Pairing Request] PIN: ${pin} from ${sender?.name} to ${receiver?.name}`);
      } catch (err) {
        console.error("Error initiating pairing:", err);
      }
    });

    socket.on("pairing:accept", async ({ senderSocketId, senderDeviceId }) => {
      try {
        const receiver = await Device.findOne({ socketId: socket.id });
        const sender = await Device.findOne({
          $or: [{ socketId: senderSocketId }, { deviceId: senderDeviceId }],
        });

        if (receiver && sender) {
          // Add to trusted devices in MongoDB for both parties
          await Device.findOneAndUpdate(
            { deviceId: receiver.deviceId },
            { $addToSet: { trustedDevices: sender.deviceId } }
          );

          await Device.findOneAndUpdate(
            { deviceId: sender.deviceId },
            { $addToSet: { trustedDevices: receiver.deviceId } }
          );

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

          console.log(`[Pairing Success] ${receiver.name} <-> ${sender.name} are now trusted`);
        }
      } catch (err) {
        console.error("Error accepting pairing:", err);
      }
    });

    socket.on("pairing:reject", async ({ senderSocketId, reason }) => {
      if (senderSocketId) {
        io.to(senderSocketId).emit("pairing:rejected", {
          reason: reason || "Pairing request was declined",
        });
      }
    });

    // 7. Disconnect handling
    socket.on("disconnect", async () => {
      console.log(`[Socket Disconnected] ID: ${socket.id}`);
      try {
        if (currentDeviceId) {
          const device = await Device.findOneAndUpdate(
            { deviceId: currentDeviceId },
            { isOnline: false, socketId: null, lastSeen: new Date() },
            { new: true }
          );

          if (device) {
            const offlinePayload = { deviceId: device.deviceId, name: device.name, id: socket.id };
            io.emit("device:offline", offlinePayload);
            io.emit("peer:left", offlinePayload);
            console.log(`[Device Offline] ${device.name}`);
          }
        } else {
          // Find device by socketId
          const device = await Device.findOneAndUpdate(
            { socketId: socket.id },
            { isOnline: false, socketId: null, lastSeen: new Date() },
            { new: true }
          );

          if (device) {
            const offlinePayload = { deviceId: device.deviceId, name: device.name, id: socket.id };
            io.emit("device:offline", offlinePayload);
            io.emit("peer:left", offlinePayload);
            console.log(`[Device Offline] ${device.name}`);
          }
        }
      } catch (err) {
        console.error("Error updating offline device status:", err);
      }
    });
  });
}

module.exports = setupSocketIO;
