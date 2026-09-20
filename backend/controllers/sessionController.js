const Session = require("../models/Session");
const crypto = require("crypto");
const { sanitizeFilename } = require("../utils/security");

/**
 * Generate a friendly session code: DROP-XXXX
 */
function generateSessionCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "DROP-";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// @desc    Create a new temporary file sharing session
// @route   POST /api/sessions/create
// @access  Public
const createSession = async (req, res) => {
  try {
    const { deviceId, name, durationMinutes = 30 } = req.body;

    if (!deviceId || !name) {
      return res.status(400).json({
        success: false,
        message: "deviceId and name are required to create a session",
      });
    }

    const duration = Math.min(Math.max(parseInt(durationMinutes, 10) || 30, 5), 180); // 5m to 180m
    const expiresAt = new Date(Date.now() + duration * 60 * 1000);

    // Generate collision-free session code
    let sessionCode = generateSessionCode();
    let existing = await Session.findOne({ sessionCode });
    let attempts = 0;
    while (existing && attempts < 5) {
      sessionCode = generateSessionCode();
      existing = await Session.findOne({ sessionCode });
      attempts++;
    }

    const rawIp =
      (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
        .split(",")[0]
        .trim();
    const ip = !rawIp || rawIp === "::1" ? "127.0.0.1" : rawIp;

    const session = await Session.create({
      sessionCode,
      creator: { deviceId, name, ip },
      durationMinutes: duration,
      expiresAt,
      participants: [
        {
          deviceId,
          name,
          isHost: true,
          joinedAt: new Date(),
        },
      ],
      files: [],
      status: "active",
    });

    const remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

    res.status(201).json({
      success: true,
      data: {
        ...session.toObject(),
        remainingSeconds,
      },
    });
  } catch (error) {
    console.error("Error creating session:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get details and files of a temporary session by code
// @route   GET /api/sessions/:code
// @access  Public
const getSessionByCode = async (req, res) => {
  try {
    const sessionCode = req.params.code.trim().toUpperCase();
    const session = await Session.findOne({ sessionCode });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Temporary session not found or has expired.",
      });
    }

    if (session.status !== "active" || session.expiresAt.getTime() <= Date.now()) {
      return res.status(410).json({
        success: false,
        message: "This temporary file-sharing session has expired.",
      });
    }

    const remainingSeconds = Math.max(
      0,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)
    );

    res.json({
      success: true,
      data: {
        ...session.toObject(),
        remainingSeconds,
      },
    });
  } catch (error) {
    console.error("Error fetching session:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Join a temporary session by code
// @route   POST /api/sessions/:code/join
// @access  Public
const joinSession = async (req, res) => {
  try {
    const sessionCode = req.params.code.trim().toUpperCase();
    const { deviceId, name, socketId } = req.body;

    if (!deviceId || !name) {
      return res.status(400).json({
        success: false,
        message: "deviceId and name are required to join session",
      });
    }

    const session = await Session.findOne({ sessionCode });

    if (!session || session.status !== "active" || session.expiresAt.getTime() <= Date.now()) {
      return res.status(404).json({
        success: false,
        message: "Session is not active or has expired.",
      });
    }

    // Check if participant already exists in roster
    const existingIndex = session.participants.findIndex(
      (p) => p.deviceId === deviceId
    );

    if (existingIndex >= 0) {
      session.participants[existingIndex].socketId = socketId || session.participants[existingIndex].socketId;
      session.participants[existingIndex].name = name;
    } else {
      session.participants.push({
        deviceId,
        name,
        socketId: socketId || null,
        isHost: session.creator.deviceId === deviceId,
        joinedAt: new Date(),
      });
    }

    await session.save();

    const remainingSeconds = Math.max(
      0,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)
    );

    res.json({
      success: true,
      data: {
        ...session.toObject(),
        remainingSeconds,
      },
    });
  } catch (error) {
    console.error("Error joining session:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Leave a temporary session
// @route   POST /api/sessions/:code/leave
// @access  Public
const leaveSession = async (req, res) => {
  try {
    const sessionCode = req.params.code.trim().toUpperCase();
    const { deviceId } = req.body;

    const session = await Session.findOne({ sessionCode });
    if (!session) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }

    session.participants = session.participants.filter(
      (p) => p.deviceId !== deviceId
    );
    await session.save();

    res.json({ success: true, message: "Left session successfully" });
  } catch (error) {
    console.error("Error leaving session:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Close and delete a temporary session immediately (host only or self-destruct)
// @route   DELETE /api/sessions/:code
// @access  Public
const closeSession = async (req, res) => {
  try {
    const sessionCode = req.params.code.trim().toUpperCase();
    const { deviceId } = req.body || {};

    const session = await Session.findOne({ sessionCode });
    if (!session) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }

    // If deviceId provided, verify it's the host/creator
    if (deviceId && session.creator.deviceId !== deviceId) {
      return res.status(403).json({
        success: false,
        message: "Only the session host can destroy this session.",
      });
    }

    await Session.deleteOne({ sessionCode });

    res.json({
      success: true,
      message: "Temporary session destroyed successfully.",
    });
  } catch (error) {
    console.error("Error closing session:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Record shared file metadata in session
// @route   POST /api/sessions/:code/files
// @access  Public
const addSessionFile = async (req, res) => {
  try {
    const sessionCode = req.params.code.trim().toUpperCase();
    const { fileId, name, size, type, senderName, senderDeviceId } = req.body;

    if (!fileId || !name || size === undefined) {
      return res.status(400).json({
        success: false,
        message: "fileId, name, and size are required",
      });
    }

    const session = await Session.findOne({ sessionCode });
    if (!session || session.status !== "active" || session.expiresAt.getTime() <= Date.now()) {
      return res.status(404).json({
        success: false,
        message: "Session is inactive or has expired",
      });
    }

    const safeName = sanitizeFilename(name);

    session.files.push({
      fileId,
      name: safeName,
      size: typeof size === "number" && size >= 0 ? size : 0,
      type: type || "",
      senderName: senderName || "Member",
      senderDeviceId: senderDeviceId || "",
      uploadedAt: new Date(),
    });

    await session.save();

    res.status(201).json({
      success: true,
      data: session.files,
    });
  } catch (error) {
    console.error("Error adding session file:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createSession,
  getSessionByCode,
  joinSession,
  leaveSession,
  closeSession,
  addSessionFile,
};
