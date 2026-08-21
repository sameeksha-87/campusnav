require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const EMBEDDINGS_FILE = path.join(__dirname, 'embeddings.json');
let embeddingsDataset = [];
let localEmbedder = null;

async function initLocalEmbedder() {
  try {
    const { pipeline } = await import('@xenova/transformers');
    localEmbedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("Server loaded local Transformer model (all-MiniLM-L6-v2).");
  } catch (err) {
    console.log("Transformers.js fallback embedder active.");
  }
}

initLocalEmbedder();

function loadEmbeddings() {
  if (fs.existsSync(EMBEDDINGS_FILE)) {
    try {
      embeddingsDataset = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, 'utf8'));
      console.log(`Loaded ${embeddingsDataset.length} FAQ embeddings into memory.`);
    } catch (err) {
      console.error("Error parsing embeddings.json:", err.message);
    }
  } else {
    console.warn("embeddings.json not found! Run 'npm run embed' to generate embeddings.");
  }
}

loadEmbeddings();

// Vector embedding generator
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${API_KEY}`;

function createLightweightEmbedding(text, dim = 384) {
  const vec = new Array(dim).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  
  words.forEach((word, idx) => {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const pos = Math.abs(hash) % dim;
    vec[pos] += 1.0 / Math.sqrt(words.length);
    const pos2 = Math.abs((hash ^ (idx * 31))) % dim;
    vec[pos2] += 0.5 / Math.sqrt(words.length);
  });
  
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0)) || 1e-10;
  return vec.map(v => v / norm);
}

async function getQueryEmbedding(text) {
  if (API_KEY && API_KEY.startsWith('AIza')) {
    try {
      const response = await fetch(EMBED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text }] }
        })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.embedding && data.embedding.values) {
          return data.embedding.values;
        }
      }
    } catch (e) {
      // Fallback
    }
  }

  if (localEmbedder) {
    const output = await localEmbedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  return createLightweightEmbedding(text);
}

// Cosine similarity
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

// Gemini LLM Generation
async function generateAnswerWithGemini(promptContext, question) {
  const models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
  
  for (const model of models) {
    if (!API_KEY || !API_KEY.startsWith('AIza')) break;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an official IIITDM Jabalpur Campus AI Assistant. Answer the user's question accurately using ONLY the provided verified FAQ context below. Keep your answer polite, clear, and direct.

CONTEXT:
${promptContext}

USER QUESTION: ${question}`
            }]
          }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      }
    } catch (err) {
      // try next model
    }
  }

  return null; // fallback synthesis
}

// RAG Search API Endpoint
app.post('/query', async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Question string is required' });
  }

  if (embeddingsDataset.length === 0) {
    loadEmbeddings();
    if (embeddingsDataset.length === 0) {
      return res.status(500).json({ error: 'No embeddings loaded. Please run npm run embed first.' });
    }
  }

  try {
    const queryVector = await getQueryEmbedding(question);

    // Compute cosine similarity for all dataset items
    const scoredMatches = embeddingsDataset.map(item => {
      const score = cosineSimilarity(queryVector, item.embedding);
      return {
        id: item.id,
        source: item.source,
        entity: item.entity,
        question: item.question,
        answer: item.answer,
        score: Math.round(score * 10000) / 10000
      };
    });

    // Sort by score descending and take Top 3
    scoredMatches.sort((a, b) => b.score - a.score);
    const topMatches = scoredMatches.slice(0, 3);

    // Build context string
    const contextStr = topMatches
      .map((m, i) => `[FAQ ${i + 1}] Entity: ${m.entity}\nQuestion: ${m.question}\nAnswer/Info: ${m.answer}`)
      .join('\n\n');

    // Generate final answer
    let finalAnswer = await generateAnswerWithGemini(contextStr, question);

    if (!finalAnswer) {
      const best = topMatches[0];
      if (best) {
        finalAnswer = `${best.answer}`;
      } else {
        finalAnswer = "I couldn't find specific information matching your query in the campus FAQ database.";
      }
    }

    res.json({
      question,
      answer: finalAnswer,
      matches: topMatches
    });
  } catch (err) {
    console.error("Error processing query:", err);
    res.status(500).json({ error: "Failed to process query" });
  }
});

// Endpoint to trigger dataset re-indexing
app.post('/api/reindex', (req, res) => {
  const { exec } = require('child_process');
  exec('node embed_faqs.js', (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    loadEmbeddings();
    res.json({ message: 'Successfully re-indexed dataset embeddings.', details: stdout });
  });
});

app.listen(PORT, () => {
  console.log(`Semantic RAG Chatbot Server running on http://localhost:${PORT}`);
});
