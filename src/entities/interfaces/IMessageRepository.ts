import { Message } from "entities/domain/queue";

export interface IMessageRepository {
  loadMessages(limit: number): Promise<{ messages: Message[] }>;
  saveMessagesBatch(message: Message[]): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  moveToDLQ(message: Message, error: string): Promise<void>;
  popBatch(): Promise<Message[]>;
  requeueMessage(message: Message): Promise<void>;
}
