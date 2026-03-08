// Bridge between chrome.storage (extension context) and sandbox iframe.
// Reads data stored by content.js or factory-scraper.js and forwards to sandbox.html.

const iframe = document.getElementById('sandbox');
let payload = null;

const params = new URLSearchParams(location.search);
const source = params.get('source');

// ── PDF data (from content.js on PDF pages) ──────────────────────
if (source === 'storage' && chrome.storage) {
  chrome.storage.local.get(['pdfData', 'pdfSource', 'pdfTimestamp'], (result) => {
    if (!result.pdfData) return;
    if (result.pdfTimestamp && Date.now() - result.pdfTimestamp > 300000) return;

    payload = {
      type: 'loadPdf',
      pdfBase64: result.pdfData,
      pdfSource: result.pdfSource || ''
    };

    chrome.storage.local.remove(['pdfData', 'pdfSource', 'pdfTimestamp']);
    trySend();
  });
}

// ── Factory data (from factory-scraper.js on order pages) ────────
if (source === 'factory' && chrome.storage) {
  chrome.storage.local.get(['factoryData', 'factorySource', 'factoryTimestamp'], (result) => {
    if (!result.factoryData) return;
    if (result.factoryTimestamp && Date.now() - result.factoryTimestamp > 300000) return;

    payload = {
      type: 'loadFactory',
      factoryJson: result.factoryData,
      factorySource: result.factorySource || ''
    };

    chrome.storage.local.remove(['factoryData', 'factorySource', 'factoryTimestamp']);
    trySend();
  });
}

// ── Sandbox ready handshake + download relay ─────────────────────
let sandboxReady = false;
window.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'sandboxReady') {
    sandboxReady = true;
    trySend();
  }

  // Relay PDF download from sandbox (CSP blocks blob downloads in sandbox)
  if (event.data.type === 'downloadPdf' && event.data.dataUrl) {
    const a = document.createElement('a');
    a.href = event.data.dataUrl;
    a.download = event.data.filename || 'labels.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Relay PDF print from sandbox — convert dataURL to blob, load in hidden iframe, trigger print
  if (event.data.type === 'printPdf' && event.data.dataUrl) {
    // Convert data URL to blob URL (data URLs are blocked by extension CSP)
    const byteString = atob(event.data.dataUrl.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    // Remove any previous print iframe
    const old = document.getElementById('printFrame');
    if (old) old.remove();

    const printFrame = document.createElement('iframe');
    printFrame.id = 'printFrame';
    printFrame.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
    printFrame.src = blobUrl;
    printFrame.addEventListener('load', () => {
      try { printFrame.contentWindow.print(); } catch (e) { window.open(blobUrl, '_blank'); }
    });
    document.body.appendChild(printFrame);
  }
});

function trySend() {
  if (sandboxReady && payload) {
    iframe.contentWindow.postMessage(payload, '*');
    payload = null;
  }
}
