const fetch = require("node-fetch");

async function testServer() {
  const payload = {
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Hi" }],
    model: "llama-3.3-70b-versatile",
    selectedModel: "llama-3.3-70b-versatile",
    provider: "Llama 3.3 70B", // Matches the provider string sent by frontend
    temperature: 0.3
  };

  try {
    const res = await fetch("http://localhost:8888/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    console.log("Server Response Status:", res.status);
    const data = await res.json();
    console.log("Server Response Data:", data);
  } catch (err) {
    console.error("Fetch Error:", err);
  }
}

testServer();
