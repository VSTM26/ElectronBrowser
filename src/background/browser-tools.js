import { isOriginAllowed } from "../shared/storage.js";
import { SENSITIVE_KEYWORDS } from "../shared/constants.js";

const NON_WEB_PROTOCOLS = ["chrome:", "chrome-extension:", "edge:", "about:", "file:"];

export async function executeBrowserTool({ name, args, currentTabId, settings }) {
  switch (name) {
    case "get_active_tab":
      return getActiveTab();
    case "list_tabs":
      return listTabs();
    case "switch_to_tab":
      return switchToTab(args);
    case "open_new_tab":
      return openNewTab(args, settings);
    case "open_or_search":
      return openOrSearch(currentTabId, settings, args);
    case "inspect_page":
      return inspectPage(currentTabId, args, settings);
    case "click_element":
      return runTabAction(currentTabId, settings, {
        type: "clickElement",
        elementId: args.elementId
      });
    case "type_into_element":
      return runTabAction(currentTabId, settings, {
        type: "typeIntoElement",
        elementId: args.elementId,
        text: String(args.text || ""),
        clearFirst: args.clearFirst !== false,
        submit: args.submit === true
      });
    case "press_key":
      return runTabAction(currentTabId, settings, {
        type: "pressKey",
        key: String(args.key || "")
      });
    case "scroll_page":
      return runTabAction(currentTabId, settings, {
        type: "scrollPage",
        direction: args.direction === "up" ? "up" : "down",
        amount: normalizeAmount(args.amount)
      });
    case "navigate_to":
      return navigateTo(currentTabId, settings, args);
    case "reload_tab":
      return reloadTab(currentTabId);
    case "go_back":
      return goBack(currentTabId);
    case "go_forward":
      return goForward(currentTabId);
    case "close_current_tab":
      return closeCurrentTab(currentTabId);
    case "wait":
      return waitForDelay(args);
    case "capture_screenshot":
      return captureScreenshot(currentTabId, args);
    case "get_page_metadata":
      return getPageMetadata(currentTabId, settings);
    case "select_option":
      return runTabAction(currentTabId, settings, {
        type: "selectOption",
        elementId: args.elementId,
        value: args.value || "",
        text: args.text || ""
      });
    case "hover_element":
      return runTabAction(currentTabId, settings, {
        type: "hoverElement",
        elementId: args.elementId
      });
    case "move_mouse_to_element":
      return runTabAction(currentTabId, settings, {
        type: "moveMouseToElement",
        elementId: args.elementId
      });
    case "move_mouse_to_coordinates":
      return runTabAction(currentTabId, settings, {
        type: "moveMouseToCoordinates",
        x: args.x,
        y: args.y,
        label: args.label || ""
      });
    case "read_element_text":
      return runTabAction(currentTabId, settings, {
        type: "readElementText",
        elementId: args.elementId
      });
    default:
      return {
        ok: false,
        error: `Unknown tool: ${name}`
      };
  }
}

export function describeToolUse(name, args) {
  switch (name) {
    case "click_element":
      return `Click element ${args.elementId}`;
    case "type_into_element":
      return `Type into ${args.elementId}: "${truncate(args.text, 80)}"`;
    case "press_key":
      return `Press key ${args.key}`;
    case "navigate_to":
      return `Navigate to ${args.url}`;
    case "open_or_search":
      return `Open or search: ${truncate(args.query, 80)}`;
    case "open_new_tab":
      return args.url ? `Open new tab: ${args.url}` : "Open new tab";
    case "reload_tab":
      return "Reload current tab";
    case "go_back":
      return "Go back";
    case "go_forward":
      return "Go forward";
    case "close_current_tab":
      return "Close current tab";
    case "capture_screenshot":
      return "Capture screenshot of visible tab";
    case "get_page_metadata":
      return "Get page metadata (forms, headings, landmarks)";
    case "select_option":
      return `Select option in ${args.elementId}: ${args.value || args.text || ""}`;
    case "hover_element":
      return `Hover over element ${args.elementId}`;
    case "move_mouse_to_element":
      return `Move cursor to element ${args.elementId}`;
    case "move_mouse_to_coordinates":
      return `Move cursor to (${args.x}, ${args.y})`;
    case "read_element_text":
      return `Read text of element ${args.elementId}`;
    default:
      return `Run ${name}`;
  }
}

export function isSensitiveAction(name, args) {
  if (name === "click_element" || name === "type_into_element") {
    const text = String(args.text || args.elementId || "").toLowerCase();
    return SENSITIVE_KEYWORDS.some((keyword) => text.includes(keyword));
  }

  return false;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "No active tab found." };
  }

  return {
    ok: true,
    currentTabId: tab.id,
    tab: serializeTab(tab),
    summary: `Active tab is "${tab.title || tab.url || "Untitled"}".`
  };
}

async function listTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return {
    ok: true,
    tabs: tabs.map(serializeTab),
    summary: `Found ${tabs.length} tabs in the current window.`
  };
}

async function switchToTab(args) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const requestedTabId = Number.isInteger(args.tabId) ? args.tabId : Number.parseInt(args.tabId, 10);
  let target = Number.isFinite(requestedTabId)
    ? tabs.find((tab) => tab.id === requestedTabId)
    : null;

  if (!target && args.query) {
    const query = String(args.query).toLowerCase();
    target = tabs.find((tab) =>
      (tab.title || "").toLowerCase().includes(query) ||
      (tab.url || "").toLowerCase().includes(query)
    );
  }

  if (!target?.id) {
    return { ok: false, error: "Unable to find a matching tab." };
  }

  await chrome.tabs.update(target.id, { active: true });
  if (typeof target.windowId === "number") {
    await chrome.windows.update(target.windowId, { focused: true });
  }

  return {
    ok: true,
    currentTabId: target.id,
    tab: serializeTab(target),
    summary: `Switched to "${target.title || target.url || "Untitled"}".`
  };
}

async function inspectPage(tabId, args, settings) {
  const tab = await requireControllableTab(tabId, settings);
  const response = await sendMessageToTab(tab.id, {
    type: "snapshot",
    includeText: args.includeText !== false,
    includeMetadata: args.includeMetadata === true
  });
  return {
    ok: true,
    currentTabId: tab.id,
    page: response,
    summary: `Inspected ${tab.title || tab.url || "page"}. Found ${response.interactiveElements?.length || 0} interactive elements.`
  };
}

async function navigateTo(tabId, settings, args) {
  const tab = await requireExistingTab(tabId);
  const url = String(args.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "navigate_to requires an absolute http or https URL." };
  }

  if (!isOriginAllowed(url, settings)) {
    return { ok: false, error: `Navigation blocked by allowlist: ${url}` };
  }

  const waitForLoad = waitForTabComplete(tab.id);
  await chrome.tabs.update(tab.id, { url });
  await waitForLoad;
  const updated = await chrome.tabs.get(tab.id);
  return {
    ok: true,
    currentTabId: tab.id,
    tab: serializeTab(updated),
    summary: `Navigated to ${updated.url || url}.`
  };
}

async function openNewTab(args, settings) {
  const active = args.active !== false;
  const requestedUrl = String(args.url || "").trim();
  const url = requestedUrl ? normalizeDestination(requestedUrl) : undefined;
  if (url && !isAllowedHttpUrl(url, settings)) {
    return {
      ok: false,
      error: `Navigation blocked by allowlist: ${url}`
    };
  }

  const tab = await chrome.tabs.create({
    url,
    active
  });

  return {
    ok: true,
    currentTabId: tab.id,
    tab: serializeTab(tab),
    summary: url ? `Opened new tab at ${url}.` : "Opened a new tab."
  };
}

async function openOrSearch(tabId, settings, args) {
  const tab = await requireExistingTab(tabId);
  const query = String(args.query || "").trim();
  if (!query) {
    return {
      ok: false,
      error: "open_or_search requires a query."
    };
  }

  const destination = buildDestinationFromQuery(query);
  if (!isAllowedHttpUrl(destination, settings)) {
    return {
      ok: false,
      error: `Navigation blocked by allowlist: ${destination}`
    };
  }

  const waitForLoad = waitForTabComplete(tab.id);
  await chrome.tabs.update(tab.id, { url: destination });
  await waitForLoad;
  const updated = await chrome.tabs.get(tab.id);

  return {
    ok: true,
    currentTabId: updated.id,
    tab: serializeTab(updated),
    summary: isLikelyUrlQuery(query)
      ? `Opened ${updated.url || destination}.`
      : `Searched Google for "${query}".`
  };
}

async function captureScreenshot(tabId, args) {
  try {
    const tab = await requireExistingTab(tabId);
    const quality = Math.min(100, Math.max(1, Number.parseInt(args.quality, 10) || 70));
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality
    });

    return {
      ok: true,
      currentTabId: tab.id,
      screenshot: dataUrl,
      summary: `Captured screenshot of "${tab.title || tab.url || "tab"}".`
    };
  } catch (error) {
    return {
      ok: false,
      error: `Screenshot capture failed: ${error.message}`
    };
  }
}

async function getPageMetadata(tabId, settings) {
  const tab = await requireControllableTab(tabId, settings);
  const response = await sendMessageToTab(tab.id, {
    type: "getMetadata"
  });
  return {
    ok: true,
    currentTabId: tab.id,
    metadata: response,
    summary: `Got metadata for ${tab.title || tab.url || "page"}.`
  };
}

async function runTabAction(tabId, settings, payload) {
  const tab = await requireControllableTab(tabId, settings);
  const result = await sendMessageToTab(tab.id, payload);
  return {
    ok: result.ok !== false,
    currentTabId: tab.id,
    ...result
  };
}

async function requireControllableTab(tabId, settings) {
  const tab = await requireExistingTab(tabId);
  if (!tab.url) {
    throw new Error("Current tab URL is unavailable.");
  }

  if (NON_WEB_PROTOCOLS.some((protocol) => tab.url.startsWith(protocol))) {
    throw new Error(`This extension cannot control ${tab.url}. Navigate to a normal website first.`);
  }

  if (!isOriginAllowed(tab.url, settings)) {
    throw new Error(`This site is blocked by the current allowlist: ${tab.url}`);
  }

  return tab;
}

async function requireExistingTab(tabId) {
  if (!tabId) {
    throw new Error("No current tab selected.");
  }

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error(`Tab ${tabId} no longer exists. The tab may have been closed or redirected.`);
  }

  if (!tab?.id) {
    throw new Error("Current tab is unavailable.");
  }

  return tab;
}

async function reloadTab(tabId) {
  const tab = await requireExistingTab(tabId);
  const waitForLoad = waitForTabComplete(tab.id);
  await chrome.tabs.reload(tab.id);
  await waitForLoad;
  const updated = await chrome.tabs.get(tab.id);
  return {
    ok: true,
    currentTabId: updated.id,
    tab: serializeTab(updated),
    summary: `Reloaded "${updated.title || updated.url || "tab"}".`
  };
}

async function goBack(tabId) {
  return navigateHistory(tabId, "back");
}

async function goForward(tabId) {
  return navigateHistory(tabId, "forward");
}

async function closeCurrentTab(tabId) {
  const tab = await requireExistingTab(tabId);
  const windowId = tab.windowId;
  await chrome.tabs.remove(tab.id);
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  return {
    ok: true,
    currentTabId: activeTab?.id || null,
    tab: activeTab ? serializeTab(activeTab) : null,
    summary: `Closed "${tab.title || tab.url || "tab"}".`
  };
}

async function navigateHistory(tabId, direction) {
  const tab = await requireExistingTab(tabId);
  const directionApi = direction === "forward" ? chrome.tabs.goForward : chrome.tabs.goBack;
  const waitForLoad = waitForTabComplete(tab.id, 10000, true);
  await directionApi(tab.id);
  await waitForLoad;
  const updated = await chrome.tabs.get(tab.id);
  return {
    ok: true,
    currentTabId: updated.id,
    tab: serializeTab(updated),
    summary: direction === "forward"
      ? `Moved forward to "${updated.title || updated.url || "tab"}".`
      : `Moved back to "${updated.title || updated.url || "tab"}".`
  };
}

async function sendMessageToTab(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (!response) {
      throw new Error("No response from content script.");
    }
    return response;
  } catch (error) {
    if (error.message?.includes("Could not establish connection") ||
      error.message?.includes("Receiving end does not exist")) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["src/content/content-script.js"]
        });
        const retryResponse = await chrome.tabs.sendMessage(tabId, message);
        if (!retryResponse) {
          throw new Error("Content script injected but returned no response.");
        }
        return retryResponse;
      } catch (retryError) {
        throw new Error(`Unable to control the page. The page may be restricted. ${retryError.message}`);
      }
    }
    throw new Error(`Unable to control the page. Reload the tab and try again. ${error.message}`);
  }
}

async function waitForDelay(args) {
  const milliseconds = Math.min(10000, Math.max(100, Number.parseInt(args.milliseconds, 10) || 1000));
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  return {
    ok: true,
    waited: milliseconds,
    summary: `Waited ${milliseconds} ms.`
  };
}

function waitForTabComplete(tabId, timeoutMs = 15000, allowNoNavigation = false) {
  return new Promise((resolve, reject) => {
    let settled = false;
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        if (allowNoNavigation) {
          cleanup();
          settled = true;
          resolve();
        }
      }
    }).catch(() => { });

    const timeoutId = setTimeout(() => {
      cleanup();
      if (allowNoNavigation) {
        resolve();
      } else {
        reject(new Error("Timed out waiting for navigation to complete."));
      }
    }, timeoutMs);

    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        settled = true;
        resolve();
      }
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };

    chrome.tabs.onUpdated.addListener(handleUpdated);
  });
}

function buildDestinationFromQuery(query) {
  if (isLikelyUrlQuery(query)) {
    return normalizeDestination(query);
  }

  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function normalizeDestination(value) {
  const trimmed = String(value || "").trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

function isLikelyUrlQuery(value) {
  const trimmed = String(value || "").trim();
  return /^https?:\/\//i.test(trimmed) || /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed);
}

function isAllowedHttpUrl(url, settings) {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  return isOriginAllowed(url, settings);
}

function serializeTab(tab) {
  return {
    id: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    active: tab.active === true,
    status: tab.status || "",
    favIconUrl: tab.favIconUrl || ""
  };
}

function normalizeAmount(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) {
    return 0.8;
  }

  return Math.min(2, Math.max(0.1, amount));
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}
