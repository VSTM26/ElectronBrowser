function installPageAgent() {
  if (window.__localCometPageAgent) {
    return;
  }

  const ELEMENT_ATTRIBUTE = "data-local-comet-id";
  const CURSOR_ID = "local-comet-cursor";
  const CURSOR_STYLE_ID = "local-comet-cursor-style";
  const CURSOR_TARGET_ID = "local-comet-target";

  window.__localCometPageAgent = {
    async run(command) {
      switch (command.type) {
        case "snapshot":
          return buildPageSnapshot(command.includeText !== false, command.includeMetadata === true);
        case "clickElement":
          return clickElement(command.elementId);
        case "typeIntoElement":
          return typeIntoElement(command);
        case "scrollPage":
          return scrollPage(command);
        case "hoverElement":
          return hoverElement(command.elementId);
        case "moveMouseToElement":
          return moveMouseToElement(command.elementId);
        case "moveMouseToCoordinates":
          return moveMouseToCoordinates(command);
        case "readElementText":
          return readElementText(command.elementId);
        default:
          return { ok: false, error: `Unknown page agent command: ${command.type}` };
      }
    }
  };

  function buildPageSnapshot(includeText, includeMetadata) {
    const interactiveElements = collectInteractiveElements();
    const landmarks = collectLandmarks();
    const forms = collectForms();
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
      landmarks,
      forms,
      visibleText: includeText ? collectVisibleText() : "",
      signature: buildSnapshotSignature({
        title: document.title,
        interactiveElements,
        landmarks,
        forms
      }),
      summary: `Found ${interactiveElements.length} ranked interactive elements, ${landmarks.length} landmarks, and ${forms.length} forms on ${document.title || window.location.href}.`
    };

    if (includeMetadata) {
      snapshot.metadata = collectMetadata(landmarks, forms);
    }

    return snapshot;
  }

  function collectInteractiveElements() {
    const selector = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='menuitem']",
      "[role='tab']",
      "[contenteditable='true']",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");

    const elements = [];
    let domOrder = 0;

    for (const element of document.querySelectorAll(selector)) {
      if (!isVisible(element)) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const text = truncate(composeElementText(element), 120);
      const score = computeElementScore(element, rect, text, domOrder);
      elements.push({
        id: ensureElementId(element),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        type: element.getAttribute("type") || "",
        name: element.getAttribute("name") || "",
        text,
        placeholder: element.getAttribute("placeholder") || "",
        href: element instanceof HTMLAnchorElement ? element.href : "",
        disabled: isDisabled(element),
        domPath: buildDomPath(element),
        score,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });
      domOrder += 1;

      if (elements.length >= 200) {
        break;
      }
    }

    return elements
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.rect.y !== right.rect.y) {
          return left.rect.y - right.rect.y;
        }
        if (left.rect.x !== right.rect.x) {
          return left.rect.x - right.rect.x;
        }
        return left.domPath.localeCompare(right.domPath);
      })
      .map((entry, index) => ({
        ...entry,
        rank: index + 1,
        score: Number(entry.score.toFixed(2))
      }));
  }

  function collectVisibleText() {
    return truncate((document.body?.innerText || "").replace(/\s+/g, " ").trim(), 8000);
  }

  function collectLandmarks() {
    const selector = [
      "main",
      "nav",
      "header",
      "footer",
      "aside",
      "section",
      "form",
      "[role='banner']",
      "[role='main']",
      "[role='navigation']",
      "[role='contentinfo']",
      "[role='search']",
      "[role='complementary']",
      "[role='region']",
      "[role='form']"
    ].join(",");

    return Array.from(document.querySelectorAll(selector))
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => isVisible(element) || hasVisibleChildContent(element))
      .slice(0, 24)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: ensureElementId(element),
          role: normalizeLandmarkRole(element),
          name: truncate(composeLandmarkName(element), 100),
          domPath: buildDomPath(element),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      });
  }

  function collectForms() {
    return Array.from(document.querySelectorAll("form"))
      .filter((form) => form instanceof HTMLFormElement)
      .filter((form) => isVisible(form) || hasVisibleInteractiveDescendant(form))
      .slice(0, 12)
      .map((form) => {
        const controls = Array.from(form.querySelectorAll("input, textarea, select, button"))
          .filter((element) => element instanceof HTMLElement)
          .filter(isVisible)
          .slice(0, 24);

        return {
          id: ensureElementId(form),
          name: truncate(composeLandmarkName(form), 100),
          method: (form.getAttribute("method") || "get").toLowerCase(),
          action: truncate(form.action || "", 160),
          fieldCount: controls.filter((control) => !(control instanceof HTMLButtonElement)).length,
          requiredCount: controls.filter((control) => control.hasAttribute("required")).length,
          submitButtons: controls
            .filter((control) => control instanceof HTMLButtonElement || (control instanceof HTMLInputElement && /submit|button/i.test(control.type || "")))
            .slice(0, 4)
            .map((control) => truncate(composeElementText(control), 80)),
          fields: controls
            .filter((control) => !(control instanceof HTMLButtonElement))
            .slice(0, 12)
            .map((control) => summarizeFormField(control))
        };
      });
  }

  function collectMetadata(landmarks, forms) {
    return {
      headings: Array.from(document.querySelectorAll("h1, h2, h3"))
        .filter(isVisible)
        .slice(0, 20)
        .map((heading) => ({
          level: Number.parseInt(heading.tagName.slice(1), 10),
          text: truncate(heading.textContent?.trim() || "", 120)
        })),
      links: Array.from(document.querySelectorAll("a[href]"))
        .filter(isVisible)
        .slice(0, 30)
        .map((anchor) => ({
          text: truncate(anchor.textContent?.trim() || "", 80),
          href: anchor.href
        })),
      landmarkCount: landmarks.length,
      formCount: forms.length,
      pageType: classifyPageType(forms)
    };
  }

  async function clickElement(elementId) {
    const element = getElementByAgentId(elementId);
    element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
    await moveCursorToElement(element, "Click");
    element.click();
    pulseCursor();
    return { ok: true, summary: `Clicked ${describeElement(element)}.` };
  }

  async function typeIntoElement({ elementId, text, clearFirst, submit }) {
    const element = getElementByAgentId(elementId);
    if (!(element instanceof HTMLInputElement) &&
      !(element instanceof HTMLTextAreaElement) &&
      !(element instanceof HTMLElement && element.isContentEditable)) {
      throw new Error("Target element is not text-editable.");
    }

    element.scrollIntoView({ behavior: "auto", block: "center" });
    await moveCursorToElement(element, "Type");
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
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    }

    return { ok: true, summary: `Typed into ${describeElement(element)}.` };
  }

  async function scrollPage({ direction, amount }) {
    const multiplier = Math.min(2, Math.max(0.1, Number.parseFloat(amount) || 0.8));
    const delta = Math.round(window.innerHeight * multiplier) * (direction === "up" ? -1 : 1);
    await moveMouseToCoordinates({
      x: Math.round(window.innerWidth * 0.86),
      y: Math.round(window.innerHeight * (direction === "up" ? 0.3 : 0.72)),
      label: direction === "up" ? "Scroll up" : "Scroll down"
    });
    window.scrollBy({ top: delta, behavior: "auto" });
    return { ok: true, summary: `Scrolled ${direction === "up" ? "up" : "down"} to ${Math.round(window.scrollY)}.` };
  }

  async function hoverElement(elementId) {
    const element = getElementByAgentId(elementId);
    element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
    await moveCursorToElement(element, "Hover");
    element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    return { ok: true, summary: `Hovered over ${describeElement(element)}.` };
  }

  async function moveMouseToElement(elementId) {
    const element = getElementByAgentId(elementId);
    element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
    await moveCursorToElement(element, "Move");
    return { ok: true, summary: `Moved cursor to ${describeElement(element)}.` };
  }

  async function moveMouseToCoordinates({ x, y, label }) {
    const nextX = clampNumber(x, 12, window.innerWidth - 12, Math.round(window.innerWidth / 2));
    const nextY = clampNumber(y, 12, window.innerHeight - 12, Math.round(window.innerHeight / 2));
    await animateCursor(nextX, nextY, label || "Move");
    return { ok: true, position: { x: nextX, y: nextY }, summary: `Moved cursor to (${nextX}, ${nextY}).` };
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
      element.setAttribute(ELEMENT_ATTRIBUTE, `lc-${hashString(buildElementIdentity(element))}`);
    }
    return element.getAttribute(ELEMENT_ATTRIBUTE);
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function composeElementText(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element instanceof HTMLInputElement ? element.value : "",
      element.textContent
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function summarizeFormField(control) {
    return {
      id: ensureElementId(control),
      tag: control.tagName.toLowerCase(),
      type: control.getAttribute("type") || "",
      name: control.getAttribute("name") || "",
      label: truncate(composeFieldLabel(control), 100),
      placeholder: truncate(control.getAttribute("placeholder") || "", 80),
      required: control.hasAttribute("required")
    };
  }

  function composeFieldLabel(control) {
    const htmlFor = control.getAttribute("id");
    const explicitLabel = htmlFor
      ? document.querySelector(`label[for="${CSS.escape(htmlFor)}"]`)
      : control.closest("label");

    return [
      explicitLabel?.textContent,
      control.getAttribute("aria-label"),
      control.getAttribute("name"),
      control.getAttribute("placeholder")
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function computeElementScore(element, rect, text, domOrder) {
    let score = 0;
    const area = Math.min(rect.width * rect.height, 24000) / 24000;
    const aboveFold = rect.top >= -20 && rect.top < window.innerHeight;
    const centerDistance = Math.abs((rect.top + rect.height / 2) - window.innerHeight * 0.4) / Math.max(window.innerHeight, 1);

    if (element instanceof HTMLButtonElement) {
      score += 34;
    } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      score += 30;
    } else if (element instanceof HTMLAnchorElement) {
      score += 22;
    } else {
      score += 16;
    }

    if (text) {
      score += 18;
    }

    if (element === document.activeElement) {
      score += 16;
    }

    if (aboveFold) {
      score += 16;
    }

    if (isPrimaryActionElement(element, text)) {
      score += 14;
    }

    if (isDisabled(element)) {
      score -= 24;
    }

    score += area * 18;
    score += Math.max(0, 10 - centerDistance * 10);
    score += Math.max(0, 10 - domOrder * 0.08);

    return score;
  }

  function isPrimaryActionElement(element, text) {
    const normalized = String(text || "").toLowerCase();
    return normalized.includes("continue") ||
      normalized.includes("submit") ||
      normalized.includes("search") ||
      normalized.includes("sign in") ||
      normalized.includes("log in") ||
      normalized.includes("next") ||
      normalized.includes("save") ||
      normalized.includes("confirm") ||
      element instanceof HTMLInputElement && /submit|search/i.test(element.type || "");
  }

  function isDisabled(element) {
    return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
  }

  function buildDomPath(element) {
    const segments = [];
    let current = element;

    while (current instanceof HTMLElement && segments.length < 8) {
      const parent = current.parentElement;
      let position = 1;
      if (parent) {
        const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName);
        position = Math.max(1, siblings.indexOf(current) + 1);
      }
      segments.unshift(`${current.tagName.toLowerCase()}:${position}`);
      current = parent;
    }

    return segments.join(">");
  }

  function buildElementIdentity(element) {
    return [
      element.tagName.toLowerCase(),
      element.getAttribute("role") || "",
      element.getAttribute("type") || "",
      element.getAttribute("name") || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("placeholder") || "",
      element instanceof HTMLAnchorElement ? element.href : "",
      buildDomPath(element)
    ].join("|");
  }

  function composeLandmarkName(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("aria-labelledby")
        ? document.getElementById(element.getAttribute("aria-labelledby"))?.textContent
        : "",
      element.querySelector("h1, h2, h3, legend")?.textContent,
      element.getAttribute("name")
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function normalizeLandmarkRole(element) {
    const explicitRole = element.getAttribute("role");
    if (explicitRole) {
      return explicitRole;
    }

    return element.tagName.toLowerCase();
  }

  function classifyPageType(forms) {
    const pageText = (document.body?.innerText || "").toLowerCase();
    if (pageText.includes("captcha") || pageText.includes("recaptcha") || pageText.includes("human verification")) {
      return "captcha";
    }

    if (document.querySelector("input[type='password']")) {
      return "login";
    }

    if (pageText.includes("sign in") || pageText.includes("log in") || pageText.includes("authentication required")) {
      return "login";
    }

    if (forms.some((form) => form.fieldCount >= 2 && form.submitButtons.length)) {
      return "form";
    }

    if (document.querySelector("article")) {
      return "article";
    }

    return "general";
  }

  function hasVisibleInteractiveDescendant(element) {
    return Array.from(element.querySelectorAll("input, textarea, select, button, a[href]")).some(isVisible);
  }

  function hasVisibleChildContent(element) {
    return Array.from(element.children).some((child) => child instanceof HTMLElement && isVisible(child));
  }

  function buildSnapshotSignature({ title, interactiveElements, landmarks, forms }) {
    return hashString([
      title || "",
      interactiveElements.slice(0, 20).map((entry) => `${entry.id}:${entry.rank}:${entry.text}`).join("|"),
      landmarks.slice(0, 12).map((entry) => `${entry.role}:${entry.name}`).join("|"),
      forms.slice(0, 8).map((entry) => `${entry.name}:${entry.fieldCount}:${entry.requiredCount}`).join("|")
    ].join("::"));
  }

  function hashString(value) {
    let hash = 0;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function describeElement(element) {
    const label = composeElementText(element);
    return label ? `${element.tagName.toLowerCase()} "${truncate(label, 60)}"` : element.tagName.toLowerCase();
  }

  async function moveCursorToElement(element, label) {
    ensureCursorPresentation();
    await nextFrame();
    const rect = element.getBoundingClientRect();
    const x = clampNumber(rect.left + rect.width / 2, 12, window.innerWidth - 12, Math.round(window.innerWidth / 2));
    const y = clampNumber(rect.top + Math.min(rect.height / 2, Math.max(18, rect.height - 10)), 12, window.innerHeight - 12, Math.round(window.innerHeight / 2));
    positionTargetRing(rect);
    await animateCursor(x, y, label);
  }

  async function animateCursor(x, y, label) {
    const cursor = ensureCursorPresentation();
    cursor.dataset.label = label || "";
    cursor.classList.add("is-visible");
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
    await delay(calculateTravelDuration(x, y));
  }

  function pulseCursor() {
    const cursor = ensureCursorPresentation();
    cursor.classList.remove("is-pulsing");
    void cursor.offsetWidth;
    cursor.classList.add("is-pulsing");
    setTimeout(() => cursor.classList.remove("is-pulsing"), 320);
  }

  function positionTargetRing(rect) {
    const ring = document.getElementById(CURSOR_TARGET_ID) || createTargetRing();
    ring.classList.add("is-visible");
    ring.style.left = `${Math.max(6, rect.left - 8)}px`;
    ring.style.top = `${Math.max(6, rect.top - 8)}px`;
    ring.style.width = `${Math.min(window.innerWidth - 12, rect.width + 16)}px`;
    ring.style.height = `${Math.min(window.innerHeight - 12, rect.height + 16)}px`;
    clearTimeout(positionTargetRing.timeoutId);
    positionTargetRing.timeoutId = setTimeout(() => ring.classList.remove("is-visible"), 1400);
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
          border: 1px solid rgba(255, 255, 255, 0.9);
          background: linear-gradient(145deg, rgba(88,240,209,0.98), rgba(60,199,196,0.98));
          box-shadow: 0 12px 30px rgba(9, 166, 162, 0.26);
          pointer-events: none;
          opacity: 0;
          transition: left 220ms cubic-bezier(0.2, 0.8, 0.2, 1), top 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 120ms ease;
        }

        #${CURSOR_ID}::after {
          content: attr(data-label);
          position: absolute;
          top: -12px;
          left: 16px;
          transform: rotate(45deg);
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(8, 17, 31, 0.92);
          color: white;
          font: 600 11px/1.1 sans-serif;
          white-space: nowrap;
          opacity: 0;
        }

        #${CURSOR_ID}.is-visible { opacity: 1; }
        #${CURSOR_ID}[data-label]:not([data-label=""])::after { opacity: 1; }
        #${CURSOR_ID}.is-pulsing { box-shadow: 0 0 0 12px rgba(88,240,209,0.12), 0 16px 34px rgba(9, 166, 162, 0.34); }

        #${CURSOR_TARGET_ID} {
          position: fixed;
          z-index: 2147483645;
          border-radius: 16px;
          border: 2px solid rgba(88,240,209,0.72);
          background: rgba(88,240,209,0.08);
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease;
        }

        #${CURSOR_TARGET_ID}.is-visible { opacity: 1; }
      `;
      document.documentElement.append(style);
    }

    let cursor = document.getElementById(CURSOR_ID);
    if (!cursor) {
      cursor = document.createElement("div");
      cursor.id = CURSOR_ID;
      cursor.dataset.label = "";
      cursor.setAttribute("aria-hidden", "true");
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
}

export function createPageCommandScript(command) {
  return `(${installPageAgent.toString()})(); window.__localCometPageAgent.run(${JSON.stringify(command)});`;
}
