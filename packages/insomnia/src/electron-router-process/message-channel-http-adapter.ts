interface RequestInitWithDuplex extends RequestInit {
  // This is used to indicate that the request body will be sent in chunks.
  // https://fetch.spec.whatwg.org/#dom-requestinit-duplex
  duplex?: 'half';
}

interface SerializableRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface SerializableResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

interface ProtocolRequest {
  type: 'request';
  request: SerializableRequest;
  requestId: string;
}

interface ProtocolResponse {
  type: 'response';
  response: SerializableResponse;
  requestId: string;
}

interface ProtocolBodyChunk {
  type: 'body-chunk';
  chunk: Uint8Array;
  requestId: string;
}

interface ProtocolBodyEnd {
  type: 'body-end';
  requestId: string;
}

interface ProtocolError {
  type: 'error';
  error: string;
  requestId: string;
}

type ProtocolMessage = ProtocolRequest | ProtocolResponse | ProtocolBodyChunk | ProtocolBodyEnd | ProtocolError;

function serializeRequest(request: Request): SerializableRequest {
  return {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
  };
}

function serializeResponse(response: Response): SerializableResponse {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

function streamBodyToPort(
  body: ReadableStream<Uint8Array> | null,
  port: Electron.MessagePortMain,
  requestId: string,
): void {
  if (!body) {
    port.postMessage({ type: 'body-end', requestId } satisfies ProtocolBodyEnd);
    return;
  }
  const reader = body.getReader();

  function pump() {
    reader
      .read()
      .then(({ done, value }) => {
        if (done) {
          port.postMessage({
            type: 'body-end',
            requestId,
          } satisfies ProtocolBodyEnd);
          return;
        }
        port.postMessage({
          type: 'body-chunk',
          chunk: value,
          requestId,
        } satisfies ProtocolBodyChunk);
        pump();
      })
      .catch(err => {
        port.postMessage({
          type: 'error',
          error: String(err),
          requestId,
        } satisfies ProtocolError);
      });
  }
  pump();
  // Ensure the port is ready to receive messages
  port.start();
}

/**
 * Port event manager for handling multiple concurrent requests
 */
class PortEventManager {
  private port: Electron.MessagePortMain;
  private activeStreams: Map<string, (msg: ProtocolMessage) => void>;
  private activeRequests: Map<string, (msg: ProtocolMessage) => void>;
  private listenerAttached: boolean;

  constructor(port: Electron.MessagePortMain) {
    this.port = port;
    this.activeStreams = new Map();
    this.activeRequests = new Map();
    this.listenerAttached = false;
  }

  ensureListener(): void {
    if (!this.listenerAttached) {
      this.port.on('message', this.handleMessage.bind(this));
      this.port.start();
      this.listenerAttached = true;
    }
  }

  handleMessage(event: any): void {
    const msg = event.data || event;
    const requestId = msg.requestId;

    if (!requestId) return;

    // Handle stream body messages
    const streamHandler = this.activeStreams.get(requestId);
    if (streamHandler && (msg.type === 'body-chunk' || msg.type === 'body-end' || msg.type === 'error')) {
      streamHandler(msg);
      if (msg.type === 'body-end' || msg.type === 'error') {
        this.activeStreams.delete(requestId);
      }
      return;
    }

    // Handle request/response messages
    const requestHandler = this.activeRequests.get(requestId);
    if (requestHandler && (msg.type === 'response' || msg.type === 'error')) {
      requestHandler(msg);
      this.activeRequests.delete(requestId);
      return;
    }
  }

  registerStreamHandler(requestId: string, handler: (msg: ProtocolMessage) => void): void {
    this.ensureListener();
    this.activeStreams.set(requestId, handler);
  }

  registerRequestHandler(requestId: string, handler: (msg: ProtocolMessage) => void): void {
    this.ensureListener();
    this.activeRequests.set(requestId, handler);
  }

  cleanup(requestId: string): void {
    this.activeStreams.delete(requestId);
    this.activeRequests.delete(requestId);
  }
}

// Global port managers to reuse event listeners
const portManagers = new WeakMap<Electron.MessagePortMain, PortEventManager>();

function getPortManager(port: Electron.MessagePortMain): PortEventManager {
  if (!portManagers.has(port)) {
    portManagers.set(port, new PortEventManager(port));
  }
  const portManager = portManagers.get(port);

  if (!portManager) {
    throw new Error('Port manager not found for the provided port.');
  }

  return portManager;
}

function receiveBodyFromPort(port: Electron.MessagePortMain, requestId: string): ReadableStream<Uint8Array> {
  const manager = getPortManager(port);

  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;

      manager.registerStreamHandler(requestId, (msg: ProtocolMessage) => {
        if (msg.type === 'body-chunk') {
          try {
            controller.enqueue(new Uint8Array(msg.chunk));
          } catch (err) {
            controller.error(new Error(`Failed to enqueue body chunk: ${(err as Error).message}`));
            manager.cleanup(requestId);
          }
        } else if (msg.type === 'body-end') {
          try {
            controller.close();
          } catch (err) {
            controller.error(new Error(`Failed to close stream: ${(err as Error).message}`));
          }
          manager.cleanup(requestId);
        } else if (msg.type === 'error') {
          controller.error(new Error(msg.error));
          manager.cleanup(requestId);
        }
      });
    },
  });

  return stream;
}

export async function handleIncomingRequest(
  event: Electron.MessageEvent,
  onRequest: (request: Request) => Promise<Response>,
): Promise<void> {
  const port = event.ports[0];
  if (!port) {
    throw new Error('No message port provided');
  }

  const msg = event.data;
  if (msg.type !== 'request') {
    throw new Error(`Unexpected message type: ${msg.type}`);
  }

  const requestId = msg.requestId;
  if (!requestId) {
    throw new Error('No request ID provided');
  }

  try {
    const reqInit: RequestInitWithDuplex = {
      method: msg.request.method,
      headers: msg.request.headers,
    };

    if (reqInit.method !== 'GET' && reqInit.method !== 'HEAD') {
      reqInit.body = receiveBodyFromPort(port, requestId);
      reqInit.duplex = 'half'; // Indicate that the request body is readable
    }

    const request = new Request(msg.request.url, reqInit);

    const response = await onRequest(request);

    port.postMessage({
      type: 'response',
      response: serializeResponse(response),
      requestId,
    } satisfies ProtocolResponse);

    streamBodyToPort(response.body, port, requestId);
  } catch (err) {
    port.postMessage({
      type: 'error',
      error: String(err),
      requestId,
    } satisfies ProtocolError);
  }
}

export async function sendRequestViaUtilityProcess(
  utilityProcess: {
    postMessage: (msg: ProtocolMessage, ports?: Electron.MessagePortMain[]) => void;
  },
  request: Request,
  port: Electron.MessagePortMain,
): Promise<Response> {
  return await new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const serializable = serializeRequest(request);
    const manager = getPortManager(port);

    utilityProcess.postMessage({
      type: 'request',
      request: serializable,
      requestId,
    } satisfies ProtocolRequest);

    streamBodyToPort(request.body, port, requestId);
    const body = receiveBodyFromPort(port, requestId);

    manager.registerRequestHandler(requestId, (msg: ProtocolMessage) => {
      if (msg.type === 'response') {
        const response = new Response(body, {
          status: msg.response.status,
          statusText: msg.response.statusText,
          headers: msg.response.headers,
        });
        resolve(response);
      } else if (msg.type === 'error') {
        reject(new Error(msg.error));
      }
    });
  });
}
