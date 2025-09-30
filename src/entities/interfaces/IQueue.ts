import { Message } from "entities/domain/queue";
import { IStorage } from "./IStorage";
import { IPayloadStorage } from "./IPayloadStorage";
import { IMessageRepository } from "./IMessageRepository";
import { IMemoryManager } from "./IMemoryManager";
import { IRetryStrategy } from "./IRetryStrategy";
import { QueueStatsService } from "services/QueueStatsService";
import { PublishHandler } from "handlers/PublishHandler";
import { FailHandler } from "handlers/FailHandler";

/**
 * Queue - The Core Domain/Service Class
 * - Manages the in-memory state of messages.
 * - Contains all business logic for queue operations.
 * - Is completely decoupled from the Durable Object environment.
 * - Persists state changes via the injected `IMessageRepository`.
 */
export interface IQueue {
  // Remove state dependency from interface
  storage: IStorage;
  payloadStorage: IPayloadStorage;
  messageRepository: IMessageRepository;
  memoryManager: IMemoryManager;
  retryStrategy: IRetryStrategy;
  statsService: QueueStatsService;

  // Handlers
  publishHandler: PublishHandler;
  failHandler: FailHandler;

  // return poll of batches
  getPoll(limit: number, timeout: number): Promise<Message[]>;
  addMessage(message: Message): Promise<void>;
  removeMessage(id: string): Promise<boolean>;
  getQueueStats(): Promise<any>;
  forceReload(): Promise<void>;
  runScheduledProcessing(
    handler: (messages: Message[]) => Promise<void> | void
  ): Promise<void>;
}
