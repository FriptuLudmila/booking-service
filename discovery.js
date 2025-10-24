export async function registerWithDiscovery(discoveryUrl, serviceName, port) {
    if (!discoveryUrl) {
        console.error("[Discovery] DISCOVERY_URL not set, skipping registration");
        return false;
    }

    console.log(`[Discovery] Registering ${serviceName} on port ${port}...`);

    const payload = {
        serviceName,
        port: Number(port),
    };

    try {
        const response = await fetch(`${discoveryUrl}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(
                `[Discovery] Registration failed: ${response.status} ${response.statusText}`
            );
            console.error(`[Discovery] Response: ${text}`);
            return false;
        }

        const data = await response.json();
        console.log("[Discovery] Successfully registered with Discovery service");
        console.log("[Discovery] Response:", data);
        return true;
    } catch (error) {
        console.error("[Discovery] Registration error:", error.message);
        return false;
    }
}

export async function retryRegistration(
    discoveryUrl,
    serviceName,
    port,
    maxRetries = 5
) {
    for (let i = 0; i < maxRetries; i++) {
        const success = await registerWithDiscovery(discoveryUrl, serviceName, port);
        if (success) {
            return;
        }

        const waitTime = Math.pow(2, i) * 1000;
        console.log(
            `[Discovery] Registration failed (attempt ${i + 1}/${maxRetries}). Retrying in ${waitTime}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    console.error(
        "[Discovery] Failed to register after maximum retries. Service will continue without registration."
    );
}

async function pingService(gatewayUrl, serviceName) {
    const url = `${gatewayUrl}/api/${serviceName}/health`;

    try {
        const response = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(3000),
        });

        if (response.ok) {
            console.log(`[PING] ${serviceName}: OK`);
        } else {
            console.log(`[PING] ${serviceName}: STATUS ${response.status}`);
        }
    } catch (error) {
        if (error.name === "AbortError") {
            console.log(`[PING] ${serviceName}: TIMEOUT`);
        } else {
            console.log(`[PING] ${serviceName}: ERROR - ${error.message}`);
        }
    }
}

export function startPingTask(gatewayUrl) {
    if (!gatewayUrl) {
        console.log("[PING] GATEWAY_URL not set, skipping ping task");
        return;
    }

    const servicesToPing = [
        "checkInService",
    ];

    const interval = setInterval(() => {
        servicesToPing.forEach((service) => {
            pingService(gatewayUrl, service);
        });
    }, 5000);

    console.log("[PING] Started ping task for inter-service communication");

    return () => {
        clearInterval(interval);
        console.log("[PING] Stopped ping task");
    };
}