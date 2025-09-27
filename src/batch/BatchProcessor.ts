import { Message } from "entities/domain/queue";
import { IBatchProcessor } from "entities/interfaces/IBatchProcessor";
import { IPayloadStorage } from "entities/interfaces/IPayloadStorage";
import { QueueLimits } from "types";

export class BatchProcessor implements IBatchProcessor {
  constructor(private payloadStorage: IPayloadStorage) {}

  async createBatch(
    messages: Message[],
    limits: QueueLimits,
    startTime: number
  ): Promise<Message[]> {
    const batchMessages: Message[] = [];
    let totalSize = 0;

    for (const message of messages) {
      if (Date.now() - startTime > limits.maxRequestDuration - 5000) {
        break;
      }

      if (batchMessages.length >= limits.maxBatchSize) {
        break;
      }

      if (totalSize + message.size > limits.maxPayloadSize / 2) {
        break;
      }

      if (message.isLarge) {
        const data = await this.payloadStorage.load(message.id);
        if (data) {
          message.data = data;
        } else {
          console.error(`Missing payload for message ${message.id}`);
          continue;
        }
      }

      batchMessages.push(message);
      totalSize += message.size;
    }

    return batchMessages;
  }
}
