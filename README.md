# Cloudflare Workers Poor Man Queue

A high-performance, 1ms message publishing and consuming queue built on top of Cloudflare Durable Objects. This solution is completely free with a built-in client, dead letter queues, and works out of the box with minimal setup.

## Features

- ⚡ **High Performance**: 1ms message publishing latency
- 💰 **Cost Effective**: Completely free on Cloudflare's free tier
- 🔄 **Dead Letter Queues**: Built-in retry mechanisms and failure handling
- 🛠️ **Easy Setup**: Works out of the box with minimal configuration
- 📊 **Monitoring**: Built-in stats and health check endpoints
- 🌐 **REST API**: Simple HTTP interface for external integration
- 💾 **Smart Storage**: Automatic overflow to R2 for large messages

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Configure

Update the configuration file `wrangler.jsonc` with your settings.

### 3. Create R2 Bucket

```bash
npx wrangler r2 bucket create simple-queue-storage
```

### 4. Development

```bash
npm run dev
```

### 5. Deploy

```bash
npm run deploy
```

## Usage

### Using the Client Outside the Worker

The queue provides a simple REST-based API for external integration. For more advanced usage, check the included `postman.json` collection.

#### Setup

1. Copy everything from the `src/client` directory to your project
2. Deploy the queue worker to Cloudflare
3. Get your base URL and API key from the deployment

#### Basic Example

```typescript
import { getSimpleQueueClient, IClientConfiguration } from "./path-to-client";

// Configure the client
const config: IClientConfiguration = {
  baseUrl: "https://your-worker.your-subdomain.workers.dev",
  apiKey: "your-api-key",
  maxPayloadSize: 1024 * 1024 // 1MB
};

// Get the client instance
const queueClient = getSimpleQueueClient(config);

// Example usage
async function example() {
  try {
    // Publish a message
    const response = await queueClient.publish({
      type: "user_registration",
      userId: "12345",
      email: "user@example.com",
      timestamp: Date.now()
    });

    console.log("Message published:", {
      id: response.id,
      size: response.size,
      storage: response.stored // "memory" or "r2"
    });

    // Check queue health
    const health = await queueClient.health();
    console.log("Queue health:", health);

    // Get queue statistics
    const stats = await queueClient.getStats();
    console.log("Queue stats:", {
      total: stats.total,
      processing: stats.processing,
      ready: stats.ready,
      retrying: stats.retrying,
      memoryUsage: stats.memoryUsage,
      memoryUtilization: stats.memoryUtilization,
      largeMessages: stats.largemessages,
      avgMessageSize: stats.avgmessageSize
    });

  } catch (error) {
    console.error("Queue operation failed:", error);
  }
}

// Run the example
example();
```

### API Reference

#### Publishing Messages

```typescript
const response = await queueClient.publish(data);
```

**Response:**
```typescript
{
  id: string;           // Unique message ID
  size: number;         // Message size in bytes  
  stored: "memory" | "r2"; // Storage location
}
```

#### Health Check

```typescript
const health = await queueClient.health();
```

**Response:**
```typescript
{
  status: "healthy" | "warning";
  memoryOk: boolean;
  queueOk: boolean;
  timestamp: number;
}
```

#### Queue Statistics

```typescript
const stats = await queueClient.getStats();
```

**Response:**
```typescript
{
  total: number;              // Total messages
  processing: number;         // Currently processing
  ready: number;              // Ready to process
  retrying: number;           // Being retried
  memoryUsage: number;        // Memory usage in bytes
  memoryUtilization: string;  // Memory utilization percentage
  largemessages: number;      // Messages stored in R2
  avgmessageSize: number;     // Average message size
}
```

## Queue Limits

The following limits are enforced to ensure optimal performance:

- **Max Payload Size**: Configurable per client
- **Max Batch Size**: Defined in queue configuration
- **Max Queue Memory**: Memory threshold before R2 overflow
- **Max Request Duration**: Timeout for processing requests

## Architecture

The queue uses Cloudflare Durable Objects for state management and automatic message overflow to R2 storage for large payloads. This ensures:

- **Consistency**: Durable Objects provide strong consistency
- **Scalability**: Automatic scaling with Cloudflare's edge network  
- **Reliability**: Built-in persistence and failure recovery
- **Cost Efficiency**: Free tier compatible with R2 overflow for cost control

## REST API Endpoints

For direct HTTP integration without the client library:

- `POST /publish` - Publish a message
- `GET /health` - Health check
- `GET /stats` - Queue statistics

See `postman.json` for complete API documentation and examples.

## Benchmarking & Load Testing

The queue includes comprehensive load testing capabilities using Locust to validate performance and scalability under various conditions.

### Performance Testing Setup

1. **Install Locust**:
```bash
pip install locust
```

2. **Configure Test Parameters**:
Update the `API_KEY` in the test script and set your worker URL.

3. **Run Performance Tests**:


<img src="./benchmark/result.png" wdith="600" height="600" >


```bash
cd benchmark 
```

```bash
locust -f locustfile.py --headless -u 1000 -r 100 --run-time 1m --stop-timeout 30 --host https://cfw-poor-man-queue.<your-cloudflare-worker-handler>.workers.dev 
```

### Performance Benchmarks

Based on Cloudflare's infrastructure, typical performance characteristics:

- **Enqueue Latency**: <2-20ms (95th percentile), 100ms-300ms durning buffer flush ( brief )
- **Dequeue Latency**: <5ms (95th percentile) 
- **Throughput**: 1,000+ messages/second 
- **Memory Efficiency**: Automatic R2 overflow for large payloads
- **Availability**: 99.9%+ uptime with global failover



## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the MIT License.