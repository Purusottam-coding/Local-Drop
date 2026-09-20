const express = require("express");
const router = express.Router();
const {
  createSession,
  getSessionByCode,
  joinSession,
  leaveSession,
  closeSession,
  addSessionFile,
} = require("../controllers/sessionController");

// POST /api/sessions/create - Create temporary session
router.post("/create", createSession);

// GET /api/sessions/:code - Get session details and active files
router.get("/:code", getSessionByCode);

// POST /api/sessions/:code/join - Join session
router.post("/:code/join", joinSession);

// POST /api/sessions/:code/leave - Leave session
router.post("/:code/leave", leaveSession);

// DELETE /api/sessions/:code - Close / destroy session
router.delete("/:code", closeSession);

// POST /api/sessions/:code/files - Record shared file in session
router.post("/:code/files", addSessionFile);

module.exports = router;
