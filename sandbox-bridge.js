// sandbox-bridge.js - Bridges between content script and sandbox
// Runs in content script, provides DOM access to sandbox

class SandboxBridge {
    constructor() {
        this.iframe = null;
        this.ready = false;
        this.pendingExecutions = new Map();
        this.setupIframe();
    }
    
    setupIframe() {
        // Create hidden sandbox iframe
        this.iframe = document.createElement('iframe');
        this.iframe.src = chrome.runtime.getURL('sandbox.html');
        this.iframe.style.display = 'none';
        (document.head || document.documentElement).appendChild(this.iframe);
        
        // Listen for messages from sandbox
        window.addEventListener('message', (event) => {
            if (event.source !== this.iframe.contentWindow) return;
            
            const { type, id, result, error, selector, attribute, value } = event.data;
            
            if (type === 'SANDBOX_READY') {
                this.ready = true;
                return;
            }
            
            // Handle DOM queries from sandbox
            if (type === 'DOM_QUERY') {
                const el = document.querySelector(selector);
                let domResult = null;
                
                if (el) {
                    domResult = {
                        textContent: el.textContent,
                        innerHTML: el.innerHTML,
                        value: el.value,
                        tagName: el.tagName,
                        className: el.className,
                        id: el.id
                    };
                    
                    // Get all attributes
                    const attrs = {};
                    for (let attr of el.attributes) {
                        attrs[attr.name] = attr.value;
                    }
                    domResult.attributes = attrs;
                }
                
                this.iframe.contentWindow.postMessage({
                    type: 'DOM_RESULT',
                    id: id,
                    result: domResult
                }, '*');
                return;
            }
            
            // Handle DOM queries for all matching elements
            if (type === 'DOM_QUERY_ALL') {
                const elements = Array.from(document.querySelectorAll(selector));
                const domResults = elements.map(el => ({
                    textContent: el.textContent,
                    innerHTML: el.innerHTML,
                    value: el.value,
                    tagName: el.tagName
                }));
                
                this.iframe.contentWindow.postMessage({
                    type: 'DOM_RESULT',
                    id: id,
                    result: domResults
                }, '*');
                return;
            }
            
            // Handle document-level queries
            if (type === 'DOCUMENT_QUERY') {
                const docResult = {
                    title: document.title,
                    url: window.location.href,
                    domain: window.location.hostname,
                    pathname: window.location.pathname,
                    readyState: document.readyState,
                    // Additional useful properties
                    documentElement: {
                        tagName: document.documentElement.tagName,
                        className: document.documentElement.className,
                        id: document.documentElement.id
                    },
                    body: {
                        className: document.body.className,
                        id: document.body.id,
                        innerHTML: document.body.innerHTML.substring(0, 500)  // First 500 chars
                    },
                    meta: {
                        description: document.querySelector('meta[name="description"]')?.content,
                        keywords: document.querySelector('meta[name="keywords"]')?.content,
                        viewport: document.querySelector('meta[name="viewport"]')?.content
                    },
                    // Cookie and storage info (if accessible)
                    cookie: document.cookie,
                    // Performance timing
                    readyState: document.readyState,
                    // Useful for SPA detection
                    scripts: document.querySelectorAll('script').length,
                    stylesheets: document.querySelectorAll('link[rel="stylesheet"], style').length,
                    iframes: document.querySelectorAll('iframe').length
                };
                
                this.iframe.contentWindow.postMessage({
                    type: 'DOM_RESULT',
                    id: id,
                    result: docResult
                }, '*');
                return;
            }
            
            // Handle custom queries (query any property by path)
            if (type === 'CUSTOM_QUERY') {
                const { queryPath } = event.data;
                let result = null;
                
                try {
                    // Safe property path traversal
                    // Example: 'body.className' or 'documentElement.children.0.textContent'
                    let obj = window;
                    const parts = queryPath.split('.');
                    
                    for (const part of parts) {
                        if (obj === null || obj === undefined) break;
                        // Handle array indices like 'children.0'
                        if (/^\d+$/.test(part)) {
                            obj = obj[parseInt(part)];
                        } else {
                            obj = obj[part];
                        }
                    }
                    
                    result = obj;
                } catch (e) {
                    result = { error: e.message };
                }
                
                this.iframe.contentWindow.postMessage({
                    type: 'DOM_RESULT',
                    id: id,
                    result: result
                }, '*');
                return;
            }
            
            if (type === 'EXECUTION_RESULT' || type === 'EXECUTION_ERROR') {
                const pending = this.pendingExecutions.get(id);
                if (pending) {
                    this.pendingExecutions.delete(id);
                    if (type === 'EXECUTION_RESULT') {
                        pending.resolve(result);
                    } else {
                        pending.reject(new Error(error.message));
                    }
                }
            }
        });
    }
    
    async execute(code) {
        // Wait for sandbox to be ready
        if (!this.ready) {
            await new Promise(resolve => {
                const check = setInterval(() => {
                    if (this.ready) {
                        clearInterval(check);
                        resolve();
                    }
                }, 50);
                setTimeout(() => {
                    clearInterval(check);
                    resolve();
                }, 5000);
            });
        }
        
        if (!this.ready) {
            throw new Error('Sandbox not ready');
        }
        
        // Generate unique ID for this execution
        const id = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Send code to sandbox
        this.iframe.contentWindow.postMessage({
            type: 'EXECUTE_CODE',
            code: code,
            id: id
        }, '*');
        
        // Wait for result
        return new Promise((resolve, reject) => {
            this.pendingExecutions.set(id, { resolve, reject });
            
            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingExecutions.has(id)) {
                    this.pendingExecutions.delete(id);
                    reject(new Error('Execution timeout'));
                }
            }, 30000);
        });
    }
    
    // Provide DOM access to sandbox code via helper functions
    async executeWithDOM(code) {
        // Inject DOM helper functions that the sandbox can call via postMessage
        const wrappedCode = `
            // Helper to query DOM (sends message back to content script)
            const $ = (selector) => {
                return new Promise((resolve) => {
                    const msgId = 'dom_' + Date.now() + Math.random();
                    window.parent.postMessage({
                        type: 'DOM_QUERY',
                        selector: selector,
                        id: msgId
                    }, '*');
                    
                    const listener = (event) => {
                        if (event.data.type === 'DOM_RESULT' && event.data.id === msgId) {
                            window.removeEventListener('message', listener);
                            resolve(event.data.result);
                        }
                    };
                    window.addEventListener('message', listener);
                });
            };
            
            // User code
            ${code}
        `;
        
        return this.execute(wrappedCode);
    }
}

// Export singleton
if (typeof window._sandboxBridge === 'undefined') {
    window._sandboxBridge = new SandboxBridge();
}
