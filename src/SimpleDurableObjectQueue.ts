import { createQueue } from "./Queue";
import { DurableObject } from "cloudflare:workers";
import { Environment, Message } from "./entities/domain/queue";
import { IQueue } from "./entities/interfaces/IQueue";

/**
 * Durable Object with optimized memory buffering
 */
export class SimpleDurableObjectQueue extends DurableObject {
  private queue: IQueue | null = null;
  private initializationPromise: Promise<void> | null = null;

  constructor(private state: DurableObjectState, public env: Environment) {
    super(state, env);

    this.state.blockConcurrencyWhile(async () => {
      await this.initialize();
    });
  }

  /**
   * intialize queue which will immediatly setTime out
   * for flushing the queue into r2 WAL ( write-ahead log)
   * if buffer size didn't get filled
   * and durable object about to go into hiberation.
   * @returns
   */
  private async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      console.log(
        "Initializing Durable Object queue service with buffering..."
      );
      this.queue = await createQueue(this.env);
      console.log(
        "Durable Object queue service with buffering initialized successfully"
      );
    })();

    return this.initializationPromise;
  }

  /**
   * Fast publish with memory buffering
   */
  async publish(data: any): Promise<any> {
    return this.queue?.publishHandler.handle(data, Date.now());
  }

  async fail(data: any, error: string): Promise<any> {
    return this.queue?.failHandler.handle(data, error);
  }

  async poll(options: {
    limit: number;
    timeout: number;
  }): Promise<{ messages: Message[] | [] }> {
    return {
      messages:
        (await this.queue?.getPoll(options.limit, options.timeout)) || [],
    };
  }

  /**
   * Get stats including buffer information
   */
  async getStats(): Promise<any> {
    return this.queue?.getQueueStats();
  }

  /**
   * Run schedule ( pooling consumtion of messages)
   */
  async runScheduledProcessing(
    handler: (messages: Message[]) => Promise<void> | void
  ): Promise<void> {
    await this.queue?.runScheduledProcessing(handler);
  }
  /**
   * Health check including buffer health
   */
  async getHealth(): Promise<any> {
    try {
      const stats = await this.queue?.getQueueStats();

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
}
