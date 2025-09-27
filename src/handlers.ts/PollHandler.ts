import { BatchProcessor } from "batch/BatchProcessor";
import { QueueLimits } from "client/types";
import { IQueue } from "entities/interfaces/IQueue";
import {
  IRequestHandler,
  PoolResponse,
} from "entities/interfaces/IRequestHandler";

export class PollHandler implements IRequestHandler {
  constructor(
    private queue: IQueue,
    private dependencies: {
      batchProcessor: BatchProcessor;
      limits: QueueLimits;
    }
  ) {}

  async handle(data: any, startTime: number): Promise<PoolResponse> {
    const messages = await this.queue.getMessages();
    const processing = await this.queue.getProcessing();
    const now = Date.now();

    const availableMessages = messages.filter(
      (msg) => !processing.has(msg.id) && now >= msg.nextRetry
    );

    if (!availableMessages.length) return { messages: [] };

    const batchMessages = await this.dependencies.batchProcessor.createBatch(
      availableMessages,
      this.dependencies.limits,
      startTime
    );

    for (const message of batchMessages) {
      await this.queue.startProcessing(message.id);
    }

    return { messages: batchMessages };
  }
}
