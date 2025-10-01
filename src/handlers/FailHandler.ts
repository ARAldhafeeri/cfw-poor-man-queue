import { Message } from "../entities/domain/queue";
import { IMemoryManager } from "../entities/interfaces/IMemoryManager";
import { IMessageRepository } from "../entities/interfaces/IMessageRepository";
import { IPayloadStorage } from "../entities/interfaces/IPayloadStorage";
import {
  FailedResponse,
  IErrorHandler,
} from "../entities/interfaces/IRequestHandler";
import { IRetryStrategy } from "../entities/interfaces/IRetryStrategy";

export class FailHandler implements IErrorHandler {
  constructor(
    private dependencies: {
      retryStrategy: IRetryStrategy;
      memoryManager: IMemoryManager;
      payloadStorage: IPayloadStorage;
      messageRepository: IMessageRepository;
      maxRetries: number;
      retryDelay: number;
    }
  ) {}

  async handle(data: Message, error: string): Promise<FailedResponse> {
    // Check if we should retry
    if (
      this.dependencies.retryStrategy.shouldRetry(
        data,
        this.dependencies.maxRetries
      )
    ) {
      // Calculate next retry time with exponential backoff
      const nextRetryAt = this.dependencies.retryStrategy.calculateNextRetry(
        data,
        this.dependencies.retryDelay
      );

      // Update message with retry info
      const messageWithRetry = {
        ...data,
        nextRetryAt,
        lastError: error,
        lastFailedAt: Date.now(),
      };

      // Requeue for later processing
      await this.dependencies.messageRepository.requeueMessage(
        messageWithRetry
      );
    } else {
      // Max retries exceeded, move to DLQ

      await this.dependencies.messageRepository.moveToDLQ(
        data,
        `Max retries (${this.dependencies.maxRetries}) exceeded. Last error: ${data.id}`
      );
      // increase error count
    }
    return { count: 1 };
  }
}
