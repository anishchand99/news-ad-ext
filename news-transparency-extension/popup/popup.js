// Default settings
const DEFAULT_SETTINGS = {
    extensionEnabled: true,
    overlayEnabled: true,
    focusModeEnabled: false,
    tooltipEnabled: true,
    panelEnabled: true
  };
  
  document.addEventListener("DOMContentLoaded", async () => {
    const extensionEnabled = document.getElementById("extensionEnabled");
    const overlayEnabled = document.getElementById("overlayEnabled");
    const focusModeEnabled = document.getElementById("focusModeEnabled");
    const tooltipEnabled = document.getElementById("tooltipEnabled");
    const panelEnabled = document.getElementById("panelEnabled");
  
    // Load settings from storage
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      extensionEnabled.checked = stored.extensionEnabled;
      overlayEnabled.checked = stored.overlayEnabled;
      focusModeEnabled.checked = stored.focusModeEnabled;
      tooltipEnabled.checked = stored.tooltipEnabled;
      panelEnabled.checked = stored.panelEnabled;
    });
  
    const updateSettingsAndNotify = () => {
      const newSettings = {
        extensionEnabled: extensionEnabled.checked,
        overlayEnabled: overlayEnabled.checked,
        focusModeEnabled: focusModeEnabled.checked,
        tooltipEnabled: tooltipEnabled.checked,
        panelEnabled: panelEnabled.checked
      };
  
      chrome.storage.sync.set(newSettings, () => {
        // Tell current tab to re-apply settings
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const [tab] = tabs;
          if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "updateSettings" });
          }
        });
      });
    };
  
    extensionEnabled.addEventListener("change", updateSettingsAndNotify);
    overlayEnabled.addEventListener("change", updateSettingsAndNotify);
    focusModeEnabled.addEventListener("change", updateSettingsAndNotify);
    tooltipEnabled.addEventListener("change", updateSettingsAndNotify);
    panelEnabled.addEventListener("change", updateSettingsAndNotify);
  });
  