import express from "express";
import { v4 as uuid } from "uuid";

const app = express();
app.use(express.json());

/**
 * In-memory store
 */
let bookings = [];

/**
 * Helpers
 */
const toISO = (d) => new Date(d).toISOString();
const isValidDate = (s) => !Number.isNaN(new Date(s).getTime());
const overlaps = (aStart, aEnd, bStart, bEnd) =>
  aStart < bEnd && bStart < aEnd;

/**
 * POST /bookings
 * Creates a new booking for a room.
 * Body: { userId, room, startTime, endTime }  (ISO 8601 strings)
 */
app.post("/bookings", (req, res) => {
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
  const conflict = bookings.some(
    (b) =>
      b.room === room &&
      overlaps(new Date(b.startTime), new Date(b.endTime), start, end)
  );
  if (conflict) {
    return res.status(409).json({ error: "Time slot taken" });
  }

  const booking = {
    bookingId: uuid(),
    userId,
    room,
    startTime: toISO(start),
    endTime: toISO(end),
    createdAt: toISO(new Date())
  };

  bookings.push(booking);
  // Response spec includes createdAt here
  return res.status(201).json(booking);
});

/**
 * GET /bookings?start={date}&end={date}
 * Returns bookings that overlap the requested interval.
 * If start/end omitted, returns all bookings.
 */
app.get("/bookings", (req, res) => {
  const { start, end } = req.query;

  if (!start || !end) {
    // For GET response spec, omit createdAt
    const list = bookings.map(({ createdAt, ...rest }) => rest);
    return res.status(200).json(list);
  }
  if (!isValidDate(start) || !isValidDate(end)) {
    return res.status(400).json({ error: "Invalid date range" });
  }
  const s = new Date(start);
  const e = new Date(end);
  if (s >= e) {
    return res.status(400).json({ error: "start must be < end" });
  }

  const within = bookings
    .filter((b) =>
      overlaps(new Date(b.startTime), new Date(b.endTime), s, e)
    )
    .map(({ createdAt, ...rest }) => rest);

  return res.status(200).json(within);
});

/**
 * DELETE /bookings/{bookingId}
 */
app.delete("/bookings/:bookingId", (req, res) => {
  const { bookingId } = req.params;
  const idx = bookings.findIndex((b) => b.bookingId === bookingId);
  if (idx === -1) return res.status(404).json({ error: "Not Found" });
  bookings.splice(idx, 1);
  return res.status(204).send();
});

app.get("/healthz", (_req, res) => res.send("ok"));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Booking service listening on :${PORT}`);
});