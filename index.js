// index.js 
import express from "express";
import { v4 as uuid } from "uuid";
import mongoose from "mongoose";

const app = express();
app.use(express.json());

/* ========= Mongo connection ========= */
const {
  PORT = 3001,
  MONGO_URI = "mongodb://localhost:27017/",    // e.g. mongodb://<user>:<pass>@localhost:27017/bookingservice?authSource=bookingservice
  MONGO_DB_NAME = "bookingservice" // optional if DB name is embedded in URI
} = process.env;

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

/* ========= Schema & Model ========= */
const bookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true, unique: true, index: true },
    userId:    { type: String, required: true, index: true },
    room:      { type: String, required: true, index: true },
    startTime: { type: Date,   required: true, index: true },
    endTime:   { type: Date,   required: true, index: true },
    createdAt: { type: Date,   default: Date.now, index: true },
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
  endTime:   { $gt: start },
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

    const doc = await Booking.create({
      bookingId: uuid(),
      userId,
      room,
      startTime: start,
      endTime: end,
      createdAt: new Date(),
    });

    // Return exactly the spec (includes createdAt)
    const { _id, ...plain } = doc.toObject();
    return res.status(201).json(plain);
  } catch (err) {
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

    // Fetch; project out Mongo internals; remove createdAt from response
    const rows = await Booking.find(query, { _id: 0, __v: 0 }).sort({ startTime: 1 }).lean();
    const response = rows.map(({ createdAt, ...rest }) => rest);
    return res.status(200).json(response);
  } catch (err) {
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
    const { bookingId } = req.params;
    const result = await Booking.deleteOne({ bookingId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Not Found" });
    }
    return res.status(204).send();
  } catch (err) {
    console.error("DELETE /bookings/:bookingId error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/healthz", (_req, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`Booking service listening on :${PORT}`);
});
