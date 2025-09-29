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
import { calculateSize } from "payload";
import { MessageRepository } from "repositories/MessageRepository";
import { ExponentialBackoffStrategy } from "retry/ExponentialBackoffStrategy";
import { QueueStatsService } from "services/QueueStatsService";
import { PayloadStorage } from "storage/PayloadStorage";
import { R2StorageAdapter } from "storage/R2StorageAdapter";
import { QueueLimits } from "entities/domain/queue";
import { IQueue } from "entities/interfaces/IQueue";

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
    public batchProcessor: IBatchProcessor,
    public statsService: QueueStatsService,
    public publishHandler: PublishHandler,
    public pollHandler: PollHandler,
    public completeHandler: CompleteHandler,
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
      // Create batches of up to 64MB each
      const batches = this.createBatches(this.messages, 64 * 1024 * 1024);
      console.log(`Created ${batches.length} batches for flushing`);

      // Save each batch as a single R2 object
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchKey = `wal/batch_${Date.now()}_${i}.json`;

        const batchData = {
          batchId: batchKey,
          timestamp: Date.now(),
          messageCount: batch.messages.length,
          totalSize: batch.totalSize,
          messages: batch.messages,
        };

        await this.storage.put(batchKey, JSON.stringify(batchData));
        console.log(
          `Saved batch ${batchKey} with ${batch.messages.length} messages`
        );
      }

      // Now save individual messages for normal operations
      // This can be done in parallel for better performance
      const savePromises = this.messages.map((message) =>
        this.messageRepository.saveMessage(message)
      );
      await Promise.all(savePromises);

      // Reset buffer state
      this.currentBufferSize = 0;
      this.lastFlushTime = Date.now();

      console.log(
        `Successfully flushed ${this.messages.length} messages in ${batches.length} batches`
      );

      // clear messages
      this.messages = [];
    } catch (error) {
      console.error(`Failed to flush buffer to R2:`, error);
      throw error;
    }
  }

  /**
   * Create batches of messages where each batch is <= maxBatchSizeBytes
   */
  private createBatches(
    messages: Message[],
    maxBatchSizeBytes: number
  ): Array<{
    messages: Message[];
    totalSize: number;
  }> {
    const batches: Array<{ messages: Message[]; totalSize: number }> = [];
    let currentBatch: Message[] = [];
    let currentBatchSize = 0;

    for (const message of messages) {
      const messageSize = message.size || 1024;

      // If adding this message would exceed batch size, start new batch
      if (
        currentBatchSize + messageSize > maxBatchSizeBytes &&
        currentBatch.length > 0
      ) {
        batches.push({
          messages: [...currentBatch],
          totalSize: currentBatchSize,
        });
        currentBatch = [];
        currentBatchSize = 0;
      }

      currentBatch.push(message);
      currentBatchSize += messageSize;
    }

    // Don't forget the last batch
    if (currentBatch.length > 0) {
      batches.push({
        messages: currentBatch,
        totalSize: currentBatchSize,
      });
    }

    return batches;
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
   * Load messages and synchronize in-memory state
   */
  private async loadMessages(): Promise<void> {
    try {
      console.log("Loading messages from storage...");
      const messages = await this.messageRepository.loadMessages(
        this.limits.messageLoadLimit
      );
      this.messages = [...messages];
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
   * Synchronized method to update a message
   */
  async updateMessage(message: Message): Promise<void> {
    const index = this.messages.findIndex((msg) => msg.id === message.id);
    if (index === -1) {
      console.warn(`Message ${message.id} not found for update`);
      return;
    }

    const oldMessage = this.messages[index];
    const oldSize = oldMessage.size || 1024;
    const newSize = message.size || 1024;

    // Update buffer size if message size changed
    if (oldSize !== newSize) {
      this.currentBufferSize = this.currentBufferSize - oldSize + newSize;
    }

    this.messages[index] = { ...message };
    await this.messageRepository.saveMessage(message);
    console.log(
      `Message ${message.id} updated. Buffer size: ${this.currentBufferSize} bytes`
    );
  }

  /**
   * Get messages
   */
  async getMessages(): Promise<Message[]> {
    return this.messages;
  }

  /**
   * Get processing set
   */
  async getProcessing(): Promise<Set<string>> {
    return new Set(this.processing);
  }

  async startProcessing(messageId: string): Promise<void> {
    this.processing.add(messageId);
    console.log(`Started processing message ${messageId}`);
  }

  async stopProcessing(messageId: string): Promise<void> {
    this.processing.delete(messageId);
    console.log(`Stopped processing message ${messageId}`);
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

  async runScheduledProcessing(): Promise<void> {
    const startTime = Date.now();
    const maxDuration = 25000;

    try {
      console.log("Running scheduled processing...");

      // First flush all buffered messages
      await this.autoFlushIfNeeded();

      let processedCount = 0;
      let errorCount = 0;

      while (Date.now() - startTime < maxDuration) {
        const stats = await this.getQueueStats();

        if (stats.availableMessages === 0) {
          console.log("No more available messages");
          break;
        }

        const result = await this.pollHandler.handle(
          {
            limit: this.limits.maxBatchSize,
            timeout: 5000,
          },
          Date.now()
        );

        if (!result.messages || result.messages.length === 0) {
          break;
        }

        for (const message of result.messages) {
          try {
            await this.completeHandler.handle({ id: message.id }, Date.now());
            processedCount++;
          } catch (error) {
            console.error(`Message ${message.id} failed:`, error);
            await this.failHandler.handle(
              {
                id: message.id,
                error:
                  error instanceof Error ? error.message : "Processing error",
              },
              Date.now()
            );
            errorCount++;
          }
        }

        if (Date.now() - startTime > maxDuration - 5000) {
          break;
        }
      }

      console.log(
        `Processed: ${processedCount}, Errors: ${errorCount} in ${
          Date.now() - startTime
        }ms`
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
  };

  const storage = new R2StorageAdapter(env.STORAGE);
  const payloadStorage = new PayloadStorage(storage);
  const messageRepository = new MessageRepository(storage, calculateSize);

  const memoryManager = new MemoryManager(limits);
  const retryStrategy = new ExponentialBackoffStrategy();
  const batchProcessor = new BatchProcessor(payloadStorage);

  const queue = new Queue(
    env,
    storage,
    payloadStorage,
    messageRepository,
    memoryManager,
    retryStrategy,
    batchProcessor,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any
  );

  const statsService = new QueueStatsService(queue, memoryManager, limits);

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

  queue.publishHandler = publishHandler;
  queue.statsService = statsService;
  queue.pollHandler = pollHandler;
  queue.completeHandler = completeHandler;
  queue.failHandler = failHandler;

  console.log("Simple buffered queue created");
  return queue;
};
