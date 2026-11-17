export function jsonResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

export function errorResult(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}

export function formatError(error) {
  if (error && typeof error.message === "string" && error.message.trim() !== "") {
    return error.message;
  }
  return String(error);
}

export function toolHandler(handler) {
  return async (args, extra) => {
    try {
      return await handler(args, extra);
    } catch (error) {
      const message = formatError(error);
      console.error(`[mikrotik-mcp] tool error: ${message}`);
      return errorResult(message);
    }
  };
}
