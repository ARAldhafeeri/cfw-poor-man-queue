import { Message } from "entities/domain/queue";
import { HonoRequest } from "hono";

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
    FailedResponse | CompleteResponse | PublishResponse | PoolResponse
  >;
}

export interface IErrorHandler {
  handle(data: any, message: string): Promise<FailedResponse>;
}
