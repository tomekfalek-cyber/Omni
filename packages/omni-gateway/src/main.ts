import { OmniGateway } from './server.js';

/**
 * Container/bootstrap entry point: starts the gateway on OMNI_GATEWAY_PORT.
 */
const port = Number(process.env.OMNI_GATEWAY_PORT ?? 7800);
const host = process.env.OMNI_GATEWAY_HOST ?? '127.0.0.1';
new OmniGateway(port, host);
