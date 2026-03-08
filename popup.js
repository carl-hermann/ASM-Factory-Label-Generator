const mainBtn = document.getElementById('mainBtn');
const openBtn = document.getElementById('openBtn');
const status  = document.getElementById('status');
const desc    = document.getElementById('desc');

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const url = tab ? tab.url || '' : '';

  // ── Factory.app order page ──────────────────────────────────
  const isFactory = url.includes('factory.app') && url.includes('/order/');
  if (isFactory) {
    status.textContent = '\u2713 Factory.app order detected';
    status.classList.add('show');
    desc.textContent = 'Click below or use the floating button on the page.';
    mainBtn.textContent = 'Generate Labels from This Order';
    mainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      mainBtn.textContent = 'Reading order...';
      // Tell the content script to scrape (it's already injected)
      chrome.tabs.sendMessage(tab.id, { action: 'scrapeAndOpen' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Content script might not be listening for messages yet.
          // Fallback: just open the generator and let the button on-page handle it.
          mainBtn.textContent = 'Use the button on the Factory page';
          setTimeout(() => window.close(), 1500);
        } else {
          window.close();
        }
      });
    });
    return;
  }

  // ── PDF page ────────────────────────────────────────────────
  const isPdf = url.endsWith('.pdf') ||
                url.includes('.pdf?') ||
                (tab && tab.title && tab.title.toLowerCase().includes('.pdf'));
  if (isPdf || url.includes('delivery') || url.includes('docket')) {
    status.textContent = '\u2713 PDF detected in current tab';
    status.classList.add('show');
    mainBtn.textContent = 'Generate Labels from This Docket';
    mainBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      mainBtn.textContent = 'Loading...';
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          try {
            const response = await fetch(location.href);
            const buffer = await response.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
            }
            const b64 = btoa(binary);
            await chrome.storage.local.set({ pdfData: b64, pdfSource: location.href, pdfTimestamp: Date.now() });
            return true;
          } catch(err) { return false; }
        }
      }).then(() => {
        chrome.tabs.create({ url: chrome.runtime.getURL('generator.html') + '?source=storage' });
        window.close();
      }).catch(err => {
        mainBtn.textContent = 'Error - open generator manually';
        console.error(err);
      });
    });
    return;
  }

  // ── Any other page ──────────────────────────────────────────
  mainBtn.textContent = 'Open Label Generator';
  mainBtn.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('generator.html') });
    window.close();
  });
  openBtn.style.display = 'none';
});

openBtn.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('generator.html') });
  window.close();
});
