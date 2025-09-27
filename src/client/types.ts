/**
 * Queue limites must be synced with entites/domain/queue
 */
export interface QueueLimits {
  maxPayloadSize: number;
  maxBatchSize: number;
  maxQueueMemory: number;
  maxRequestDuration: number;
}

/**
 * Published Message Response
 */
export interface PublishedMessageResponse {
  id: string;
  size: number;
  stored: "memory" | "r2";
}

/**
 * response of stats for the queue from core backend of the queue.
 */
export interface QueueStatsResponse {
  total: number;
  processing: number;
  ready: number;
  retrying: number;
  memoryUsage: number;
  memoryUtilization: string;
  largemessages: number;
  avgmessageSize: number;
}

/**
 * Health Response
 */
export interface QueueHealthResponse {
  status: "healthy" | "warning";
  memoryOk: boolean;
  queueOk: boolean;
  timestamp: number;
}

/**
 * Configuration for the worker queue client
 */
export interface IClientConfiguration {
  baseUrl: string;
  apiKey: string;
  maxPayloadSize: number;
}

/**
 * Qeueu Publisher simple rest implementation with fire and forget
 * for low latency
 */
export interface IClientPublisher {
  /**
   *
   * @param data - data to be published
   */
  publish(data: any): Promise<PublishedMessageResponse>;
}

/**
 * Simple queue stats, health rest api request
 */
export interface IClientStatsRequester {
  /**
   * Simple rest request return health stats for the queue
   */
  health(): Promise<QueueHealthResponse>;
  /**
   * get stats of the queue using rest request.
   */
  getStats(): Promise<QueueStatsResponse>;
}

/**
 * User exposed apis for client
 */
export interface ISimpleQueueClient {
  /**
   *
   * @param data - data to be published
   */
  publish(data: any): Promise<PublishedMessageResponse>;
  /**
   * Simple rest request return health stats for the queue
   */
  health(): Promise<QueueHealthResponse>;
  /**
   * get stats of the queue using rest request.
   */
  getStats(): Promise<QueueStatsResponse>;
}
