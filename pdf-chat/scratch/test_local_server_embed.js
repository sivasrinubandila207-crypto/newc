const fetch = require('node-fetch');

async function test() {
  try {
    const res = await fetch('http://localhost:8888/api/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ texts: ['hello'] })
    });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

test();
