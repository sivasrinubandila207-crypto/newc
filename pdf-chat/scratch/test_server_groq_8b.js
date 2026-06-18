const fetch = require("node-fetch");

async function testGroq8B() {
  const largeContext = "This is a seating plan.\n".repeat(2000);
  const payload = {
    system: `You are a helpful assistant. Here is the context:\n\n${largeContext}`,
    messages: [{ role: "user", content: "explain" }],
    model: "llama-3.1-8b-instant",
    selectedModel: "llama-3.1-8b-instant",
    provider: "Llama 3.1 8B (Fast)",
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

testGroq8B();
