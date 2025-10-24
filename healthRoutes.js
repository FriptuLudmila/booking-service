import os from "os";

const startTime = Date.now();

function getCPUUsage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu) => {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~((100 * idle) / total);

    return usage;
}

function getMemoryUsage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;

    return memoryUsage;
}

export function healthHandler(req, res) {
    const uptime = Date.now() - startTime;
    const uptimeSeconds = Math.floor(uptime / 1000);

    res.status(200).json({
        status: "healthy",
        uptime: `${uptimeSeconds}s`,
    });
}

export function loadHandler(req, res) {
    try {
        const cpu = getCPUUsage();
        const memory = getMemoryUsage();

        res.status(200).json({
            cpu: parseFloat(cpu.toFixed(2)),
            memory: parseFloat(memory.toFixed(2)),
        });
    } catch (error) {
        console.error("Error getting system load:", error);
        res.status(500).json({ error: "Failed to get system load" });
    }
}