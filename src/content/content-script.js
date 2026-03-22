const ELEMENT_ATTRIBUTE = "data-ollama-agent-id";
const CURSOR_ID = "oa-agent-cursor";
const CURSOR_STYLE_ID = "oa-agent-cursor-style";
const CURSOR_TARGET_ID = "oa-agent-target";
let elementCounter = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case "snapshot":
          sendResponse(buildPageSnapshot(message.includeText !== false, message.includeMetadata === true));
          break;
        case "clickElement":
          sendResponse(await clickElement(message.elementId));
          break;
        case "typeIntoElement":
          sendResponse(await typeIntoElement(message));
          break;
        case "pressKey":
          sendResponse(pressKey(message.key));
          break;
        case "scrollPage":
          sendResponse(await scrollPage(message));
          break;
        case "getMetadata":
          sendResponse(getPageMetadata());
          break;
        case "selectOption":
          sendResponse(await selectOption(message));
          break;
        case "hoverElement":
          sendResponse(await hoverElement(message.elementId));
          break;
        case "moveMouseToElement":
          sendResponse(await moveMouseToElement(message.elementId));
          break;
        case "moveMouseToCoordinates":
          sendResponse(await moveMouseToCoordinates(message));
          break;
        case "readElementText":
          sendResponse(readElementText(message.elementId));
          break;
        default:
          sendResponse({ ok: false, error: `Unknown content action: ${message.type}` });
          break;
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();

  return true;
});

function buildPageSnapshot(includeText, includeMetadata) {
  const interactiveElements = collectInteractiveElements();
  const snapshot = {
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      atTop: window.scrollY < 10,
      atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 10
    },
    interactiveElements,
    visibleText: includeText ? collectVisibleText() : "",
    summary: `Found ${interactiveElements.length} interactive elements on ${document.title || window.location.href}.`
  };

  if (includeMetadata) {
    snapshot.metadata = collectMetadata();
  }

  return snapshot;
}

function collectInteractiveElements() {
  const candidates = Array.from(document.querySelectorAll([
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "textarea",
    "select",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='tab']",
    "[role='checkbox']",
    "[role='radio']",
    "[role='switch']",
    "[role='combobox']",
    "[role='searchbox']",
    "[contenteditable='true']",
    "summary",
    "details",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",")));

  const elements = [];
  for (const element of candidates) {
    if (!isVisible(element)) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const entry = {
      id: ensureElementId(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || "",
      name: element.getAttribute("name") || "",
      text: truncate(composeElementText(element), 120),
      placeholder: element.getAttribute("placeholder") || "",
      href: element instanceof HTMLAnchorElement ? element.href : "",
      disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
      checked: element.checked === true || element.getAttribute("aria-checked") === "true",
      required: element.required === true,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };

    if (element.tagName === "SELECT") {
      entry.options = collectSelectOptions(element);
    }

    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      entry.value = truncate(element.value || "", 120);
    }

    elements.push(entry);
    if (elements.length >= 200) {
      break;
    }
  }

  return elements;
}

function collectSelectOptions(selectElement) {
  const options = [];
  for (const opt of selectElement.options) {
    options.push({
      value: opt.value,
      text: truncate(opt.textContent || "", 80),
      selected: opt.selected
    });
    if (options.length >= 20) {
      break;
    }
  }
  return options;
}

function collectVisibleText() {
  const text = document.body?.innerText || "";
  return truncate(text.replace(/\s+/g, " ").trim(), 8000);
}

function collectMetadata() {
  const headings = [];
  for (const heading of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (!isVisible(heading)) continue;
    headings.push({
      level: Number.parseInt(heading.tagName.slice(1), 10),
      text: truncate(heading.textContent?.trim() || "", 120)
    });
    if (headings.length >= 30) break;
  }

  const forms = [];
  for (const form of document.querySelectorAll("form")) {
    const inputs = form.querySelectorAll("input:not([type='hidden']), textarea, select");
    forms.push({
      id: form.id || "",
      action: form.action || "",
      method: form.method || "",
      fieldCount: inputs.length,
      fields: Array.from(inputs).slice(0, 10).map((input) => ({
        tag: input.tagName.toLowerCase(),
        type: input.getAttribute("type") || "",
        name: input.getAttribute("name") || "",
        id: input.id || "",
        label: findLabelText(input),
        required: input.required === true
      }))
    });
    if (forms.length >= 10) break;
  }

  const landmarks = [];
  for (const element of document.querySelectorAll("header, nav, main, aside, footer, [role='banner'], [role='navigation'], [role='main'], [role='complementary'], [role='contentinfo'], [role='search']")) {
    if (!isVisible(element)) continue;
    landmarks.push({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      label: element.getAttribute("aria-label") || ""
    });
    if (landmarks.length >= 20) break;
  }

  const links = [];
  const seenHrefs = new Set();
  for (const anchor of document.querySelectorAll("a[href]")) {
    if (!isVisible(anchor) || seenHrefs.has(anchor.href)) continue;
    seenHrefs.add(anchor.href);
    links.push({
      text: truncate(anchor.textContent?.trim() || "", 80),
      href: anchor.href
    });
    if (links.length >= 30) break;
  }

  return {
    headings,
    forms,
    landmarks,
    links,
    hasLoginForm: detectLoginForm(),
    pageType: detectPageType()
  };
}

function detectLoginForm() {
  const passwordInputs = document.querySelectorAll("input[type='password']");
  return passwordInputs.length > 0;
}

function detectPageType() {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const body = (document.body?.innerText || "").slice(0, 2000).toLowerCase();

  if (url.includes("login") || url.includes("signin") || url.includes("sign-in")) {
    return "login";
  }
  if (url.includes("search") || url.includes("q=")) {
    return "search_results";
  }
  if (url.includes("checkout") || url.includes("cart")) {
    return "checkout";
  }
  if (url.includes("settings") || url.includes("preferences")) {
    return "settings";
  }
  if (document.querySelectorAll("input[type='password']").length > 0) {
    return "login";
  }
  return "general";
}

function findLabelText(input) {
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) {
      return truncate(label.textContent?.trim() || "", 80);
    }
  }

  const parent = input.closest("label");
  if (parent) {
    return truncate(parent.textContent?.trim() || "", 80);
  }

  return input.getAttribute("aria-label") || input.getAttribute("placeholder") || "";
}

async function clickElement(elementId) {
  const element = getElementByAgentId(elementId);
  element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
  await moveCursorToElement(element, { label: "Click" });
  element.click();
  pulseCursor("click");
  return {
    ok: true,
    summary: `Clicked ${describeElement(element)}.`
  };
}

async function typeIntoElement({ elementId, text, clearFirst, submit }) {
  const element = getElementByAgentId(elementId);
  if (!(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement) &&
    !(element instanceof HTMLElement && element.isContentEditable)) {
    throw new Error("Target element is not text-editable.");
  }

  element.scrollIntoView({ behavior: "auto", block: "center" });
  await moveCursorToElement(element, { label: "Type" });
  element.focus();
  const nextText = String(text || "");

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (clearFirst !== false) {
      element.value = "";
    }
    element.value = clearFirst === false ? `${element.value}${nextText}` : nextText;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    if (clearFirst !== false) {
      element.textContent = "";
    }
    element.textContent = clearFirst === false ? `${element.textContent || ""}${nextText}` : nextText;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextText, inputType: "insertText" }));
  }

  if (submit) {
    dispatchKeyboardEvent(element, "Enter");
    const form = element.closest("form");
    if (form) {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  }

  return {
    ok: true,
    summary: `Typed into ${describeElement(element)}.`
  };
}

function pressKey(key) {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  dispatchKeyboardEvent(target, String(key || ""));
  return {
    ok: true,
    summary: `Pressed ${key}.`
  };
}

async function scrollPage({ direction, amount }) {
  const multiplier = Math.min(2, Math.max(0.1, Number.parseFloat(amount) || 0.8));
  const delta = Math.round(window.innerHeight * multiplier) * (direction === "up" ? -1 : 1);
  await moveMouseToCoordinates({
    x: Math.round(window.innerWidth * 0.84),
    y: Math.round(window.innerHeight * (direction === "up" ? 0.28 : 0.72)),
    label: direction === "up" ? "Scroll up" : "Scroll down"
  });
  window.scrollBy({ top: delta, behavior: "auto" });
  await delay(90);
  return {
    ok: true,
    scrollY: Math.round(window.scrollY),
    atTop: window.scrollY < 10,
    atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 10,
    summary: `Scrolled ${direction === "up" ? "up" : "down"} to ${Math.round(window.scrollY)}.`
  };
}

async function selectOption({ elementId, value, text }) {
  const element = getElementByAgentId(elementId);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error("Target element is not a select dropdown.");
  }

  element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
  await moveCursorToElement(element, { label: "Select" });
  let matched = false;
  for (const option of element.options) {
    if ((value && option.value === value) || (text && option.textContent?.trim() === text)) {
      option.selected = true;
      matched = true;
      break;
    }
  }

  if (!matched) {
    for (const option of element.options) {
      if ((text && option.textContent?.trim().toLowerCase().includes(text.toLowerCase()))) {
        option.selected = true;
        matched = true;
        break;
      }
    }
  }

  if (!matched) {
    throw new Error(`No matching option found. Available: ${Array.from(element.options).map((o) => o.textContent?.trim()).join(", ")}`);
  }

  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("input", { bubbles: true }));

  return {
    ok: true,
    summary: `Selected option in ${describeElement(element)}.`
  };
}

async function hoverElement(elementId) {
  const element = getElementByAgentId(elementId);
  element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
  await moveCursorToElement(element, { label: "Hover" });

  element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

  return {
    ok: true,
    summary: `Hovered over ${describeElement(element)}.`
  };
}

async function moveMouseToElement(elementId) {
  const element = getElementByAgentId(elementId);
  element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
  await moveCursorToElement(element, { label: "Move" });
  return {
    ok: true,
    summary: `Moved cursor to ${describeElement(element)}.`
  };
}

async function moveMouseToCoordinates({ x, y, label }) {
  const nextX = clampNumber(x, 12, window.innerWidth - 12, Math.round(window.innerWidth / 2));
  const nextY = clampNumber(y, 12, window.innerHeight - 12, Math.round(window.innerHeight / 2));
  await animateCursor(nextX, nextY, label || "Move");
  return {
    ok: true,
    position: { x: nextX, y: nextY },
    summary: `Moved cursor to (${nextX}, ${nextY}).`
  };
}

function readElementText(elementId) {
  const element = getElementByAgentId(elementId);
  const fullText = element.innerText || element.textContent || "";

  return {
    ok: true,
    text: truncate(fullText.trim(), 8000),
    summary: `Read ${fullText.trim().length} characters from ${describeElement(element)}.`
  };
}

function getPageMetadata() {
  return {
    ok: true,
    ...collectMetadata()
  };
}

function getElementByAgentId(elementId) {
  const selector = `[${ELEMENT_ATTRIBUTE}="${CSS.escape(String(elementId || ""))}"]`;
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Element ${elementId} was not found. Inspect the page again.`);
  }
  return element;
}

function ensureElementId(element) {
  if (!element.hasAttribute(ELEMENT_ATTRIBUTE)) {
    element.setAttribute(ELEMENT_ATTRIBUTE, `oa-${Date.now().toString(36)}-${++elementCounter}`);
  }
  return element.getAttribute(ELEMENT_ATTRIBUTE);
}

function isVisible(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function composeElementText(element) {
  const parts = [
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    element instanceof HTMLInputElement ? element.value : "",
    element.textContent
  ].filter(Boolean);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function describeElement(element) {
  const label = composeElementText(element);
  return label ? `${element.tagName.toLowerCase()} "${truncate(label, 60)}"` : element.tagName.toLowerCase();
}

function dispatchKeyboardEvent(target, key) {
  const options = {
    key,
    bubbles: true,
    cancelable: true
  };
  target.dispatchEvent(new KeyboardEvent("keydown", options));
  target.dispatchEvent(new KeyboardEvent("keypress", options));
  target.dispatchEvent(new KeyboardEvent("keyup", options));
}

async function moveCursorToElement(element, options = {}) {
  ensureCursorPresentation();
  await nextFrame();
  const rect = element.getBoundingClientRect();
  const x = clampNumber(rect.left + rect.width / 2, 12, window.innerWidth - 12, Math.round(window.innerWidth / 2));
  const y = clampNumber(rect.top + Math.min(rect.height / 2, Math.max(18, rect.height - 10)), 12, window.innerHeight - 12, Math.round(window.innerHeight / 2));
  positionTargetRing(rect);
  await animateCursor(x, y, options.label || "Move");
}

async function animateCursor(x, y, label) {
  const cursor = ensureCursorPresentation();
  cursor.dataset.label = label || "";
  cursor.classList.add("is-visible");
  cursor.style.left = `${x}px`;
  cursor.style.top = `${y}px`;
  await delay(calculateTravelDuration(x, y));
}

function pulseCursor(kind) {
  const cursor = ensureCursorPresentation();
  cursor.dataset.state = kind || "active";
  cursor.classList.remove("is-pulsing");
  void cursor.offsetWidth;
  cursor.classList.add("is-pulsing");
  setTimeout(() => {
    cursor.dataset.state = "";
    cursor.classList.remove("is-pulsing");
  }, 320);
}

function positionTargetRing(rect) {
  const ring = document.getElementById(CURSOR_TARGET_ID) || createTargetRing();
  ring.classList.add("is-visible");
  ring.style.left = `${Math.max(6, rect.left - 8)}px`;
  ring.style.top = `${Math.max(6, rect.top - 8)}px`;
  ring.style.width = `${Math.min(window.innerWidth - 12, rect.width + 16)}px`;
  ring.style.height = `${Math.min(window.innerHeight - 12, rect.height + 16)}px`;
  clearTimeout(positionTargetRing.timeoutId);
  positionTargetRing.timeoutId = setTimeout(() => {
    ring.classList.remove("is-visible");
  }, 1400);
}

function ensureCursorPresentation() {
  let style = document.getElementById(CURSOR_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = CURSOR_STYLE_ID;
    style.textContent = `
      #${CURSOR_ID} {
        position: fixed;
        left: 50vw;
        top: 50vh;
        z-index: 2147483646;
        width: 18px;
        height: 18px;
        margin-left: -3px;
        margin-top: -3px;
        border-radius: 999px 999px 999px 0;
        transform: rotate(-45deg);
        transform-origin: 25% 25%;
        border: 1px solid rgba(255, 255, 255, 0.92);
        background:
          radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95), rgba(255,255,255,0.18) 38%, rgba(110,79,255,0.96) 76%),
          linear-gradient(145deg, rgba(135,97,255,0.98), rgba(74,36,210,0.98));
        box-shadow: 0 10px 30px rgba(54, 19, 174, 0.32), 0 0 0 1px rgba(181, 162, 255, 0.26);
        pointer-events: none;
        opacity: 0;
        transition:
          left 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
          top 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 120ms ease,
          box-shadow 160ms ease;
      }

      #${CURSOR_ID}::after {
        content: attr(data-label);
        position: absolute;
        top: -12px;
        left: 16px;
        transform: rotate(45deg);
        transform-origin: left center;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(20, 18, 29, 0.9);
        color: rgba(244, 240, 255, 0.94);
        font: 600 11px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.02em;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 120ms ease;
      }

      #${CURSOR_ID}.is-visible {
        opacity: 1;
      }

      #${CURSOR_ID}[data-label]:not([data-label=""])::after {
        opacity: 1;
      }

      #${CURSOR_ID}.is-pulsing {
        box-shadow: 0 14px 36px rgba(54, 19, 174, 0.38), 0 0 0 10px rgba(145, 116, 255, 0.16);
      }

      #${CURSOR_TARGET_ID} {
        position: fixed;
        z-index: 2147483645;
        border-radius: 16px;
        border: 2px solid rgba(125, 92, 255, 0.72);
        box-shadow: 0 18px 40px rgba(61, 30, 168, 0.12);
        background: linear-gradient(180deg, rgba(125, 92, 255, 0.09), rgba(125, 92, 255, 0.03));
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease;
      }

      #${CURSOR_TARGET_ID}.is-visible {
        opacity: 1;
      }
    `;
    document.documentElement.append(style);
  }

  let cursor = document.getElementById(CURSOR_ID);
  if (!cursor) {
    cursor = document.createElement("div");
    cursor.id = CURSOR_ID;
    cursor.setAttribute("aria-hidden", "true");
    cursor.dataset.label = "";
    cursor.dataset.state = "";
    document.documentElement.append(cursor);
  }

  if (!document.getElementById(CURSOR_TARGET_ID)) {
    createTargetRing();
  }

  return cursor;
}

function createTargetRing() {
  const ring = document.createElement("div");
  ring.id = CURSOR_TARGET_ID;
  ring.setAttribute("aria-hidden", "true");
  document.documentElement.append(ring);
  return ring;
}

function calculateTravelDuration(nextX, nextY) {
  const cursor = ensureCursorPresentation();
  const currentX = Number.parseFloat(cursor.style.left) || Math.round(window.innerWidth / 2);
  const currentY = Number.parseFloat(cursor.style.top) || Math.round(window.innerHeight / 2);
  const distance = Math.hypot(nextX - currentX, nextY - currentY);
  return Math.max(120, Math.min(360, Math.round(distance * 0.6)));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}
