import { Message } from "../domain/queue";

export interface IMessageRepository {
  /**
   * Loads messages with custom payload
   * both limit and timeout are environmeent variables.
   * @param limit limit of messages per batch
   */
  loadMessages(limit: number): Promise<{ messages: Message[] }>;
  /**
   * Adds batch with timestamp to WAL R2 storage.
   * @param messages batch of messages to add to WAL in R2 Storage
   */
  saveMessagesBatch(messages: Message[]): Promise<void>;
  /**
   * TODO: delete specific message, still needs work
   * @param messageId
   */
  deleteMessage(messageId: string): Promise<void>;
  /**
   * After maximum retries message is moved to special queue
   * Named dead letter queue.
   * Such queue need to be deployed as standalone worker
   * And logic need to be implemented
   * @param message message to add to dlq
   * @param error error message
   */
  moveToDLQ(message: Message, error: string): Promise<void>;
  /**
   * Simple pop operation for WAL databases techinque
   */
  popBatch(): Promise<Message[]>;
  /**
   * Since dead-letter queue expect single message not
   * an array of messages then this will pop a message randomly
   * from the dead-letter queue.
   */
  popMessageFromDLQ(): Promise<Message | null>;
  /**
   * readd message as single message batch after increasing retry
   * @param message message to be requed
   */
  requeueMessage(message: Message): Promise<void>;
}
