import os
import aiohttp
import asyncio
from dotenv import load_dotenv

load_dotenv()
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

async def list_models():
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={GOOGLE_API_KEY}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            data = await resp.json()
            if "models" in data:
                for m in data["models"]:
                    print(f"{m['name']} - {m['supportedGenerationMethods']}")
            else:
                print(f"Error: {data}")

if __name__ == "__main__":
    asyncio.run(list_models())
