import { Message } from "./entities/domain/queue";

export async function processmessageWithTimeout(
  message: Message,
  timeoutMs: number
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`message processing timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      await processmessage(message);
      clearTimeout(timeout);
      resolve();
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

async function processmessage(message: Message): Promise<void> {
  console.log(
    `Processing message ${message.id} (${message.size} bytes):`,
    message.isLarge ? "[Large payload]" : message.data
  );

  // Simulate processing time based on message size
  const processingTime = Math.min(message.size / 10000, 5000); // Max 5s
  await new Promise((resolve) => setTimeout(resolve, processingTime));

  // Simulate occasional failures for testing
  if (Math.random() < 0.05) {
    // 5% failure rate
    throw new Error("Random processing failure");
  }

  console.log(`message ${message.id} completed in ${processingTime}ms`);
}
