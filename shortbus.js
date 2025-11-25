import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROTO_PATH_BROKER = join(__dirname, 'proto/broker.proto');
const PROTO_PATH_EVENTS = join(__dirname, 'proto/events.proto');

// Load proto for gRPC client
const packageDefinitionBroker = protoLoader.loadSync(PROTO_PATH_BROKER, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

const brokerProto = grpc.loadPackageDefinition(packageDefinitionBroker);

// Load proto for message encoding/decoding with protobufjs
const eventsRoot = await protobuf.load(PROTO_PATH_EVENTS);
const PingRequest = eventsRoot.lookupType('events.PingRequest');
const PingResponse = eventsRoot.lookupType('events.PingResponse');
const BroadcastCabOccupation = eventsRoot.lookupType('events.BroadcastCabOccupation');

export class ShortBusClient {
    constructor(serviceName, brokerUrl) {
        this.serviceName = serviceName;
        const hostname = os.hostname();
        const shortUuid = uuidv4().substring(0, 8);
        this.instanceId = `${serviceName}-${hostname}-${shortUuid}`;
        this.brokerUrl = brokerUrl;
        this.loadReportInterval = null;

        this.client = new brokerProto.dev.bytegrip.broker.MessageBroker(
            brokerUrl,
            grpc.credentials.createInsecure()
        );
    }

    async start() {
        console.log(`[ShortBus] Starting client for service: ${this.serviceName} [${this.instanceId}]`);

        await this.registerService('PingRequest');
        await this.registerService('PingResponse');
        await this.registerService('BroadcastCabOccupation');

        console.log(`[ShortBus] Client started for service: ${this.serviceName} [${this.instanceId}]`);

        this.subscribeToPingRequests();
        this.subscribeToPingResponses();
        this.startLoadReporting();
    }

    async stop() {
        console.log(`[ShortBus] Stopping client for service: ${this.serviceName}`);
        if (this.loadReportInterval) {
            clearInterval(this.loadReportInterval);
        }
        this.client.close();
        console.log(`[ShortBus] Client stopped for service: ${this.serviceName}`);
    }

    async registerService(eventType) {
        return new Promise((resolve, reject) => {
            this.client.RegisterService(
                {
                    service_name: this.serviceName,
                    instance_id: this.instanceId,
                    event_type: eventType,
                },
                (error, response) => {
                    if (error) {
                        console.error(`[ShortBus] Failed to register for ${eventType}:`, error.message);
                        reject(error);
                    } else {
                        console.log(`[ShortBus] Registered: ${this.instanceId} for ${eventType}`);
                        resolve();
                    }
                }
            );
        });
    }

    subscribeToPingRequests() {
        const subscribe = () => {
            const call = this.client.SubscribeQueue({
                event_type: 'PingRequest',
                consumer_id: this.instanceId,
            });

            console.log('[ShortBus] Subscribed to PingRequest queue');

            call.on('data', async (event) => {
                try {
                    if (!event.payload || !event.payload.value) {
                        console.error('[ShortBus] Invalid event payload');
                        return;
                    }

                    const pingRequest = PingRequest.decode(event.payload.value);
                    
                    console.log(`[ShortBus] Received PingRequest from ${pingRequest.from_service}: ${pingRequest.message}`);

                    await this.publishPingResponse({
                        message: 'Pong from booking-service',
                        timestamp: Date.now(),
                        original_message: pingRequest.message,
                        from_service: 'booking-service',
                    });
                } catch (error) {
                    console.error('[ShortBus] Failed to process PingRequest:', error);
                }
            });

            call.on('error', (error) => {
                console.error('[ShortBus] PingRequest subscription error:', error.message, ', reconnecting...');
                setTimeout(() => subscribe(), 5000);
            });

            call.on('end', () => {
                console.log('[ShortBus] PingRequest subscription ended, reconnecting...');
                setTimeout(() => subscribe(), 5000);
            });
        };

        subscribe();
    }

    subscribeToPingResponses() {
        const subscribe = () => {
            const call = this.client.SubscribeTopic({
                event_type: 'PingResponse',
                subscriber_id: this.instanceId,
            });

            console.log('[ShortBus] Subscribed to PingResponse topic');

            call.on('data', (event) => {
                try {
                    if (!event.payload || !event.payload.value) {
                        return;
                    }

                    const pingResponse = PingResponse.decode(event.payload.value);
                    
                    console.log(`[ShortBus] Received PingResponse from ${pingResponse.from_service}: ${pingResponse.message}`);
                } catch (error) {
                    console.error('[ShortBus] Failed to process PingResponse:', error);
                }
            });

            call.on('error', (error) => {
                console.error('[ShortBus] PingResponse subscription error:', error.message, ', reconnecting...');
                setTimeout(() => subscribe(), 5000);
            });

            call.on('end', () => {
                console.log('[ShortBus] PingResponse subscription ended, reconnecting...');
                setTimeout(() => subscribe(), 5000);
            });
        };

        subscribe();
    }

    async publishPingResponse(response) {
        const payload = PingResponse.encode(response).finish();

        const event = {
            event_type: 'PingResponse',
            payload: {
                type_url: 'type.googleapis.com/events.PingResponse',
                value: payload,
            },
            timestamp: Date.now(),
            correlation_id: '',
            reply_to: '',
        };

        return new Promise((resolve, reject) => {
            this.client.Publish({ event }, (error, response) => {
                if (error) {
                    console.error('[ShortBus] Failed to publish PingResponse:', error.message);
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    async publishBroadcastCabOccupation(occupation) {
        console.log('[ShortBus] Publishing BroadcastCabOccupation with data:', JSON.stringify(occupation));
        
        // Verify message before encoding
        const errMsg = BroadcastCabOccupation.verify(occupation);
        if (errMsg) {
            console.error('[ShortBus] Message verification failed:', errMsg);
        }
        
        const payload = BroadcastCabOccupation.encode(occupation).finish();
        console.log('[ShortBus] Encoded payload length:', payload.length);
        
        // Test decoding to verify
        const decoded = BroadcastCabOccupation.decode(payload);
        console.log('[ShortBus] Decoded test:', JSON.stringify(decoded));

        const event = {
            event_type: 'BroadcastCabOccupation',
            payload: {
                type_url: 'type.googleapis.com/events.BroadcastCabOccupation',
                value: payload,
            },
            timestamp: Date.now().toString(),
            correlation_id: '',
            reply_to: '',
        };

        return new Promise((resolve, reject) => {
            this.client.Publish({ event }, (error, response) => {
                if (error) {
                    console.error('[ShortBus] Failed to publish BroadcastCabOccupation:', error.message);
                    reject(error);
                } else {
                    console.log('[ShortBus] Published BroadcastCabOccupation successfully');
                    resolve();
                }
            });
        });
    }

    startLoadReporting() {
        this.loadReportInterval = setInterval(async () => {
            try {
                const cpuUsage = process.cpuUsage();
                const memUsage = process.memoryUsage();
                
                const totalMem = os.totalmem();
                const freeMem = os.freemem();
                const usedMem = totalMem - freeMem;
                const memPercent = (usedMem / totalMem) * 100;

                // Approximate CPU percentage
                const cpuPercent = ((cpuUsage.user + cpuUsage.system) / 1000000) % 100;

                const loadReport = {
                    service_name: this.serviceName,
                    instance_id: this.instanceId,
                    load: {
                        cpu_percent: cpuPercent,
                        memory_percent: memPercent,
                        timestamp: Date.now(),
                    },
                };

                this.client.ReportLoad(loadReport, (error) => {
                    if (error) {
                        console.error('[ShortBus] Failed to report load:', error.message);
                    }
                });
            } catch (error) {
                console.error('[ShortBus] Error in load reporting:', error);
            }
        }, 5000);
    }
}
