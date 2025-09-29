import { Message } from "entities/domain/queue";
import { IStorage } from "./IStorage";
import { IPayloadStorage } from "./IPayloadStorage";
import { IMessageRepository } from "./IMessageRepository";
import { IMemoryManager } from "./IMemoryManager";
import { IRetryStrategy } from "./IRetryStrategy";
import { IBatchProcessor } from "./IBatchProcessor";
import { QueueStatsService } from "services/QueueStatsService";
import { PublishHandler } from "handlers.ts/PublishHandler";
import { PollHandler } from "handlers.ts/PollHandler";
import { CompleteHandler } from "handlers.ts/CompleteHandler";
import { FailHandler } from "handlers.ts/FailHandler";

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
  batchProcessor: IBatchProcessor;
  statsService: QueueStatsService;

  // Handlers
  publishHandler: PublishHandler;
  pollHandler: PollHandler;
  completeHandler: CompleteHandler;
  failHandler: FailHandler;

  getMessages(): Promise<Message[]>;
  getProcessing(): Promise<Set<string>>;
  addMessage(message: Message): Promise<void>;
  removeMessage(id: string): Promise<boolean>;
  updateMessage(message: Message): Promise<void>;
  startProcessing(id: string): Promise<void>;
  stopProcessing(id: string): Promise<void>;
  getQueueStats(): Promise<any>;
  forceReload(): Promise<void>;
  runScheduledProcessing(): Promise<void>;
}
