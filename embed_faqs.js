const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${API_KEY}`;

let pipeline = null;

async function loadLocalEmbedder() {
  try {
    const { pipeline: transformersPipeline } = await import('@xenova/transformers');
    pipeline = await transformersPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("Local Transformer Model (all-MiniLM-L6-v2) loaded successfully.");
  } catch (err) {
    console.log("Transformers.js not found, using lightweight semantic dense vectorizer.");
  }
}

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

async function getEmbedding(text) {
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

  if (pipeline) {
    const output = await pipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  return createLightweightEmbedding(text);
}

function formatHours(hoursObj) {
  if (!hoursObj || typeof hoursObj !== 'object') return 'N/A';
  if (hoursObj.daily && hoursObj.daily.open) {
    return `${hoursObj.daily.open} - ${hoursObj.daily.close}`;
  }

  function formatSub(obj) {
    if (typeof obj === 'string') return obj;
    if (!obj || typeof obj !== 'object') return '';
    return Object.entries(obj)
      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
      .join(', ');
  }

  let str = [];
  if (hoursObj.weekdays) {
    str.push(`Weekdays: ${formatSub(hoursObj.weekdays)}`);
  }
  if (hoursObj.weekends) {
    str.push(`Weekends: ${formatSub(hoursObj.weekends)}`);
  }
  if (str.length > 0) return str.join(' | ');

  return formatSub(hoursObj) || 'N/A';
}

async function main() {
  await loadLocalEmbedder();

  const itemsToEmbed = [];
  let idCounter = 1;

  // 1. Load academics_with_faqs.json
  if (fs.existsSync('academics_with_faqs.json')) {
    const acadData = JSON.parse(fs.readFileSync('academics_with_faqs.json', 'utf8'));
    const list = acadData.academic_administrative || [];
    for (const item of list) {
      const entityName = item.name || '';
      const details = item.details || '';
      const location = item.location || '';
      const timings = item.timings ? `${item.timings.open} - ${item.timings.close}` : 'N/A';
      const landmarks = (item.nearby_landmarks || []).join(', ');

      for (const faq of item.faqs || []) {
        const question = faq.question || '';
        const answer = faq.answer || '';

        const embedText = `Question: ${question}\nAnswer: ${answer}\nEntity: ${entityName}\nLocation: ${location}\nDetails: ${details}`;
        
        let structuredAnswer = `**${entityName}**\n${answer}`;
        if (location) structuredAnswer += `\n📍 **Location:** ${location}`;
        if (timings !== 'N/A') structuredAnswer += `\n⏰ **Timings:** ${timings}`;
        if (landmarks) structuredAnswer += `\n📌 **Nearby Landmarks:** ${landmarks}`;

        itemsToEmbed.push({
          id: `ACAD_${idCounter++}`,
          source: 'academics_with_faqs.json',
          question,
          answer: structuredAnswer,
          entity: entityName,
          embed_text: embedText,
          context: structuredAnswer
        });
      }
    }
  }

  // 2. Load campusfacilities.json
  if (fs.existsSync('campusfacilities.json')) {
    const facData = JSON.parse(fs.readFileSync('campusfacilities.json', 'utf8'));
    for (const item of facData) {
      const entityName = item.name || '';
      const description = item.description || '';
      const location = item.location || '';
      const hoursStr = formatHours(item.operating_hours);
      const services = (item.services || []).join(', ');
      const landmarks = (item.nearby_landmarks || []).join(', ');
      const payment = (item.payment_methods || []).join(', ');

      let structuredAnswer = `**${entityName}**\n${description}`;
      if (location) structuredAnswer += `\n📍 **Location:** ${location}`;
      if (hoursStr && hoursStr !== 'N/A') structuredAnswer += `\n⏰ **Operating Hours:** ${hoursStr}`;
      if (landmarks) structuredAnswer += `\n📌 **Nearby Landmarks:** ${landmarks}`;
      if (services) structuredAnswer += `\n✨ **Services:** ${services}`;
      if (payment) structuredAnswer += `\n💳 **Payment Methods:** ${payment}`;

      for (const question of item.faqs || []) {
        const embedText = `Question: ${question}\nFacility: ${entityName}\nLocation: ${location}\nHours: ${hoursStr}\nDescription: ${description}`;

        itemsToEmbed.push({
          id: `FAC_${idCounter++}`,
          source: 'campusfacilities.json',
          question,
          answer: structuredAnswer,
          entity: entityName,
          embed_text: embedText,
          context: structuredAnswer
        });
      }
    }
  }

  console.log(`Total FAQ items to process: ${itemsToEmbed.length}`);

  const embeddingsDataset = [];
  for (let i = 0; i < itemsToEmbed.length; i++) {
    const item = itemsToEmbed[i];
    const vec = await getEmbedding(item.embed_text);
    item.embedding = vec;
    embeddingsDataset.push(item);

    if ((i + 1) % 20 === 0 || i === itemsToEmbed.length - 1) {
      console.log(`Processed embeddings for ${i + 1}/${itemsToEmbed.length} FAQs...`);
    }
  }

  fs.writeFileSync('embeddings.json', JSON.stringify(embeddingsDataset, null, 2), 'utf8');
  console.log(`Successfully generated and saved ${embeddingsDataset.length} vector embeddings to embeddings.json`);
}

main().catch(console.error);
