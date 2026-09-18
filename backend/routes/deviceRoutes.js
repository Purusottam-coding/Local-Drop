const express = require("express");
const router = express.Router();
const {
  getDevices,
  getDeviceById,
  registerDevice,
  updateDevice,
} = require("../controllers/deviceController");

router.get("/", getDevices);
router.get("/:deviceId", getDeviceById);
router.post("/register", registerDevice);
router.patch("/:deviceId", updateDevice);

module.exports = router;
