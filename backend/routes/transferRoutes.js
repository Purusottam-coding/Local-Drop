const express = require("express");
const router = express.Router();
const Transfer = require("../models/Transfer");

// GET /api/transfers - Get transfer history with optional filters
router.get("/", async (req, res) => {
  try {
    const { deviceId, status, limit = 50 } = req.query;
    const filter = {};

    if (deviceId) {
      filter.$or = [
        { "sender.deviceId": deviceId },
        { "receiver.deviceId": deviceId },
      ];
    }

    if (status) {
      filter.status = status;
    }

    const transfers = await Transfer.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10));

    res.json({ success: true, count: transfers.length, data: transfers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/transfers/:transferId - Get single transfer details
router.get("/:transferId", async (req, res) => {
  try {
    const transfer = await Transfer.findOne({ transferId: req.params.transferId });
    if (!transfer) {
      return res.status(404).json({ success: false, message: "Transfer record not found" });
    }
    res.json({ success: true, data: transfer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/transfers - Clear transfer history
router.delete("/", async (req, res) => {
  try {
    const { deviceId } = req.query;
    const filter = {};

    if (deviceId) {
      filter.$or = [
        { "sender.deviceId": deviceId },
        { "receiver.deviceId": deviceId },
      ];
    }

    const result = await Transfer.deleteMany(filter);
    res.json({ success: true, message: "Transfer history cleared", deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
