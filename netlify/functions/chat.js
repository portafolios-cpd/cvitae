// netlify/functions/chat.js
// Valida por Origin (no requiere token en el HTML)
// Rate limiting por IP: máx 3 llamadas por día

const Anthropic = require("@anthropic-ai/sdk");

// ── Rate limiting en memoria ──────────────────────────────────
const ipCalls = new Map();
const MAX_CALLS_PER_DAY = 3;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipCalls.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCalls.set(ip, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
    return false;
  }
  if (entry.count >= MAX_CALLS_PER_DAY) return true;
  entry.count += 1;
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Validar Origin
  const origin = event.headers["origin"] || event.headers["referer"] || "";
  const allowedOrigins = [
    "https://cvitaepy.netlify.app",
    "http://localhost:8888",
    "http://localhost:3000",
  ];
  if (!allowedOrigins.some(o => origin.startsWith(o))) {
    return errorResponse(403, "Forbidden");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return errorResponse(400, "Invalid JSON");
  }

  const { prompt } = body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 10) {
    return errorResponse(400, "Prompt inválido");
  }
  if (prompt.length > 8000) {
    return errorResponse(400, "Prompt demasiado largo");
  }

  const ip =
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event.headers["client-ip"] ||
    "unknown";

  if (isRateLimited(ip)) {
    return {
      statusCode: 429,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Límite alcanzado. Máximo 3 previews por día." }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY no configurado");
    return errorResponse(500, "Server configuration error");
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: "Sos un experto en recursos humanos especializado en redacción de CVs profesionales para Latinoamérica y el mundo. Respondés siempre en texto plano sin markdown, sin asteriscos ni caracteres especiales de formato. Tus CVs son claros, profesionales y adaptados exactamente al puesto.",
      messages: [{ role: "user", content: prompt }],
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(message),
    };
  } catch (err) {
    console.error("Anthropic API error:", err?.status, err?.message);
    if (err.status === 401) return errorResponse(500, "API key inválida");
    if (err.status === 429) return errorResponse(503, "Límite de API alcanzado. Intentá en unos minutos.");
    return errorResponse(500, "Error del servidor. Intentá de nuevo.");
  }
};

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://cvitaepy.netlify.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function errorResponse(statusCode, message) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}
