import { OmniGateway } from './server.js';

/**
 * Container/bootstrap entry point: starts the gateway on OMNI_GATEWAY_PORT.
 */
const port = Number(process.env.OMNI_GATEWAY_PORT ?? 7800);
new OmniGateway(port);
