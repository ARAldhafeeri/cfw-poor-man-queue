export interface IStorage {
  put(key: string, value: any): Promise<void>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
  list(options: {
    prefix: string;
    limit?: number;
  }): Promise<{ objects: Array<{ key: string }> }>;
}
