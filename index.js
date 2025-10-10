// index.js
import "dotenv/config";
import express from "express";
import { v4 as uuid } from "uuid";
import mongoose from "mongoose";
import { calendarService } from "./calendarService.js";
import {
  taskManager,
  TaskTimeoutError,
  ConcurrentTaskLimitError,
} from "./taskManager.js";

const app = express();
app.use(express.json());

/* ========= Env ========= */
const {
  PORT = 3001,

  // Mongo
  MONGO_URI = "mongodb://localhost:27017/", // e.g. mongodb://<user>:<pass>@localhost:27017/bookingservice?authSource=bookingservice
  MONGO_DB_NAME = "bookingservice",

  // Task manager
  MAX_CONCURRENT_TASKS = 10,
  TASK_TIMEOUT = 30000, // ms

  // Gateway (minimal)
} = process.env;

const GATEWAY_URL = "http://faf-mgmt-gateway:7000"
const SERVICE_NAME = "booking-service"

/* ========= Task manager config ========= */
taskManager.updateConfig({
  maxConcurrentTasks: parseInt(MAX_CONCURRENT_TASKS, 10),
  taskTimeout: parseInt(TASK_TIMEOUT, 10),
});

/* ========= Gateway registration (once) ========= */
async function registerWithGatewayOnce() {
  console.log("[Gateway] Starting registration process...");
  console.log(`[Gateway] Target URL: ${GATEWAY_URL}/register`);
  console.log(`[Gateway] Service Name: ${SERVICE_NAME}`);
  console.log(`[Gateway] Service Port: ${PORT}`);

  const payload = {
    serviceName: SERVICE_NAME,
    port: Number(PORT),
    requiresAuth: false,
  };
  console.log("[Gateway] Registration payload:", JSON.stringify(payload, null, 2));

  try {
    console.log("[Gateway] Sending POST request to gateway...");
    const res = await fetch(`${GATEWAY_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Service-wide auth disabled; no endpoint customizations
      body: JSON.stringify(payload),
    });

    console.log(`[Gateway] Received response with status: ${res.status} ${res.statusText}`);
    console.log(`[Gateway] Response headers:`, Object.fromEntries(res.headers.entries()));

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Gateway] ❌ Registration failed!`);
      console.error(`[Gateway] Status: ${res.status} ${res.statusText}`);
      console.error(`[Gateway] Response body: ${text}`);
      return;
    }

    const data = await res.json();
    console.log("[Gateway] ✅ Successfully registered!");
    console.log("[Gateway] Registration response:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[Gateway] ❌ Registration error - Exception caught:");
    console.error(`[Gateway] Error type: ${e?.constructor?.name || 'Unknown'}`);
    console.error(`[Gateway] Error message: ${e?.message || 'No message'}`);
    console.error(`[Gateway] Error code: ${e?.code || 'No code'}`);
    console.error(`[Gateway] Full error:`, e);

    // Additional network-specific debugging
    if (e?.cause) {
      console.error(`[Gateway] Error cause:`, e.cause);
    }
    if (e?.code === 'ECONNREFUSED') {
      console.error(`[Gateway] 💡 Connection refused - Is the gateway running at ${GATEWAY_URL}?`);
    }
    if (e?.code === 'ENOTFOUND') {
      console.error(`[Gateway] 💡 Host not found - Check if ${GATEWAY_URL} is accessible`);
    }
    if (e?.code === 'ETIMEDOUT') {
      console.error(`[Gateway] 💡 Connection timeout - Gateway may be unreachable`);
    }
  }
}

/* ========= Mongo connection & init ========= */
if (!MONGO_URI) {
  console.error("Missing MONGO_URI env var");
  process.exit(1);
}

try {
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB_NAME });
  console.log("Connected to MongoDB");
} catch (err) {
  console.error("Mongo connection error:", err?.message || err);
  process.exit(1);
}

// Initialize Google Calendar service (your module)
await calendarService.initialize();

// Register with gateway once on startup (non-fatal if it fails)
await registerWithGatewayOnce();

/* ========= Schema & Model ========= */
const bookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    room: { type: String, required: true, index: true },
    startTime: { type: Date, required: true, index: true },
    endTime: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    calendarEventId: { type: String }, // Google Calendar event ID
  },
  { versionKey: false }
);

// Helpful compound index for overlap queries by room
bookingSchema.index({ room: 1, startTime: 1, endTime: 1 });

const Booking = mongoose.model("Booking", bookingSchema);

/* ========= Helpers ========= */
const isValidDate = (s) => !Number.isNaN(new Date(s).getTime());
const overlapsQuery = (start, end) => ({
  // overlap: existing.start < end AND existing.end > start
  startTime: { $lt: end },
  endTime: { $gt: start },
});

/* ========= Routes ========= */

/**
 * POST /bookings
 * Body: { userId, room, startTime, endTime } (ISO strings)
 * Response 201: { bookingId, userId, room, startTime, endTime, createdAt }
 * Errors: 400 invalid, 409 overlap
 */
app.post("/bookings", async (req, res) => {
  try {
    const result = await taskManager.executeTask(async () => {
      const { userId, room, startTime, endTime } = req.body || {};
      if (!userId || !room || !startTime || !endTime) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (!isValidDate(startTime) || !isValidDate(endTime)) {
        return res.status(400).json({ error: "Invalid datetime format" });
      }
      const start = new Date(startTime);
      const end = new Date(endTime);
      if (start >= end) {
        return res.status(400).json({ error: "startTime must be < endTime" });
      }

      // 409 if any overlapping booking for the same room
      const conflict = await Booking.exists({
        room,
        ...overlapsQuery(start, end),
      });
      if (conflict) {
        return res.status(409).json({ error: "Time slot taken" });
      }

      const bookingId = uuid();
      const doc = await Booking.create({
        bookingId,
        userId,
        room,
        startTime: start,
        endTime: end,
        createdAt: new Date(),
      });

      // Create Google Calendar event (your module)
      const calendarEventId = await calendarService.createEvent({
        bookingId,
        userId,
        room,
        startTime: start,
        endTime: end,
      });

      // Update booking with calendar event ID if created
      if (calendarEventId) {
        doc.calendarEventId = calendarEventId;
        await doc.save();
      }

      // Return exactly the spec (includes createdAt, excludes calendarEventId)
      const { _id, calendarEventId: _calId, ...plain } = doc.toObject();
      return res.status(201).json(plain);
    });

    return result;
  } catch (err) {
    if (err instanceof TaskTimeoutError) {
      console.error("POST /bookings timeout:", err.message);
      return res.status(408).json({ error: err.message });
    }
    if (err instanceof ConcurrentTaskLimitError) {
      console.error("POST /bookings concurrency limit:", err.message);
      return res.status(429).json({ error: err.message });
    }
    console.error("POST /bookings error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * GET /bookings?start={date}&end={date}
 * Returns all bookings, or only the ones that overlap the given range.
 * (Response excludes createdAt per your spec)
 */
app.get("/bookings", async (req, res) => {
  try {
    const result = await taskManager.executeTask(async () => {
      const { start, end } = req.query;

      let query = {};
      if (start || end) {
        if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
          return res.status(400).json({ error: "Invalid date range" });
        }
        const s = new Date(start);
        const e = new Date(end);
        if (s >= e) {
          return res.status(400).json({ error: "start must be < end" });
        }
        query = overlapsQuery(s, e);
      }

      // Fetch; project out Mongo internals; remove createdAt and calendarEventId from response
      const rows = await Booking.find(query, { _id: 0, __v: 0 })
        .sort({ startTime: 1 })
        .lean();
      const response = rows.map(({ createdAt, calendarEventId, ...rest }) => rest);
      return res.status(200).json(response);
    });

    return result;
  } catch (err) {
    if (err instanceof TaskTimeoutError) {
      console.error("GET /bookings timeout:", err.message);
      return res.status(408).json({ error: err.message });
    }
    if (err instanceof ConcurrentTaskLimitError) {
      console.error("GET /bookings concurrency limit:", err.message);
      return res.status(429).json({ error: err.message });
    }
    console.error("GET /bookings error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * DELETE /bookings/{bookingId}
 * Response 204, 404 if not found
 */
app.delete("/bookings/:bookingId", async (req, res) => {
  try {
    const result = await taskManager.executeTask(async () => {
      const { bookingId } = req.params;

      // Find first to get calendar event ID
      const booking = await Booking.findOne({ bookingId });
      if (!booking) {
        return res.status(404).json({ error: "Not Found" });
      }

      // Remove from Google Calendar if present
      if (booking.calendarEventId) {
        await calendarService.deleteEventById(booking.calendarEventId);
      }

      // Delete from DB
      await Booking.deleteOne({ bookingId });

      return res.status(204).send();
    });

    return result;
  } catch (err) {
    if (err instanceof TaskTimeoutError) {
      console.error("DELETE /bookings/:bookingId timeout:", err.message);
      return res.status(408).json({ error: err.message });
    }
    if (err instanceof ConcurrentTaskLimitError) {
      console.error("DELETE /bookings/:bookingId concurrency limit:", err.message);
      return res.status(429).json({ error: err.message });
    }
    console.error("DELETE /bookings/:bookingId error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ========= Health ========= */
app.get("/healthz", (_req, res) => res.send("ok"));

/* ========= Listen ========= */
app.listen(PORT, () => {
  console.log(`Booking service listening on :${PORT}`);
});
