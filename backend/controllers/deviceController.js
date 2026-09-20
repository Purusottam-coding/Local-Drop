const Device = require("../models/Device");

// @desc    Get all registered devices (with optional online filter)
// @route   GET /api/devices
// @access  Public
const getDevices = async (req, res) => {
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
};

// @desc    Get single device by deviceId
// @route   GET /api/devices/:deviceId
// @access  Public
const getDeviceById = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }
    res.json({ success: true, data: device });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Register or update device identity & IP
// @route   POST /api/devices/register
// @access  Public
const registerDevice = async (req, res) => {
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
};

// @desc    Update device properties (rename, trust status, autoAccept)
// @route   PATCH /api/devices/:deviceId
// @access  Public
const updateDevice = async (req, res) => {
  try {
    const { name, isTrusted, type, autoAcceptTrusted } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (isTrusted !== undefined) updateData.isTrusted = isTrusted;
    if (type !== undefined) updateData.type = type;
    if (autoAcceptTrusted !== undefined) updateData.autoAcceptTrusted = autoAcceptTrusted;

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
};

// @desc    Add a trusted device
// @route   POST /api/devices/:deviceId/trust
// @access  Public
const addTrustedDevice = async (req, res) => {
  try {
    const { targetDeviceId } = req.body;
    if (!targetDeviceId) {
      return res.status(400).json({ success: false, message: "targetDeviceId is required" });
    }

    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { $addToSet: { trustedDevices: targetDeviceId } },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }

    res.json({ success: true, data: device.trustedDevices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Remove a trusted device
// @route   DELETE /api/devices/:deviceId/trust/:targetDeviceId
// @access  Public
const removeTrustedDevice = async (req, res) => {
  try {
    const { deviceId, targetDeviceId } = req.params;

    // Mutually disconnect both devices
    const device = await Device.findOneAndUpdate(
      { deviceId },
      { $pull: { trustedDevices: targetDeviceId }, isTrusted: false },
      { new: true }
    );

    await Device.findOneAndUpdate(
      { deviceId: targetDeviceId },
      { $pull: { trustedDevices: deviceId }, isTrusted: false }
    );

    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }

    res.json({ success: true, data: device.trustedDevices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get trusted devices for this device
// @route   GET /api/devices/:deviceId/trusted
// @access  Public
const getTrustedDevices = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }

    const trustedList = await Device.find({
      deviceId: { $in: device.trustedDevices || [] },
    }).select("deviceId name type ip isOnline lastSeen");

    res.json({ success: true, data: trustedList });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDevices,
  getDeviceById,
  registerDevice,
  updateDevice,
  addTrustedDevice,
  removeTrustedDevice,
  getTrustedDevices,
};
