import { Message } from "entities/domain/queue";

export interface IRetryStrategy {
  shouldRetry(message: Message, maxRetries: number): boolean;
  calculateNextRetry(message: Message, baseDelay: number): number;
}
