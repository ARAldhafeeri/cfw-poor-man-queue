import random
import time
import uuid
from locust import HttpUser, task, between

class SimpleQueueTest(HttpUser):
    """
    Simplified Locust test for Cloudflare Workers Queue with Bearer token auth
    """
    
    # Test configuration - using Bearer token
    API_TOKEN = "your-secret-api-key"  # Replace with your actual API token
    
    def on_start(self):
        """Called when a user starts"""
        self.client.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.API_TOKEN}"
        })
    
    def generate_message(self, size="small"):
        """Generate message payload based on size"""
        base_message = {
            "data": {
                "type": "test",
                "id": str(uuid.uuid4()),
                "timestamp": time.time(),
                "test_id": f"test_{random.randint(1000, 9999)}"
            },
            "priority": random.randint(1, 10)
        }
        
        if size == "small":
            base_message["data"]["content"] = "Small test message for performance testing"
        elif size == "medium":
            base_message["data"]["content"] = "Medium message " + "x" * 500  # ~500 bytes
        else:  # large
            base_message["data"]["content"] = "Large message " + "y" * 2000  # ~2KB message
            
        return base_message
    
    @task(1)
    def enqueue_small_message(self):
        """Test enqueuing small messages"""
        message = self.generate_message("small")
        
        with self.client.post("/publish", json=message, catch_response=True) as response:
            if response.status_code == 200:
                response.success()

            else:
                response.failure(f"HTTP {response.status_code}")
    
    
# class HighLoadTest(SimpleQueueTest):
#     """High load test scenario with Bearer token"""
#     weight = 1
    
#     @task(7)
#     def rapid_enqueue(self):
#         message = self.generate_message("small")
#         with self.client.post("/publish", json=message, catch_response=True) as response:
#             if response.status_code == 200:
#                 response.success()
#             else:
#                 response.failure(f"HTTP {response.status_code}")
    
#     @task(3)
#     def rapid_dequeue(self):
#         with self.client.get("/poll?limit=3&timeout=1000", catch_response=True) as response:
#             if response.status_code == 200:
#                 response.success()
#             else:
#                 response.failure(f"HTTP {response.status_code}")


