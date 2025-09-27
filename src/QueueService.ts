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
}

export class QueueService implements IQueueService {
  private queue: IQueue | null = null;

  constructor(private state: DurableObjectState, private env: any) {}

  async initialize(): Promise<void> {
    if (this.queue) return;

    this.queue = await createQueue(this.env);
    console.log(
      "Queue service initialized with underlying queue implementation"
    );
  }

  private getQueue(): IQueue {
    if (!this.queue) {
      throw new Error("Queue not initialized");
    }
    return this.queue;
  }

  async publish(data: any): Promise<any> {
    const result = await this.getQueue().publishHandler.handle(
      data,
      Date.now()
    );

    const stats = await this.getQueue().getQueueStats();
    console.log(`Published message. Queue stats:`, stats);

    return result;
  }

  async poll(options: { limit: number; timeout: number }): Promise<any> {
    const statsBefore = await this.getQueue().getQueueStats();
    console.log(`Polling messages. Queue stats before:`, statsBefore);

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

    const stats = await this.getQueue().getQueueStats();
    console.log(`Completed message ${messageId}. Queue stats:`, stats);

    return result;
  }

  async fail(messageId: string, error: string): Promise<any> {
    console.log(`Failing message ${messageId}: ${error}`);
    const result = await this.getQueue().failHandler.handle(
      { id: messageId, error },
      Date.now()
    );

    const stats = await this.getQueue().getQueueStats();
    console.log(`Failed message ${messageId}. Queue stats:`, stats);

    return result;
  }

  async getStats(): Promise<any> {
    const stats = await this.getQueue().getQueueStats();

    return {
      ...stats,
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
    await this.getQueue().forceReload();
    const statsAfter = await this.getQueue().getQueueStats();

    return {
      success: true,
      statsBefore,
      statsAfter,
      message: "Queue state reloaded from storage",
    };
  }

  async runScheduledProcessing(): Promise<void> {
    const startTime = Date.now();
    const maxDuration = 25000;

    try {
      console.log("Running scheduled processing in Queue Service...");

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

        console.log(`Processing batch of ${result.messages.length} messages`);

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
          console.log("Approaching time limit, stopping processing");
          break;
        }
      }

      const finalStats = await this.getQueue().getQueueStats();
      console.log(
        `Scheduled processing completed: ${processedCount} processed, ${errorCount} errors in ${
          Date.now() - startTime
        }ms. Final stats:`,
        finalStats
      );
    } catch (error) {
      console.error("Scheduled processing error:", error);
    }
  }
}
