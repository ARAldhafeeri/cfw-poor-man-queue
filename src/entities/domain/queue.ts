export type Environment = {
  Bindings: {
    readonly R2_BUCKET: R2Bucket;
    readonly API_KEY?: string;
    readonly DO: DurableObjectState;
    readonly STORAGE: R2Bucket;
    readonly SIMPLE_QUEUE: DurableObjectNamespace;
  };
  Variables: {
    MAX_PAYLOAD_SIZE: string;
    MAX_BATCH_SIZE: string;
    MAX_QUEUE_MEMORY: string;
    MAX_RETRIES: string;
    RETRY_DELAY_MS: string;
    MESSAGE_LOAD_LIMIT: string;
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

export interface QueueLimits {
  maxPayloadSize: number;
  maxBatchSize: number;
  maxQueueMemory: number;
  maxRequestDuration: number;
  messageLoadLimit: number;
}

export interface QueueStats {
  total: number;
  processing: number;
  ready: number;
  retrying: number;
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
