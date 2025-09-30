import { IStorage } from "entities/interfaces/IStorage";

export class R2StorageAdapter implements IStorage {
  constructor(private r2Bucket: R2Bucket) {}

  async put(key: string, value: any): Promise<void> {
    await this.r2Bucket.put(key, value);
  }

  async get(key: string): Promise<{ text(): Promise<string> } | null> {
    return await this.r2Bucket.get(key);
  }

  async delete(key: string): Promise<void> {
    await this.r2Bucket.delete(key);
  }

  async list(options: {
    prefix: string;
    limit?: number;
  }): Promise<{ objects: Array<{ key: string }> }> {
    // return with limits
    if (options.limit && typeof options.limit === "number") {
      return this.r2Bucket.list({
        prefix: options.prefix,
        limit: options.limit,
      });
    }
    // return all
    return this.r2Bucket.list({ prefix: options.prefix });
  }
}
