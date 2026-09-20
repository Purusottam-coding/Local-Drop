const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      default: "browser",
      enum: ["desktop", "mobile", "tablet", "browser", "windows", "mac", "android", "ios", "linux"],
    },
    ip: {
      type: String,
      default: "127.0.0.1",
    },
    socketId: {
      type: String,
      default: null,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    isTrusted: {
      type: Boolean,
      default: false,
    },
    trustedDevices: {
      type: [String],
      default: [],
    },
    autoAcceptTrusted: {
      type: Boolean,
      default: true,
    },
    pairingPin: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Device", deviceSchema);
