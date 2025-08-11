import { initElectronRouter } from './electron.router';
import { handleIncomingRequest } from './message-channel-http-adapter';

const { createAppRequestHandler, url } = initElectronRouter();

const requestHandler = createAppRequestHandler();
let communicationPort: Electron.MessagePortMain | null = null;

process.parentPort.on('message', e => {
  const { type } = e.data;
  if (type === 'init') {
    // Store the communication port from the init message
    communicationPort = e.ports[0];
    console.log('Router process initialized with communication port');
    process.parentPort.postMessage({ type: 'url', url });
  } else if (type === 'request') {
    if (!communicationPort) {
      process.parentPort.postMessage({
        type: 'error',
        error: 'Communication port not set up',
      });
      return;
    }

    // Create a synthetic event with the stored port
    const syntheticEvent: Electron.MessageEvent = {
      data: e.data,
      ports: [communicationPort],
    };

    handleIncomingRequest(syntheticEvent, requestHandler).catch(err => {
      if (!communicationPort) {
        process.parentPort.postMessage({
          type: 'error',
          error: 'Communication port not set up',
        });
        process.exit(1);
      }

      communicationPort.postMessage({ type: 'error', error: String(err) });
    });
  }
});
