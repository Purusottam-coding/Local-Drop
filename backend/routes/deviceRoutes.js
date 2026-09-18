const express = require("express");
const router = express.Router();
const Device = require("../models/Device");

// GET /api/devices - Get all devices (or filter by online)
router.get("/", async (req, res) => {
  try {
    const { online } = req.query;
    const filter = {};
    if (online === "true") {
      filter.isOnline = true;
    }
    const devices = await Device.find(filter).sort({ isOnline: -1, lastSeen: -1 });
    res.json({ success: true, count: devices.length, data: devices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/devices/:deviceId - Get specific device
router.get("/:deviceId", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }
    res.json({ success: true, data: device });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/devices/register - Register or heartbeat a device
router.post("/register", async (req, res) => {
  try {
    const { deviceId, name, type } = req.body;
    if (!deviceId || !name) {
      return res.status(400).json({ success: false, message: "deviceId and name are required" });
    }

    const ip =
      (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim() ||
      "127.0.0.1";

    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        name,
        type: type || "browser",
        ip: ip === "::1" ? "127.0.0.1" : ip,
        lastSeen: new Date(),
      },
      { new: true, upsert: true }
    );

    res.status(200).json({ success: true, data: device });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /api/devices/:deviceId - Update device info (e.g. rename, trust)
router.patch("/:deviceId", async (req, res) => {
  try {
    const { name, isTrusted, type } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (isTrusted !== undefined) updateData.isTrusted = isTrusted;
    if (type !== undefined) updateData.type = type;

    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      updateData,
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }

    res.json({ success: true, data: device });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
