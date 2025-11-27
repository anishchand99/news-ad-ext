// Default settings
const DEFAULT_SETTINGS = {
  extensionEnabled: true,
  overlayEnabled: true,
  focusModeEnabled: false,
  tooltipEnabled: true,
  panelEnabled: true,
  sitePreferences: {},
};

document.addEventListener('DOMContentLoaded', async () => {
  // UI Elements
  const extensionEnabled = document.getElementById('extensionEnabled');
  const siteEnabled = document.getElementById('siteEnabled');
  const currentSiteLabel = document.getElementById('currentSiteLabel');

  const overlayEnabled = document.getElementById('overlayEnabled');
  const focusModeEnabled = document.getElementById('focusModeEnabled');
  const tooltipEnabled = document.getElementById('tooltipEnabled');
  const panelEnabled = document.getElementById('panelEnabled');

  // Bulk Add Elements
  const btnBulkAdd = document.getElementById('btnBulkAdd');
  const bulkInput = document.getElementById('bulkInput');
  const bulkStatus = document.getElementById('bulkStatus');

  // Get Current Tab Hostname
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let currentHostname = null;

  if (tab && tab.url) {
    try {
      const url = new URL(tab.url);
      currentHostname = url.hostname;
      currentSiteLabel.textContent = `Current: ${currentHostname}`;
    } catch (e) {
      currentSiteLabel.textContent = 'Current Site (Unknown)';
      siteEnabled.disabled = true;
    }
  }

  // Load Settings
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    // Global
    extensionEnabled.checked = stored.extensionEnabled;
    overlayEnabled.checked = stored.overlayEnabled;
    focusModeEnabled.checked = stored.focusModeEnabled;
    tooltipEnabled.checked = stored.tooltipEnabled;
    panelEnabled.checked = stored.panelEnabled;

    // Site Specific
    if (currentHostname) {
      // Check exact match
      const isAllowed = stored.sitePreferences[currentHostname] === true;
      siteEnabled.checked = isAllowed;
    }
  });

  // Save Handler
  const updateSettingsAndNotify = () => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      const updatedPreferences = stored.sitePreferences || {};

      if (currentHostname) {
        updatedPreferences[currentHostname] = siteEnabled.checked;
      }

      const newSettings = {
        extensionEnabled: extensionEnabled.checked,
        overlayEnabled: overlayEnabled.checked,
        focusModeEnabled: focusModeEnabled.checked,
        tooltipEnabled: tooltipEnabled.checked,
        panelEnabled: panelEnabled.checked,
        sitePreferences: updatedPreferences,
      };

      chrome.storage.sync.set(newSettings, () => {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'updateSettings' });
        }
      });
    });
  };

  // 4. Bulk Add Logic
  const handleBulkAdd = () => {
    const rawText = bulkInput.value;
    if (!rawText.trim()) return;

    const lines = rawText.split(/[\n,]/);
    let addedCount = 0;

    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      const preferences = stored.sitePreferences || {};

      lines.forEach((line) => {
        let clean = line.trim();
        if (!clean) return;

        // Attempt to extract hostname
        try {
          if (!clean.startsWith('http')) {
            clean = 'https://' + clean;
          }
          const urlObj = new URL(clean);
          preferences[urlObj.hostname] = true;
          addedCount++;
        } catch (err) {
          console.log('Could not parse URL:', line);
        }
      });

      // Save back to storage
      chrome.storage.sync.set({ sitePreferences: preferences }, () => {
        bulkInput.value = ''; // Clear input
        bulkStatus.textContent = `Successfully added ${addedCount} sites!`;

        // If the user just added the *current* site via bulk, update the toggle visually
        if (currentHostname && preferences[currentHostname]) {
          siteEnabled.checked = true;
          // Also notify content script to start immediately
          chrome.tabs.sendMessage(tab.id, { type: 'updateSettings' });
        }

        setTimeout(() => {
          bulkStatus.textContent = '';
        }, 3000);
      });
    });
  };

  // Listeners
  extensionEnabled.addEventListener('change', updateSettingsAndNotify);
  siteEnabled.addEventListener('change', updateSettingsAndNotify);
  overlayEnabled.addEventListener('change', updateSettingsAndNotify);
  focusModeEnabled.addEventListener('change', updateSettingsAndNotify);
  tooltipEnabled.addEventListener('change', updateSettingsAndNotify);
  panelEnabled.addEventListener('change', updateSettingsAndNotify);

  // Bulk Listener
  btnBulkAdd.addEventListener('click', handleBulkAdd);
});
