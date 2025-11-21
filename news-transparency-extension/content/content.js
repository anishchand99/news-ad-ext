// ------------------------------
// Settings
// ------------------------------
const DEFAULT_SETTINGS = {
  extensionEnabled: true,
  overlayEnabled: true,
  focusModeEnabled: false,
  tooltipEnabled: true,
  panelEnabled: true
};

let currentSettings = { ...DEFAULT_SETTINGS };

// Shared UI elements
let tooltipEl = null;
let panelEl = null;
let panelBodyEl = null;

// ------------------------------
// Initialization
// ------------------------------
chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
  currentSettings = { ...DEFAULT_SETTINGS, ...stored };
  if (currentSettings.extensionEnabled) {
    initAdvisor();
  }
  applyFocusMode();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "updateSettings") {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      currentSettings = { ...DEFAULT_SETTINGS, ...stored };
      if (currentSettings.extensionEnabled) {
        initAdvisor();
      } else {
        cleanupAdvisor();
      }
      applyFocusMode();
    });
  }
});

// ------------------------------
// Core
// ------------------------------
function initAdvisor() {
  ensureTooltip();
  ensurePanel();
  annotatePage();
}

function cleanupAdvisor() {
  // Remove badges
  document.querySelectorAll(".advisor-badge").forEach((el) => el.remove());

  // Remove data attributes
  document
    .querySelectorAll("[data-advisor-type]")
    .forEach((el) => el.removeAttribute("data-advisor-type"));
  document
    .querySelectorAll("[data-advisor-signals]")
    .forEach((el) => el.removeAttribute("data-advisor-signals"));

  // Remove positioning class from headlines
  document
    .querySelectorAll(".advisor-target")
    .forEach((el) => el.classList.remove("advisor-target"));

  if (tooltipEl) tooltipEl.style.display = "none";
  if (panelEl) panelEl.classList.remove("open");
}

function applyFocusMode() {
  if (currentSettings.extensionEnabled && currentSettings.focusModeEnabled) {
    document.body.classList.add("news-focus-mode");
  } else {
    document.body.classList.remove("news-focus-mode");
  }
}

/**
 * Main function:
 * 1. Find article/card blocks.
 * 2. For each block, find a single headline.
 * 3. Classify the block and attach ONE badge to the headline.
 */
function annotatePage() {
  if (!currentSettings.overlayEnabled) {
    cleanupAdvisor();
    return;
  }

  const blocks = findArticleBlocks().filter(
    (block) => !block.dataset.advisorType
  );

  for (const block of blocks) {
    const headline = findHeadlineWithinBlock(block);
    if (!headline) continue;

    const result = classifyBlock(block);

    // mark block (for focus mode)
    block.dataset.advisorType = result.type;
    block.dataset.advisorSignals = JSON.stringify(result.signals);

    // mark headline (for tooltip/panel and for layout)
    headline.dataset.advisorType = result.type;
    headline.dataset.advisorSignals = JSON.stringify(result.signals);
    headline.classList.add("advisor-target");

    createOrUpdateBadge(headline, result.type, result.signals);
  }
}

// ------------------------------
// Block & headline detection
// ------------------------------

/**
 * Find "story blocks" that likely contain a headline and content.
 */
function findArticleBlocks() {
  const set = new Set();

  // semantic article elements
  document.querySelectorAll("article").forEach((el) => set.add(el));

  // Typical card/story containers used on news sites
  const blockSelectors = [
    "div[class*='article']",
    "div[class*='story']",
    "div[class*='card']",
    "section[class*='article']",
    "section[class*='story']",
    "section[class*='card']",
    "li[class*='article']",
    "li[class*='story']",
    "li[class*='card']"
  ];

  blockSelectors.forEach((sel) =>
    document.querySelectorAll(sel).forEach((el) => set.add(el))
  );

  // Fallback: blocks that are just big headline containers
  document.querySelectorAll("main, section").forEach((el) => {
    if (el.querySelector("h1, h2, h3")) set.add(el);
  });

  return Array.from(set);
}

/**
 * Inside a block, choose ONE primary headline element.
 */
function findHeadlineWithinBlock(block) {
  // explicit headline-like classes
  const candidate =
    block.querySelector(
      "h1[class*='headline'], h2[class*='headline'], h3[class*='headline'], " +
        "[class*='headline'], [class*='head-line'], [class*='title'], [data-headline]"
    ) ||
    block.querySelector("h1, h2, h3");

  return candidate || null;
}

// ------------------------------
// Classification using HTML-based heuristics
// ------------------------------

/**
 * Classify a block as "news" | "ad" | "sponsored".
 * Uses text, HTML, classes/ids/data attributes (block + ancestors), and links.
 */
function classifyBlock(el) {
  const text = (el.innerText || "").toLowerCase();
  const html = (el.outerHTML || "").toLowerCase();
  const signals = [];

  const AD_KEYWORDS = [
    "advertisement",
    "advertiser",
    "ad unit",
    "ad choices",
    "adchoice",
    "sponsored ad",
    "paid ad"
  ];

  const SPONSORED_KEYWORDS = [
    "sponsored",
    "sponsored content",
    "sponsored by",
    "paid content",
    "partner content",
    "presented by",
    "brandvoice",
    "promoted"
  ];

  const AD_NETWORKS = ["taboola", "outbrain", "zergnet", "revcontent"];
  const CTA_KEYWORDS = [
    "shop now",
    "learn more",
    "buy now",
    "sign up",
    "try now"
  ];

  let strongAd = false;
  let sponsored = false;

  // --- 1. Keyword checks in text / HTML ---
  for (const kw of AD_KEYWORDS) {
    if (text.includes(kw) || html.includes(kw)) {
      strongAd = true;
      signals.push(`Contains ad keyword "${kw}" in text/HTML`);
    }
  }

  for (const kw of SPONSORED_KEYWORDS) {
    if (text.includes(kw) || html.includes(kw)) {
      sponsored = true;
      signals.push(`Contains sponsored keyword "${kw}" in text/HTML`);
    }
  }

  // --- 2. Ad networks in HTML ---
  for (const net of AD_NETWORKS) {
    if (html.includes(net)) {
      strongAd = true;
      signals.push(`Contains ad network identifier "${net}"`);
    }
  }

  // --- 3. Attributes on block + ancestors ---
  const checkNodeAttrs = (node, depthLabel) => {
    if (!node) return;
    const cls = (node.className || "").toLowerCase();
    const id = (node.id || "").toLowerCase();
    const dataset = node.dataset || {};
    const attrString = `${cls} ${id} ${JSON.stringify(dataset).toLowerCase()}`;

    if (/\b(ad|ads|advert|advertisement|adslot)\b/.test(attrString)) {
      strongAd = true;
      signals.push(
        `Class/id/data attributes (${depthLabel}) contain ad-like tokens: "${attrString
          .trim()
          .slice(0, 80)}…"`
      );
    }

    if (/\b(sponsored|sponsor|promo|promoted)\b/.test(attrString)) {
      sponsored = true;
      signals.push(
        `Class/id/data attributes (${depthLabel}) contain sponsored tokens: "${attrString
          .trim()
          .slice(0, 80)}…"`
      );
    }
  };

  checkNodeAttrs(el, "block");
  let ancestor = el.parentElement;
  let hop = 1;
  while (ancestor && hop <= 3) {
    checkNodeAttrs(ancestor, `ancestor level ${hop}`);
    ancestor = ancestor.parentElement;
    hop++;
  }

  // --- 4. Links: affiliate patterns & CTAs ---
  const links = Array.from(el.querySelectorAll("a[href]"));
  const affiliatePatterns = ["utm_source=", "utm_campaign=", "affid=", "ref="];
  let affiliateCount = 0;
  let ctaCount = 0;

  for (const a of links) {
    const href = (a.getAttribute("href") || "").toLowerCase();
    const linkText = (a.innerText || "").toLowerCase();

    if (affiliatePatterns.some((p) => href.includes(p))) {
      affiliateCount++;
    }

    if (CTA_KEYWORDS.some((kw) => linkText.includes(kw))) {
      ctaCount++;
    }
  }

  if (affiliateCount > 0) {
    sponsored = true;
    signals.push(`Contains ~${affiliateCount} affiliate-style links in this block`);
  }

  if (ctaCount > 0) {
    signals.push(`Contains ~${ctaCount} strong call-to-action link(s)`);
  }

  // --- 5. Structural news cues ---
  const hasTime = !!el.querySelector("time");
  const hasByline =
    /by\s+[a-z]+\s+[a-z]+/.test(text) || /by\s+[a-z]+/.test(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (hasTime) {
    signals.push("Contains a <time> element (typical of news articles)");
  }
  if (hasByline) {
    signals.push("Contains a byline-like pattern (e.g., 'By Author Name')");
  }
  if (wordCount > 150) {
    signals.push(`Contains ~${wordCount} words (long-form text typical of articles)`);
  }

  // --- 6. Decide final type ---
  let type = "news";

  if (strongAd) {
    type = "ad";
  } else if (sponsored) {
    type = "sponsored";
  } else {
    type = "news";
    if (signals.length === 0) {
      signals.push("No explicit ad/sponsored signals found – treated as news.");
    }
  }

  return { type, signals };
}

// ------------------------------
// UI Helpers: badge, tooltip, panel
// ------------------------------
function createOrUpdateBadge(headlineEl, type, signals) {
  if (!currentSettings.overlayEnabled) return;

  // Remove old badge on this headline if present
  const oldBadge = headlineEl.querySelector(".advisor-badge");
  if (oldBadge) oldBadge.remove();

  const badge = document.createElement("div");
  badge.className = `advisor-badge ${type}`;
  badge.dataset.advisorType = type;

  const shape = document.createElement("span");
  shape.className = "shape";
  badge.appendChild(shape);

  const label = document.createElement("span");
  label.textContent =
    type === "news"
      ? "News"
      : type === "ad"
      ? "Ad"
      : "Sponsored";
  badge.appendChild(label);

  // Overlay visual is just shape + label.
  // Tooltip and panel behavior is controlled by feature toggles:

  if (currentSettings.tooltipEnabled) {
    badge.addEventListener("mouseenter", (ev) => {
      showTooltipForBlock(ev.clientX, ev.clientY, type, signals);
    });
    badge.addEventListener("mousemove", (ev) => {
      moveTooltip(ev.clientX, ev.clientY);
    });
    badge.addEventListener("mouseleave", () => {
      hideTooltip();
    });
  }

  if (currentSettings.panelEnabled) {
    badge.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openPanelForHeadline(headlineEl, type, signals);
    });
  }

  headlineEl.insertBefore(badge, headlineEl.firstChild);
}

function ensureTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement("div");
  tooltipEl.id = "advisor-tooltip";
  document.body.appendChild(tooltipEl);
}

function showTooltipForBlock(x, y, type, signals) {
  if (!tooltipEl || !currentSettings.tooltipEnabled) return;

  tooltipEl.innerHTML = "";
  const title = document.createElement("strong");
  title.textContent =
    type === "news"
      ? "Classified as News"
      : type === "ad"
      ? "Classified as Ad"
      : "Classified as Sponsored Content";
  tooltipEl.appendChild(title);

  const reason = document.createElement("div");
  if (signals.length > 0) {
    reason.textContent = `Reason: ${signals[0]}`;
  } else {
    reason.textContent = "Reason: Heuristic classification.";
  }
  tooltipEl.appendChild(reason);

  tooltipEl.style.display = "block";
  moveTooltip(x, y);
}

function moveTooltip(x, y) {
  if (!tooltipEl) return;
  const padding = 12;
  tooltipEl.style.left = x + padding + "px";
  tooltipEl.style.top = y + padding + "px";
}

function hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.style.display = "none";
}

function ensurePanel() {
  if (panelEl) return;

  panelEl = document.createElement("div");
  panelEl.id = "advisor-panel";

  const header = document.createElement("div");
  header.id = "advisor-panel-header";

  const h2 = document.createElement("h2");
  h2.textContent = "Transparency Panel";
  header.appendChild(h2);

  const closeBtn = document.createElement("button");
  closeBtn.id = "advisor-panel-close";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => {
    panelEl.classList.remove("open");
  });
  header.appendChild(closeBtn);

  panelBodyEl = document.createElement("div");
  panelBodyEl.id = "advisor-panel-body";

  panelEl.appendChild(header);
  panelEl.appendChild(panelBodyEl);
  document.body.appendChild(panelEl);
}

function openPanelForHeadline(headlineEl, type, signals) {
  if (!panelEl || !currentSettings.panelEnabled) return;
  panelBodyEl.innerHTML = "";

  const block = findArticleBlocks().find((b) => b.contains(headlineEl)) || headlineEl;

  const intro = document.createElement("p");
  intro.textContent =
    type === "news"
      ? "This headline appears to be part of genuine news content based on the following signals:"
      : type === "ad"
      ? "This headline appears to be part of an advertisement based on the following signals:"
      : "This headline appears to be part of sponsored/partner content based on the following signals:";
  panelBodyEl.appendChild(intro);

  const list = document.createElement("ul");
  for (const s of signals) {
    const li = document.createElement("li");
    li.textContent = s;
    list.appendChild(li);
  }
  panelBodyEl.appendChild(list);

  const techHeader = document.createElement("h3");
  techHeader.textContent = "Technical Signals (Snippet)";
  panelBodyEl.appendChild(techHeader);

  const snippet = document.createElement("code");
  snippet.textContent = getElementSnippet(block);
  panelBodyEl.appendChild(snippet);

  panelEl.classList.add("open");
}

function getElementSnippet(el) {
  const html = el.outerHTML || "";
  return html.length > 500 ? html.slice(0, 500) + "…" : html;
}

// Re-run classification on DOM changes (for infinite scroll pages, etc.)
const observer = new MutationObserver(() => {
  if (!currentSettings.extensionEnabled || !currentSettings.overlayEnabled) {
    return;
  }
  if (observer._pending) return;
  observer._pending = true;
  setTimeout(() => {
    observer._pending = false;
    annotatePage();
  }, 1000);
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});
