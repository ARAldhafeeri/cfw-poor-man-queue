import { IMemoryManager } from "./entities/interfaces/IMemoryManager";
import { IMessageRepository } from "./entities/interfaces/IMessageRepository";
import { IPayloadStorage } from "./entities/interfaces/IPayloadStorage";
import { IRetryStrategy } from "./entities/interfaces/IRetryStrategy";
import { IStorage } from "./entities/interfaces/IStorage";
import { FailHandler } from "./handlers/FailHandler";
import { PublishHandler } from "./handlers/PublishHandler";
import { MemoryManager } from "./memory/MemoryManager";
import { MessageRepository } from "./repositories/MessageRepository";
import { ExponentialBackoffStrategy } from "./retry/ExponentialBackoffStrategy";
import { QueueStatsService } from "./services/QueueStatsService";
import { PayloadStorage } from "./storage/PayloadStorage";
import { R2StorageAdapter } from "./storage/R2StorageAdapter";
import { Message, QueueLimits } from "./entities/domain/queue";
import { IQueue } from "./entities/interfaces/IQueue";
import { Status } from "./entities/interfaces/IRequestHandler";

export class Queue implements IQueue {
  private messages: Message[] = [];
  private processing = new Set<string>();
  private limits: QueueLimits;
  private loadPromise: Promise<void> | null = null;
  private isLoaded: boolean = false;
  private bufferSizeBytes: number;
  private currentBufferSize: number = 0;
  private lastFlushTime: number = Date.now();
  private flushTimeout: any = null;

  constructor(
    env: any,
    public storage: IStorage,
    public payloadStorage: IPayloadStorage,
    public messageRepository: IMessageRepository,
    public memoryManager: IMemoryManager,
    public retryStrategy: IRetryStrategy,
    public statsService: QueueStatsService,
    public publishHandler: PublishHandler,
    public failHandler: FailHandler
  ) {
    this.bufferSizeBytes = parseInt(env.BUFFER_SIZE || "67108864"); // 64MB default
    this.limits = {
      maxPayloadSize: parseInt(env.MAX_PAYLOAD_SIZE),
      maxBatchSize: parseInt(env.MAX_BATCH_SIZE),
      maxQueueMemory: parseInt(env.MAX_QUEUE_MEMORY),
      maxRequestDuration: 25000,
      messageLoadLimit: parseInt(env.MESSAGE_LOAD_LIMIT),
      bufferFlush: parseInt(env.BUFFER_FLUSH || "9"),
      maxRetry: parseInt(env.MAX_RETRIES || "3"),
      retryDelay: parseInt(env.RETRY_DELAY_MS || "6000"),
    };

    this.setupFlushTimer();
  }

  /**
   * Setup automatic flush timer (9 seconds)
   */
  private setupFlushTimer(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    this.flushTimeout = setTimeout(() => {
      this.autoFlushIfNeeded();
    }, this.limits.bufferFlush * 1000);
  }

  /**
   * Check if buffer should be flushed
   */
  private shouldFlush(): boolean {
    const timeSinceLastFlush = Date.now() - this.lastFlushTime;
    return (
      this.currentBufferSize >= this.bufferSizeBytes ||
      timeSinceLastFlush >= this.limits.bufferFlush * 1000 - 100
    );
  }

  /**
   * Auto-flush if conditions are met
   */
  private async autoFlushIfNeeded(): Promise<void> {
    if (this.shouldFlush() && this.messages.length > 0) {
      console.log(
        `Auto-flushing buffer: ${this.messages.length} messages, ${this.currentBufferSize} bytes`
      );
      await this.flushToStorage();
    }
    this.setupFlushTimer();
  }

  /**
   * Add message with buffering - check flush conditions
   */
  async addMessage(message: Message): Promise<void> {
    const messageSize = message.size || 1024;

    // should send 429 for retry instead of 500 error.
    if (!this.memoryManager.canAccommodate(messageSize)) {
      throw new Error(`Cannot accommodate message: would exceed memory limit`);
    }

    this.messages.push(message);
    this.currentBufferSize += messageSize;
    this.memoryManager.addMessage(message);

    console.log(
      `Message ${message.id} added to buffer. Current buffer: ${this.currentBufferSize}/${this.bufferSizeBytes} bytes`
    );

    if (this.currentBufferSize >= this.bufferSizeBytes) {
      console.log(`Buffer size threshold reached, flushing...`);
      await this.flushToStorage();
    }
  }

  /**
   * Flush buffer to R2 storage as batched write-ahead logs
   */
  async flushToStorage(): Promise<void> {
    /**
     * No messages to flush
     */
    if (this.messages.length === 0) {
      this.lastFlushTime = Date.now();
      return;
    }

    console.log(
      `Flushing ${this.messages.length} messages (${this.currentBufferSize} bytes) to R2 as batched WAL`
    );

    try {
      const timestamp = Date.now();
      const messagesLength = this.messages.length;

      // Create batches of up to 64MB each
      await this.messageRepository.saveMessagesBatch(this.messages);

      console.log(`Created ${messagesLength} batches for flushing`);

      // Reset buffer state
      this.currentBufferSize = 0;
      this.lastFlushTime = Date.now();
      const duration = Date.now() - timestamp;
      console.log(
        `Successfully flushed ${this.messages.length} messages in ${messagesLength} batches. In ${duration} ms`
      );

      // clear messages
      this.messages = [];
    } catch (error) {
      console.error(`Failed to flush buffer to R2:`, error);
      throw error;
    }
  }

  /**
   * Ensure messages are loaded before any operation
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
   * Load messages
   */
  private async loadMessages(): Promise<void> {
    try {
      console.log("Loading messages from storage...");
      const loaded = await this.messageRepository.loadMessages(
        this.limits.messageLoadLimit
      );
      this.messages = [...loaded.messages];
      this.processing.clear();

      // Recalculate buffer size from loaded messages
      this.currentBufferSize = this.messages.reduce(
        (total, msg) => total + (msg.size || 1024),
        0
      );
      this.memoryManager.recalculateFromMessages(this.messages);

      console.log(
        `Loaded ${this.messages.length} messages, buffer size: ${this.currentBufferSize} bytes`
      );
    } catch (error) {
      console.error("Load messages error:", error);
      this.messages = [];
      this.processing.clear();
      this.currentBufferSize = 0;
      this.memoryManager.setUsage(0);
    }
  }

  /**
   * Synchronized method to remove a message
   */
  async removeMessage(messageId: string): Promise<boolean> {
    const index = this.messages.findIndex((msg) => msg.id === messageId);
    if (index === -1) {
      console.warn(`Message ${messageId} not found for removal`);
      return false;
    }

    const [removedMessage] = this.messages.splice(index, 1);
    const messageSize = removedMessage.size || 1024;

    // Update buffer size
    this.currentBufferSize -= messageSize;
    this.memoryManager.removeMessage(messageId, messageSize);
    await this.messageRepository.deleteMessage(messageId);

    console.log(
      `Message ${messageId} removed. Buffer size: ${this.currentBufferSize} bytes`
    );
    return true;
  }

  /**
   * Get messages
   */
  async getPoll(limit: number, timeout: number): Promise<Message[]> {
    const loadPromise = this.messageRepository.loadMessages(limit);
    const timeoutPromise = new Promise<Message[]>((resolve) =>
      setTimeout(() => resolve([]), timeout)
    );

    return Promise.race([
      loadPromise.then((result) => result.messages),
      timeoutPromise,
    ]);
  }

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
      bufferStats: {
        currentSizeBytes: this.currentBufferSize,
        maxSizeBytes: this.bufferSizeBytes,
        utilization: (this.currentBufferSize / this.bufferSizeBytes) * 100,
        timeSinceLastFlush: now - this.lastFlushTime,
        shouldFlush: this.shouldFlush(),
        messagesInBuffer: this.messages.length,
      },
      largeMessages: this.messages.filter((msg) => msg.isLarge).length,
      avgMessageSize:
        this.messages.length > 0
          ? Math.round(this.currentBufferSize / this.messages.length)
          : 0,
    };
  }

  async forceReload(): Promise<void> {
    this.isLoaded = false;
  }

  /**
   * Manual buffer flush for testing or emergency
   */
  async manualFlush(): Promise<void> {
    console.log("Manual buffer flush requested");
    await this.flushToStorage();
  }

  /**
   * Get current buffer utilization for monitoring
   */
  getBufferUtilization(): number {
    return (this.currentBufferSize / this.bufferSizeBytes) * 100;
  }

  /**
   * Reset buffer (for testing)
   */
  resetBuffer(): void {
    this.currentBufferSize = 0;
    this.lastFlushTime = Date.now();
  }

  async runScheduledProcessing(
    handler: (messages: Message) => Promise<Status>
  ): Promise<void> {
    const startTime = Date.now();
    const maxDuration = this.limits.maxRequestDuration || 25000; // 25000ms

    try {
      console.log("Running scheduled processing...");

      // First flush all buffered messages
      await this.autoFlushIfNeeded();

      let processedCount = 0;
      let errorCount = 0;
      let retriedCount = 0;

      // Process batches for max duration which is 25s
      // for cloudflare free plan
      // we want to create race condition between max request duration
      // and the processing
      let currentTimeout = null;
      const timeoutPromise = new Promise((_, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Processing terminated due to timeout"));
        }, maxDuration);

        // Store timeout so we can clear it later
        currentTimeout = timeout;
      });

      const processABatch = async () => {
        // Get messages batches
        const messages = await this.messageRepository.popBatch();

        console.log(`Processing batch of ${messages.length} messages`);

        const messagePromises = messages.map(async (message) => {
          try {
            // Handle if the message reached max retry
            if (message.retries > this.limits.maxRetry) {
              await this.messageRepository.moveToDLQ(
                message,
                "max retries reached"
              );
              return;
            }

            // Pass messages to custom handler
            const result = await handler(message);
            // handle the new degrade gracefully logic
            if (!result.status) {
              try {
                const currentRetries = (message.retries || 0) + 1;
                const updatedMessage = {
                  ...message,
                  retries: currentRetries,
                };
                await this.failHandler.handle(updatedMessage, result.error);
              } catch (e) {
                console.log("Failure handler throws errors", e);
              }
              errorCount++;
            } else {
              processedCount++;
            }
          } catch (error) {
            console.error(
              `Message ${message.id} failed (attempt ${
                (message.retries || 0) + 1
              }):`,
              error
            );

            // TODO: handle unexpected errors
          }
        });

        await Promise.allSettled(messagePromises);
      };

      await Promise.race([timeoutPromise, processABatch()]);

      if (currentTimeout) {
        clearTimeout(currentTimeout);
        currentTimeout = null;
      }

      const duration = Date.now() - startTime;
      console.log(
        `Processed: ${processedCount}, Retried: ${retriedCount}, Failed (to DLQ): ${errorCount} in ${duration}ms`
      );
    } catch (error) {
      console.error("Scheduled processing error:", error);
    }
  }
}

/**
 * Create queue with proper initialization and dependency injection
 */
export const createQueue = async (env: any): Promise<IQueue> => {
  const limits: QueueLimits = {
    maxPayloadSize: parseInt(env.MAX_PAYLOAD_SIZE || "1048576"),
    maxBatchSize: parseInt(env.MAX_BATCH_SIZE || "10"),
    maxQueueMemory: parseInt(env.MAX_QUEUE_MEMORY || "104857600"),
    maxRequestDuration: 25000,
    messageLoadLimit: parseInt(env.MESSAGE_LOAD_LIMIT || "100"),
    bufferFlush: parseInt(env.BUFFER_FLUSH || "9"),
    maxRetry: parseInt(env.MAX_RETRIES || "3"),
    retryDelay: parseInt(env.RETRY_DELAY_MS || "6000"),
  };

  const storage = new R2StorageAdapter(env.STORAGE);
  const payloadStorage = new PayloadStorage(storage);
  const messageRepository = new MessageRepository({
    storage: storage,
    walStorageName: env.WAL_STORAGE_NAME,
    deadLetterQueueName: env.DLQ_NAME,
  });

  const memoryManager = new MemoryManager(limits);
  const retryStrategy = new ExponentialBackoffStrategy();
  const failHandler = new FailHandler({
    retryStrategy: retryStrategy,
    memoryManager: memoryManager,
    payloadStorage: payloadStorage,
    messageRepository: messageRepository,
    maxRetries: parseInt(env.MAX_RETRIES || "3"),
    retryDelay: parseInt(env.MAX_RETRIES || "3"),
  });

  const queue = new Queue(
    env,
    storage,
    payloadStorage,
    messageRepository,
    memoryManager,
    retryStrategy,
    null as any,
    null as any,
    failHandler
  );

  const statsService = new QueueStatsService(queue, memoryManager, limits);

  const publishHandler = new PublishHandler(queue, {
    limits: limits,
    memoryManager: memoryManager,
    payloadStorage: payloadStorage,
    messageRepository: messageRepository,
  });

  queue.publishHandler = publishHandler;
  queue.statsService = statsService;
  queue.failHandler = failHandler;

  console.log("Simple buffered queue created");
  return queue;
};
