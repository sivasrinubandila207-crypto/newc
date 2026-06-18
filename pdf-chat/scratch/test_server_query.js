const fetch = require("node-fetch");

async function testExactUserQuery() {
  // Simulate the actual 3992 characters document text
  const docText = "Notice Board Seating Plan for B.Tech IV Semester End Examinations. ".repeat(60); 
  const payload = {
    system: `You are a helpful assistant. Here is the context:\n\n${docText}`,
    messages: [{ role: "user", content: "explain" }],
    model: "llama-3.3-70b-versatile",
    selectedModel: "llama-3.3-70b-versatile",
    provider: "Llama 3.3 70B",
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

testExactUserQuery();
