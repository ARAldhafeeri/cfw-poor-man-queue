import { Message } from "entities/domain/queue";
import { IMessageRepository } from "entities/interfaces/IMessageRepository";
import { IStorage } from "entities/interfaces/IStorage";

export class MessageRepository implements IMessageRepository {
  constructor(
    private storage: IStorage,
    private payloadCalculator: (data: any) => number
  ) {}

  async loadMessages(limit: number): Promise<Message[]> {
    try {
      const objects = await this.storage.list({ prefix: "messages/" });
      const messages = await Promise.all(
        objects.objects.slice(0, 1000).map(async (obj) => {
          try {
            const content = await this.storage.get(obj.key);
            if (content) {
              return JSON.parse(await content.text()) as Message;
            }
          } catch (error) {
            console.error(`Failed to load message ${obj.key}:`, error);
          }
          return null;
        })
      );

      return messages.filter(Boolean) as Message[];
    } catch (error) {
      console.error("Load messages error:", error);
      return [];
    }
  }

  async saveMessage(message: Message): Promise<void> {
    const metadata = {
      id: message.id,
      retries: message.retries,
      nextRetry: message.nextRetry,
      createdAt: message.createdAt,
      size: message.size,
      isLarge: message.isLarge,
      data: message.isLarge ? null : message.data,
    };

    await this.storage.put(
      `messages/${message.id}.json`,
      JSON.stringify(metadata)
    );
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.storage.delete(`messages/${messageId}.json`);
  }

  async moveToDLQ(message: Message, error: string): Promise<void> {
    const dlqMessage = {
      ...message,
      error,
      failedAt: Date.now(),
      data: message.isLarge
        ? `[Large payload stored separately: payloads/${message.id}.json]`
        : message.data,
    };
    await this.storage.put(
      `dlq/${message.id}.json`,
      JSON.stringify(dlqMessage)
    );
  }
}
