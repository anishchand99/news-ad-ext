// CONFIGURATION & CONSTANTS

const AD_DOMAINS = [
  'doubleclick.net',
  'googleadservices.com',
  'outbrain.com',
  'taboola.com',
  'zemanta.com',
  'dianomi.com',
  'revcontent.com',
  'adsystem.com',
  'rubiconproject.com',
  'pubmatic.com',
  'adnxs.com',
];

const SPONSORED_KEYWORDS = [
  'sponsored',
  'paid content',
  'paid partner',
  'advertisement',
  'promoted',
];

const WIDGET_SELECTORS = [
  '.OUTBRAIN',
  '.ob-widget',
  '.trc_related_container',
  '.taboola-container',
  '.dianomi-container',
  '.revcontent-network',
  '[id*="google_ads_iframe"]',
  '.commercial-unit',
];

const TYPE_AD = 'advisor-status-ad';
const TYPE_NEWS = 'advisor-status-news';
const TYPE_SPONSORED = 'advisor-status-sponsored';
const TYPE_NEUTRAL = 'advisor-status-neutral';

// STATE MANAGEMENT

const DEFAULT_SETTINGS = {
  extensionEnabled: true,
  overlayEnabled: true,
  focusModeEnabled: false,
  tooltipEnabled: true,
  panelEnabled: true,
  sitePreferences: {},
};

let currentSettings = { ...DEFAULT_SETTINGS };
let tooltipEl = null;
let panelEl = null;
let panelBodyEl = null;

let linkObserver = null;
let mutationObserver = null;

//INITIALIZATION

chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
  currentSettings = { ...DEFAULT_SETTINGS, ...stored };
  checkAndRun();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'updateSettings') {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      currentSettings = { ...DEFAULT_SETTINGS, ...stored };
      checkAndRun();
    });
  }
});

function checkAndRun() {
  const hostname = window.location.hostname;
  if (!currentSettings.extensionEnabled) {
    cleanupAdvisor();
    return;
  }
  const isSiteAllowed = currentSettings.sitePreferences[hostname] === true;
  if (isSiteAllowed) {
    initAdvisor();
    applyFocusMode();
  } else {
    cleanupAdvisor();
    document.body.classList.remove('news-focus-mode');
  }
}

function initAdvisor() {
  ensureTooltip();
  ensurePanel();

  setupIntersectionObserver();
  setupMutationObserver();

  scanNewNodes([document.body]);
}

function cleanupAdvisor() {
  if (linkObserver) linkObserver.disconnect();
  if (mutationObserver) mutationObserver.disconnect();

  document
    .querySelectorAll('.advisor-anchor, .advisor-overlay-badge')
    .forEach((el) => el.remove());

  document
    .querySelectorAll('.advisor-group-sponsored, .advisor-group-ad')
    .forEach((el) => {
      el.classList.remove('advisor-group-sponsored', 'advisor-group-ad');
    });

  document.querySelectorAll('[data-advisor-processed]').forEach((el) => {
    delete el.dataset.advisorProcessed;
  });

  if (tooltipEl) tooltipEl.style.display = 'none';
  if (panelEl) panelEl.classList.remove('open');
}

function applyFocusMode() {
  if (currentSettings.extensionEnabled && currentSettings.focusModeEnabled) {
    document.body.classList.add('news-focus-mode');
  } else {
    document.body.classList.remove('news-focus-mode');
  }
}

// OBSERVERS
function setupIntersectionObserver() {
  if (linkObserver) linkObserver.disconnect();

  linkObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          processSingleElement(el);
          observer.unobserve(el);
        }
      });
    },
    {
      rootMargin: '200px',
    }
  );
}

function setupMutationObserver() {
  if (mutationObserver) mutationObserver.disconnect();

  mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        scanNewNodes(mutation.addedNodes);
      }
    }
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function scanNewNodes(nodeList) {
  nodeList.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const links = node.querySelectorAll('a, [data-href]');
    links.forEach((link) => {
      if (!link.dataset.advisorProcessed) linkObserver.observe(link);
    });
    if (
      (node.tagName === 'A' || node.hasAttribute('data-href')) &&
      !node.dataset.advisorProcessed
    ) {
      linkObserver.observe(node);
    }

    const frames = node.querySelectorAll('iframe');
    frames.forEach((frame) => {
      if (!frame.dataset.advisorProcessed) linkObserver.observe(frame);
    });
    if (node.tagName === 'IFRAME' && !node.dataset.advisorProcessed) {
      linkObserver.observe(node);
    }

    const widgets = node.querySelectorAll(WIDGET_SELECTORS.join(','));
    widgets.forEach((widget) => {
      if (!widget.dataset.advisorProcessed) linkObserver.observe(widget);
    });
    if (
      node.matches &&
      node.matches(WIDGET_SELECTORS.join(',')) &&
      !node.dataset.advisorProcessed
    ) {
      linkObserver.observe(node);
    }
  });
}

//CORE LOGIC

function processSingleElement(el) {
  if (el.dataset.advisorProcessed) return;

  // WIDGET GROUP LOGIC
  if (el.matches(WIDGET_SELECTORS.join(','))) {
    // Iframe Widget (Black Box)
    if (el.tagName === 'IFRAME') {
      applyGroupStyling(el, TYPE_SPONSORED, {
        summary: ['Sponsored Widget'],
        details: [
          'Content recommendation widget detected.',
          'Contains external sponsored links.',
        ],
      });
      el.dataset.advisorProcessed = 'true';
      return;
    }
    // Shadow DOM Host (Black Box)
    if (el.shadowRoot) {
      applyGroupStyling(el, TYPE_SPONSORED, {
        summary: ['Sponsored Widget (Shadow DOM)'],
        details: [
          'Widget uses Shadow DOM encapsulation.',
          'Contents are hidden from main document.',
          'Treated as single sponsored zone.',
        ],
      });
      el.dataset.advisorProcessed = 'true';
      return;
    }
    // Div Widget (Traversable) -> Ignore Container
    el.dataset.advisorProcessed = 'true';
    return;
  }

  // IFRAME LOGIC
  if (el.tagName === 'IFRAME') {
    processIframe(el);
    return;
  }

  // LINK LOGIC
  if (el.closest('nav') || el.closest('footer')) {
    el.dataset.advisorProcessed = 'true';
    return;
  }

  if (
    el.closest('.advisor-group-sponsored') ||
    el.closest('.advisor-group-ad')
  ) {
    el.dataset.advisorProcessed = 'true';
    return;
  }

  const container = findClosestBlock(el);
  const classification = classifyElement(el, container);

  if (classification.type !== TYPE_NEUTRAL) {
    applyBadge(el, classification);
  }

  el.dataset.advisorProcessed = 'true';
}

function processIframe(frame) {
  if (
    frame.closest('.advisor-group-sponsored') ||
    frame.closest('.advisor-group-ad')
  ) {
    frame.dataset.advisorProcessed = 'true';
    return;
  }

  const rawSrc = frame.getAttribute('src');
  const src = rawSrc ? rawSrc.toLowerCase() : '';
  const id = (frame.id || '').toLowerCase();

  const currentHost = window.location.hostname.replace(/^www\./, '');
  const domainParts = currentHost.split('.');
  const rootDomain =
    domainParts.length > 1 ? domainParts.slice(-2).join('.') : currentHost;

  const matchedNetwork = AD_DOMAINS.find((domain) => src.includes(domain));
  const matchedIdKeyword = ['google_ads', 'taboola', 'outbrain'].find((k) =>
    id.includes(k)
  );

  let classification = null;

  // Empty/Blank Source
  if (!src || src === 'about:blank') {
    if (matchedIdKeyword) {
      classification = {
        type: TYPE_AD,
        summary: ['Ad Iframe Detected'],
        details: [
          `Iframe ID contains "${matchedIdKeyword}".`,
          'No source URL present.',
        ],
      };
    } else {
      classification = {
        type: TYPE_SPONSORED,
        summary: ['Dynamic Content'],
        details: [
          'Iframe has no source URL.',
          'Likely dynamic script injection or tracking pixel.',
        ],
      };
    }
  }
  // Known Ad Network
  else if (matchedNetwork || matchedIdKeyword) {
    classification = {
      type: TYPE_AD,
      summary: ['Ad Network Detected'],
      details: [],
    };
    if (matchedNetwork)
      classification.details.push(
        `Source matches known ad network: "${matchedNetwork}"`
      );
    if (matchedIdKeyword)
      classification.details.push(
        `ID contains ad pattern: "${matchedIdKeyword}"`
      );
    classification.details.push('Element Type: <IFRAME>');
  }
  // Internal / Editorial
  else if (src.includes(rootDomain)) {
    classification = {
      type: TYPE_NEWS,
      summary: ['Internal Embed'],
      details: [
        `Embed source matches parent domain (${rootDomain})`,
        'Assumed editorial content.',
      ],
    };
  }
  // Foreign / External
  else {
    classification = {
      type: TYPE_SPONSORED,
      summary: ['External Source'],
      details: [
        'Foreign iframe source detected.',
        `Source: ${
          src.startsWith('http') ? new URL(src).hostname : 'Relative/Unknown'
        }`,
        `Origin differs from current site (${rootDomain}).`,
      ],
    };
  }

  if (classification) {
    if (
      classification.type === TYPE_AD ||
      classification.type === TYPE_SPONSORED
    ) {
      applyGroupStyling(frame, classification.type, classification);
    } else {
      applyOverlayBadge(frame, classification.type, classification);
    }
  }

  frame.dataset.advisorProcessed = 'true';
}

function classifyElement(element, container) {
  const rawUrl =
    element.tagName === 'A' ? element.href : element.getAttribute('data-href');
  let fullUrl = '';
  try {
    fullUrl = new URL(rawUrl, window.location.origin).href.toLowerCase();
  } catch (e) {
    fullUrl = (rawUrl || '').toLowerCase();
  }

  const text = element.innerText.trim();
  const containerText = container ? container.innerText.toLowerCase() : '';
  const currentHost = window.location.hostname.replace('www.', '');

  const matchedAdDomain = AD_DOMAINS.find((d) => fullUrl.includes(d));
  if (matchedAdDomain) {
    return {
      type: TYPE_AD,
      summary: ['Ad Network Link'],
      details: [`Destination URL matches: "${matchedAdDomain}"`],
    };
  }

  if (
    fullUrl.includes('utm_source=outbrain') ||
    fullUrl.includes('utm_source=taboola')
  ) {
    return {
      type: TYPE_SPONSORED,
      summary: ['Tracked Content'],
      details: ['URL contains Outbrain/Taboola tracking parameters.'],
    };
  }

  if (
    fullUrl.includes('sponsored') ||
    fullUrl.includes('paid-post') ||
    fullUrl.includes('paidcontent')
  ) {
    return {
      type: TYPE_SPONSORED,
      summary: ['Sponsored Path'],
      details: ['URL structure indicates paid content.'],
    };
  }

  for (const keyword of SPONSORED_KEYWORDS) {
    if (
      containerText.includes(keyword) &&
      !text.toLowerCase().includes(keyword)
    ) {
      return {
        type: TYPE_SPONSORED,
        summary: ['Sponsored Label'],
        details: [`Nearby container text matched keyword: "${keyword}"`],
      };
    }
  }

  try {
    const urlObj = new URL(fullUrl);
    const linkHost = urlObj.hostname.replace('www.', '');
    if (linkHost !== currentHost) {
      return {
        type: TYPE_SPONSORED,
        summary: ['External Link'],
        details: [`Link destination (${linkHost}) differs from current site.`],
      };
    }
  } catch (e) {}

  if (text.length === 0 || text.length < 15)
    return { type: TYPE_NEUTRAL, summary: [], details: [] };

  return {
    type: TYPE_NEWS,
    summary: ['Article Headline'],
    details: ['Internal link.', 'Standard headline length.', 'No ad signals.'],
  };
}

// UI GENERATION

function applyBadge(targetElement, classification) {
  if (targetElement.querySelector('.advisor-anchor')) return;
  if (
    targetElement.closest('.advisor-group-sponsored') ||
    targetElement.closest('.advisor-group-ad')
  )
    return;

  const injectionTarget = findInjectionPoint(targetElement);

  const anchor = document.createElement('span');
  anchor.className = 'advisor-anchor';

  const badge = createBadgeElement(classification.type);
  setupBadgeEvents(badge, targetElement, classification.type, classification);

  anchor.appendChild(badge);
  injectionTarget.appendChild(anchor);
}

function applyGroupStyling(targetElement, type, classification) {
  targetElement.classList.add(`advisor-group-${type}`);
  applyOverlayBadge(targetElement, type, classification);
}

function applyOverlayBadge(targetElement, type, classification) {
  const isIframe = targetElement.tagName === 'IFRAME';
  const isShadowHost = targetElement.shadowRoot !== null;
  const injectOutside = isIframe || isShadowHost;

  if (injectOutside) {
    if (targetElement.parentElement.querySelector('.advisor-overlay-badge'))
      return;
  } else {
    if (targetElement.querySelector('.advisor-overlay-badge')) return;
  }

  let parentToPosition = injectOutside
    ? targetElement.parentElement
    : targetElement;

  const isTrapContainer =
    parentToPosition.matches &&
    parentToPosition.matches(
      '.trc_rbox .sponsored, .ob-unit, .ob-rec-text-wrapper'
    );

  if (!isTrapContainer) {
    const style = window.getComputedStyle(parentToPosition);
    if (style.position === 'static') {
      parentToPosition.style.position = 'relative';
    }
  }

  const badge = createBadgeElement(type);
  badge.classList.add('advisor-overlay-badge');
  setupBadgeEvents(badge, targetElement, type, classification);

  if (injectOutside) {
    targetElement.parentElement.insertBefore(badge, targetElement);
  } else {
    targetElement.appendChild(badge);
  }
}

function createBadgeElement(type) {
  const badge = document.createElement('span');
  badge.className = `advisor-badge ${type}`;
  let label = 'NEWS';
  if (type === TYPE_AD) label = 'AD';
  if (type === TYPE_SPONSORED) label = 'PAID';
  badge.innerText = label;
  return badge;
}

function setupBadgeEvents(badge, targetSource, type, classificationData) {
  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPanel(targetSource, type, classificationData);
  });

  if (tooltipEl) {
    badge.addEventListener('mouseenter', (e) =>
      showTooltip(e, type, classificationData.summary)
    );
    badge.addEventListener('mouseleave', hideTooltip);
  }
}

// DOM HELPERS & UI
function findInjectionPoint(rootElement) {
  const candidates = rootElement.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, span, div, p, strong, b, em'
  );
  let bestCandidate = null;
  let maxScore = 0;

  candidates.forEach((el) => {
    const text = el.innerText.trim();
    const len = text.length;
    if (len < 3) return;

    let score = len;
    if (/^H[1-6]/.test(el.tagName)) score += 50;
    if (
      (el.className || '').includes('title') ||
      (el.className || '').includes('headline')
    )
      score += 20;

    if (score >= maxScore) {
      maxScore = score;
      bestCandidate = el;
    }
  });
  return bestCandidate || rootElement;
}

function findClosestBlock(element) {
  let el = element.parentElement;
  let depth = 0;
  while (el && depth < 4) {
    if (['ARTICLE', 'LI', 'TD'].includes(el.tagName)) return el;
    const cls = (el.className || '').toString().toLowerCase();
    if (
      cls.includes('card') ||
      cls.includes('container') ||
      cls.includes('story')
    )
      return el;
    el = el.parentElement;
    depth++;
  }
  return element.parentElement;
}

function ensureTooltip() {
  if (document.getElementById('advisor-tooltip')) {
    tooltipEl = document.getElementById('advisor-tooltip');
    return;
  }
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'advisor-tooltip';
  document.body.appendChild(tooltipEl);
}

function showTooltip(ev, type, summaryLines) {
  if (!tooltipEl) return;
  const rect = ev.target.getBoundingClientRect();

  let displayType = type.replace('advisor-status-', '').toUpperCase();

  let html = `<strong>${displayType}</strong>`;
  if (summaryLines && summaryLines.length > 0) {
    html += `<ul style="margin:0;padding-left:12px;">`;
    summaryLines.forEach((s) => (html += `<li>${s}</li>`));
    html += '</ul>';
  }
  tooltipEl.innerHTML = html;
  tooltipEl.style.display = 'block';
  tooltipEl.style.top = `${rect.bottom + window.scrollY + 5}px`;
  tooltipEl.style.left = `${rect.left + window.scrollX}px`;
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

function ensurePanel() {
  if (document.getElementById('advisor-panel')) {
    panelEl = document.getElementById('advisor-panel');
    panelBodyEl = document.getElementById('advisor-panel-body');
    return;
  }
  panelEl = document.createElement('div');
  panelEl.id = 'advisor-panel';
  const header = document.createElement('div');
  header.id = 'advisor-panel-header';
  header.innerHTML =
    '<h3>Transparency Report</h3> <button id="advisor-panel-close">×</button>';
  panelEl.appendChild(header);
  panelBodyEl = document.createElement('div');
  panelBodyEl.id = 'advisor-panel-body';
  panelEl.appendChild(panelBodyEl);
  document.body.appendChild(panelEl);
  document
    .getElementById('advisor-panel-close')
    .addEventListener('click', () => {
      panelEl.classList.remove('open');
    });
}

function openPanel(targetEl, type, classificationData) {
  panelBodyEl.innerHTML = '';

  let color = '#333';
  let displayType = type.replace('advisor-status-', '').toUpperCase();
  if (type === TYPE_NEWS) color = '#2ecc71';
  if (type === TYPE_AD) color = '#e74c3c';
  if (type === TYPE_SPONSORED) color = '#9b59b6';

  const headerSection = document.createElement('div');
  headerSection.className = 'advisor-panel-section';
  headerSection.innerHTML = `
    <h1 style="color: ${color}; margin: 0; font-size: 24px;">${displayType}</h1>
    <p style="margin: 5px 0 0; color: #666; font-size: 12px;">Content Classification Report</p>
  `;
  panelBodyEl.appendChild(headerSection);

  if (classificationData.details && classificationData.details.length > 0) {
    const reasonSection = document.createElement('div');
    reasonSection.className = 'advisor-panel-section';
    reasonSection.innerHTML = `<h4>Classification Reasons</h4>`;
    const ul = document.createElement('ul');
    ul.className = 'advisor-reason-list';
    classificationData.details.forEach((detail) => {
      const li = document.createElement('li');
      li.textContent = detail;
      ul.appendChild(li);
    });
    reasonSection.appendChild(ul);
    panelBodyEl.appendChild(reasonSection);
  }

  const rawUrl =
    targetEl.tagName === 'A'
      ? targetEl.href
      : targetEl.getAttribute('src') || targetEl.getAttribute('data-href');

  if (rawUrl && rawUrl.startsWith('http')) {
    const urlSection = document.createElement('div');
    urlSection.className = 'advisor-panel-section';
    urlSection.innerHTML = `<h4>URL Evidence</h4>`;

    try {
      const url = new URL(rawUrl);
      let html = `
            <div class="advisor-url-breakdown">
                <div class="advisor-url-row">
                    <div class="advisor-url-label">Domain:</div>
                    <div class="advisor-url-value">${url.hostname}</div>
                </div>
            </div>
          `;

      const params = [];
      url.searchParams.forEach((val, key) => {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.startsWith('utm_') ||
          lowerKey === 'gclid' ||
          lowerKey === 'fbclid'
        ) {
          params.push({ key, val, highlight: true });
          return;
        }
        if (
          lowerKey === 'redir' ||
          lowerKey === 'redirect' ||
          lowerKey === 'url' ||
          lowerKey === 'dest'
        ) {
          params.push({ key, val, highlight: true });
          return;
        }
        if (lowerKey.includes('click_id') || lowerKey === 'ref') {
          params.push({ key, val, highlight: false });
          return;
        }
      });

      if (params.length > 0) {
        html += `<div style="margin-top: 10px; font-weight:600; font-size:11px; color:#586069;">TRACKING & REDIRECTS:</div>`;
        html += `<table class="advisor-param-table">`;
        params.forEach((p) => {
          const cls = p.highlight ? 'advisor-param-highlight' : '';
          let displayVal = p.val;
          if (
            displayVal.startsWith('http%') ||
            displayVal.startsWith('https%')
          ) {
            try {
              displayVal = decodeURIComponent(displayVal);
            } catch (e) {}
          }
          html += `<tr class="${cls}"><th>${p.key}</th><td>${displayVal}</td></tr>`;
        });
        html += `</table>`;
      } else {
        html += `<div style="margin-top: 10px; font-size:11px; color:#999; font-style:italic;">No tracking parameters detected.</div>`;
      }

      urlSection.innerHTML += html;
      panelBodyEl.appendChild(urlSection);
    } catch (e) {
      const code = document.createElement('div');
      code.className = 'advisor-code-block';
      code.textContent = rawUrl;
      urlSection.appendChild(code);
      panelBodyEl.appendChild(urlSection);
    }
  }

  const sourceSection = document.createElement('div');
  sourceSection.className = 'advisor-panel-section';
  sourceSection.innerHTML = `<h4>Element Source</h4>`;
  const codeBlock = document.createElement('code');
  codeBlock.className = 'advisor-code-block';
  codeBlock.textContent =
    targetEl.outerHTML.substring(0, 500) +
    (targetEl.outerHTML.length > 500 ? '...' : '');
  sourceSection.appendChild(codeBlock);
  panelBodyEl.appendChild(sourceSection);

  panelEl.classList.add('open');
}

// DIAGNOSTIC TOOL (Z-KEY)

let isDebugModeActive = false;

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'z' && !isDebugModeActive) {
    isDebugModeActive = true;
    document.body.style.outline = '5px solid #ff9800';
    document.body.style.cursor = 'help';
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === 'z') {
    isDebugModeActive = false;
    document.body.style.outline = '';
    document.body.style.cursor = '';
  }
});

function handleDiagnosticClick(e) {
  if (!isDebugModeActive) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  if (e.type === 'click' || e.type === 'contextmenu') {
    runDiagnosticReport(e.target);
  }
  return false;
}

window.addEventListener('click', handleDiagnosticClick, { capture: true });
window.addEventListener('mousedown', handleDiagnosticClick, { capture: true });
window.addEventListener('mouseup', handleDiagnosticClick, { capture: true });
window.addEventListener('contextmenu', handleDiagnosticClick, {
  capture: true,
});

function runDiagnosticReport(clickedElement) {
  console.clear();
  console.group('ADVISOR DIAGNOSTIC REPORT');

  const validLink = clickedElement.closest('a, [data-href]');
  const validIframe = clickedElement.closest('iframe');
  const targetElement = validLink || validIframe || clickedElement;

  const isSelectedByCode = !!(validLink || validIframe);

  if (isSelectedByCode) {
    console.log('[PASS] SELECTOR MATCHED');
    console.log('Target Found:', targetElement);
  } else {
    console.log('[FAIL] SELECTOR MISSED');
    console.log('Element Clicked:', clickedElement);
  }

  let injectionPoint = null;
  if (validIframe) {
    injectionPoint = validIframe.parentElement;
  } else {
    injectionPoint = findInjectionPoint(targetElement);
  }

  if (injectionPoint) {
    const oldOutline = injectionPoint.style.outline;
    injectionPoint.style.outline = '4px solid #00bcd4';
    setTimeout(() => {
      injectionPoint.style.outline = oldOutline;
    }, 1500);
    console.log('[VISUAL] Flashing Injection Point');
  } else {
    console.log('[ERROR] No Injection Point Found');
  }

  const container = findClosestBlock(targetElement);
  const result = classifyElement(targetElement, container);

  console.log(`RESULT: ${result.type.toUpperCase()}`);
  console.log('SUMMARY:', result.summary);
  console.table(result.details);
  console.groupEnd();
}
