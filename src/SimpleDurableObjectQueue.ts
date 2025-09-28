import { DurableObject } from "cloudflare:workers";
import { IQueueService, QueueService } from "./QueueService";
import { Environment } from "entities/domain/queue";

/**
 * Durable Object with optimized memory buffering
 */
export class SimpleDurableObjectQueue extends DurableObject {
  private queueService: IQueueService | null = null;
  private initializationPromise: Promise<void> | null = null;

  constructor(private state: DurableObjectState, public env: Environment) {
    super(state, env);

    this.state.blockConcurrencyWhile(async () => {
      await this.initialize();
    });
  }

  private async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      console.log("Initializing Durable Object queue service with buffering...");
      this.queueService = new QueueService(this.state, this.env);
      await this.queueService.initialize();
      console.log("Durable Object queue service with buffering initialized successfully");
    })();

    return this.initializationPromise;
  }

  private getQueueService(): IQueueService {
    if (!this.queueService) {
      throw new Error("Queue service not initialized");
    }
    return this.queueService;
  }

  /**
   * Fast publish with memory buffering
   */
  async publish(data: any): Promise<any> {
    return this.getQueueService().publish(data);
  }

  /**
   * Poll messages (automatically flushes buffer first)
   */
  async poll(options: { limit: number; timeout: number }): Promise<any> {
    return this.getQueueService().poll(options);
  }

  async complete(data: { messageId: string }): Promise<any> {
    return this.getQueueService().complete(data.messageId);
  }

  async fail(data: { messageId: string; error: string }): Promise<any> {
    return this.getQueueService().fail(data.messageId, data.error);
  }

  /**
   * Get stats including buffer information
   */
  async getStats(): Promise<any> {
    return this.getQueueService().getStats();
  }

  /**
   * Health check including buffer health
   */
  async getHealth(): Promise<any> {
    return this.getQueueService().getHealth();
  }

  async clear(): Promise<any> {
    return this.getQueueService().clear();
  }

  async debug_reload(): Promise<any> {
    return this.getQueueService().debugReload();
  }

  /**
   * Manual buffer flush endpoint
   */
  async flush_buffer(): Promise<any> {
    return this.getQueueService().flushBuffer();
  }

  /**
   * Scheduled processing (flushes buffer first)
   */
  async runScheduledProcessing(): Promise<void> {
    return this.getQueueService().runScheduledProcessing();
  }
}