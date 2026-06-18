const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function test() {
  const key = process.env.GEMINI_API_KEY;
  console.log("Using API Key:", key);
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Hello" }] }]
    });
    console.log("Success! Response:", result.response.text());
  } catch (err) {
    console.error("Error encountered:");
    console.error("Message:", err.message);
    console.error("Status:", err.status || err.statusCode);
    console.error("Full Error:", err);
  }
}

test();
