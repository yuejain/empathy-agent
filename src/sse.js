/* Shared by the browser and regression tests. Handles named events, CRLF and split chunks. */
(function (root) {
  function createSSEParser(onEvent) {
    let buffer = '', data = [], event = 'message';
    function line(value) {
      if (value === '') {
        if (data.length) onEvent({ event, data: data.join('\n') });
        data = []; event = 'message'; return;
      }
      if (value.startsWith(':')) return;
      const colon = value.indexOf(':');
      const name = colon < 0 ? value : value.slice(0, colon);
      let content = colon < 0 ? '' : value.slice(colon + 1);
      if (content.startsWith(' ')) content = content.slice(1);
      if (name === 'data') data.push(content);
      if (name === 'event') event = content;
    }
    return {
      feed(chunk) {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          line(buffer.slice(0, index).replace(/\r$/, '')); buffer = buffer.slice(index + 1);
        }
      },
      finish() { if (buffer) line(buffer.replace(/\r$/, '')); buffer = ''; line(''); },
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createSSEParser };
  else root.createSSEParser = createSSEParser;
})(globalThis);
