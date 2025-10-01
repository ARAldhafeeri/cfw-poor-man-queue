import { Message } from "../domain/queue";

export interface FailedResponse {
  count: number;
}

export interface CompleteResponse {
  success: boolean;
}

export interface PoolResponse {
  messages: Message[] | [];
}

export interface PublishResponse {
  id?: string;
  size?: number;
  stored?: "memory" | "r2";
  error?: "Payload exceeds maximum size" | "Failed to store large payload";
  maxSize?: number;
  actualSize?: number;
  message?: string;
}

export interface IRequestHandler {
  handle(
    data: any,
    startTime: number
  ): Promise<
    FailedResponse | CompleteResponse | PublishResponse | PoolResponse | void
  >;
}

/**
 * Handles when tick logic or custom user IConsumeHandler fails.
 * We use exponential backoff retry. When retry reached max ( which is configureable by user)
 * The Queue will move the message to DEAD Latter Queue.
 * ( which need to be implemented as stand alone with custom handler)
 */
export interface IErrorHandler {
  handle(data: any, message: string): Promise<FailedResponse>;
}

/**
 * custom logic receive batch from WAL to consume messages.
 * passed to run schedule in queue.
 */
export interface IConsumeHandler extends IRequestHandler {
  handle(
    messages: Message[]
  ): Promise<
    FailedResponse | CompleteResponse | PublishResponse | PoolResponse | void
  >;
}
