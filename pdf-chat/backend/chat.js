const fetch = require("node-fetch");
const { randomUUID } = require("crypto");

function inferProviderFromModel(modelName = "") {
  return (modelName.startsWith("gemini") || modelName.startsWith("gemma") || modelName === "auto-fallback") ? "gemini" : "groq";
}

function logChatRequest({ requestId, endpoint, selectedProvider, selectedModel, resolvedProvider, resolvedModel, testMode }) {
  console.log(
    `[AI][${requestId}] endpoint=${endpoint} selectedProvider=${selectedProvider || "unknown"} selectedModel=${selectedModel || "unknown"} resolvedProvider=${resolvedProvider} resolvedModel=${resolvedModel} testMode=${testMode ? "true" : "false"}`
  );
}

function logProviderError({ requestId, provider, model, statusCode, message, details }) {
  console.error(
    `[AI][${requestId}] provider=${provider} model=${model} status=${statusCode ?? "n/a"} error=${message}${details ? ` details=${details}` : ""}`
  );
}

function isLiveModel(modelName = "") {
  return new Set([
    "gemini-3-flash-live",
    "gemini-2.5-flash-native-audio-dialog",
    "gemini-3.5-live-translate"
  ]).has(modelName);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const requestId = event.headers?.["x-request-id"] || event.headers?.["X-Request-Id"] || randomUUID();

  try {
    const body = JSON.parse(event.body);
    const endpoint = event.path || "/api/chat";
    const testMode = endpoint.endsWith("chat-test") || body.testMode === true;
    const minimalTest = testMode || body.minimalTest === true;
    const modelName = body.model || "llama-3.3-70b-versatile";
    const selectedProvider = body.provider || inferProviderFromModel(body.selectedModel || modelName);
    const resolvedProvider = inferProviderFromModel(modelName);
    let text = "";
    let aiRequestCount = 0;
    let systemPrompt = body.system || "";

    if (isLiveModel(modelName) || isLiveModel(body.selectedModel)) {
      const message = "Experimental: Live API integration required";
      logProviderError({
        requestId,
        provider: "live",
        model: body.selectedModel || modelName,
        statusCode: 400,
        message
      });
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: message, requestId })
      };
    }

    logChatRequest({
      requestId,
      endpoint,
      selectedProvider,
      selectedModel: body.selectedModel || modelName,
      resolvedProvider,
      resolvedModel: modelName,
      testMode: minimalTest
    });

    const incomingMessages = minimalTest ? [{ role: "user", content: "Hi" }] : (body.messages || []);
    const disableFallback = minimalTest || body.disableFallback === true;
    const disableSystemPrompt = minimalTest || body.disableDocumentProcessing === true;
    // Inject developer identity instruction dynamically only if requested
    const lowerQuery = (incomingMessages && incomingMessages.length > 0) ? String(incomingMessages[incomingMessages.length - 1].content || "").toLowerCase() : '';
    const isAskingForDeveloper = /developer|creator|builder|who\s*made\s*you|who\s*built\s*you/i.test(lowerQuery);
    if (!disableSystemPrompt && isAskingForDeveloper) {
      const developerInstruction = "\nDeveloper Identity: You were developed and built by BSS. You are InsightDocs AI. If asked about your developer, builder, creator, or who made you, you must state that you were developed and built by BSS (InsightDocs AI). You must NOT mention that you are a large language model trained by Google or anything about Google. State only that you were developed by BSS.";
      if (systemPrompt) {
        systemPrompt += developerInstruction;
      } else {
        systemPrompt = developerInstruction;
      }
    }

    // Write system prompt to file in dev mode only — avoids disk I/O on every production request
    const IS_DEV = process.env.NODE_ENV !== 'production' && !process.env.NETLIFY && !process.env.RENDER;
    if (IS_DEV) {
      const fs = require('fs');
      try {
        fs.writeFileSync('./system_prompt.txt', disableSystemPrompt ? '' : (systemPrompt || ''));
      } catch (e) {
        console.error("Failed to write system prompt log:", e);
      }
    }


    const provider = resolvedProvider;
    if (provider === "gemini") {
      const km = require("./geminiKeyManager");
      
      // Check if user passed their own geminiKeys in the request body
      const usingUserGeminiKeys = body.geminiKeys && typeof body.geminiKeys === 'string';
      const userGeminiKeys = usingUserGeminiKeys ? body.geminiKeys.split(',').map(k => k.trim()).filter(Boolean) : [];

      if (!usingUserGeminiKeys && !km.getCurrentKey()) {
        logProviderError({ requestId, provider: "gemini", model: modelName, statusCode: 400, message: "No Gemini API keys configured" });
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "🔑 Please add GEMINI_API_KEY or GEMINI_API_KEYS to your .env file, or configure custom keys in the settings panel." })
        };
      }

      // Format messages for Gemini API
      const contents = [];
      let systemInstruction = "";
      
      if (systemPrompt) {
        systemInstruction = systemPrompt;
      }
      
      const chatMessages = incomingMessages;
      chatMessages.forEach(m => {
        const role = m.role === "assistant" ? "model" : "user";
        contents.push({
          role: role,
          parts: [{ text: m.content }]
        });
      });

      const { GoogleGenerativeAI } = require("@google/generative-ai");

      // Define fallback chain
      const fallbackChain = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3-flash", "gemini-3.1-flash-lite"];
      const modelsToTry = disableFallback ? [modelName]
        : modelName === "auto-fallback"
        ? fallbackChain
        : [modelName];

      let lastError = null;
      let success = false;
      let userKeysLocalIndex = 0;
      const userKeysCooldowns = new Set();

      for (const currentModel of modelsToTry) {
        let retryCount = 0;
        const maxRetries = usingUserGeminiKeys ? userGeminiKeys.length : km.getMaxRetries();

        while (true) {
          let activeKey = null;
          let keyIndex = 0;

          if (usingUserGeminiKeys) {
            // Find first user key not marked as failed/on cooldown in this request
            let found = false;
            for (let i = 0; i < userGeminiKeys.length; i++) {
              const idx = (userKeysLocalIndex + i) % userGeminiKeys.length;
              if (!userKeysCooldowns.has(idx)) {
                activeKey = userGeminiKeys[idx];
                keyIndex = idx;
                userKeysLocalIndex = idx;
                found = true;
                break;
              }
            }
            if (!found) {
              lastError = new Error("All user-supplied Gemini API keys failed or are on cooldown.");
              break;
            }
          } else {
            activeKey = km.getCurrentKey();
            keyIndex = km.getStatus().currentIndex;
          }

          if (!activeKey) {
            lastError = new Error("No available Gemini API keys.");
            break;
          }

          try {
            aiRequestCount += 1;
            console.log(`[AI][${requestId}] provider=gemini model=${currentModel} attempt=${aiRequestCount} keyIndex=${keyIndex} (userKeys=${usingUserGeminiKeys})`);
            
            const genAI = new GoogleGenerativeAI(activeKey);
            const model = genAI.getGenerativeModel({
              model: currentModel,
              systemInstruction: systemInstruction || undefined
            });

            const genConfig = {
              temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
              maxOutputTokens: body.max_tokens || 16000
            };

            const timeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 55000;
            const result = await model.generateContent({
              contents,
              generationConfig: genConfig
            }, { timeout: timeoutMs });

            text = result.response.text() || "";
            lastError = null;
            success = true;
            break; // success
          } catch (err) {
            const statusCode = err?.status || err?.response?.status || err?.cause?.statusCode || null;
            const errorMsg = err.message || String(err);

            const isRotatable = km.isRotatableError(err);
            if (isRotatable && retryCount < maxRetries) {
              if (usingUserGeminiKeys) {
                userKeysCooldowns.add(userKeysLocalIndex);
                userKeysLocalIndex = (userKeysLocalIndex + 1) % userGeminiKeys.length;
                retryCount++;
                console.warn(`[AI][${requestId}] User Gemini key[${keyIndex}] failed (reason=${errorMsg}). Rotating to next key...`);
                continue;
              } else {
                const { rotated } = km.markKeyFailed(activeKey, errorMsg, requestId);
                if (rotated) {
                  retryCount++;
                  continue;
                }
              }
            }

            // Log non-rotatable error or if max retries exceeded
            logProviderError({
              requestId,
              provider: "gemini",
              model: currentModel,
              statusCode,
              message: errorMsg
            });
            lastError = err;
            break;
          }
        }

        if (success) {
          break;
        }
      }

      if (lastError) {
        throw lastError;
      }
    } else if (provider === "groq") {
      const km = require("./geminiKeyManager"); // For reuse of isRotatableError

      // Check for user-provided groqKeys (comma-separated or single)
      const usingUserGroqKeys = body.groqKeys && typeof body.groqKeys === 'string';
      const userGroqKeys = usingUserGroqKeys ? body.groqKeys.split(',').map(k => k.trim()).filter(Boolean) : [];

      const activeGroqKeys = userGroqKeys.length > 0 ? userGroqKeys : (GROQ_API_KEY ? [GROQ_API_KEY] : []);

      if (activeGroqKeys.length === 0) {
        logProviderError({ requestId, provider: "groq", model: modelName, statusCode: 400, message: "No Groq API keys configured" });
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "🔑 Groq API key is not configured. Please add one in settings or set GROQ_API_KEY in the environment." })
        };
      }

      // Build messages array
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push(...incomingMessages);

      let groqSuccess = false;
      let groqError = null;
      let groqKeyIndex = 0;
      let groqAttempts = 0;

      while (groqAttempts < activeGroqKeys.length) {
        const currentGroqKey = activeGroqKeys[groqKeyIndex];
        try {
          aiRequestCount += 1;
          console.log(`[AI][${requestId}] provider=groq model=${modelName} attempt=${aiRequestCount} keyIndex=${groqKeyIndex} (userKeys=${usingUserGroqKeys})`);

          const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${currentGroqKey}`
            },
            body: JSON.stringify({
              model: modelName,
              messages,
              max_tokens: body.max_tokens || 8000,
              temperature: typeof body.temperature === 'number' ? body.temperature : 0.7
            })
          });

          const rawGroqBody = await response.text();
          let groqData = {};
          try {
            groqData = rawGroqBody ? JSON.parse(rawGroqBody) : {};
          } catch {
            groqData = { raw: rawGroqBody };
          }

          if (!response.ok) {
            const message = groqData?.error?.message || groqData?.message || rawGroqBody || response.statusText || "Groq request failed";
            throw new Error(message);
          }

          if (groqData.error) {
            const message = groqData.error.message || JSON.stringify(groqData.error);
            throw new Error(message);
          }

          text = groqData.choices?.[0]?.message?.content || "";
          groqSuccess = true;
          break; // success!
        } catch (err) {
          groqError = err;
          groqAttempts++;
          console.warn(`[AI][${requestId}] Groq key index ${groqKeyIndex} failed: ${err.message || err}. Rotating to next Groq key...`);
          groqKeyIndex = (groqKeyIndex + 1) % activeGroqKeys.length;
        }
      }

      if (!groqSuccess) {
        logProviderError({
          requestId,
          provider: "groq",
          model: modelName,
          statusCode: 500,
          message: groqError?.message || "All Groq keys failed"
        });
        throw groqError || new Error("All Groq keys failed");
      }
    } else {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `Unsupported provider: ${selectedProvider || provider}` , requestId })
      };
    }

    // Return in the same format the frontend expects
    const data = {
      content: [{ type: "text", text }]
    };

    console.log(`[AI][${requestId}] endpoint=${endpoint} provider=${provider} model=${modelName} status=200 apiCalls=${aiRequestCount}`);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    };
  } catch (err) {
    const errorMessage = String(err?.message || err || 'Unknown AI error');
    console.error(`[AI][${requestId}] handler failed message=${errorMessage}`);
    let friendlyMessage = errorMessage;
    let statusCode = 500;

    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo') || errorMessage.includes('network')) {
      friendlyMessage = '📡 No internet connection. Please check your network and try again.';
      statusCode = 502;
    } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
      friendlyMessage = '⏱ Request timed out. The server took too long to respond. Please try again.';
      statusCode = 504;
    } else if (errorMessage.includes('ECONNREFUSED')) {
      friendlyMessage = '🔌 Connection refused. The AI server is unreachable. Please try again later.';
      statusCode = 502;
    } else if (errorMessage.includes('401') || errorMessage.includes('invalid_api_key') || errorMessage.includes('Authentication')) {
      friendlyMessage = '🔑 Invalid API key. Please check your GROQ_API_KEY in the .env file.';
      statusCode = 401;
    } else if (errorMessage.includes('429') || errorMessage.includes('rate_limit') || errorMessage.includes('Rate limit') || errorMessage.includes('quota') || errorMessage.includes('exceeded')) {
      friendlyMessage = `📊 Daily quota exceeded: ${errorMessage}`;
      statusCode = 429;
    } else if (errorMessage.includes('500') || errorMessage.includes('Internal Server')) {
      friendlyMessage = '🛠 Groq server error. This is temporary — please try again in a few seconds.';
      statusCode = 502;
    }

    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: friendlyMessage, requestId })
    };
  }
};
