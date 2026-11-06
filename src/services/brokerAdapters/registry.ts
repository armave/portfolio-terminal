import type { BrokerAdapter, BrokerProviderId } from '../../types/broker';
import { freedomTradeNetBrokerAdapter } from './freedomTradeNetAdapter';

export interface BrokerAdapterRegistry {
  get(provider: BrokerProviderId): BrokerAdapter;
  list(): BrokerAdapter[];
  register(adapter: BrokerAdapter): () => void;
}

export function createBrokerAdapterRegistry(
  initialAdapters: readonly BrokerAdapter[] = []
): BrokerAdapterRegistry {
  const adapters = new Map<BrokerProviderId, BrokerAdapter>();

  const register = (adapter: BrokerAdapter): (() => void) => {
    if (adapters.has(adapter.provider)) {
      throw new Error(`A broker adapter is already registered for "${adapter.provider}".`);
    }
    adapters.set(adapter.provider, adapter);
    return () => {
      if (adapters.get(adapter.provider) === adapter) adapters.delete(adapter.provider);
    };
  };

  initialAdapters.forEach(register);

  return {
    get(provider) {
      const adapter = adapters.get(provider);
      if (!adapter) throw new Error(`No broker adapter is registered for "${provider}".`);
      return adapter;
    },
    list() {
      return [...adapters.values()];
    },
    register
  };
}

export const brokerAdapterRegistry = createBrokerAdapterRegistry([
  freedomTradeNetBrokerAdapter
]);
