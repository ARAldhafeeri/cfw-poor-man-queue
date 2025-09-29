import { Message, QueueLimits } from "entities/domain/queue";
import { IMemoryManager } from "entities/interfaces/IMemoryManager";

export class MemoryManager implements IMemoryManager {
  private memoryUsage = 0;

  constructor(private limits: QueueLimits) {}

  addMessage(message: Message): void {
    if (!message.isLarge) {
      this.memoryUsage += message.size || 0;
      console.log(
        `Memory: Added message ${message.id}, usage now: ${this.memoryUsage} bytes`
      );
    }
  }

  removeMessage(messageId: string, size: number): void {
    this.memoryUsage = Math.max(0, this.memoryUsage - size); // Prevent negative values
    console.log(
      `Memory: Removed message ${messageId}, usage now: ${this.memoryUsage} bytes`
    );
  }

  canAccommodate(size: number): boolean {
    console.log("limits", this.limits.maxPayloadSize, size);
    const canFit = size <= this.limits.maxPayloadSize;
    console.log(
      `Memory: Can accommodate ${size} bytes? ${canFit} (current: ${this.memoryUsage}, limit: ${this.limits.maxQueueMemory})`
    );
    return canFit;
  }

  getCurrentUsage(): number {
    return this.memoryUsage;
  }

  getUtilization(): number {
    return (this.memoryUsage / this.limits.maxQueueMemory) * 100;
  }

  setUsage(usage: number): void {
    console.log(
      `Memory: Setting usage from ${this.memoryUsage} to ${usage} bytes`
    );
    this.memoryUsage = Math.max(0, usage); // Prevent negative values
  }

  /**
   * Messages is global state between durable objects
   * It need to be bassed here to  calculate messages correctly.
   *  Recalculate memory usage from current messages
   * This should be called periodically to ensure accuracy
   */
  recalculateFromMessages(messages: Message[]): void {
    const newUsage = messages
      .filter((msg) => !msg.isLarge)
      .reduce((total, msg) => total + (msg.size || 0), 0);

    console.log(
      `Memory: Recalculating usage from ${this.memoryUsage} to ${newUsage} bytes`
    );
    this.memoryUsage = newUsage;
  }
}
