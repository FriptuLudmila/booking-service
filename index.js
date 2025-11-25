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
import { healthHandler, loadHandler } from "./healthRoutes.js";
import { metricsHandler } from "./metrics.js";
import { prometheusMiddleware } from "./middleware.js";
import { retryRegistration, startPingTask } from "./discovery.js";
import { ShortBusClient } from "./shortbus.js";
import {
    requestsTotal,
    requestDuration,
    errorsTotal,
    dbOperationsTotal,
    bookingsCreated,
    bookingsDeleted,
    bookingConflicts,
    calendarOperationsTotal,
    taskTimeouts,
    taskConcurrencyLimitHits,
} from "./metrics.js";

const app = express();
app.use(express.json());

app.use(prometheusMiddleware);

const {
    BOOKING_PORT = 80,
    BOOKING_MONGO_URI = "mongodb://localhost:27017/",
    BOOKING_MONGO_DB_NAME = "bookingservice",
    BOOKING_MAX_CONCURRENT_TASKS = 10,
    BOOKING_TASK_TIMEOUT = 30000, // ms
    GATEWAY_URL,
    DISCOVERY_URL,
    SHORTBUS_URL = "localhost:50051",
} = process.env;

const SERVICE_NAME = "bookingService";

// Initialize ShortBus client
let shortbusClient = null;
try {
    shortbusClient = new ShortBusClient('booking-service', SHORTBUS_URL);
} catch (error) {
    console.error('[ShortBus] Failed to initialize client:', error.message);
}

taskManager.updateConfig({
    maxConcurrentTasks: parseInt(BOOKING_MAX_CONCURRENT_TASKS, 10),
    taskTimeout: parseInt(BOOKING_TASK_TIMEOUT, 10),
});

if (!BOOKING_MONGO_URI) {
    console.error("Missing MONGO_URI env var");
    process.exit(1);
}

try {
    await mongoose.connect(BOOKING_MONGO_URI, { dbName: BOOKING_MONGO_DB_NAME });
    console.log("Connected to MongoDB");
} catch (err) {
    console.error("Mongo connection error:", err?.message || err);
    process.exit(1);
}

await calendarService.initialize();

retryRegistration(DISCOVERY_URL, SERVICE_NAME, BOOKING_PORT);

const stopPingTask = startPingTask(GATEWAY_URL);

process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully...");
    if (stopPingTask) stopPingTask();
    process.exit(0);
});

process.on("SIGINT", () => {
    console.log("SIGINT received, shutting down gracefully...");
    if (stopPingTask) stopPingTask();
    process.exit(0);
});

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

bookingSchema.index({ room: 1, startTime: 1, endTime: 1 });

const Booking = mongoose.model("Booking", bookingSchema);

const isValidDate = (s) => !Number.isNaN(new Date(s).getTime());
const overlapsQuery = (start, end) => ({
    startTime: { $lt: end },
    endTime: { $gt: start },
});

app.get("/health", healthHandler);
app.get("/load", loadHandler);
app.get("/metrics", metricsHandler);

app.post("/bookings", async (req, res) => {
    try {
        const result = await taskManager.executeTask(async () => {
            const { userId, room, startTime, endTime } = req.body || {};
            if (!userId || !room || !startTime || !endTime) {
                errorsTotal.labels("validation_error").inc();
                console.log("POST /bookings: Missing required fields");
                return res.status(400).json({ error: "Missing required fields" });
            }
            if (!isValidDate(startTime) || !isValidDate(endTime)) {
                errorsTotal.labels("validation_error").inc();
                console.log("POST /bookings: Invalid datetime format");
                return res.status(400).json({ error: "Invalid datetime format" });
            }
            const start = new Date(startTime);
            const end = new Date(endTime);
            if (start >= end) {
                errorsTotal.labels("validation_error").inc();
                console.log("POST /bookings: startTime must be < endTime");
                return res.status(400).json({ error: "startTime must be < endTime" });
            }

            const conflict = await Booking.exists({
                room,
                ...overlapsQuery(start, end),
            });

            if (conflict) {
                bookingConflicts.inc();
                dbOperationsTotal.labels("check_conflict", "conflict").inc();
                console.log(`POST /bookings: Conflict for room ${room}`);
                return res.status(409).json({ error: "Time slot taken" });
            }

            dbOperationsTotal.labels("check_conflict", "success").inc();

            const bookingId = uuid();
            const doc = await Booking.create({
                bookingId,
                userId,
                room,
                startTime: start,
                endTime: end,
                createdAt: new Date(),
            });

            dbOperationsTotal.labels("create_booking", "success").inc();
            bookingsCreated.inc();

            // Publish BroadcastCabOccupation event to ShortBus
            if (shortbusClient) {
                try {
                    const date = start.toISOString().split('T')[0];
                    const startTimeStr = start.toTimeString().split(' ')[0].substring(0, 5);
                    const endTimeStr = end.toTimeString().split(' ')[0].substring(0, 5);

                    await shortbusClient.publishBroadcastCabOccupation({
                        date: date,
                        startTime: startTimeStr,
                        endTime: endTimeStr,
                        bookingId: bookingId,
                        userId: userId,
                        timestamp: Date.now(),
                    });
                    console.log(`POST /bookings: Published BroadcastCabOccupation for booking ${bookingId}`);
                } catch (shortbusError) {
                    console.error('[ShortBus] Failed to publish occupation event:', shortbusError.message);
                    // Continue - booking is still created
                }
            }

            try {
                const calendarEventId = await calendarService.createEvent({
                    bookingId,
                    userId,
                    room,
                    startTime: start,
                    endTime: end,
                });

                if (calendarEventId) {
                    doc.calendarEventId = calendarEventId;
                    await doc.save();
                    calendarOperationsTotal.labels("create_event", "success").inc();
                    console.log(`POST /bookings: Calendar event ${calendarEventId} saved to booking`);
                } else {
                    console.warn(`POST /bookings: Calendar event creation returned null for booking ${bookingId}`);
                }
            } catch (calError) {
                calendarOperationsTotal.labels("create_event", "failure").inc();
                console.error("POST /bookings: Calendar event creation failed:", calError.message);
                if (calError.code) {
                    console.error(`  API Error code: ${calError.code}`);
                }
                // Continue without calendar event - booking is still created
            }

            const { _id, calendarEventId: _calId, ...plain } = doc.toObject();
            console.log(`POST /bookings: Created booking ${bookingId}`);
            return res.status(201).json(plain);
        });

        return result;
    } catch (err) {
        if (err instanceof TaskTimeoutError) {
            taskTimeouts.inc();
            console.error("POST /bookings timeout:", err.message);
            return res.status(408).json({ error: err.message });
        }
        if (err instanceof ConcurrentTaskLimitError) {
            taskConcurrencyLimitHits.inc();
            console.error("POST /bookings concurrency limit:", err.message);
            return res.status(429).json({ error: err.message });
        }
        errorsTotal.labels("internal_error").inc();
        console.error("POST /bookings error:", err);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get("/bookings", async (req, res) => {
    try {
        const result = await taskManager.executeTask(async () => {
            const { start, end } = req.query;

            let query = {};
            if (start || end) {
                if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
                    errorsTotal.labels("validation_error").inc();
                    console.log("GET /bookings: Invalid date range");
                    return res.status(400).json({ error: "Invalid date range" });
                }
                const s = new Date(start);
                const e = new Date(end);
                if (s >= e) {
                    errorsTotal.labels("validation_error").inc();
                    console.log("GET /bookings: start must be < end");
                    return res.status(400).json({ error: "start must be < end" });
                }
                query = overlapsQuery(s, e);
            }

            const rows = await Booking.find(query, { _id: 0, __v: 0 })
                .sort({ startTime: 1 })
                .lean();

            dbOperationsTotal.labels("list_bookings", "success").inc();

            const response = rows.map(({ createdAt, calendarEventId, ...rest }) => rest);
            console.log(`GET /bookings: Retrieved ${response.length} bookings`);
            return res.status(200).json(response);
        });

        return result;
    } catch (err) {
        if (err instanceof TaskTimeoutError) {
            taskTimeouts.inc();
            console.error("GET /bookings timeout:", err.message);
            return res.status(408).json({ error: err.message });
        }
        if (err instanceof ConcurrentTaskLimitError) {
            taskConcurrencyLimitHits.inc();
            console.error("GET /bookings concurrency limit:", err.message);
            return res.status(429).json({ error: err.message });
        }
        errorsTotal.labels("internal_error").inc();
        console.error("GET /bookings error:", err);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

app.delete("/bookings/:bookingId", async (req, res) => {
    try {
        const result = await taskManager.executeTask(async () => {
            const { bookingId } = req.params;

            const booking = await Booking.findOne({ bookingId });
            if (!booking) {
                errorsTotal.labels("not_found").inc();
                console.log(`DELETE /bookings/${bookingId}: Not found`);
                return res.status(404).json({ error: "Not Found" });
            }

            if (booking.calendarEventId) {
                try {
                    await calendarService.deleteEventById(booking.calendarEventId);
                    calendarOperationsTotal.labels("delete_event", "success").inc();
                    console.log(`DELETE /bookings/${bookingId}: Deleted calendar event ${booking.calendarEventId}`);
                } catch (calError) {
                    calendarOperationsTotal.labels("delete_event", "failure").inc();
                    console.error(`DELETE /bookings/${bookingId}: Calendar event deletion failed:`, calError);
                }
            }

            await Booking.deleteOne({ bookingId });
            dbOperationsTotal.labels("delete_booking", "success").inc();
            bookingsDeleted.inc();

            console.log(`DELETE /bookings/${bookingId}: Deleted booking`);
            return res.status(204).send();
        });

        return result;
    } catch (err) {
        if (err instanceof TaskTimeoutError) {
            taskTimeouts.inc();
            console.error("DELETE /bookings/:bookingId timeout:", err.message);
            return res.status(408).json({ error: err.message });
        }
        if (err instanceof ConcurrentTaskLimitError) {
            taskConcurrencyLimitHits.inc();
            console.error("DELETE /bookings/:bookingId concurrency limit:", err.message);
            return res.status(429).json({ error: err.message });
        }
        errorsTotal.labels("internal_error").inc();
        console.error("DELETE /bookings/:bookingId error:", err);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(BOOKING_PORT, async () => {
    console.log(`Booking service listening on :${BOOKING_PORT}`);
    
    // Start ShortBus client
    if (shortbusClient) {
        try {
            await shortbusClient.start();
            console.log('[ShortBus] Client started successfully');
        } catch (error) {
            console.error('[ShortBus] Failed to start client:', error.message);
        }
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    if (shortbusClient) {
        await shortbusClient.stop();
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    if (shortbusClient) {
        await shortbusClient.stop();
    }
    process.exit(0);
});