import { Message } from "entities/domain/queue";
import { IMemoryManager } from "entities/interfaces/IMemoryManager";
import { IMessageRepository } from "entities/interfaces/IMessageRepository";
import { IPayloadStorage } from "entities/interfaces/IPayloadStorage";
import { IQueue } from "entities/interfaces/IQueue";
import {
  CompleteResponse,
  IRequestHandler,
} from "entities/interfaces/IRequestHandler";
import { HonoRequest } from "hono";

export class CompleteHandler implements IRequestHandler {
  constructor(
    private queue: IQueue,
    private dependencies: {
      memoryManager: IMemoryManager;
      payloadStorage: IPayloadStorage;
      messageRepository: IMessageRepository;
      processing: Set<string>;
      messages: Message[];
    }
  ) {}

  async handle(
    data: { id: string },
    startTime: number
  ): Promise<CompleteResponse> {
    try {
      const { id } = data;

      this.dependencies.processing.delete(id);

      this.dependencies.messageRepository
        .deleteMessage(id)
        .catch((err) => console.error("Delete message metadata error:", err));
      return { success: true };
    } catch {
      return { success: false };
    }
  }
}
