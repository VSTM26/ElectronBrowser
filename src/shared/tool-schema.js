export const TOOL_RUNTIMES = {
  DESKTOP: "desktop",
  EXTENSION: "extension"
};

function defineTool(name, description, properties = {}, required = [], runtimes = [TOOL_RUNTIMES.DESKTOP, TOOL_RUNTIMES.EXTENSION]) {
  return {
    name,
    runtimes,
    tool: {
      type: "function",
      function: {
        name,
        description,
        parameters: {
          type: "object",
          required,
          properties
        }
      }
    }
  };
}

export const BROWSER_TOOL_CATALOG = [
  defineTool("get_active_tab", "Return information about the active browser tab including title, URL, and tab id."),
  defineTool("list_tabs", "List the tabs currently open in the browser shell."),
  defineTool("switch_to_tab", "Activate a tab by id or fuzzy title or URL match.", {
    tabId: { type: "string", description: "Tab id to activate." },
    query: { type: "string", description: "Partial title or URL to match." }
  }),
  defineTool("open_new_tab", "Open a new browser tab, optionally with a URL.", {
    url: { type: "string", description: "Optional destination URL." },
    active: { type: "boolean", description: "Whether the new tab becomes active.", default: true }
  }),
  defineTool("open_or_search", "Open a destination in the current tab. If the input is not a URL, run a Google search.", {
    query: { type: "string", description: "URL, hostname, or search query." }
  }, ["query"]),
  defineTool("navigate_to", "Navigate the current tab to an absolute URL.", {
    url: { type: "string", description: "Absolute URL starting with http or https." }
  }, ["url"]),
  defineTool("reload_tab", "Reload the current tab."),
  defineTool("go_back", "Go back in the current tab."),
  defineTool("go_forward", "Go forward in the current tab."),
  defineTool("close_current_tab", "Close the current tab."),
  defineTool("inspect_page", "Capture the current page state including ranked interactive elements, landmarks, form summaries, OCR-backed screenshot grounding, and the diff from the previous observation. Use this before acting.", {
    includeText: { type: "boolean", description: "Include a visible text excerpt.", default: true },
    includeMetadata: { type: "boolean", description: "Include headings, links, and page metadata.", default: true },
    includeScreenshot: { type: "boolean", description: "Capture a screenshot grounding payload for the current viewport when supported.", default: true },
    includeOcr: { type: "boolean", description: "Run OCR on the screenshot grounding payload when supported.", default: true },
    includeDiff: { type: "boolean", description: "Include the diff from the last observed page state for this tab when supported.", default: true }
  }),
  defineTool("click_element", "Click an interactive element on the current page by element id.", {
    elementId: { type: "string", description: "Stable element id from inspect_page. If you do not have the exact id, pass your best target phrase here and optionally use elementHint too." },
    elementHint: { type: "string", description: "Optional short fallback hint like 'email field' or 'Continue button'." }
  }, ["elementId"]),
  defineTool("type_into_element", "Type text into an input, textarea, or contenteditable element.", {
    elementId: { type: "string", description: "Stable element id from inspect_page. If you do not have the exact id, pass your best target phrase here and optionally use elementHint too." },
    elementHint: { type: "string", description: "Optional short fallback hint like 'email field' or 'search box'." },
    text: { type: "string", description: "Text to enter." },
    clearFirst: { type: "boolean", description: "Clear existing text first.", default: true },
    submit: { type: "boolean", description: "Press Enter after typing.", default: false }
  }, ["elementId", "text"]),
  defineTool("hover_element", "Hover over an element to reveal menus or tooltips.", {
    elementId: { type: "string", description: "Stable element id from inspect_page. If you do not have the exact id, pass your best target phrase here and optionally use elementHint too." },
    elementHint: { type: "string", description: "Optional short fallback hint for the target element." }
  }, ["elementId"]),
  defineTool("move_mouse_to_element", "Move the visible cursor to a specific element before acting.", {
    elementId: { type: "string", description: "Stable element id from inspect_page. If you do not have the exact id, pass your best target phrase here and optionally use elementHint too." },
    elementHint: { type: "string", description: "Optional short fallback hint for the target element." }
  }, ["elementId"]),
  defineTool("move_mouse_to_coordinates", "Move the visible cursor to viewport coordinates.", {
    x: { type: "integer", description: "Viewport x coordinate." },
    y: { type: "integer", description: "Viewport y coordinate." },
    label: { type: "string", description: "Optional short label near the cursor." }
  }, ["x", "y"]),
  defineTool("scroll_page", "Scroll the current page up or down by a fraction of the viewport height.", {
    direction: { type: "string", enum: ["up", "down"], default: "down" },
    amount: { type: "number", description: "Viewport multiple between 0.1 and 2.0.", default: 0.8 }
  }),
  defineTool("read_element_text", "Read the full text of a specific element.", {
    elementId: { type: "string", description: "Stable element id from inspect_page. If you do not have the exact id, pass your best target phrase here and optionally use elementHint too." },
    elementHint: { type: "string", description: "Optional short fallback hint for the target element." }
  }, ["elementId"]),
  defineTool("wait", "Wait for a number of milliseconds so the page can update.", {
    milliseconds: { type: "integer", description: "Delay between 100 and 10000 milliseconds.", default: 1000 }
  }),
  defineTool("press_key", "Dispatch a keyboard key on the current page or focused element.", {
    key: { type: "string", description: "Keyboard key such as Enter, Tab, Escape, ArrowDown." }
  }, ["key"], [TOOL_RUNTIMES.EXTENSION]),
  defineTool("capture_screenshot", "Capture a screenshot of the currently visible tab. Returns an image payload.", {
    quality: { type: "integer", description: "JPEG quality from 1 to 100.", default: 70 }
  }, [], [TOOL_RUNTIMES.EXTENSION]),
  defineTool("get_page_metadata", "Get structured metadata about the current page including forms, headings, landmarks, and navigation state.", {}, [], [TOOL_RUNTIMES.EXTENSION]),
  defineTool("select_option", "Select an option from a dropdown or select element by value or visible text.", {
    elementId: { type: "string", description: "The stable element id of the select element." },
    value: { type: "string", description: "The value attribute of the option to select." },
    text: { type: "string", description: "The visible text of the option to select." }
  }, ["elementId"], [TOOL_RUNTIMES.EXTENSION])
];

export function getBrowserTools(runtime = TOOL_RUNTIMES.EXTENSION) {
  return BROWSER_TOOL_CATALOG
    .filter((entry) => entry.runtimes.includes(runtime))
    .map((entry) => entry.tool);
}

export function getBrowserToolDefinitionMap(runtime = TOOL_RUNTIMES.EXTENSION) {
  return new Map(getBrowserTools(runtime).map((entry) => [entry.function.name, entry]));
}

export const BROWSER_TOOLS = getBrowserTools(TOOL_RUNTIMES.EXTENSION);
export const DESKTOP_BROWSER_TOOLS = getBrowserTools(TOOL_RUNTIMES.DESKTOP);
