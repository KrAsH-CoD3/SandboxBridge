// content.js - Extension side
// Standard operations run in ISOLATED world (content script context)
// Custom code execution is handled by sandbox iframe in content script
// Isolated world is invisible to page detection

const COMMAND_COOKIE = 'pw_cmd';
const RESULT_COOKIE = 'pw_result';
const STATUS_COOKIE = 'pw_status';

// Execute custom code in sandbox iframe
// Sandbox iframe provides:
// - Isolated execution context (page can't detect)
// - Exempt from page's CSP (can use eval)
// - Full DOM access via bridge
async function executeCustomCode(code) {
  // Retry logic for background script connection
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'EXECUTE_CUSTOM',
          code: code
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      return result;
      
    } catch (error) {
      // If connection failed and we have retries left, wait and try again
      if (attempt < 2) {
        console.log(`Background connection failed, retry ${attempt + 1}/3...`);
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      
      // All retries failed - return error
      return { 
        error: 'Background script connection failed', 
        message: error.message,
        hint: 'Try reloading the extension or page'
      };
    }
  }
}

// Safe execution environment
async function executeCommand(cmd) {
  let result;
  
  try {
    switch(cmd.action) {
      case 'click':
        document.querySelector(cmd.selector)?.click();
        result = { success: true };
        break;
        
      case 'getText':
        result = { 
          text: document.querySelector(cmd.selector)?.textContent 
        };
        break;
        
      case 'getAllText':
        result = { 
          texts: Array.from(document.querySelectorAll(cmd.selector))
            .map(el => el.textContent) 
        };
        break;
        
      case 'fillInput':
        const input = document.querySelector(cmd.selector);
        if (input) {
          input.value = cmd.value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          result = { success: true };
        } else {
          result = { success: false, error: 'Element not found' };
        }
        break;
        
      case 'getAttribute':
        const el = document.querySelector(cmd.selector);
        result = { 
          value: el?.getAttribute(cmd.attribute) 
        };
        break;
        
      case 'waitForElement':
        // Poll for element
        for (let i = 0; i < cmd.timeout / 100; i++) {
          if (document.querySelector(cmd.selector)) {
            result = { success: true };
            break;
          }
          await new Promise(r => setTimeout(r, 100));
        }
        if (!result) result = { success: false, error: 'Timeout' };
        break;
        
      case 'custom':
        // Execute via sandbox iframe - allows eval, isolated from page
        try {
          const sandboxResult = await window._sandboxBridge.execute(cmd.code);
          result = sandboxResult || { success: true };
        } catch (error) {
          result = { error: error.message, stack: error.stack };
        }
        break;
        
      default:
        result = { error: 'Unknown action' };
    }
  } catch (error) {
    result = { error: error.message, stack: error.stack };
  }
  
  return result;
}

// Poll for commands
async function checkForCommands() {
  const cookies = document.cookie.split('; ');
  const commandCookie = cookies.find(row => row.startsWith(COMMAND_COOKIE + '='));
  
  if (commandCookie) {
    try {
      const encoded = commandCookie.split('=')[1];
      const command = JSON.parse(decodeURIComponent(encoded));
      
      // Clear command cookie immediately
      document.cookie = `${COMMAND_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
      
      // Set processing status
      document.cookie = `${STATUS_COOKIE}=processing; path=/`;
      
      // Execute command
      const result = await executeCommand(command);
      
      // Write result
      const encodedResult = encodeURIComponent(JSON.stringify(result));
      document.cookie = `${RESULT_COOKIE}=${encodedResult}; path=/`;
      document.cookie = `${STATUS_COOKIE}=done; path=/`;
      
    } catch (error) {
      const errorResult = { error: 'Command parse error', message: error.message };
      const encoded = encodeURIComponent(JSON.stringify(errorResult));
      document.cookie = `${RESULT_COOKIE}=${encoded}; path=/`;
      document.cookie = `${STATUS_COOKIE}=error; path=/`;
    }
  }
}

// Keep background script alive by pinging it regularly
setInterval(() => {
  try {
    chrome.runtime.sendMessage({ type: 'KEEPALIVE' }, () => {
      // Ignore errors - this is just to keep background alive
      if (chrome.runtime.lastError) {
        // Silent fail
      }
    });
  } catch (e) {
    // Silent fail
  }
}, 20000); // Ping every 20 seconds

// Fast polling - 50ms response time
setInterval(checkForCommands, 50);

// Signal ready
document.cookie = `pw_ready=true; path=/`;
console.log('SandboxBridge Loaded successfully! - Sandbox for eval, ISOLATED world for DOM access');