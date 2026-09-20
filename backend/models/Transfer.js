const mongoose = require("mongoose");

const transferFileSchema = new mongoose.Schema({
  name: { type: String, required: true },
  size: { type: Number, required: true },
  type: { type: String, default: "" },
  relativePath: { type: String, default: "" },
});

const transferSchema = new mongoose.Schema(
  {
    transferId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sender: {
      deviceId: { type: String, required: true },
      name: { type: String, required: true },
      ip: { type: String, default: "127.0.0.1" },
    },
    receiver: {
      deviceId: { type: String, required: true },
      name: { type: String, required: true },
      ip: { type: String, default: "127.0.0.1" },
    },
    files: [transferFileSchema],
    totalSize: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "transferring", "completed", "failed", "cancelled"],
      default: "pending",
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-expire transfer history after 24 hours (86,400 seconds) if not cleared manually
transferSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("Transfer", transferSchema);
