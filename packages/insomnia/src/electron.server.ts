// electron-api-adapter.ts
import { randomUUID } from 'node:crypto';

import type * as Electron from 'electron';

interface ElectronApiRequest {
  type: 'electron-api-request';
  id: string;
  method: string;
  args: any[];
}
interface ElectronApiResponse {
  type: 'electron-api-response';
  id: string;
  result?: any;
  error?: string;
}

const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: any) => void }>();

// Listen for responses from main process
process.parentPort.on('message', (msg: Electron.MessageEvent) => {
  if (msg.data.type === 'electron-api-response') {
    const { id, result, error } = msg.data as ElectronApiResponse;
    const handlers = pending.get(id);
    if (!handlers) return;
    error ? handlers.reject(new Error(error)) : handlers.resolve(result);
    pending.delete(id);
  }
});

// Expose a recursive IPC proxy so any nested Electron API can be called
const electron = (() => {
  const createProxy = (path: string[]): any =>
    new Proxy(() => {}, {
      get(_, prop: string) {
        return createProxy([...path, prop.toString()]);
      },
      apply(_, __, args: any[]) {
        const id = randomUUID();
        const method = path.join('.');
        process.parentPort.postMessage({
          type: 'electron-api-request',
          id,
          method,
          args,
        } as ElectronApiRequest);
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
        });
      },
    });
  return createProxy([]);
})();

export default electron as typeof Electron;
