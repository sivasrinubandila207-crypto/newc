const { GoogleGenerativeAI } = require("@google/generative-ai");

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
      body: JSON.stringify({ error: "🔑 Please add GEMINI_API_KEY or GEMINI_API_KEYS to your .env file." })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { image } = body; // Base64 encoded PNG image content without data:image/png;base64 prefix
    
    if (!image) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Image data is required" })
      };
    }

    const prompt = "Perform OCR on this image. Extract all text exactly as it appears in the document, preserving structure, tables, columns, rows, labels, and values. Especially extract candidate name, father name, seat number, subject marks, and grand total if visible. Do not summarize, omit, or modify anything. Print only the exact extracted text.";

    const imageParts = [
      {
        inlineData: {
          data: image,
          mimeType: "image/png"
        }
      }
    ];

    let text = "";
    let success = false;
    let retryCount = 0;
    const maxRetries = km.getMaxRetries(); // Math.min(GEMINI_MAX_RETRIES, poolSize)

    while (true) {
      const activeKey = km.getCurrentKey();
      if (!activeKey) {
        throw new Error("No available Gemini API keys.");
      }

      try {
        const keyIndex = km.getStatus().currentIndex;
        console.log(`[Vision OCR] Sending page image to Gemini 2.5 Flash for OCR... keyIndex=${keyIndex}`);
        const genAI = new GoogleGenerativeAI(activeKey);
        // Use gemini-2.5-flash which is fast and supports vision (multimodal) input
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const timeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 12000;
        const result = await model.generateContent([prompt, ...imageParts], { timeout: timeoutMs });
        text = result.response.text() || "";
        success = true;
        break;
      } catch (err) {
        const errorMsg = err.message || String(err);
        
        if (km.isRotatableError(err) && retryCount < maxRetries) {
          const { rotated } = km.markKeyFailed(activeKey, errorMsg, "vision-ocr");
          if (rotated) {
            retryCount++;
            continue; // Retry OCR request with rotated key
          }
        }
        throw err;
      }
    }

    console.log(`[Vision OCR] Text extraction complete. Extracted ${text.length} characters.`);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    };
  } catch (err) {
    console.error("[Vision OCR] Handler error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
