import { Message } from "../entities/domain/queue";
import { IMessageRepository } from "../entities/interfaces/IMessageRepository";
import { IStorage } from "../entities/interfaces/IStorage";

export class MessageRepository implements IMessageRepository {
  constructor(
    private dependencies: {
      storage: IStorage;
      walStorageName: string;
      deadLetterQueueName: string;
    }
  ) {}

  async loadMessages(limit: number): Promise<{ messages: Message[] }> {
    console.log("limit", this.dependencies.walStorageName);
    try {
      const objects = await this.dependencies.storage.list({
        prefix: this.dependencies.walStorageName,
        limit: limit,
      });

      const batchResults = await Promise.all(
        objects.objects.slice(0, limit).map(async (obj) => {
          try {
            const content = await this.dependencies.storage.get(obj.key);
            if (content) {
              const batchData = JSON.parse(await content.text());
              // Return the messages array from the batch, not the whole batch object
              return batchData.messages || [];
            }
          } catch (error) {
            console.error(`Failed to load message ${obj.key}:`, error);
          }
          return []; // Return empty array on error
        })
      );

      const allMessages = batchResults.flat();
      return { messages: allMessages };
    } catch (error) {
      console.error("Load messages error:", error);
      return { messages: [] };
    }
  }

  async saveMessagesBatch(messages: Message[]): Promise<void> {
    const timestamp = Date.now();
    const batchKey = `${this.dependencies.walStorageName}/batch_${timestamp}.json`;

    const batchData = {
      batchId: batchKey,
      timestamp: timestamp,
      messageCount: messages.length,
      messages: messages,
    };

    await this.dependencies.storage.put(batchKey, JSON.stringify(batchData));
  }

  // TODO delete batch

  async deleteMessage(messageId: string): Promise<void> {
    await this.dependencies.storage.delete(`messages/${messageId}.json`);
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
    await this.dependencies.storage.put(
      `${this.dependencies.deadLetterQueueName}/${message.id}.json`,
      JSON.stringify(dlqMessage)
    );
  }

  /**
   * Pop single message from dead letter queue
   * TODO: maybe some piority stuff via meta data & r2-SQL
   * As cloudflare recently added r2-SQL.
   */
  async popMessageFromDLQ(): Promise<Message | null> {
    try {
      const objects = await this.dependencies.storage.list({
        prefix: this.dependencies.deadLetterQueueName,
        limit: 1,
      });

      if (objects.objects.length === 0) {
        return null; // Queue is empty
      }

      const oldestMessage = objects.objects[0];
      const content = await this.dependencies.storage.get(oldestMessage.key);

      if (!content) {
        return null;
      }

      const message = JSON.parse(await content.text());

      // Delete the batch from storage
      await this.dependencies.storage.delete(oldestMessage.key);

      return message;
    } catch (error) {
      console.error("Pop batch error:", error);
      return null;
    }
  }

  /**
   * Pop an entire batch from the WAL (FIFO queue behavior)
   * Returns all messages from the oldest batch and removes it from storage
   */
  async popBatch(): Promise<Message[]> {
    try {
      const objects = await this.dependencies.storage.list({
        prefix: this.dependencies.walStorageName,
        limit: 1,
      });

      if (objects.objects.length === 0) {
        return []; // Queue is empty
      }

      const oldestBatch = objects.objects[0];
      const content = await this.dependencies.storage.get(oldestBatch.key);

      if (!content) {
        return [];
      }

      const batchData = JSON.parse(await content.text());

      // Delete the batch from storage
      await this.dependencies.storage.delete(oldestBatch.key);

      // Return all messages from the batch
      if (batchData.messages && Array.isArray(batchData.messages)) {
        return batchData.messages;
      }

      // If it's a single message (not in batch format), wrap it in array
      return [batchData as Message];
    } catch (error) {
      console.error("Pop batch error:", error);
      return [];
    }
  }

  /**
   * Requeue a message for retry with updated retry information
   */
  async requeueMessage(message: Message): Promise<void> {
    try {
      // Save as a single-message batch with timestamp ensuring it's processed later
      const retryTimestamp = Date.now();
      const batchKey = `${this.dependencies.walStorageName}/batch_${retryTimestamp}_retry_${message.id}.json`;

      const batchData = {
        batchId: batchKey,
        timestamp: retryTimestamp,
        messageCount: 1,
        messages: [message],
        isRetryBatch: true,
      };

      await this.dependencies.storage.put(batchKey, JSON.stringify(batchData));
    } catch (error) {
      console.error(`Failed to requeue message ${message.id}:`, error);
      throw error;
    }
  }
}
