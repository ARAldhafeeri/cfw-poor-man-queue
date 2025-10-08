export type Environment = {
  Bindings: {
    readonly R2_BUCKET: R2Bucket;
    readonly API_KEY?: string;
    readonly DO: DurableObjectState;
    readonly STORAGE: R2Bucket;
    readonly SIMPLE_QUEUE: DurableObjectNamespace;
    readonly D1: D1Database;
  };
  Variables: {
    MAX_PAYLOAD_SIZE: string;
    MAX_BATCH_SIZE: string;
    MAX_QUEUE_MEMORY: string;
    MAX_RETRIES: string;
    RETRY_DELAY_MS: string;
    MESSAGE_LOAD_LIMIT: string;
    MAX_MESSAGE_SIZE: string;
    BUFFER_FLUSH: string;
  };
};

export interface Message {
  id: string;
  data: any;
  retries: number;
  nextRetry: number;
  createdAt: number;
  size: number;
  isLarge: boolean;
  error?: string;
}

/**
 * Temporal queue message
 */
export interface TemporalMessage extends Message {
  data: { memories: string[]; agentId: string };
}

/**
 * TODO: Behavioral Queue Message
 */
export interface TemporalMessage extends Message {
  data: { memories: string[]; agentId: string };
}

export interface QueueLimits {
  /**
   * Default is 1kb size limit per message for maximum throubput
   */
  maxPayloadSize: number;
  maxBatchSize: number;
  /**
   * maximum buffer size for in-memory messages before flushing.
   */
  maxQueueMemory: number;
  maxRequestDuration: number;
  messageLoadLimit: number;
  /**
   * Flush buffer configuration, should be in 9s or below
   * for default free cloudflare worker durable object
   */
  bufferFlush: number;
  /**
   * Retry paramaters
   */
  maxRetry: number;
  retryDelay: number;
}

export interface QueueStats {
  total: number;

  memoryUsage: number;
  memoryLimit: number;
  memoryUtilization: string;
  largeMessages: number;
  avgMessageSize: number;
}

export interface HealthStatus {
  status: "healthy" | "warning";
  memoryOk: boolean;
  queueOk: boolean;
  timestamp: number;
}
