import { QueueLimits } from "client/types";
import { Message } from "entities/domain/queue";

export interface IBatchProcessor {
  createBatch(
    messages: Message[],
    limits: QueueLimits,
    startTime: number
  ): Promise<Message[]>;
}
