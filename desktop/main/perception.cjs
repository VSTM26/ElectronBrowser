const { createWorker } = require("tesseract.js");

let workerPromise = null;
const OCR_TIMEOUT_MS = 15000;

async function recognizeScreenshot({ imageBase64, maxCharacters = 2400 } = {}) {
  if (!imageBase64) {
    return {
      ok: false,
      error: "No screenshot payload was provided for OCR."
    };
  }

  try {
    const worker = await getWorker();
    const result = await withTimeout(
      worker.recognize(toPngDataUrl(imageBase64)),
      OCR_TIMEOUT_MS,
      `OCR timed out after ${Math.round(OCR_TIMEOUT_MS / 1000)}s.`
    );
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
  } catch (error) {
    await resetWorker();
    return {
      ok: false,
      error: normalizePerceptionError(error)
    };
  }
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
    workerPromise = createWorker("eng", 1, {
      errorHandler: (error) => {
        console.warn(`[perception] OCR worker error: ${normalizePerceptionError(error)}`);
      }
    });
  }

  return workerPromise;
}

async function resetWorker() {
  if (!workerPromise) {
    return;
  }

  const currentWorkerPromise = workerPromise;
  workerPromise = null;

  try {
    const worker = await currentWorkerPromise;
    await worker.terminate();
  } catch {
    // Ignore cleanup failures while resetting the OCR worker.
  }
}

function toPngDataUrl(imageBase64) {
  const normalized = String(imageBase64 || "")
    .trim()
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  return `data:image/png;base64,${normalized}`;
}

function normalizePerceptionError(error) {
  const message = String(error?.message || error || "OCR failed.");
  return message.replace(/^Error:\s*/i, "").trim();
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
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
