import { requestsTotal, requestDuration, errorsTotal } from "./metrics.js";


export function prometheusMiddleware(req, res, next) {
    const start = Date.now();

    const originalEnd = res.end;

    res.end = function (...args) {
        const duration = (Date.now() - start) / 1000;

        const endpoint = req.route?.path || req.path || req.url;
        const method = req.method;
        const status = res.statusCode.toString();

        requestsTotal.labels(method, endpoint, status).inc();
        requestDuration.labels(method, endpoint).observe(duration);

        if (res.statusCode >= 400) {
            const errorType = res.statusCode >= 500 ? "server_error" : "client_error";
            errorsTotal.labels(errorType).inc();
        }

        originalEnd.apply(res, args);
    };

    next();
}