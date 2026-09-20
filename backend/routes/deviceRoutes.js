const express = require("express");
const router = express.Router();
const {
  getDevices,
  getDeviceById,
  registerDevice,
  updateDevice,
  addTrustedDevice,
  removeTrustedDevice,
  getTrustedDevices,
} = require("../controllers/deviceController");

router.get("/", getDevices);
router.get("/:deviceId", getDeviceById);
router.post("/register", registerDevice);
router.patch("/:deviceId", updateDevice);

// Trusted devices endpoints
router.post("/:deviceId/trust", addTrustedDevice);
router.delete("/:deviceId/trust/:targetDeviceId", removeTrustedDevice);
router.get("/:deviceId/trusted", getTrustedDevices);

module.exports = router;
