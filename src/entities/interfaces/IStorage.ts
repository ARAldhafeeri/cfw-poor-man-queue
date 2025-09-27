export interface IStorage {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
  list(options: {
    prefix: string;
  }): Promise<{ objects: Array<{ key: string }> }>;
}
