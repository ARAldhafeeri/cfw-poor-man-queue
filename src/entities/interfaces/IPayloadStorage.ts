export interface IPayloadStorage {
  store(messageId: string, data: any): Promise<void>;
  load(messageId: string): Promise<any | null>;
  delete(messageId: string): Promise<void>;
}
