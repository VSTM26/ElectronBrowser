function installPageAgent() {
  if (window.__localCometPageAgent) {
    return;
  }

  const ELEMENT_ATTRIBUTE = "data-local-comet-id";
  const CURSOR_ID = "local-comet-cursor";
  const CURSOR_STYLE_ID = "local-comet-cursor-style";
  const CURSOR_TARGET_ID = "local-comet-target";
  const elementIds = new WeakMap();
  let nextElementId = 1;

  window.__localCometPageAgent = {
    async run(command) {
      try {
        switch (command.type) {
          case "snapshot":
            return buildPageSnapshot(command.includeText !== false, command.includeMetadata === true);
          case "clickElement":
            return clickElement(command);
          case "typeIntoElement":
            return typeIntoElement(command);
          case "scrollPage":
            return scrollPage(command);
          case "hoverElement":
            return hoverElement(command);
          case "moveMouseToElement":
            return moveMouseToElement(command);
          case "moveMouseToCoordinates":
            return moveMouseToCoordinates(command);
          case "readElementText":
            return readElementText(command);
          default:
            return { ok: false, error: `Unknown page agent command: ${command.type}`, failureCategory: "invalid_command" };
        }
      } catch (error) {
        return serializeCommandError(error);
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
        label: truncate(composeFieldLabel(element), 100),
        text,
        placeholder: element.getAttribute("placeholder") || "",
        href: element instanceof HTMLAnchorElement ? element.href : "",
        disabled: isDisabled(element),
        contentEditable: element instanceof HTMLElement && element.isContentEditable,
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

  async function clickElement({ elementId, elementHint }) {
    const resolution = resolveElementTarget({ elementId, elementHint });
    const element = resolution.element;
    if (isDisabled(element)) {
      return {
        ok: false,
        error: `${describeElement(element)} is disabled and cannot be clicked.`,
        failureCategory: "blocked_target"
      };
    }
    const beforeFocus = document.activeElement;
    const beforeState = captureElementInteractionState(element);
    element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
    await moveCursorToElement(element, "Click");
    dispatchClickSequence(element);
    await nextFrame();
    await delay(40);
    pulseCursor();
    const afterState = captureElementInteractionState(element);
    const effectDetected = !afterState.connected ||
      hasInteractionStateChanged(beforeState, afterState) ||
      document.activeElement !== beforeFocus;
    if (!effectDetected) {
      return {
        ok: false,
        error: `Clicked ${describeElement(element)}${describeResolutionSuffix(resolution)}, but no visible effect was detected.`,
        failureCategory: "no_state_change"
      };
    }
    return {
      ok: true,
      effectVerified: true,
      summary: `Clicked ${describeElement(element)}${describeResolutionSuffix(resolution)}.`
    };
  }

  async function typeIntoElement({ elementId, elementHint, text, clearFirst, submit }) {
    const resolution = resolveElementTarget({
      elementId,
      elementHint,
      editableOnly: true
    });
    const element = resolution.element;
    if (!(element instanceof HTMLInputElement) &&
      !(element instanceof HTMLTextAreaElement) &&
      !(element instanceof HTMLElement && element.isContentEditable)) {
      throw new Error("Target element is not text-editable.");
    }

    element.scrollIntoView({ behavior: "auto", block: "center" });
    await moveCursorToElement(element, "Type");
    element.focus();
    const nextText = String(text || "");
    const startingValue = readEditableValue(element);
    const expectedValue = clearFirst === false ? `${startingValue}${nextText}` : nextText;

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setNativeFormValue(element, expectedValue);
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: nextText,
        inputType: clearFirst === false ? "insertText" : "insertReplacementText"
      }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      if (clearFirst !== false) {
        element.textContent = "";
      }
      element.textContent = expectedValue;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextText, inputType: "insertText" }));
    }

    if (readEditableValue(element) !== expectedValue) {
      return {
        ok: false,
        error: `Typed into ${describeElement(element)}${describeResolutionSuffix(resolution)}, but the field did not keep the expected value.`,
        failureCategory: "input_rejected",
        expectedValue: truncate(expectedValue, 160),
        actualValue: truncate(readEditableValue(element), 160)
      };
    }

    if (submit) {
      dispatchEnterSequence(element);
      const form = element instanceof HTMLElement ? element.closest("form") : null;
      if (form instanceof HTMLFormElement && typeof form.requestSubmit === "function") {
        form.requestSubmit();
      }
    }

    return {
      ok: true,
      effectVerified: true,
      summary: `Typed into ${describeElement(element)}${describeResolutionSuffix(resolution)}.`
    };
  }

  async function scrollPage({ direction, amount }) {
    const multiplier = Math.min(2, Math.max(0.1, Number.parseFloat(amount) || 0.8));
    const delta = Math.round(window.innerHeight * multiplier) * (direction === "up" ? -1 : 1);
    const beforeWindowScroll = Math.round(window.scrollY);
    await moveMouseToCoordinates({
      x: Math.round(window.innerWidth * 0.86),
      y: Math.round(window.innerHeight * (direction === "up" ? 0.3 : 0.72)),
      label: direction === "up" ? "Scroll up" : "Scroll down"
    });
    window.scrollBy({ top: delta, behavior: "auto" });
    await nextFrame();
    await delay(40);

    const afterWindowScroll = Math.round(window.scrollY);
    if (afterWindowScroll !== beforeWindowScroll) {
      return {
        ok: true,
        effectVerified: true,
        summary: `Scrolled ${direction === "up" ? "up" : "down"} to ${afterWindowScroll}.`
      };
    }

    const scrollContainer = findBestScrollableContainer();
    if (scrollContainer) {
      const beforeContainerScroll = Math.round(scrollContainer.scrollTop);
      scrollContainer.scrollBy({ top: delta, behavior: "auto" });
      await nextFrame();
      await delay(40);
      const afterContainerScroll = Math.round(scrollContainer.scrollTop);
      if (afterContainerScroll !== beforeContainerScroll) {
        return {
          ok: true,
          effectVerified: true,
          summary: `Scrolled the active panel ${direction === "up" ? "up" : "down"} to ${afterContainerScroll}.`
        };
      }
    }

    return {
      ok: false,
      error: `Unable to scroll ${direction === "up" ? "up" : "down"} any farther in the current view.`,
      failureCategory: "no_state_change"
    };
  }

  async function hoverElement({ elementId, elementHint }) {
    const resolution = resolveElementTarget({ elementId, elementHint });
    const element = resolution.element;
    element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
    await moveCursorToElement(element, "Hover");
    element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    return { ok: true, summary: `Hovered over ${describeElement(element)}${describeResolutionSuffix(resolution)}.` };
  }

  async function moveMouseToElement({ elementId, elementHint }) {
    const resolution = resolveElementTarget({ elementId, elementHint });
    const element = resolution.element;
    element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
    await moveCursorToElement(element, "Move");
    return { ok: true, summary: `Moved cursor to ${describeElement(element)}${describeResolutionSuffix(resolution)}.` };
  }

  async function moveMouseToCoordinates({ x, y, label }) {
    const nextX = clampNumber(x, 12, window.innerWidth - 12, Math.round(window.innerWidth / 2));
    const nextY = clampNumber(y, 12, window.innerHeight - 12, Math.round(window.innerHeight / 2));
    await animateCursor(nextX, nextY, label || "Move");
    return { ok: true, position: { x: nextX, y: nextY }, summary: `Moved cursor to (${nextX}, ${nextY}).` };
  }

  function readElementText({ elementId, elementHint }) {
    const resolution = resolveElementTarget({ elementId, elementHint });
    const element = resolution.element;
    const fullText = element.innerText || element.textContent || "";
    return {
      ok: true,
      text: truncate(fullText.trim(), 8000),
      summary: `Read ${fullText.trim().length} characters from ${describeElement(element)}${describeResolutionSuffix(resolution)}.`
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
    const existingAttribute = element.getAttribute(ELEMENT_ATTRIBUTE);
    if (existingAttribute) {
      elementIds.set(element, existingAttribute);
      return existingAttribute;
    }

    const existingId = elementIds.get(element);
    if (existingId) {
      element.setAttribute(ELEMENT_ATTRIBUTE, existingId);
      return existingId;
    }

    const nextId = `lc-${nextElementId++}`;
    elementIds.set(element, nextId);
    element.setAttribute(ELEMENT_ATTRIBUTE, nextId);
    return nextId;
  }

  function resolveElementTarget({ elementId, elementHint, editableOnly = false }) {
    const exactId = String(elementId || "").trim();
    const explicitHint = normalizeElementHint(elementHint);
    if (exactId) {
      try {
        const exactElement = getElementByAgentId(exactId);
        if (!editableOnly || isEditableElement(exactElement)) {
          return {
            element: exactElement,
            matchedBy: "id",
            requested: exactId
          };
        }
      } catch {
        if (isAgentElementId(exactId) && !explicitHint) {
          throw createPageAgentError(`Element ${exactId} was not found. Inspect the page again.`, {
            failureCategory: "missing_element",
            requestedTarget: exactId
          });
        }
      }
    }

    const hint = explicitHint || (!isAgentElementId(exactId) ? normalizeElementHint(exactId) : "");
    if (hint) {
      return resolveElementTargetByHint(hint, { editableOnly });
    }

    throw createPageAgentError(`Element ${exactId || elementHint || "target"} was not found. Inspect the page again.`, {
      failureCategory: "missing_element",
      requestedTarget: exactId || elementHint || "target"
    });
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
      composeFieldLabel(element),
      element.getAttribute("aria-label"),
      element.getAttribute("name"),
      element.getAttribute("placeholder"),
      element instanceof HTMLInputElement && /checkbox|radio/i.test(element.type || "")
        ? (element.checked ? "checked" : "unchecked")
        : "",
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

  function resolveElementTargetByHint(hint, { editableOnly = false } = {}) {
    const candidates = findElementCandidatesByHint(hint, { editableOnly });
    if (!candidates.length) {
      throw createPageAgentError(`Element ${hint} was not found. Inspect the page again.`, {
        failureCategory: "missing_element",
        requestedTarget: hint
      });
    }

    const [best, second] = candidates;
    if (best.score < 6) {
      throw createPageAgentError(`I could not confidently match "${hint}" to a page element. Inspect the page again and retry with an exact element id.`, {
        failureCategory: "missing_element",
        requestedTarget: hint,
        candidates: candidates.map((candidate) => summarizeCandidate(candidate.entry, candidate.score))
      });
    }

    if (second && second.score >= best.score - 1) {
      throw createPageAgentError(`"${hint}" matches multiple similar elements. Inspect the page again and retry with an exact element id or a more specific hint.`, {
        failureCategory: "ambiguous_element",
        requestedTarget: hint,
        candidates: candidates.map((candidate) => summarizeCandidate(candidate.entry, candidate.score))
      });
    }

    return {
      element: getElementByAgentId(best.entry.id),
      matchedBy: "hint",
      requested: hint,
      matchedHint: best.hint
    };
  }

  function findElementCandidatesByHint(hint, { editableOnly = false } = {}) {
    const interactiveElements = collectInteractiveElements()
      .filter((entry) => !editableOnly || isEditableSnapshotEntry(entry));
    const normalizedHint = normalizeElementHint(hint);
    const hintTokens = normalizedHint.split(/\s+/).filter(Boolean);

    return interactiveElements
      .map((entry) => {
      const haystack = normalizeElementHint([
        entry.id,
        entry.label,
        entry.text,
        entry.name,
        entry.placeholder,
        entry.tag,
        entry.type,
        entry.role,
        entry.contentEditable ? "contenteditable" : ""
      ].filter(Boolean).join(" "));
      const score = scoreHintAgainstElement(normalizedHint, hintTokens, haystack, entry);
      return {
        entry,
        score,
        hint: normalizedHint
      };
    })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.rank - right.entry.rank)
      .slice(0, 5);
  }

  function scoreHintAgainstElement(normalizedHint, hintTokens, haystack, entry) {
    let score = 0;
    if (!normalizedHint || !haystack) {
      return score;
    }

    if (haystack.includes(normalizedHint)) {
      score += 8;
    }

    const overlap = hintTokens.filter((token) => haystack.includes(token)).length;
    score += overlap * 2;

    if (entry.label && normalizeElementHint(entry.label).includes(normalizedHint)) {
      score += 4;
    }
    if (entry.placeholder && normalizeElementHint(entry.placeholder).includes(normalizedHint)) {
      score += 4;
    }
    if (entry.name && normalizeElementHint(entry.name).includes(normalizedHint)) {
      score += 3;
    }
    if (entry.type && normalizedHint.includes(String(entry.type).toLowerCase())) {
      score += 1;
    }
    if (entry.tag === "input" && /\b(field|input|email|password|name|search)\b/.test(normalizedHint)) {
      score += 2;
    }
    if ((entry.tag === "button" || entry.role === "button") && /\b(button|submit|continue|next|save)\b/.test(normalizedHint)) {
      score += 2;
    }

    return score;
  }

  function normalizeElementHint(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/id\s*\(.*?\)/g, " ")
      .replace(/get from inspect_page/gi, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isEditableSnapshotEntry(entry) {
    return entry.tag === "input" ||
      entry.tag === "textarea" ||
      entry.role === "textbox" ||
      entry.contentEditable === true;
  }

  function isEditableElement(element) {
    return element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      (element instanceof HTMLElement && element.isContentEditable);
  }

  function setNativeFormValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    if (typeof element.setSelectionRange === "function") {
      const cursor = String(value || "").length;
      element.setSelectionRange(cursor, cursor);
    }
  }

  function describeResolutionSuffix(resolution) {
    return resolution?.matchedBy === "hint"
      ? ` (matched "${truncate(resolution.matchedHint || resolution.requested || "", 60)}")`
      : "";
  }

  function createPageAgentError(message, details = {}) {
    const error = new Error(message);
    Object.assign(error, details);
    return error;
  }

  function serializeCommandError(error) {
    const result = {
      ok: false,
      error: truncate(String(error?.message || error || "Page agent command failed."), 280),
      failureCategory: error?.failureCategory || "page_agent"
    };

    if (error?.requestedTarget) {
      result.requestedTarget = String(error.requestedTarget);
    }
    if (Array.isArray(error?.candidates) && error.candidates.length) {
      result.candidates = error.candidates.slice(0, 5);
    }

    return result;
  }

  function summarizeCandidate(entry, score) {
    return {
      id: entry.id,
      tag: entry.tag,
      type: entry.type || "",
      label: truncate(entry.label || entry.text || entry.name || entry.placeholder || entry.tag, 100),
      text: truncate(entry.text || "", 120),
      score: Number(score.toFixed(2))
    };
  }

  function isAgentElementId(value) {
    return /^lc-[a-z0-9-]+$/i.test(String(value || "").trim());
  }

  function readEditableValue(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return String(element.value || "");
    }
    return String(element.textContent || "");
  }

  function captureElementInteractionState(element) {
    return {
      connected: element.isConnected,
      url: window.location.href,
      activeTag: document.activeElement?.tagName || "",
      activeId: document.activeElement instanceof HTMLElement ? document.activeElement.getAttribute(ELEMENT_ATTRIBUTE) || "" : "",
      ariaExpanded: element.getAttribute("aria-expanded") || "",
      ariaPressed: element.getAttribute("aria-pressed") || "",
      checked: element instanceof HTMLInputElement ? element.checked : null,
      value: truncate(readEditableValue(element), 160)
    };
  }

  function hasInteractionStateChanged(beforeState, afterState) {
    return JSON.stringify(beforeState) !== JSON.stringify(afterState);
  }

  function dispatchClickSequence(element) {
    const rect = element.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
      button: 0
    };

    element.focus?.();
    element.dispatchEvent(new MouseEvent("mouseover", eventInit));
    element.dispatchEvent(new MouseEvent("mousemove", eventInit));
    element.dispatchEvent(new MouseEvent("mousedown", eventInit));
    element.dispatchEvent(new MouseEvent("mouseup", eventInit));
    element.click();
  }

  function dispatchEnterSequence(element) {
    const eventInit = { key: "Enter", code: "Enter", bubbles: true, cancelable: true };
    element.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    element.dispatchEvent(new KeyboardEvent("keypress", eventInit));
    element.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  }

  function findBestScrollableContainer() {
    const candidates = Array.from(document.querySelectorAll("*"))
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => element !== document.body && element !== document.documentElement)
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return /(auto|scroll|overlay)/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 24 &&
          element.clientHeight > 120 &&
          isVisible(element);
      })
      .slice(0, 80);

    let best = null;
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;
      const centerDistance = Math.abs((rect.top + rect.height / 2) - window.innerHeight / 2);
      const score = area - centerDistance * 120;
      if (!best || score > best.score) {
        best = { element, score };
      }
    }

    return best?.element || null;
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
