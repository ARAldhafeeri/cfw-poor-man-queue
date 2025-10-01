import { Message } from "../domain/queue";

export interface IRetryStrategy {
  shouldRetry(message: Message, maxRetries: number): boolean;
  calculateNextRetry(message: Message, baseDelay: number): number;
}
