const express = require("express");
const router = express.Router();
const {
  getTransfers,
  getTransferById,
  clearTransfers,
} = require("../controllers/transferController");

router.get("/", getTransfers);
router.get("/:transferId", getTransferById);
router.delete("/", clearTransfers);

module.exports = router;
