import assert from 'node:assert';
import path from 'node:path';
import { styleText } from 'node:util';

import type { UtilityProcess } from 'electron';
import * as electron from 'electron';
import { app, dialog, MessageChannelMain, utilityProcess } from 'electron';

import { sendRequestViaUtilityProcess } from './message-channel-http-adapter';

// Type definitions for message types
interface ElectronApiRequest {
  type: 'electron-api-request';
  id: string;
  method: string;
  args: unknown[];
}

interface ElectronApiResponse {
  type: 'electron-api-response';
  id: string;
  result?: unknown;
  error?: string;
}

interface UrlMessage {
  type: 'url';
  url: string;
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

interface InitMessage {
  type: 'init';
}

type RouterMessage = ElectronApiRequest | ElectronApiResponse | UrlMessage | ErrorMessage | InitMessage;

// Type-safe function to check if a value is a function
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

// Type-safe function to check if an object has a property
function hasProperty(obj: unknown, prop: string): obj is Record<string, unknown> {
  return obj !== null && typeof obj === 'object' && prop in obj;
}

const ROUTER_PROCESS_LOG = styleText('bgGray', ' Router Process ');

class RouterProcess {
  routerProcess: UtilityProcess | null = null;
  messageChannel: MessageChannelMain | null = null;
  url = '';
  appExited = false;

  async init() {
    if (this.routerProcess) {
      console.warn(ROUTER_PROCESS_LOG, 'Router process is already running.');
      return { url: this.url };
    }

    this.routerProcess = utilityProcess.fork(path.join(__dirname, 'router-process.js'), undefined, {
      env: process.env,
      serviceName: 'electron-router',
      stdio: 'pipe',
    });

    // Create the message channel once during initialization
    this.messageChannel = new MessageChannelMain();

    this.attachListeners();

    return this.start();
  }

  async start(): Promise<{ url: string }> {
    if (!this.routerProcess) {
      throw new Error('Router process is not initialized.');
    }

    assert(this.messageChannel, 'Message channel is not initialized.');
    // Send init message with the port2 for communication
    this.routerProcess.postMessage({ type: 'init' }, [this.messageChannel.port2]);

    return new Promise((resolve, reject) => {
      assert(this.routerProcess, 'Router process is not initialized.');
      this.routerProcess.on('message', (msg: RouterMessage) => {
        // Handle utility-process API proxy requests
        if (msg.type === 'electron-api-request') {
          const { id, method, args } = msg;
          this.handleElectronApiRequest(id, method, args);
          return;
        }

        if (msg.type === 'url') {
          this.url = msg.url;
          // When we get the url, we know the port setup was successful
          resolve({ url: this.url });
        } else if (msg.type === 'error') {
          console.error(ROUTER_PROCESS_LOG, 'Error:', msg.error);
          reject(new Error(msg.error));
        }
      });
    });
  }

  private handleElectronApiRequest(id: string, method: string, args: unknown[]): void {
    // Traverse nested API path with proper type safety
    const parts = method.split('.');
    let target: unknown = electron;
    let func: unknown = electron;

    for (const part of parts) {
      if (!hasProperty(func, part)) {
        assert(this.routerProcess, 'Router process is not initialized.');
        this.routerProcess.postMessage({
          type: 'electron-api-response',
          id,
          error: `Method not found: ${method}`,
        } satisfies ElectronApiResponse);
        return;
      }
      target = func;
      func = func[part];
    }

    if (!isFunction(func)) {
      assert(this.routerProcess, 'Router process is not initialized.');
      this.routerProcess.postMessage({
        type: 'electron-api-response',
        id,
        error: `${method} is not a function`,
      } satisfies ElectronApiResponse);
      return;
    }

    try {
      // TypeScript knows func is a Function here due to the type guard
      const resultOrPromise = func.apply(target, args);

      // Check if result is a Promise
      if (
        resultOrPromise &&
        typeof resultOrPromise === 'object' &&
        'then' in resultOrPromise &&
        typeof resultOrPromise.then === 'function'
      ) {
        (resultOrPromise as Promise<unknown>)
          .then((res: unknown) => {
            assert(this.routerProcess, 'Router process is not initialized.');
            this.routerProcess.postMessage({
              type: 'electron-api-response',
              id,
              result: res,
            } satisfies ElectronApiResponse);
          })
          .catch((err: unknown) => {
            assert(this.routerProcess, 'Router process is not initialized.');
            this.routerProcess.postMessage({
              type: 'electron-api-response',
              id,
              error: String(err),
            } satisfies ElectronApiResponse);
          });
      } else {
        assert(this.routerProcess, 'Router process is not initialized.');
        this.routerProcess.postMessage({
          type: 'electron-api-response',
          id,
          result: resultOrPromise,
        } satisfies ElectronApiResponse);
      }
    } catch (error) {
      assert(this.routerProcess, 'Router process is not initialized.');
      this.routerProcess.postMessage({
        type: 'electron-api-response',
        id,
        error: String(error),
      } satisfies ElectronApiResponse);
    }
  }

  attachListeners() {
    assert(this.routerProcess, 'Router process is not initialized.');
    assert(this.routerProcess.stderr, 'Router process stderr is not initialized.');
    assert(this.routerProcess.stdout, 'Router process stdout is not initialized.');

    this.routerProcess.stderr.on('data', data => {
      console.error(ROUTER_PROCESS_LOG, 'Router process stderr:', data.toString());
    });

    this.routerProcess.on('error', err => {
      console.error(ROUTER_PROCESS_LOG, 'Router process error:', err);
    });

    this.routerProcess.stdout.on('data', data => {
      console.log(ROUTER_PROCESS_LOG, 'Router process stdout:', data.toString());
    });

    app.on('before-quit', () => {
      console.warn(ROUTER_PROCESS_LOG, 'App is exiting, terminating router process...');
      this.appExited = true;
      if (this.routerProcess) {
        this.routerProcess.kill();
        this.routerProcess = null;
      }
      if (this.messageChannel) {
        this.messageChannel.port1.close();
        this.messageChannel.port2.close();
        this.messageChannel = null;
      }
    });

    this.routerProcess.on('exit', async code => {
      console.error(ROUTER_PROCESS_LOG, 'Router process exited with code:', code);
      this.routerProcess = null;
      this.messageChannel = null; // Clear the message channel when process exits
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (this.appExited) {
      console.warn(ROUTER_PROCESS_LOG, 'App has exited, cannot send request.');
      return new Response('App has exited, cannot send request.', {
        status: 500,
      });
    }

    if (!this.routerProcess) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'An unexpected error occurred',
        buttons: ['Restart the app'],
        message: 'An unexpected error occured. Please share this with the developers.',
      });

      await this.init();
    }

    // If message channel is null, recreate it and reinitialize the router process
    if (!this.messageChannel) {
      console.warn(ROUTER_PROCESS_LOG, 'Message channel is null, reinitializing router process.');
      await this.init();
    }

    try {
      assert(this.routerProcess, 'Router process is not initialized.');
      assert(this.messageChannel, 'Message channel is not initialized.');

      return sendRequestViaUtilityProcess(this.routerProcess, request, this.messageChannel.port1);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new Response(`Error sending request: ${errorMessage}`, {
        status: 500,
      });
    }
  }
}

const routerProcess = new RouterProcess();

export { routerProcess };
