import promClient from "prom-client";

const register = new promClient.Registry();

promClient.collectDefaultMetrics({ register });

export const requestsTotal = new promClient.Counter({
    name: "booking_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "endpoint", "status"],
    registers: [register],
});

export const requestDuration = new promClient.Histogram({
    name: "booking_request_duration_seconds",
    help: "HTTP request latency in seconds",
    labelNames: ["method", "endpoint"],
    buckets: [0.1, 0.5, 1, 2, 5],
    registers: [register],
});

export const errorsTotal = new promClient.Counter({
    name: "booking_errors_total",
    help: "Total number of errors",
    labelNames: ["type"],
    registers: [register],
});

export const dbOperationsTotal = new promClient.Counter({
    name: "booking_db_operations_total",
    help: "Total number of database operations",
    labelNames: ["operation", "status"],
    registers: [register],
});

export const bookingsCreated = new promClient.Counter({
    name: "booking_bookings_created_total",
    help: "Total number of bookings created",
    registers: [register],
});

export const bookingsDeleted = new promClient.Counter({
    name: "booking_bookings_deleted_total",
    help: "Total number of bookings deleted",
    registers: [register],
});

export const bookingConflicts = new promClient.Counter({
    name: "booking_conflicts_total",
    help: "Total number of booking conflicts (409 errors)",
    registers: [register],
});

export const calendarOperationsTotal = new promClient.Counter({
    name: "booking_calendar_operations_total",
    help: "Total number of Google Calendar operations",
    labelNames: ["operation", "status"],
    registers: [register],
});

export const activeBookingsGauge = new promClient.Gauge({
    name: "booking_active_bookings",
    help: "Number of active bookings by room",
    labelNames: ["room"],
    registers: [register],
});

export const taskTimeouts = new promClient.Counter({
    name: "booking_task_timeouts_total",
    help: "Total number of task timeouts",
    registers: [register],
});

export const taskConcurrencyLimitHits = new promClient.Counter({
    name: "booking_task_concurrency_limit_hits_total",
    help: "Total number of times concurrent task limit was hit",
    registers: [register],
});

export const activeTasks = new promClient.Gauge({
    name: "booking_active_tasks",
    help: "Number of currently active tasks",
    registers: [register],
});

export async function metricsHandler(req, res) {
    try {
        res.set("Content-Type", register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
    } catch (error) {
        console.error("Error generating metrics:", error);
        res.status(500).end();
    }
}

export { register };