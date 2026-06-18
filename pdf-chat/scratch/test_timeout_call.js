const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function test() {
  const key = process.env.GEMINI_API_KEY;
  console.log("Using API Key:", key);
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    // Setting a very small timeout (e.g. 10ms) on generateContent itself to force a timeout
    const result = await model.generateContent(
      { contents: [{ role: "user", parts: [{ text: "Hello" }] }] },
      { timeout: 10 } // 10 milliseconds
    );
    console.log("Success! Response:", result.response.text());
  } catch (err) {
    console.error("Error encountered on generateContent call:");
    console.error("Message:", err.message);
    console.error("Status:", err.status || err.statusCode);
    console.error("Name:", err.name);
  }
}

test();
