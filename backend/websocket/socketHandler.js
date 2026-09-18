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

        // Acknowledge back to the current device
        socket.emit("device:registered", {
          deviceId: device.deviceId,
          name: device.name,
          type: device.type,
          ip: device.ip,
          isTrusted: device.isTrusted,
        });

        // Broadcast to everyone else that this device is online
        socket.broadcast.emit("device:online", {
          deviceId: device.deviceId,
          name: device.name,
          type: device.type,
          ip: device.ip,
          socketId: socket.id,
          lastSeen: device.lastSeen,
        });

        // Send list of currently online devices to this socket
        const onlineDevices = await Device.find({
          isOnline: true,
          deviceId: { $ne: deviceId },
        }).select("deviceId name type ip socketId lastSeen isTrusted");

        socket.emit("devices:list", onlineDevices);

        console.log(`[Device Registered] ${device.name} (${device.deviceId})`);
      } catch (err) {
        console.error("Error in device:register:", err);
        socket.emit("error", { message: "Failed to register device" });
      }
    });

    // 2. Request active peer list
    socket.on("devices:refresh", async () => {
      try {
        const onlineDevices = await Device.find({
          isOnline: true,
          deviceId: { $ne: currentDeviceId },
        }).select("deviceId name type ip socketId lastSeen isTrusted");

        socket.emit("devices:list", onlineDevices);
      } catch (err) {
        console.error("Error refreshing devices:", err);
      }
    });

    // 3. WebRTC Signaling Relays
    socket.on("webrtc:offer", ({ targetSocketId, targetDeviceId, offer }) => {
      if (targetSocketId) {
        io.to(targetSocketId).emit("webrtc:offer", {
          fromSocketId: socket.id,
          fromDeviceId: currentDeviceId,
          offer,
        });
      }
    });

    socket.on("webrtc:answer", ({ targetSocketId, targetDeviceId, answer }) => {
      if (targetSocketId) {
        io.to(targetSocketId).emit("webrtc:answer", {
          fromSocketId: socket.id,
          fromDeviceId: currentDeviceId,
          answer,
        });
      }
    });

    socket.on("webrtc:ice-candidate", ({ targetSocketId, candidate }) => {
      if (targetSocketId) {
        io.to(targetSocketId).emit("webrtc:ice-candidate", {
          fromSocketId: socket.id,
          fromDeviceId: currentDeviceId,
          candidate,
        });
      }
    });

    // 4. File Transfer Requests and Handshake
    socket.on("transfer:request", async (data) => {
      try {
        const { targetDeviceId, targetSocketId, files } = data;
        const sender = await Device.findOne({ socketId: socket.id });
        const receiver = await Device.findOne({
          $or: [{ socketId: targetSocketId }, { deviceId: targetDeviceId }],
        });

        if (!receiver) {
          return socket.emit("transfer:error", { message: "Target device not found or offline" });
        }

        const transferId = uuidv4();
        const totalSize = (files || []).reduce((acc, f) => acc + (f.size || 0), 0);

        // Record in MongoDB
        const transfer = await Transfer.create({
          transferId,
          sender: {
            deviceId: sender ? sender.deviceId : currentDeviceId,
            name: sender ? sender.name : "Unknown Sender",
            ip: clientIp,
          },
          receiver: {
            deviceId: receiver.deviceId,
            name: receiver.name,
            ip: receiver.ip,
          },
          files: files || [],
          totalSize,
          status: "pending",
        });

        // Notify target device
        io.to(receiver.socketId).emit("transfer:incoming", {
          transferId,
          from: {
            deviceId: sender ? sender.deviceId : currentDeviceId,
            name: sender ? sender.name : "Unknown Sender",
            socketId: socket.id,
          },
          files,
          totalSize,
        });

        // Confirm to sender that request was sent
        socket.emit("transfer:sent", { transferId, status: "pending" });
        console.log(`[Transfer Request] ${transferId} from ${sender?.name} to ${receiver?.name}`);
      } catch (err) {
        console.error("Error creating transfer request:", err);
        socket.emit("transfer:error", { message: "Failed to initiate transfer request" });
      }
    });

    socket.on("transfer:accept", async ({ transferId, senderSocketId }) => {
      try {
        await Transfer.findOneAndUpdate(
          { transferId },
          { status: "accepted", respondedAt: new Date() }
        );

        if (senderSocketId) {
          io.to(senderSocketId).emit("transfer:accepted", {
            transferId,
            receiverSocketId: socket.id,
          });
        }
        console.log(`[Transfer Accepted] ${transferId}`);
      } catch (err) {
        console.error("Error accepting transfer:", err);
      }
    });

    socket.on("transfer:reject", async ({ transferId, senderSocketId, reason }) => {
      try {
        await Transfer.findOneAndUpdate(
          { transferId },
          {
            status: "rejected",
            respondedAt: new Date(),
            completedAt: new Date(),
            errorMessage: reason || "Transfer rejected by receiver",
          }
        );

        if (senderSocketId) {
          io.to(senderSocketId).emit("transfer:rejected", {
            transferId,
            reason: reason || "Transfer declined",
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

    // 5. Disconnect handling
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
            io.emit("device:offline", { deviceId: device.deviceId, name: device.name });
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
            io.emit("device:offline", { deviceId: device.deviceId, name: device.name });
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
