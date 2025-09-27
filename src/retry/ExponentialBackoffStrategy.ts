import { Message } from "entities/domain/queue";
import { IRetryStrategy } from "entities/interfaces/IRetryStrategy";

export class ExponentialBackoffStrategy implements IRetryStrategy {
  shouldRetry(message: Message, maxRetries: number): boolean {
    return message.retries < maxRetries;
  }

  calculateNextRetry(message: Message, baseDelay: number): number {
    const backoffMs = baseDelay * Math.pow(2, message.retries - 1);
    const jitter = Math.random() * 1000;
    return Date.now() + backoffMs + jitter;
  }
}
