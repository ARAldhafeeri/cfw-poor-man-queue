import { BatchProcessor } from "batch/BatchProcessor";
import { Message } from "entities/domain/queue";
import { IBatchProcessor } from "entities/interfaces/IBatchProcessor";
import { IMemoryManager } from "entities/interfaces/IMemoryManager";
import { IMessageRepository } from "entities/interfaces/IMessageRepository";
import { IPayloadStorage } from "entities/interfaces/IPayloadStorage";
import { IRetryStrategy } from "entities/interfaces/IRetryStrategy";
import { IStorage } from "entities/interfaces/IStorage";
import { CompleteHandler } from "handlers.ts/CompleteHandler";
import { FailHandler } from "handlers.ts/FailHandler";
import { PollHandler } from "handlers.ts/PollHandler";
import { PublishHandler } from "handlers.ts/PublishHandler";
import { MemoryManager } from "memory/MemoryManager";
import { calculateSize, isLargePayload } from "payload";
import { MessageRepository } from "repositories/MessageRepository";
import { ExponentialBackoffStrategy } from "retry/ExponentialBackoffStrategy";
import { QueueStatsService } from "services/QueueStatsService";
import { PayloadStorage } from "storage/PayloadStorage";
import { R2StorageAdapter } from "storage/R2StorageAdapter";
import { Environment, QueueLimits } from "entities/domain/queue";
import { IQueue } from "entities/interfaces/IQueue";

export class Queue implements IQueue {
  private messages: Message[] = [];
  private processing = new Set<string>();
  private limits: QueueLimits;
  private loadPromise: Promise<void> | null = null;
  private isLoaded: boolean = false;

  constructor(
    env: any,
    // Dependencies injected
    public storage: IStorage,
    public payloadStorage: IPayloadStorage,
    public messageRepository: IMessageRepository,
    public memoryManager: IMemoryManager,
    public retryStrategy: IRetryStrategy,
    public batchProcessor: IBatchProcessor,
    public statsService: QueueStatsService,

    // Handlers
    public publishHandler: PublishHandler,
    public pollHandler: PollHandler,
    public completeHandler: CompleteHandler,
    public failHandler: FailHandler
  ) {
    this.limits = {
      maxPayloadSize: parseInt(env.MAX_PAYLOAD_SIZE),
      maxBatchSize: parseInt(env.MAX_BATCH_SIZE),
      maxQueueMemory: parseInt(env.MAX_QUEUE_MEMORY),
      maxRequestDuration: 25000,
    };
  }
  /**
   *  Ensure messages are loaded before any operation
   */
  private async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.loadMessages().finally(() => {
        this.isLoaded = true;
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  /**
   *  Load messages and synchronize in-memory state
   */
  private async loadMessages(): Promise<void> {
    try {
      console.log("Loading messages from storage...");
      const messages = await this.messageRepository.loadMessages();
      this.messages = [...messages];
      this.processing.clear();
      this.memoryManager.recalculateFromMessages(this.messages);
      console.log(`Loaded ${this.messages.length} messages`);
    } catch (error) {
      console.error("Load messages error:", error);
      this.messages = [];
      this.processing.clear();
      this.memoryManager.setUsage(0);
    }
  }

  /**
   *  Synchronized method to add a message
   */
  async addMessage(message: Message): Promise<void> {
    await this.ensureLoaded();

    if (
      !message.isLarge &&
      !this.memoryManager.canAccommodate(message.size || 0)
    ) {
      throw new Error(`Cannot accommodate message: would exceed memory limit`);
    }

    this.messages.push(message);
    this.memoryManager.addMessage(message);
    await this.messageRepository.saveMessage(message);
    console.log(`Message ${message.id} added and persisted`);
  }

  /**
   *  Synchronized method to remove a message
   */
  async removeMessage(messageId: string): Promise<boolean> {
    await this.ensureLoaded();

    const index = this.messages.findIndex((msg) => msg.id === messageId);
    if (index === -1) {
      console.warn(`Message ${messageId} not found for removal`);
      return false;
    }

    // Remove from in-memory state
    const [removedMessage] = this.messages.splice(index, 1);

    // Update memory tracking
    this.memoryManager.removeMessage(messageId, removedMessage.size || 0);

    // Remove from persistent storage
    await this.messageRepository.deleteMessage(messageId);

    console.log(`Message ${messageId} removed and deleted from storage`);
    return true;
  }

  /**
   *  Synchronized method to update a message
   */
  async updateMessage(message: Message): Promise<void> {
    await this.ensureLoaded();

    const index = this.messages.findIndex((msg) => msg.id === message.id);
    if (index === -1) {
      console.warn(`Message ${message.id} not found for update`);
      return;
    }

    // Update in-memory state
    this.messages[index] = { ...message };

    // Persist to storage
    await this.messageRepository.saveMessage(message);

    console.log(`Message ${message.id} updated and persisted`);
  }

  /**
   *  Get messages (read-only copy)
   */
  async getMessages(): Promise<Message[]> {
    await this.ensureLoaded();
    return [...this.messages]; // Return copy to prevent external mutation
  }

  /**
   *  Get processing set (read-only copy)
   */
  async getProcessing(): Promise<Set<string>> {
    await this.ensureLoaded();
    return new Set(this.processing); // Return copy to prevent external mutation
  }

  /**
   *  Start processing a message
   */
  async startProcessing(messageId: string): Promise<void> {
    await this.ensureLoaded();
    this.processing.add(messageId);
    console.log(`Started processing message ${messageId}`);
  }

  /**
   *  Stop processing a message
   */
  async stopProcessing(messageId: string): Promise<void> {
    await this.ensureLoaded();
    this.processing.delete(messageId);
    console.log(`Stopped processing message ${messageId}`);
  }

  /**
   *  Get queue statistics
   */
  async getQueueStats(): Promise<any> {
    await this.ensureLoaded();

    const now = Date.now();
    return {
      totalMessages: this.messages.length,
      processingCount: this.processing.size,
      availableMessages: this.messages.filter(
        (msg) => !this.processing.has(msg.id) && (msg.nextRetry || 0) <= now
      ).length,
      retryingMessages: this.messages.filter(
        (msg) => !this.processing.has(msg.id) && (msg.nextRetry || 0) > now
      ).length,
      memoryUsage: this.memoryManager.getCurrentUsage(),
      memoryLimit: this.limits.maxQueueMemory,
      memoryUtilization: this.memoryManager.getUtilization(),
      largeMessages: this.messages.filter((msg) => msg.isLarge).length,
      avgMessageSize:
        this.messages.length > 0
          ? Math.round(
              this.messages.reduce((total, msg) => total + (msg.size || 0), 0) /
                this.messages.length
            )
          : 0,
    };
  }

  /**
   *  Force reload from storage (for debugging)
   */
  async forceReload(): Promise<void> {
    this.isLoaded = false;
    await this.ensureLoaded();
  }
}

/**
 * Create queue with proper initialization and dependency injection
 */
export const createQueue = async (env: any): Promise<IQueue> => {
  // Create limits from environment
  const limits: QueueLimits = {
    maxPayloadSize: parseInt(env.MAX_PAYLOAD_SIZE || "1048576"), // 1MB default
    maxBatchSize: parseInt(env.MAX_BATCH_SIZE || "10"),
    maxQueueMemory: parseInt(env.MAX_QUEUE_MEMORY || "104857600"), // 100MB default
    maxRequestDuration: 25000,
  };

  // Create storage layer
  const storage = new R2StorageAdapter(env.STORAGE);
  const payloadStorage = new PayloadStorage(storage);
  const messageRepository = new MessageRepository(storage, calculateSize);

  // Create core services
  const memoryManager = new MemoryManager(limits);
  const retryStrategy = new ExponentialBackoffStrategy();
  const batchProcessor = new BatchProcessor(payloadStorage);

  // Create stats service (will be injected into queue)

  // Create the queue instance with all dependencies
  const queue = new Queue(
    env,
    storage,
    payloadStorage,
    messageRepository,
    memoryManager,
    retryStrategy,
    batchProcessor,
    // will assign below to keep durable object state synced
    null as any,
    null as any,
    null as any,
    null as any,
    null as any
  );

  const statsService = new QueueStatsService(queue, memoryManager, limits);

  // Create handlers with their dependencies
  const publishHandler = new PublishHandler(queue, {
    limits: limits,
    memoryManager: memoryManager,
    payloadStorage: payloadStorage,
    messageRepository: messageRepository,
  });

  const pollHandler = new PollHandler(queue, {
    batchProcessor: batchProcessor,
    limits: limits,
  });

  const completeHandler = new CompleteHandler(queue, {
    memoryManager: memoryManager,
    payloadStorage: payloadStorage,
    messageRepository: messageRepository,
    processing: new Set(),
    messages: await queue.getMessages(),
  });

  const failHandler = new FailHandler(queue, {
    retryStrategy: retryStrategy,
    memoryManager: memoryManager,
    payloadStorage: payloadStorage,
    messageRepository: messageRepository,
    maxRetries: parseInt(env.MAX_RETRIES || "3"),
    retryDelay: parseInt(env.MAX_RETRIES || "3"),
  });

  // intialize handlers here to keep state synced
  queue.publishHandler = publishHandler;
  queue.statsService = statsService;
  queue.pollHandler = pollHandler;
  queue.completeHandler = completeHandler;
  queue.failHandler = failHandler;

  console.log("Queue created and initialized successfully");
  return queue;
};
