import { database } from '../common/database';
import type { BaseModel } from '.';

export const name = 'WebSocket Request';

export const type = 'WebSocketRequest';

export const prefix = 'ws-req';

export const canDuplicate = true;

export const canSync = false;

export interface BaseWebSocketRequest {
  name: string;
  url: string;
  metaSortKey: number;
}

export type WebSocketRequest = BaseModel & BaseWebSocketRequest & { type: typeof type };

export const isWebSocketRequest = (model: Pick<BaseModel, 'type'>): model is WebSocketRequest => (
  model.type === type
);

export const init = (): BaseWebSocketRequest => ({
  name: 'New WebSocket Request',
  url: '',
  metaSortKey: -1 * Date.now(),
});

export const migrate = (doc: WebSocketRequest) => doc;

export const create = (patch: Partial<WebSocketRequest> = {}) => {
  if (!patch.parentId) {
    throw new Error(`New WebSocketRequest missing \`parentId\`: ${JSON.stringify(patch)}`);
  }

  return database.docCreate<WebSocketRequest>(type, patch);
};

export const remove = (obj: WebSocketRequest) => database.remove(obj);

export const update = (
  obj: WebSocketRequest,
  patch: Partial<WebSocketRequest> = {}
) => database.docUpdate(obj, patch);

export const getById = (_id: string) => database.getWhere<WebSocketRequest>(type, { _id });

export const all = () => database.all<WebSocketRequest>(type);