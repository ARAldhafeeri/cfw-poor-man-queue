import { Message } from "entities/domain/queue";

export interface IMemoryManager {
  addMessage(message: Message): void;
  removeMessage(messageId: string, size: number): void;
  canAccommodate(size: number): boolean;
  getCurrentUsage(): number;
  getUtilization(): number;
  setUsage(usage: number): void;
  recalculateFromMessages(messages: Message[]): void;
}
