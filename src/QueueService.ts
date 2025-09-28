// QueueService.ts
import { IQueue } from "entities/interfaces/IQueue";
import { createQueue } from "./Queue";
import { Environment } from "entities/domain/queue";

export interface IQueueService {
  initialize(): Promise<void>;
  publish(data: any): Promise<any>;
  poll(options: { limit: number; timeout: number }): Promise<any>;
  complete(messageId: string): Promise<any>;
  fail(messageId: string, error: string): Promise<any>;
  getStats(): Promise<any>;
  getHealth(): Promise<any>;
  clear(): Promise<any>;
  debugReload(): Promise<any>;
  runScheduledProcessing(): Promise<void>;
  flushBuffer(): Promise<any>; // New method for manual buffer flush
}

export class QueueService implements IQueueService {
  private queue: IQueue | null = null;
  private messageBuffer: Map<string, any> = new Map(); // Simple buffer in Durable Object memory

  constructor(private state: DurableObjectState, private env: any) {}

  async initialize(): Promise<void> {
    if (this.queue) return;

    this.queue = await createQueue(this.env);
    console.log(
      "Queue service initialized with underlying queue implementation and buffering"
    );
  }

  private getQueue(): IQueue {
    if (!this.queue) {
      throw new Error("Queue not initialized");
    }
    return this.queue;
  }

  async publish(data: any): Promise<any> {
    const messageId = `msg_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Store in Durable Object memory buffer
    this.messageBuffer.set(messageId, {
      id: messageId,
      data: data,
      timestamp: Date.now(),
      status: "buffered",
    });

    console.log(
      `Message ${messageId} buffered in DO memory (${this.messageBuffer.size} total)`
    );

    // If buffer gets too big, flush some to queue
    if (this.messageBuffer.size > 100) {
      await this.flushSomeMessages();
    }

    return {
      messageId,
      status: "buffered",
      bufferSize: this.messageBuffer.size,
    };
  }

  async poll(options: { limit: number; timeout: number }): Promise<any> {
    // First flush buffered messages to queue
    await this.flushAllMessages();

    const result = await this.getQueue().pollHandler.handle(
      options,
      Date.now()
    );

    console.log(
      `Poll result: ${result.messages?.length || 0} messages returned`
    );
    return result;
  }

  async complete(messageId: string): Promise<any> {
    console.log(`Completing message ${messageId}`);
    const result = await this.getQueue().completeHandler.handle(
      { id: messageId },
      Date.now()
    );

    return result;
  }

  async fail(messageId: string, error: string): Promise<any> {
    console.log(`Failing message ${messageId}: ${error}`);
    const result = await this.getQueue().failHandler.handle(
      { id: messageId, error },
      Date.now()
    );

    return result;
  }

  async getStats(): Promise<any> {
    const stats = await this.getQueue().getQueueStats();

    return {
      bufferSize: this.messageBuffer.size,
      totalIncludingBuffer: stats.totalMessages + this.messageBuffer.size,
      debug: {
        durableObjectId: this.state.id?.toString(),
        timestamp: Date.now(),
      },
    };
  }

  async getHealth(): Promise<any> {
    try {
      const stats = await this.getQueue().getQueueStats();

      return {
        healthy: true,
        initialized: !!this.queue,
        buffering: {
          enabled: true,
          bufferedMessages: stats.bufferedMessages,
          bufferHealthy: stats.memoryUtilization < 0.9, // Warn if > 90%
        },
        ...stats,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: Date.now(),
      };
    }
  }

  async clear(): Promise<any> {
    // Force flush buffer first
    await this.flushBuffer();
    await this.getQueue().forceReload();

    const messages = await this.getQueue().getMessages();
    console.log(`Clearing ${messages.length} messages`);

    for (const message of messages) {
      await this.getQueue().removeMessage(message.id);
    }

    const finalStats = await this.getQueue().getQueueStats();
    console.log(`Queue cleared. Final stats:`, finalStats);

    return {
      success: true,
      message: `Cleared ${messages.length} messages`,
      finalStats,
    };
  }

  async debugReload(): Promise<any> {
    const statsBefore = await this.getQueue().getQueueStats();
    await this.getQueue().forceReload(); // This will flush buffer first
    const statsAfter = await this.getQueue().getQueueStats();

    return {
      success: true,
      statsBefore,
      statsAfter,
      message: "Queue state reloaded from storage (buffer flushed)",
    };
  }

  async flushBuffer(): Promise<any> {
    const bufferSize = this.messageBuffer.size;

    if (bufferSize === 0) {
      return { success: true, message: "Buffer already empty" };
    }

    await this.flushAllMessages();

    return {
      success: true,
      message: `Flushed ${bufferSize} messages from DO buffer to queue`,
    };
  }

  /**
   * Flush all buffered messages to the queue
   */
  private async flushAllMessages(): Promise<void> {
    if (this.messageBuffer.size === 0) return;

    console.log(`Flushing ${this.messageBuffer.size} messages from DO buffer`);

    for (const [messageId, messageData] of this.messageBuffer.entries()) {
      try {
        await this.getQueue().publishHandler.handle(
          messageData.data,
          Date.now()
        );
        this.messageBuffer.delete(messageId);
      } catch (error) {
        console.error(`Failed to flush message ${messageId}:`, error);
      }
    }

    console.log("All messages flushed from DO buffer");
  }

  /**
   * Flush some messages when buffer gets full
   */
  private async flushSomeMessages(): Promise<void> {
    const toFlush = Math.min(50, this.messageBuffer.size); // Flush 50 messages max
    let flushed = 0;

    for (const [messageId, messageData] of this.messageBuffer.entries()) {
      if (flushed >= toFlush) break;

      try {
        await this.getQueue().publishHandler.handle(
          messageData.data,
          Date.now()
        );
        this.messageBuffer.delete(messageId);
        flushed++;
      } catch (error) {
        console.error(`Failed to flush message ${messageId}:`, error);
      }
    }

    console.log(`Flushed ${flushed} messages from DO buffer`);
  }

  async runScheduledProcessing(): Promise<void> {
    const startTime = Date.now();
    const maxDuration = 25000;

    try {
      console.log("Running scheduled processing...");

      // First flush all buffered messages
      await this.flushAllMessages();

      let processedCount = 0;
      let errorCount = 0;

      while (Date.now() - startTime < maxDuration) {
        const stats = await this.getQueue().getQueueStats();

        if (stats.availableMessages === 0) {
          console.log("No more available messages");
          break;
        }

        const result = await this.getQueue().pollHandler.handle(
          {
            limit: parseInt(this.env.MAX_BATCH_SIZE || "10"),
            timeout: 5000,
          },
          Date.now()
        );

        if (!result.messages || result.messages.length === 0) {
          break;
        }

        for (const message of result.messages) {
          try {
            await this.getQueue().completeHandler.handle(
              { id: message.id },
              Date.now()
            );
            processedCount++;
          } catch (error) {
            console.error(`Message ${message.id} failed:`, error);
            await this.getQueue().failHandler.handle(
              {
                id: message.id,
                error:
                  error instanceof Error ? error.message : "Processing error",
              },
              Date.now()
            );
            errorCount++;
          }
        }

        if (Date.now() - startTime > maxDuration - 5000) {
          break;
        }
      }

      console.log(
        `Processed: ${processedCount}, Errors: ${errorCount} in ${
          Date.now() - startTime
        }ms`
      );
    } catch (error) {
      console.error("Scheduled processing error:", error);
    }
  }
}
