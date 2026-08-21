import os
import json
import time
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable not set")

EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={API_KEY}"

def get_embedding(text):
    payload = {
        "model": "models/text-embedding-004",
        "content": {
            "parts": [{"text": text}]
        }
    }
    resp = requests.post(EMBED_URL, json=payload)
    if resp.status_code != 200:
        print(f"Error {resp.status_code}: {resp.text}")
        resp.raise_for_status()
    data = resp.json()
    return data["embedding"]["values"]

items_to_embed = []
id_counter = 1

# 1. Load academics_with_faqs.json
with open("academics_with_faqs.json", "r", encoding="utf-8") as f:
    acad_data = json.load(f)

for item in acad_data.get("academic_administrative", []):
    entity_name = item.get("name", "")
    details = item.get("details", "")
    location = item.get("location", "")
    
    for faq in item.get("faqs", []):
        question = faq.get("question", "")
        answer = faq.get("answer", "")
        
        embed_text = f"Question: {question}\nAnswer: {answer}\nContext: {entity_name} located at {location}. {details}"
        context_text = f"Entity: {entity_name}\nQuestion: {question}\nAnswer: {answer}\nLocation: {location}"
        
        items_to_embed.append({
            "id": f"ACAD_{id_counter}",
            "source": "academics_with_faqs.json",
            "question": question,
            "answer": answer,
            "entity": entity_name,
            "embed_text": embed_text,
            "context": context_text
        })
        id_counter += 1

# 2. Load campusfacilities.json
with open("campusfacilities.json", "r", encoding="utf-8") as f:
    fac_data = json.load(f)

for item in fac_data:
    entity_name = item.get("name", "")
    description = item.get("description", "")
    location = item.get("location", "")
    hours = json.dumps(item.get("operating_hours", {}))
    services = ", ".join(item.get("services", []))
    payment = ", ".join(item.get("payment_methods", []))
    landmarks = ", ".join(item.get("nearby_landmarks", []))
    
    # Generate structured answer from facility info
    full_info = f"{description} Located at: {location}. Operating Hours: {hours}. Services: {services}. Nearby landmarks: {landmarks}. Payment: {payment}."
    
    for question in item.get("faqs", []):
        embed_text = f"Question: {question}\nFacility: {entity_name}\nLocation: {location}\nDescription: {description}"
        context_text = f"Facility: {entity_name}\nQuestion: {question}\nLocation: {location}\nDetails: {full_info}"
        
        items_to_embed.append({
            "id": f"FAC_{id_counter}",
            "source": "campusfacilities.json",
            "question": question,
            "answer": full_info,
            "entity": entity_name,
            "embed_text": embed_text,
            "context": context_text
        })
        id_counter += 1

print(f"Total items to embed: {len(items_to_embed)}")

embeddings_dataset = []
for idx, item in enumerate(items_to_embed):
    try:
        vec = get_embedding(item["embed_text"])
        item["embedding"] = vec
        embeddings_dataset.append(item)
        if (idx + 1) % 10 == 0 or idx == len(items_to_embed) - 1:
            print(f"Embedded {idx + 1}/{len(items_to_embed)} items...")
        time.sleep(0.1) # avoid rate limits
    except Exception as e:
        print(f"Failed to embed item {item['id']}: {e}")

with open("embeddings.json", "w", encoding="utf-8") as f:
    json.dump(embeddings_dataset, f, indent=2, ensure_ascii=False)

print(f"Successfully saved {len(embeddings_dataset)} embeddings to embeddings.json")
