import { QueueLimits } from "./entities/domain/queue";

export function calculateSize(data: any): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

export function isLargePayload(size: number, limits: QueueLimits): boolean {
  return size > limits.maxPayloadSize / 10; // Consider >10MB as large
}
