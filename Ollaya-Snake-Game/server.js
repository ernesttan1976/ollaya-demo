const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT || 8787);
const root = __dirname;
const htmlPath = path.join(root, 'snake-ollaya.html');
const enginePath = path.join(root, 'snake-rules-engine.js');
const calculationsPath = path.join(root, 'snake-calculations.js');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return false;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

const envLoaded = loadEnv();
const ollayaUrl = process.env.OLLAYA_API_URL || 'http://127.0.0.1:62762/v1/decide';

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', chunk => {
      data += chunk;
      if (data.length > 200000) reject(new Error('Request body is too large'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Request body must be valid JSON')); }
    });
    request.on('error', reject);
  });
}

async function evolveRules(request, response) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'sk-your-key-here') {
    return sendJson(response, 503, {
      error: envLoaded ? 'OPENAI_API_KEY is missing or still set to the placeholder in .env' : 'No .env file was found next to server.js. Create one with OPENAI_API_KEY=sk-... and restart the server.'
    });
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  const model = 'gpt-5.6-luna';
  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
      body: JSON.stringify({
        model,
        stream: true,
        input: [
        {
          role: 'system',
            content: 'You evolve a Snake game runtime contract. The user payload contains files.rules.json, files.snake-calculations.js, and a complete state snapshot. Analyze all three together with the death event and human reflection. Return only a valid JSON object with version, planner, safety, evolution, and optionally calculationsSource fields. If calculationsSource is returned, preserve the executable snake-calculations.js contract: it must be JavaScript that exposes choose(state, preferred), safeDirections(state), and buildInput(state, preferred). Improve both rules and calculations based on the observed state, not by inventing unrelated fields.'
        },
        {
          role: 'user',
          content: JSON.stringify(payload)
        }
      ]
    })
  });

  if (!upstream.ok) {
    const body = await upstream.json().catch(() => ({}));
    return sendJson(response, upstream.status, { error: body.error?.message || 'OpenAI request failed' });
  }

  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'Transfer-Encoding': 'chunked' });
  let buffer = '';
  let text = '';
  const emit = event => response.write(`${JSON.stringify(event)}\n`);
  const parseLine = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    const delta = event.delta || event.output_text?.delta || event.response?.output_text?.delta;
    if (delta) { text += delta; emit({ type: 'delta', text: delta }); }
  };
  try {
    for await (const chunk of upstream.body) {
      buffer += Buffer.from(chunk).toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(parseLine);
    }
    if (buffer.trim()) parseLine(buffer.trim());
    const rules = JSON.parse(text);
    emit({ type: 'done', rules });
    response.end();
  } catch (error) {
    emit({ type: 'error', error: error.message || 'OpenAI returned invalid rules JSON' });
    response.end();
  }
}

async function askOllaya(request, response) {
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OLLAYA_API_TOKEN) headers.Authorization = `Bearer ${process.env.OLLAYA_API_TOKEN}`;
  try {
    const upstream = await fetch(ollayaUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: process.env.OLLAYA_MODEL || 'laya',
        state: {
          prompt: payload.prompt,
          input: payload.input,
          gameState: payload.state,
          rules: payload.rules,
          calculations: payload.calculations
        },
        questions: [{
          id: 'direction',
          type: 'choice',
          question: 'Choose the next legal Snake direction using the supplied ranked moves.',
          options: payload.input?.safeDirections || []
        }]
      })
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return sendJson(response, upstream.status, { error: result.error || `Ollaya returned HTTP ${upstream.status}` });
    const direction = result.direction || result.answer || result.choice || result.chosen || result.answers?.direction?.answer || result.answers?.direction?.chosen || result.answers?.[0]?.answer;
    if (!direction) return sendJson(response, 502, { error: 'Ollaya returned no direction', raw: result });
    sendJson(response, 200, { direction: String(direction).toUpperCase(), raw: result, endpoint: ollayaUrl });
  } catch (error) {
    sendJson(response, 502, { error: `Ollaya request failed: ${error.message}`, endpoint: ollayaUrl });
  }
}

const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/api/ollaya-move') {
    askOllaya(request, response).catch(error => sendJson(response, 502, { error: error.message }));
    return;
  }
  if (request.method === 'POST' && request.url === '/api/evolve-rules') {
    evolveRules(request, response).catch(error => sendJson(response, 502, { error: error.message }));
    return;
  }
  if (request.method === 'GET' && (request.url === '/' || request.url === '/snake-ollaya.html')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(htmlPath).pipe(response);
    return;
  }
  if (request.method === 'GET' && request.url === '/snake-rules-engine.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    fs.createReadStream(enginePath).pipe(response);
    return;
  }
  if (request.method === 'GET' && request.url === '/snake-calculations.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    fs.createReadStream(calculationsPath).pipe(response);
    return;
  }
  sendJson(response, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`Snake server listening on http://localhost:${port}`);
  console.log(`Ollaya decisions proxying to ${ollayaUrl}`);
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'sk-your-key-here') {
    console.warn('OpenAI evolution is disabled: add OPENAI_API_KEY to .env, then restart this server.');
  }
});
