// Content script - detects PDF pages and injects a "Generate Labels" button
// When clicked, fetches PDF bytes (using the tab's session/cookies)
// and stores them in chrome.storage.local for the generator page to read.

(function() {
  const isPDF =
    document.contentType === 'application/pdf' ||
    location.pathname.toLowerCase().endsWith('.pdf') ||
    document.querySelector('embed[type="application/pdf"]') !== null;

  if (!isPDF) return;
  if (document.getElementById('asm-label-btn')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'asm-label-btn';
  wrapper.innerHTML = `
    <div id="asm-label-inner" style="
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 8px;
      background: #003a5d;
      color: white;
      padding: 10px 18px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      transition: all 0.2s;
      user-select: none;
    ">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/>
      </svg>
      <span id="asm-label-text">Generate Labels</span>
    </div>
  `;

  document.body.appendChild(wrapper);

  const inner = document.getElementById('asm-label-inner');
  inner.addEventListener('mouseover', () => { inner.style.background = '#00507a'; inner.style.transform = 'translateY(-1px)'; });
  inner.addEventListener('mouseout', () => { inner.style.background = '#003a5d'; inner.style.transform = 'none'; });

  inner.addEventListener('click', async () => {
    const textEl = document.getElementById('asm-label-text');
    const origText = textEl.textContent;

    try {
      textEl.textContent = 'Loading PDF...';
      inner.style.pointerEvents = 'none';
      inner.style.opacity = '0.7';

      // Fetch the PDF bytes from the current URL (we have the right cookies/session)
      const response = await fetch(location.href);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const buffer = await response.arrayBuffer();

      // Convert to base64 for storage
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const b64 = btoa(binary);

      // Store in chrome.storage.local
      await chrome.storage.local.set({
        pdfData: b64,
        pdfSource: location.href,
        pdfTimestamp: Date.now()
      });

      // Open generator
      const generatorUrl = chrome.runtime.getURL('generator.html') + '?source=storage';
      window.open(generatorUrl, '_blank');

      textEl.textContent = origText;
      inner.style.pointerEvents = '';
      inner.style.opacity = '';

    } catch (err) {
      console.error('ASM Label Generator - failed to load PDF:', err);
      textEl.textContent = 'Error - try drag & drop';
      inner.style.background = '#dc2626';
      setTimeout(() => {
        textEl.textContent = origText;
        inner.style.background = '#003a5d';
        inner.style.pointerEvents = '';
        inner.style.opacity = '';
      }, 3000);
    }
  });
})();
