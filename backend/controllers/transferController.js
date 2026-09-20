const Transfer = require("../models/Transfer");

// @desc    Get transfer history with optional filters
// @route   GET /api/transfers
// @access  Public
const getTransfers = async (req, res) => {
  try {
    const { deviceId, status, limit = 50 } = req.query;
    const past24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filter = {
      createdAt: { $gte: past24h },
    };

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
};

// @desc    Get details of a single transfer
// @route   GET /api/transfers/:transferId
// @access  Public
const getTransferById = async (req, res) => {
  try {
    const transfer = await Transfer.findOne({ transferId: req.params.transferId });
    if (!transfer) {
      return res.status(404).json({ success: false, message: "Transfer record not found" });
    }
    res.json({ success: true, data: transfer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Clear transfer history
// @route   DELETE /api/transfers
// @access  Public
const clearTransfers = async (req, res) => {
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
    res.json({
      success: true,
      message: "Transfer history cleared",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getTransfers,
  getTransferById,
  clearTransfers,
};
