import { OmniGateway } from './server.js';
import { ConfigStore } from './config-store.js';

async function main() {
  const port = Number(process.env.OMNI_GATEWAY_PORT ?? 7800);
  const host = process.env.OMNI_GATEWAY_HOST ?? '127.0.0.1';

  const store = new ConfigStore();
  await store.initialize();

  const cfg = store.get();
  console.log('[Gateway] silnik=' + cfg.provider + ' model=' + cfg.model +
    ' klucz_openrouter=' + (store.hasOpenRouterKey() ? 'tak' : 'nie'));

  new OmniGateway(port, host, store);
}

main().catch((error) => {
  console.error('[Gateway] Blad startu:', error);
  process.exit(1);
});
