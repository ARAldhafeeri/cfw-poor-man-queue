import { IMemoryManager } from "entities/interfaces/IMemoryManager";
import { IMessageRepository } from "entities/interfaces/IMessageRepository";
import { IPayloadStorage } from "entities/interfaces/IPayloadStorage";
import { IQueue } from "entities/interfaces/IQueue";
import {
  FailedResponse,
  IRequestHandler,
} from "entities/interfaces/IRequestHandler";
import { IRetryStrategy } from "entities/interfaces/IRetryStrategy";

export class FailHandler implements IRequestHandler {
  constructor(
    private queue: IQueue,
    private dependencies: {
      retryStrategy: IRetryStrategy;
      memoryManager: IMemoryManager;
      payloadStorage: IPayloadStorage;
      messageRepository: IMessageRepository;
      maxRetries: number;
      retryDelay: number;
    }
  ) {}

  async handle(
    data: { id: string; error: string },
    startTime: number
  ): Promise<FailedResponse> {
    const { id, error } = data;

    const messages = await this.queue.getMessages();

    const message = messages.find((message) => message.id === id);

    if (!message) {
      // not found response
      return {
        deadLetter: false,
        finalAttempt: 0,
      };
    }

    message.retries++;

    if (
      !this.dependencies.retryStrategy.shouldRetry(
        message,
        this.dependencies.maxRetries
      )
    ) {
      await this.dependencies.messageRepository.moveToDLQ(
        message,
        error as string
      );

      if (!message.isLarge) {
        this.dependencies.memoryManager.removeMessage(message.id, message.size);
      } else {
        this.dependencies.payloadStorage
          .delete(id)
          .catch((err) => console.error("Delete failed payload error:", err));
      }

      this.dependencies.messageRepository
        .deleteMessage(id)
        .catch((err) =>
          console.error("Delete failed message metadata error:", err)
        );

      return {
        deadLetter: true,
        finalAttempt: message.retries,
      };
    }

    message.nextRetry = this.dependencies.retryStrategy.calculateNextRetry(
      message,
      this.dependencies.retryDelay
    );

    this.dependencies.messageRepository
      .saveMessage(message)
      .catch((err) => console.error("Update message metadata error:", err));

    return {
      retry: true,
      nextRetry: message.nextRetry,
      attempt: message.retries,
    };
  }
}
