import { IMemoryManager } from "entities/interfaces/IMemoryManager";
import {
  HealthStatus,
  Message,
  QueueLimits,
  QueueStats,
} from "entities/domain/queue";
import { IQueue } from "Queue";

export class QueueStatsService {
  constructor(
    private queue: IQueue, // Reference to queue
    private memoryManager: IMemoryManager,
    private limits: QueueLimits
  ) {}

  async getStats(): Promise<QueueStats> {
    const messages = await this.queue.getMessages();
    const processing = await this.queue.getProcessing();
    const now = Date.now();

    return {
      total: messages.length,
      processing: processing.size,
      ready: messages.filter(
        (message: Message) =>
          !processing.has(message.id) && (message.nextRetry || 0) <= now
      ).length,
      retrying: messages.filter(
        (message) =>
          !processing.has(message.id) && (message.nextRetry || 0) > now
      ).length,
      memoryUsage: this.memoryManager.getCurrentUsage(),
      memoryLimit: this.limits.maxQueueMemory,
      memoryUtilization: this.memoryManager.getUtilization().toFixed(2) + "%",
      largeMessages: messages.filter((message) => message.isLarge).length,
      avgMessageSize:
        messages.length > 0
          ? Math.round(
              messages.reduce((sum, message) => sum + (message.size || 0), 0) /
                messages.length
            )
          : 0,
    };
  }

  async getHealth(): Promise<HealthStatus> {
    const messages = await this.queue.getMessages();
    const memoryOk = this.memoryManager.getUtilization() < 80;
    const queueOk = messages.length < 10000;

    return {
      status: memoryOk && queueOk ? "healthy" : "warning",
      memoryOk,
      queueOk,
      timestamp: Date.now(),
    };
  }
}
