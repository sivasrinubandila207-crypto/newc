const fetch = require("node-fetch");
require("dotenv").config();

async function testGroq() {
  const key = process.env.GROQ_API_KEY;
  console.log("Using Groq API Key:", key ? "Found" : "Not Found");
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10
      })
    });
    const data = await response.json();
    console.log("Groq Response Status:", response.status);
    console.log("Groq Response Data:", data);
  } catch (err) {
    console.error("Groq Error:", err);
  }
}

testGroq();
