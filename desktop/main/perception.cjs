const { createWorker } = require("tesseract.js");

let workerPromise = null;

async function recognizeScreenshot({ imageBase64, maxCharacters = 2400 } = {}) {
  if (!imageBase64) {
    throw new Error("No screenshot payload was provided for OCR.");
  }

  const worker = await getWorker();
  const imageBuffer = Buffer.from(String(imageBase64), "base64");
  const result = await worker.recognize(imageBuffer);
  const data = result?.data || {};
  const words = Array.isArray(data.words) ? data.words : [];
  const filteredWords = words
    .filter((word) => typeof word?.text === "string" && word.text.trim())
    .slice(0, 48)
    .map((word) => ({
      text: truncate(word.text.trim(), 60),
      confidence: round(word.confidence),
      bbox: normalizeBbox(word.bbox)
    }));

  return {
    ok: true,
    text: truncate(normalizeText(data.text), maxCharacters),
    confidence: round(data.confidence),
    wordCount: words.length,
    words: filteredWords
  };
}

async function shutdownPerception() {
  if (!workerPromise) {
    return;
  }

  const currentWorkerPromise = workerPromise;
  workerPromise = null;

  try {
    const worker = await currentWorkerPromise;
    await worker.terminate();
  } catch {
    // Ignore cleanup errors on shutdown.
  }
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }

  return workerPromise;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeBbox(bbox) {
  if (!bbox) {
    return null;
  }

  return {
    x0: round(bbox.x0),
    y0: round(bbox.y0),
    x1: round(bbox.x1),
    y1: round(bbox.y1)
  };
}

function round(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Number(numeric.toFixed(2));
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

module.exports = {
  recognizeScreenshot,
  shutdownPerception
};
