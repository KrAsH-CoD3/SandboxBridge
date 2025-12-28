// background.js - Handles keepalive only

// Keep track of last activity to prevent sleep
let lastActivity = Date.now();

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  lastActivity = Date.now();
  
  // Handle keepalive pings
  if (message.type === 'KEEPALIVE') {
    sendResponse({ status: 'alive' });
    return true;
  }
  
  return false;
});

// Self-keepalive: Prevent service worker from sleeping during active use
setInterval(() => {
  const timeSinceActivity = Date.now() - lastActivity;
  if (timeSinceActivity < 25000) {
    chrome.storage.local.get('keepalive', () => {});
  }
}, 15000);
