const { GoogleGenerativeAI } = require("@google/generative-ai");

function classifyEmbedError(err) {
  const message = err?.message || String(err || 'Unknown embedding error');
  const lower = message.toLowerCase();
  if (lower.includes('invalid_api_key') || lower.includes('authentication') || lower.includes('401')) return { statusCode: 401, message: '🔑 Invalid API key. Please check your GEMINI_API_KEY in the environment.' };
  if (lower.includes('quota') || lower.includes('exceeded') || lower.includes('429') || lower.includes('rate limit')) return { statusCode: 429, message: 'Embedding quota exceeded. Please try again later, switch to Full Context mode, or upload a smaller document.' };
  if (lower.includes('timeout') || lower.includes('etimedout')) return { statusCode: 504, message: '⏱ Request timed out. The embedding service took too long to respond. Please try again.' };
  if (lower.includes('enotfound') || lower.includes('network') || lower.includes('getaddrinfo')) return { statusCode: 502, message: '📡 No internet connection. Please check your network and try again.' };
  return { statusCode: 500, message };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const km = require("./geminiKeyManager");
  const currentKey = km.getCurrentKey();
  if (!currentKey) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "🔑 Please add GEMINI_API_KEY or GEMINI_API_KEYS to your .env file." }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { texts } = body;

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "texts array is required and must be non-empty." }),
      };
    }

    const embeddingModels = ["gemini-embedding-2", "gemini-embedding-001"];
    const batchSize = 100;
    const embedBatch = async (chunkBatch, offset) => {
      let localModelIndex = 0;
      let retryCount = 0;
      const maxRetries = km.getMaxRetries();

      const batchRequest = {
        requests: chunkBatch.map(text => {
          const req = {
            content: {
              role: "user",
              parts: [{ text: text.slice(0, 2048) }]
            }
          };
          if (embeddingModels[localModelIndex] === "gemini-embedding-2") {
            req.outputDimensionality = 768;
          }
          return req;
        })
      };

      while (true) {
        const activeKey = km.getCurrentKey();
        if (!activeKey) {
          throw new Error("No available Gemini API keys.");
        }

        const genAI = new GoogleGenerativeAI(activeKey);
        let model = genAI.getGenerativeModel({ model: embeddingModels[localModelIndex] });

        const keyIndex = km.getStatus().currentIndex;
        console.log(`[Embed] model=${embeddingModels[localModelIndex]} batch=${chunkBatch.length} offset=${offset} keyIndex=${keyIndex}`);

        try {
          const timeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 12000;
          const result = await model.batchEmbedContents(batchRequest, { timeout: timeoutMs });
          if (result && result.embeddings) {
            return result.embeddings.map(e => e.values);
          } else {
            throw new Error("Batch embedding failed to return valid embeddings.");
          }
        } catch (err) {
          const errorMsg = err.message || String(err);
          
          if (km.isRotatableError(err) && retryCount < maxRetries) {
            const { rotated } = km.markKeyFailed(activeKey, errorMsg, `embed-${offset}`);
            if (rotated) {
              retryCount++;
              continue; // Retry the batch with the rotated key
            }
          }

          // Fallback to secondary model if not a quota/rate-limit error (e.g., model not found)
          const isFallbackEligible = !errorMsg.toLowerCase().includes('quota') && !errorMsg.includes('429');
          if (isFallbackEligible && localModelIndex < embeddingModels.length - 1) {
            localModelIndex++;
            console.warn(`[Embed] model unavailable, retrying batch with fallback model: ${embeddingModels[localModelIndex]}`);
            continue; // Retry the batch with fallback model (same API key)
          }

          throw err;
        }
      }
    };

    const batchPromises = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      batchPromises.push(embedBatch(texts.slice(i, i + batchSize), i));
    }

    const batchResults = await Promise.all(batchPromises);
    const embeddings = batchResults.flat();

    console.log(`[Embed] Generated ${embeddings.length} embeddings (dim=${embeddings[0]?.length || 0})`);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeddings }),
    };
  } catch (err) {
    const classified = classifyEmbedError(err);
    console.error(`[Embed] error status=${classified.statusCode} message=${classified.message}`);

    return {
      statusCode: classified.statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: classified.message }),
    };
  }
};

