import { Message } from "entities/domain/queue";

export interface IMessageRepository {
  loadMessages(limit: number): Promise<Message[]>;
  saveMessage(message: Message): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  moveToDLQ(message: Message, error: string): Promise<void>;
}
