// netlify/functions/save-cv.js
// Guarda el CV en Netlify Blobs y retorna un ID único

const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGINS = [
  "https://cvitaepy.netlify.app",
  "http://localhost:8888",
  "http://localhost:3000",
];

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://cvitaepy.netlify.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const origin = event.headers["origin"] || event.headers["referer"] || "";
  if (!ALLOWED_ORIGINS.some((o) => origin.startsWith(o))) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: "Forbidden" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const { name, email, profession, job, format, cvHtml, plan } = body;

  if (!name || !email || !cvHtml) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Faltan datos requeridos" }) };
  }

  // Validar email básico
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Email inválido" }) };
  }

  const id = uid();
  const store = getStore("cvitae-orders");

  const order = {
    id,
    name,
    email,
    profession: profession || "",
    job: job || "",
    format: format || "latam",
    plan: plan || "basic",
    cvHtml,
    status: "pending", // pending | approved | sent
    createdAt: new Date().toISOString(),
    approvedAt: null,
    sentAt: null,
  };

  await store.setJSON(id, order);

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({ id, ok: true }),
  };
};
