export const BROWSER_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_active_tab",
      description: "Return information about the active browser tab including title, URL, and tab id.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_tabs",
      description: "List all tabs in the current window so you can switch between them.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "switch_to_tab",
      description: "Activate a tab by numeric id or fuzzy title or URL match.",
      parameters: {
        type: "object",
        properties: {
          tabId: {
            type: "integer",
            description: "Exact tab id to activate."
          },
          query: {
            type: "string",
            description: "Partial tab title or URL to search for."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "open_new_tab",
      description: "Open a new browser tab, optionally with a URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Optional absolute URL to open in the new tab."
          },
          active: {
            type: "boolean",
            description: "Whether the new tab should become active.",
            default: true
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "open_or_search",
      description: "Open a destination from the current tab. If the input is a URL or hostname it navigates there, otherwise it performs a Google search.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "URL, hostname, or free-form search query."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "inspect_page",
      description: "Capture the current page state including URL, title, visible text, and a list of all interactive elements with stable ids. Use this before clicking, typing, or scrolling.",
      parameters: {
        type: "object",
        properties: {
          includeText: {
            type: "boolean",
            description: "Whether to include a truncated visible text excerpt.",
            default: true
          },
          includeMetadata: {
            type: "boolean",
            description: "Whether to include page metadata such as forms, landmarks, and headings.",
            default: false
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click an interactive element on the current page by element id.",
      parameters: {
        type: "object",
        required: ["elementId"],
        properties: {
          elementId: {
            type: "string",
            description: "The stable element id returned by inspect_page."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "type_into_element",
      description: "Type text into an input, textarea, or contenteditable element by element id.",
      parameters: {
        type: "object",
        required: ["elementId", "text"],
        properties: {
          elementId: {
            type: "string",
            description: "The stable element id returned by inspect_page."
          },
          text: {
            type: "string",
            description: "Text to enter."
          },
          clearFirst: {
            type: "boolean",
            description: "Whether to clear existing text before typing.",
            default: true
          },
          submit: {
            type: "boolean",
            description: "Whether to press Enter after typing.",
            default: false
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "press_key",
      description: "Dispatch a keyboard key on the current page or focused element.",
      parameters: {
        type: "object",
        required: ["key"],
        properties: {
          key: {
            type: "string",
            description: "Keyboard key such as Enter, Tab, Escape, ArrowDown."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll_page",
      description: "Scroll the current page up or down by a fraction of the viewport height.",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down"],
            default: "down"
          },
          amount: {
            type: "number",
            description: "Viewport multiple between 0.1 and 2.0.",
            default: 0.8
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "navigate_to",
      description: "Navigate the current tab to an absolute URL.",
      parameters: {
        type: "object",
        required: ["url"],
        properties: {
          url: {
            type: "string",
            description: "Absolute URL starting with http or https."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Wait for a number of milliseconds to allow the page to update.",
      parameters: {
        type: "object",
        properties: {
          milliseconds: {
            type: "integer",
            description: "Delay between 100 and 10000 milliseconds.",
            default: 1000
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "reload_tab",
      description: "Reload the current tab.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "go_back",
      description: "Go back in the current tab's history.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "go_forward",
      description: "Go forward in the current tab's history.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "close_current_tab",
      description: "Close the current tab and continue in the newly active tab.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "capture_screenshot",
      description: "Capture a screenshot of the currently visible tab. Returns a data URL of the image.",
      parameters: {
        type: "object",
        properties: {
          quality: {
            type: "integer",
            description: "JPEG quality from 1 to 100.",
            default: 70
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_page_metadata",
      description: "Get structured metadata about the current page including forms, headings, landmarks, and navigation state.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "select_option",
      description: "Select an option from a dropdown/select element by value or visible text.",
      parameters: {
        type: "object",
        required: ["elementId"],
        properties: {
          elementId: {
            type: "string",
            description: "The stable element id of the select element."
          },
          value: {
            type: "string",
            description: "The value attribute of the option to select."
          },
          text: {
            type: "string",
            description: "The visible text of the option to select."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "hover_element",
      description: "Hover over an element to trigger hover effects, tooltips, or dropdown menus.",
      parameters: {
        type: "object",
        required: ["elementId"],
        properties: {
          elementId: {
            type: "string",
            description: "The stable element id returned by inspect_page."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "move_mouse_to_element",
      description: "Move the visible on-page cursor to a specific element before taking another action.",
      parameters: {
        type: "object",
        required: ["elementId"],
        properties: {
          elementId: {
            type: "string",
            description: "The stable element id returned by inspect_page."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "move_mouse_to_coordinates",
      description: "Move the visible on-page cursor to viewport coordinates when an element id is not the right fit.",
      parameters: {
        type: "object",
        required: ["x", "y"],
        properties: {
          x: {
            type: "integer",
            description: "Viewport x coordinate in pixels."
          },
          y: {
            type: "integer",
            description: "Viewport y coordinate in pixels."
          },
          label: {
            type: "string",
            description: "Optional short label to show near the cursor."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_element_text",
      description: "Read the full text content of a specific element by its id, useful for reading long text that was truncated in inspect_page.",
      parameters: {
        type: "object",
        required: ["elementId"],
        properties: {
          elementId: {
            type: "string",
            description: "The stable element id returned by inspect_page."
          }
        }
      }
    }
  }
];
