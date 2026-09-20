const mongoose = require("mongoose");

const sessionParticipantSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  name: { type: String, required: true },
  socketId: { type: String, default: null },
  isHost: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now },
});

const sessionFileSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  name: { type: String, required: true },
  size: { type: Number, required: true },
  type: { type: String, default: "" },
  senderName: { type: String, required: true },
  senderDeviceId: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
});

const sessionSchema = new mongoose.Schema(
  {
    sessionCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    creator: {
      deviceId: { type: String, required: true },
      name: { type: String, required: true },
      ip: { type: String, default: "127.0.0.1" },
    },
    durationMinutes: {
      type: Number,
      required: true,
      default: 30,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
    participants: [sessionParticipantSchema],
    files: [sessionFileSchema],
    status: {
      type: String,
      enum: ["active", "closed", "expired"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Session", sessionSchema);
