/* Coalesce transport fragments into at most one text update per animation frame. */
(function (root) {
  function createStreamRenderer({ appendText, replaceText, requestFrame = root.requestAnimationFrame.bind(root), cancelFrame = root.cancelAnimationFrame.bind(root) }) {
    let fragments = [], frame = null, rendered = '', closed = false;
    function clearFrame() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
    }
    function flush() {
      clearFrame();
      if (closed || !fragments.length) return;
      const chunk = fragments.join(''); fragments = [];
      rendered += chunk;
      appendText(chunk);
    }
    return {
      append(chunk) {
        if (closed || !chunk) return;
        fragments.push(chunk);
        if (frame === null) frame = requestFrame(flush);
      },
      flush,
      finish(content) {
        if (closed) return;
        clearFrame(); fragments = []; closed = true;
        // The server's committed result is authoritative, including output filtering.
        if (content !== rendered) replaceText(content);
        rendered = content;
      },
      cancel() { clearFrame(); fragments = []; closed = true; },
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createStreamRenderer };
  else root.createStreamRenderer = createStreamRenderer;
})(globalThis);
