// Factory.app generic content script
// Runs on app.factory.app order pages, scrapes ALL order data using
// stable data-testid selectors + DOM structure, and injects a
// "Generate Labels" button.
//
// Supports all order types: UGL deliveries, flashings/drawings,
// laser/fab jobs, and generic orders.

(function() {
  'use strict';

  if (!location.hostname.includes('factory.app')) return;

  /* --- Header button (next to Edit Order) ------------------------ */
  let debounceTimer = null;

  function tryInject() {
    // Find the Edit Order button in the header nav
    const editBtn = Array.from(document.querySelectorAll('.navbar-order button'))
      .find(b => b.textContent.trim() === 'Edit Order');

    const existing = document.getElementById('asm-label-btn');

    // No Edit Order button → remove ours if present
    if (!editBtn) {
      if (existing) {
        const li = existing.closest('li');
        if (li) li.remove(); else existing.remove();
      }
      return;
    }

    // Already injected → nothing to do
    if (existing) return;

    const ul = editBtn.closest('ul');
    if (!ul) return;

    const li = document.createElement('li');
    li.className = 'mr-2_5 nav-item';

    const btn = document.createElement('button');
    btn.id = 'asm-label-btn';
    btn.type = 'button';
    btn.className = 'btn btn-outline-primary btn-sm';
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         style="flex-shrink:0">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <line x1="6" y1="8" x2="6" y2="16"/>
      <line x1="9" y1="8" x2="9" y2="16" stroke-width="1.5"/>
      <line x1="12" y1="8" x2="12" y2="16"/>
      <line x1="15" y1="8" x2="15" y2="16" stroke-width="1.5"/>
      <line x1="18" y1="8" x2="18" y2="16"/>
    </svg><span id="asm-label-text">Generate Labels</span>`;
    btn.addEventListener('click', handleClick);

    li.appendChild(btn);
    const editLi = editBtn.closest('li');
    ul.insertBefore(li, editLi);
  }

  // MutationObserver watches for SPA navigation / header rendering
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryInject, 200);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial attempts for first page load
  tryInject();
  setTimeout(tryInject, 500);
  setTimeout(tryInject, 1500);

  /* --- Click -> scrape -> store -> open generator ---------------- */
  async function handleClick() {
    const textEl = document.getElementById('asm-label-text');
    const btn    = document.getElementById('asm-label-btn');
    const orig   = textEl.textContent;

    try {
      textEl.textContent = 'Reading order...';
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.7';

      const data = scrapeOrder();
      if (!data.drawings.length && !data.products.length) {
        throw new Error('No products or drawings found on page');
      }

      await chrome.storage.local.set({
        factoryData:      JSON.stringify(data),
        factorySource:    location.href,
        factoryTimestamp: Date.now()
      });

      window.open(
        chrome.runtime.getURL('generator.html') + '?source=factory',
        '_blank'
      );

      textEl.textContent = orig;
      btn.style.pointerEvents = '';
      btn.style.opacity = '';
    } catch (err) {
      console.error('[ASM Labels]', err);
      textEl.textContent = 'Error: ' + err.message;
      btn.classList.replace('btn-outline-primary', 'btn-danger');
      setTimeout(() => {
        textEl.textContent = orig;
        btn.classList.replace('btn-danger', 'btn-outline-primary');
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
      }, 3000);
    }
  }

  /* --- Helpers --------------------------------------------------- */
  function txt(selector, root) {
    const el = (root || document).querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  function txtAll(selector, root) {
    return Array.from((root || document).querySelectorAll(selector))
      .map(el => el.textContent.trim())
      .filter(Boolean);
  }

  /* --- Page scraper ---------------------------------------------- */
  function scrapeOrder() {
    const data = {
      header: {
        orderNumber: '',
        po: '',
        customer: '',
        customerCompany: '',
        contact: { name: '', phone: '', email: '' },
        billTo: { address: '', city: '' },
        createdBy: '',
        createdDate: '',
        requiredDate: '',
        notes: '',
        pickupNotes: '',
        status: '',
        qboNumber: '',
      },
      drawings: [],
      products: [],
      totals: {
        labour: '',
        subTotal: '',
        tax: '',
        total: '',
      },
      orderType: 'generic',
      factoryLink: location.href,
    };

    // -- Header fields via data-testid selectors --
    const h = data.header;

    // Order # from page title
    const pageText = document.body.innerText || '';
    const orderM = pageText.match(/ORDER\s*#?\s*(\d+)/i);
    if (orderM) h.orderNumber = orderM[1];

    // Customer company from title: "ORDER #51932 - UGL LIMITED"
    const custM = pageText.match(/ORDER\s*#?\s*\d+\s*[-\u2013\u2014]\s*(.+?)(?:\n|$)/i);
    if (custM) h.customerCompany = custM[1].trim();

    h.po          = txt('[data-testid="sales-order-value-po"]');
    h.createdBy   = txt('[data-testid="sales-order-value-created-by"]');
    h.createdDate = txt('[data-testid="sales-order-created-date-value"]');
    h.requiredDate= txt('[data-testid="sales-order-required-date-value"]');
    h.qboNumber   = txt('[data-testid="sales-order-accounting-number"]');
    h.pickupNotes = txt('[data-testid="sales-order-value-pickup-notes"]');

    // Notes (contenteditable div)
    const notesEl = document.querySelector('[data-testid="sales-order-input-notes"]');
    h.notes = notesEl ? notesEl.textContent.trim() : '';

    // Invoiced status
    const invoicedEl = document.querySelector('[data-testid="sales-order-invoiced"]');

    // Status badge
    const statusEl = document.querySelector('.order-page__status .status-label')
                  || document.querySelector('[class*="StatusSelect"] .status-label')
                  || document.querySelector('.status-label.badge');
    h.status = statusEl ? statusEl.textContent.trim() : '';

    // Bill-to address
    h.billTo.address = txt('[data-testid="sales-order-value-bill-to-address1-address-2"]');
    h.billTo.city    = txt('[data-testid="sales-order-value-bill-to-city-state-country-postcode"]');

    // Contact info
    const contactSection = document.querySelector('.order-page__customer-data');
    if (contactSection) {
      const fields = txtAll('.field-value', contactSection);
      for (const f of fields) {
        if (f.includes('@'))                         h.contact.email = f;
        else if (/^[\d\s()+\-]{7,}$/.test(f))      h.contact.phone = f;
        else if (!h.contact.name && f.length > 0)   h.contact.name  = f;
      }
    }

    // Customer: prefer company from title, then contact name
    h.customer = h.customerCompany || h.contact.name || '';

    // -- Totals --
    data.totals.labour   = txt('[data-testid="sales-order-value-labour-amount"]');
    data.totals.subTotal = txt('[data-testid="sales-order-value-sub-total-amount"]');
    data.totals.tax      = txt('[data-testid="sales-order-value-tax-amount"]');
    data.totals.total    = txt('[data-testid="sales-order-value-total-amount"]');

    // -- Drawings (flashing orders) --
    const drawingBoxes = document.querySelectorAll('.drawing-box');
    drawingBoxes.forEach((box, idx) => {
      const drawing = {
        index: idx + 1,
        material: '',
        thickness: '',
        girth: '',
        qty: 1,
        lengths: '',
        totalLm: '',
        pricePerM: '',
        totalPrice: '',
        dimensions: [],
      };

      // Thickness
      drawing.thickness = txt('.drawing-material_thickness', box);

      // Material name and girth from the top row spans
      const topRow = box.querySelector('.drawing .w-100.d-flex');
      if (topRow) {
        const spans = topRow.querySelectorAll('span');
        spans.forEach(span => {
          const t = span.textContent.trim();
          if (span.classList.contains('drawing-material_thickness')) return;
          if (span.classList.contains('drawing-material_girth')) {
            drawing.girth = t.replace(/^Girth\s*/i, '');
            return;
          }
          if (t && !drawing.material && t.length > 2) {
            drawing.material = t;
          }
        });
      }

      // Girth fallback
      if (!drawing.girth) {
        const girthEl = box.querySelector('.drawing-material_girth');
        if (girthEl) drawing.girth = girthEl.textContent.trim().replace(/^Girth\s*/i, '');
      }

      // Qty from button in the top-right area
      const btns = box.querySelectorAll('.drawing .w-100 button, .drawing button');
      for (const b of btns) {
        const n = parseInt(b.textContent.trim());
        if (n > 0 && n <= 999) { drawing.qty = n; break; }
      }

      // Lengths: "1 at 2500mm"
      const lengthsEl = box.querySelector('.drawing-lengths');
      if (lengthsEl) drawing.lengths = lengthsEl.textContent.trim();

      // Totals: lm, $/M, price
      const totalVals = txtAll('.drawing-total_values > div', box);
      if (totalVals.length >= 3) {
        drawing.totalLm    = totalVals[0];
        drawing.pricePerM  = totalVals[1];
        drawing.totalPrice = totalVals[2];
      }

      // Dimensions from SVG text elements
      const svgTexts = box.querySelectorAll('svg text');
      svgTexts.forEach(t => {
        const val = t.textContent.trim();
        if (/^\d+$/.test(val) || /^CF\d+$/.test(val)) {
          drawing.dimensions.push(val);
        }
      });

      // Profile SVG markup (visible drawing, not the hidden PDF version)
      // Crop viewBox to actual content bounding box to remove whitespace
      const profileSvgs = box.querySelectorAll('svg.mt-2_5');
      const visibleSvg = Array.from(profileSvgs).find(
        s => !s.closest('.drawing-for-pdf')
      );
      if (visibleSvg) {
        try {
          const bbox = visibleSvg.getBBox();
          const pad = Math.max(bbox.width, bbox.height) * 0.05; // 5% padding
          const croppedVB = [
            bbox.x - pad, bbox.y - pad,
            bbox.width + pad * 2, bbox.height + pad * 2
          ].map(v => Math.round(v * 100) / 100).join(' ');
          // Clone and update viewBox to cropped version
          const clone = visibleSvg.cloneNode(true);
          clone.setAttribute('viewBox', croppedVB);
          drawing.svgMarkup = clone.outerHTML;
        } catch (e) {
          drawing.svgMarkup = visibleSvg.outerHTML;
        }
      }

      data.drawings.push(drawing);
    });

    // -- Product rows (non-drawing items) --
    // Use actual Factory.app DOM selectors discovered from real order pages
    const productRows = document.querySelectorAll('.order-products-table__body-row');
    if (productRows.length > 0) {
      productRows.forEach((row, idx) => {
        const product = {
          index: idx + 1,
          qty: 1,
          name: '',
          description: '',
          attributes: [],
          accountingCode: '',
          unitPrice: '',
          totalPrice: '',
          rawText: '',
        };

        // Quantity
        const qtyEl = row.querySelector('[class*="quantityValue"]');
        if (qtyEl) {
          const n = parseInt(qtyEl.textContent.trim());
          if (n > 0) product.qty = n;
        }
        product.hasQty = !!qtyEl;

        // Product name (e.g. "DOOR ASSEMBLY | 1000318773 | C67640A01")
        const nameEl = row.querySelector('.order-products-table__body-row__product-name span');
        if (nameEl) product.name = nameEl.textContent.trim();

        // Description (multiline, e.g. "LINE# 10 | PROJECT R-0219\nFAI to be completed\n...")
        const descEl = row.querySelector('.order-products-table__body-row__product-description span');
        if (descEl) product.description = descEl.textContent.trim();

        // Accounting code (e.g. "LASERFAB")
        const codeEl = row.querySelector('.order-products-table__body-row__accounting-code');
        if (codeEl) product.accountingCode = codeEl.textContent.trim();

        // Attribute label/value pairs
        const attrLabels = row.querySelectorAll('.order-products-table__body-row__attribute-label');
        const attrValues = row.querySelectorAll('.order-products-table__body-row__attribute-value');
        const attrCount = Math.min(attrLabels.length, attrValues.length);
        for (let i = 0; i < attrCount; i++) {
          product.attributes.push({
            label: attrLabels[i].textContent.trim(),
            value: attrValues[i].textContent.trim(),
          });
        }

        // Prices
        const priceEls = row.querySelectorAll('.order-products-table__body-row__product-price-display');
        if (priceEls.length >= 1) product.unitPrice = priceEls[0].textContent.trim();
        if (priceEls.length >= 2) product.totalPrice = priceEls[1].textContent.trim();

        product.rawText = row.innerText || '';

        if (product.name || product.rawText.length > 3) {
          data.products.push(product);
        }
      });

      console.log('[ASM Labels] Extracted ' + data.products.length + ' products via DOM selectors');
    }

    // Fallback: text-based extraction if DOM selectors found nothing
    if (!data.products.length && !data.drawings.length) {
      const productsSection = document.querySelector('.order-page__products');
      if (productsSection) {
        const productText = productsSection.innerText || '';
        console.log('[ASM Labels] DOM selectors found nothing, trying text fallback:', productText.substring(0, 500));
        if (productText.trim()) {
          data.products.push(...extractProductsFromText(productText));
        }
      }
    }

    // -- Auto-detect order type --
    data.orderType = detectOrderType(data);

    console.log('[ASM Labels] Scraped:', JSON.stringify({
      orderType: data.orderType,
      drawingsCount: data.drawings.length,
      productsCount: data.products.length,
      products: data.products.map(p => ({ qty: p.qty, name: p.name }))
    }));

    return data;
  }

  /* --- Extract products from rendered innerText ------------------- */
  function extractProductsFromText(text) {
    const products = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Lines to skip entirely
    const SKIP = [
      /^Products$/i, /^Items$/i, /^Drawings$/i, /^Mark all/i,
      /^QTY\b.*DESCRIPTION/i, /^EACH$/i, /^TOTAL$/i,
      /^Sub total$/i, /^Labour$/i, /^Tax$/i,
      /^Total\s+lm/i, /^\$\/M$/i,
      /^Add (team member|labels)/i,
      /^(Created|Required|Assigned|Invoiced|Status|Contact|Bill to|Pick up|PO|Labels|Notes|QBO|Collaborate|Checklists|Tracking|Timeline|Profitability|Linked|Order details)\s*$/i,
      /^(Created by|Created|Required)$/i,
      /^Mark all drawings/i,
      /^ALL INTERNAL/i,       // SVG text from drawings
      /^CF\d+$/,              // SVG dimension labels
      /^Girth\s+\d/i,        // Drawing girth labels
      /^\d+\s+at\s+\d+mm$/i, // Drawing lengths "1 at 2500mm"
    ];

    let current = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip known non-product lines
      if (SKIP.some(p => p.test(line))) continue;

      // Skip price-only lines
      if (/^\$[\d,.]+$/.test(line)) {
        if (current) {
          if (!current.unitPrice) current.unitPrice = line;
          else current.totalPrice = line;
        }
        continue;
      }

      // Skip standalone small numbers that are likely just UI elements
      // BUT catch standalone numbers 1-500 as potential qty markers
      const standaloneQty = line.match(/^(\d{1,3})$/);

      // Pattern A: "10  PRODUCT NAME" (qty + spaces + name on same line)
      const qtyNameMatch = line.match(/^(\d{1,3})\s{2,}(.+)/);
      if (qtyNameMatch && parseInt(qtyNameMatch[1]) > 0 && parseInt(qtyNameMatch[1]) <= 500) {
        if (current) products.push(current);
        current = {
          index: products.length + 1,
          qty: parseInt(qtyNameMatch[1]),
          name: qtyNameMatch[2].trim(),
          description: '',
          attributes: [],
          unitPrice: '',
          totalPrice: '',
          rawText: line,
        };
        continue;
      }

      // Pattern B: Standalone qty number, followed by product name on next line(s)
      // Only treat as qty if it's 1-500 and the next non-skip line looks like a product name
      if (standaloneQty) {
        const qtyVal = parseInt(standaloneQty[1]);
        if (qtyVal > 0 && qtyVal <= 500) {
          // Look ahead: is the next non-empty, non-skip line a product name?
          let nextLine = '';
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nl = lines[j].trim();
            if (!nl) continue;
            if (SKIP.some(p => p.test(nl))) continue;
            if (/^\$[\d,.]+$/.test(nl)) continue;
            if (/^\d{1,3}$/.test(nl)) break; // another qty = this wasn't a qty
            nextLine = nl;
            break;
          }

          // If we found a plausible next line, treat this as a new product
          if (nextLine && nextLine.length > 1 && !/^\d{1,3}$/.test(nextLine)) {
            if (current) products.push(current);
            current = {
              index: products.length + 1,
              qty: qtyVal,
              name: '',  // will be filled by the next iteration
              description: '',
              attributes: [],
              unitPrice: '',
              totalPrice: '',
              rawText: line,
            };
            continue;
          }
        }
        // If it didn't match as qty, skip it (likely page numbers, counts, etc.)
        continue;
      }

      // If we have a current product with no name yet, this line IS the name
      if (current && !current.name) {
        current.name = line;
        current.rawText += '\n' + line;
        continue;
      }

      // If we have a current product with a name, this is description/continuation
      if (current) {
        // Check if this looks like a new product name (not a description/attribute)
        // Heuristic: if it's a very short line or looks like a category, it might
        // be a new product. But generally, treat it as description.
        if (!current.description) {
          current.description = line;
        } else {
          current.description += '\n' + line;
        }
        current.rawText += '\n' + line;
        continue;
      }

      // No current product - this might be a product name without a qty prefix
      // (happens with some order formats). Skip short/noise lines.
      if (line.length > 3 && !/^\d+$/.test(line)) {
        // Could be a product without explicit qty - start one with qty=1
        current = {
          index: products.length + 1,
          qty: 1,
          name: line,
          description: '',
          attributes: [],
          unitPrice: '',
          totalPrice: '',
          rawText: line,
        };
      }
    }

    if (current && (current.name || current.rawText.length > 3)) {
      products.push(current);
    }

    return products;
  }

  /* --- Detect order type ----------------------------------------- */
  function detectOrderType(data) {
    const h = data.header;

    // UGL: 10-digit PO starting with 4, or UGL in status/company
    if (/^4\d{9}$/.test(h.po) || /UGL/i.test(h.status) || /UGL/i.test(h.customerCompany)) {
      return 'ugl';
    }

    // Flashing: has drawings
    if (data.drawings.length > 0 || /FLASH/i.test(h.status)) {
      return 'flashing';
    }

    // Laser/fab
    const allText = data.products.map(p => p.name + ' ' + (p.description || '')).join(' ');
    if (/LASER\s*FAB|LASER\s*CUT|CUT\s*ONLY|CUT\s*\+\s*FOLD/i.test(allText)) {
      return 'laserfab';
    }

    return 'generic';
  }

})();
