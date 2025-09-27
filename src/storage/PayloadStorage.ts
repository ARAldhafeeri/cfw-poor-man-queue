import { IPayloadStorage } from "entities/interfaces/IPayloadStorage";
import { IStorage } from "entities/interfaces/IStorage";

export class PayloadStorage implements IPayloadStorage {
  constructor(private storage: IStorage) {}

  async store(messageId: string, data: any): Promise<void> {
    await this.storage.put(`payloads/${messageId}.json`, JSON.stringify(data));
  }

  async load(messageId: string): Promise<any | null> {
    try {
      const payload = await this.storage.get(`payloads/${messageId}.json`);
      return payload ? JSON.parse(await payload.text()) : null;
    } catch (error) {
      console.error(`Failed to load payload for message ${messageId}:`, error);
      return null;
    }
  }

  async delete(messageId: string): Promise<void> {
    await this.storage.delete(`payloads/${messageId}.json`);
  }
}
