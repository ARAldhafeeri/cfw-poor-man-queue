import { DurableObject } from "cloudflare:workers";
import { IQueueService, QueueService } from "./QueueService";
import { Environment } from "entities/domain/queue";

/**
 * Durable Object acts as the coordination layer, not the implementation
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
      console.log("Initializing Durable Object queue service...");
      this.queueService = new QueueService(this.state, this.env);
      await this.queueService.initialize();
      console.log("Durable Object queue service initialized successfully");
    })();

    return this.initializationPromise;
  }

  private getQueueService(): IQueueService {
    if (!this.queueService) {
      throw new Error("Queue service not initialized");
    }
    return this.queueService;
  }

  async publish(data: any): Promise<any> {
    return this.getQueueService().publish(data);
  }

  async poll(options: { limit: number; timeout: number }): Promise<any> {
    return this.getQueueService().poll(options);
  }

  async complete(data: { messageId: string }): Promise<any> {
    return this.getQueueService().complete(data.messageId);
  }

  async fail(data: { messageId: string; error: string }): Promise<any> {
    return this.getQueueService().fail(data.messageId, data.error);
  }

  async getStats(): Promise<any> {
    return this.getQueueService().getStats();
  }

  async getHealth(): Promise<any> {
    return this.getQueueService().getHealth();
  }

  async clear(): Promise<any> {
    return this.getQueueService().clear();
  }

  async debug_reload(): Promise<any> {
    return this.getQueueService().debugReload();
  }

  async runScheduledProcessing(): Promise<void> {
    return this.getQueueService().runScheduledProcessing();
  }
}
