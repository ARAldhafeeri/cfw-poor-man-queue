import { QueueLimits } from "../entities/domain/queue";
import { Message } from "../entities/domain/queue";
import { IQueue } from "../entities/interfaces/IQueue";
import {
  IRequestHandler,
  PublishResponse,
} from "../entities/interfaces/IRequestHandler";
import { MemoryManager } from "../memory/MemoryManager";
import { calculateSize, isLargePayload } from "../payload";
import { MessageRepository } from "../repositories/MessageRepository";
import { PayloadStorage } from "../storage/PayloadStorage";

export class PublishHandler implements IRequestHandler {
  constructor(
    private queue: IQueue,
    private dependencies: {
      limits: QueueLimits;
      memoryManager: MemoryManager;
      payloadStorage: PayloadStorage;
      messageRepository: MessageRepository;
    }
  ) {}

  async handle(data: any, startTime: number): Promise<PublishResponse> {
    const payloadSize = calculateSize(data);

    if (payloadSize > this.dependencies.limits.maxPayloadSize) {
      return {
        error: "Payload exceeds maximum size",
        maxSize: this.dependencies.limits.maxPayloadSize,
        actualSize: payloadSize,
      };
    }

    const isLarge = isLargePayload(
      payloadSize,
      this.dependencies.limits as any
    ); // Need to fix type compatibility between backend and client
    const willExceedMemory =
      this.dependencies.memoryManager.canAccommodate(payloadSize);

    const message: Message = {
      id: crypto.randomUUID(),
      data: isLarge || willExceedMemory ? null : data,
      retries: 0,
      nextRetry: 0,
      createdAt: Date.now(),
      size: payloadSize,
      isLarge: isLarge || willExceedMemory,
    };

    // handle large messages
    if (message.isLarge) {
      try {
        await this.dependencies.payloadStorage.store(message.id, data);
      } catch (error) {
        return {
          error: "Failed to store large payload",
          message: error instanceof Error ? error.message : "Storage error",
        };
      }

      this.queue.addMessage(message);

      if (
        Date.now() - startTime >
        this.dependencies.limits.maxRequestDuration - 2000
      ) {
        console.warn("Request approaching time limit, responding early");
      }

      return {
        id: message.id,
        size: payloadSize,
        stored: message.isLarge ? "r2" : "memory",
      };
    }

    // message is small push to memory
    this.queue.addMessage(message);

    return {
      id: message.id,
      size: payloadSize,
      stored: "memory",
    };
  }
}
