# CampusNav - IIITDM Jabalpur Navigation & AI Assistant

CampusNav is an interactive web-based navigation application and query assistant built for the **PDPM IIITDM Jabalpur** campus. It combines precise GeoJSON spatial data, graph-based routing, and a semantic Retrieval-Augmented Generation (RAG) chatbot to help students, faculty, and visitors navigate the campus effortlessly.

---

## 🌟 Key Features

* **Interactive Campus Map**: Multi-layer Leaflet.js map with detailed vector boundaries for campus buildings, roads, footpaths, and entry gates.
* **Smart Route Finder**: Graph-based shortest path routing (Dijkstra algorithm) with support for multi-stop waypoints and step-by-step turn directions.
* **Instant Search & Category Filters**: Quick fuzzy searching across departments, hostels, canteens, sports complexes, and emergency facilities.
* **Campus AI Assistant (RAG Chatbot)**: Vector-based semantic query engine using Gemini API (`text-embedding-004` & `gemini-2.0-flash`) for answering questions about mess timings, department locations, and campus FAQs with cosine-similarity source citations.
* **Modern UI & Dark/Light Themes**: Dynamic glassmorphism interface with toggleable light/dark modes tailored for mobile and desktop screens.
* **PWA & Offline Caching**: Service Worker setup for fast caching and offline functionality.

---

## 🛠️ Tech Stack

* **Frontend**: HTML5, Vanilla CSS3 (Custom Design System), JavaScript (ES6+), Leaflet.js, Fuse.js, FontAwesome.
* **Backend**: Node.js, Express.js.
* **AI / Semantic Search**: Google Gemini API (`text-embedding-004`, `gemini-2.0-flash`), `@xenova/transformers` (local fallback embedder), Cosine Similarity engine.
* **Spatial Data & Graph Routing**: GeoJSON (`buildings`, `roads`, `footpaths`), custom graph representations (`nodes.json`, `edges.json`, `weights.json`).

---

## 📁 Repository Structure

```
PR-2001/
├── index.html               # Main application web layout
├── style.css                # Custom CSS design system & chatbot styling
├── server.js                # Express backend & RAG API server
├── embed_faqs.js            # Node script for generating vector embeddings
├── embed_faqs.py            # Python embedding helper script
├── service-worker.js        # Progressive Web App (PWA) cache worker
├── js/
│   ├── app.js               # Map initialization, Leaflet layers, search & routing
│   └── chatbot.js           # RAG chatbot widget UI & backend query handler
├── buildings.geojson        # Campus building polygons & metadata
├── footpaths.geojson        # Footpath spatial paths
├── roads.geojson            # Campus road network
├── nodes.json / edges.json  # Graph network used for Dijkstra navigation
├── academics_with_faqs.json # FAQ dataset for RAG system
└── embeddings.json          # Pre-computed vector embeddings database
```

---

## ⚡ Quick Start

### 1. Prerequisites
* **Node.js** (v18 or higher recommended)
* **npm** (v9 or higher)

### 2. Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sameeksha-87/campusnav.git
   cd campusnav
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory (or copy from `.env.example`):
   ```env
   PORT=3000
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
   *(Note: A Gemini API Key is optional; if omitted, the app will fall back to local feature extraction for vector search).*

4. **Generate Vector Embeddings** (Optional if `embeddings.json` is already present):
   ```bash
   npm run embed
   ```

5. **Run the Application**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your web browser.

---

## 📡 API Endpoints

* **`POST /query`**: Process user question via RAG vector search.
  * **Payload**: `{ "question": "Where is the CSE department?" }`
  * **Response**: `{ "question": "...", "answer": "...", "matches": [...] }`

* **`POST /api/reindex`**: Re-generate embeddings dataset when FAQs or academic metadata update.

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
