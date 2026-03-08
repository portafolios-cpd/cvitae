// netlify/functions/chat.js
// ─────────────────────────────────────────────────────────────
// Función serverless segura para CVitae
// Protecciones:
//   1. Solo acepta POST
//   2. Valida token secreto (variable de entorno SITE_TOKEN)
//   3. Rate limiting por IP: máx 3 llamadas por día
//   4. Valida que el prompt no esté vacío ni sea demasiado largo
//   5. Cabeceras CORS correctas
// ─────────────────────────────────────────────────────────────

const Anthropic = require("@anthropic-ai/sdk");

// ── Rate limiting en memoria ──────────────────────────────────
// NOTA: En Netlify Functions cada instancia es efímera, por lo
// que este mapa se reinicia con cada cold start. Para un rate
// limiting más robusto se recomienda usar Upstash Redis o
// Netlify Blobs. Para el volumen actual (100 CVs) esto es
// suficiente y sin costo adicional.
const ipCalls = new Map(); // { ip -> { count, resetAt } }
const MAX_CALLS_PER_DAY = 3;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipCalls.get(ip);

  if (!entry || now > entry.resetAt) {
    // Primera llamada o ventana expirada: resetear
    ipCalls.set(ip, {
      count: 1,
      resetAt: now + 24 * 60 * 60 * 1000, // 24 horas
    });
    return false;
  }

  if (entry.count >= MAX_CALLS_PER_DAY) {
    return true;
  }

  entry.count += 1;
  return false;
}

// ── Handler principal ─────────────────────────────────────────
exports.handler = async (event) => {
  // 1. Solo POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // 2. CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  // 3. Parsear body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const { prompt, token } = body;

  // 4. Validar token secreto
  const expectedToken = process.env.SITE_TOKEN;
  if (!expectedToken) {
    console.error("SITE_TOKEN no configurado en variables de entorno");
    return errorResponse(500, "Server configuration error");
  }
  if (!token || token !== expectedToken) {
    return errorResponse(403, "Forbidden");
  }

  // 5. Validar prompt
  if (!prompt || typeof prompt !== "string") {
    return errorResponse(400, "Prompt requerido");
  }
  if (prompt.length > 8000) {
    return errorResponse(400, "Prompt demasiado largo");
  }

  // 6. Rate limiting por IP
  const ip =
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event.headers["client-ip"] ||
    "unknown";

  if (isRateLimited(ip)) {
    return {
      statusCode: 429,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: "Demasiadas solicitudes. Máximo 3 previews por día por IP.",
      }),
    };
  }

  // 7. Llamar a la API de Anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY no configurado");
    return errorResponse(500, "Server configuration error");
  }

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001", // Haiku: más barato, suficiente para CVs
      max_tokens: 2048,
      system:
        "Sos un experto en recursos humanos especializado en redacción de CVs profesionales para Latinoamérica y el mundo. Respondés siempre en texto plano sin markdown, sin asteriscos ni caracteres especiales de formato. Tus CVs son claros, profesionales y adaptados exactamente al puesto.",
      messages: [{ role: "user", content: prompt }],
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(message),
    };
  } catch (err) {
    console.error("Anthropic API error:", err);

    // Distinguir errores de la API de Anthropic
    if (err.status === 401) {
      return errorResponse(500, "API key inválida");
    }
    if (err.status === 429) {
      return errorResponse(503, "Límite de API alcanzado. Intentá en unos minutos.");
    }
    if (err.status === 529 || err.status === 500) {
      return errorResponse(503, "Servicio de IA temporalmente no disponible. Intentá en unos minutos.");
    }

    return errorResponse(500, "Error interno del servidor");
  }
};

// ── Helpers ───────────────────────────────────────────────────
function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://cvitaepy.netlify.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ error: message }),
  };
}
