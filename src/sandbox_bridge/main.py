import asyncio
import json
import urllib.parse
from pathlib import Path
from playwright.async_api import async_playwright, Page

class StealthExtension:
    """Execute JavaScript through extension - ZERO detection in main context"""
    
    COMMAND_COOKIE = 'pw_cmd'
    RESULT_COOKIE = 'pw_result'
    STATUS_COOKIE = 'pw_status'
    
    def __init__(self, page: Page):
        self.page = page
    
    async def execute(self, command, timeout=10):
        """
        Execute command through extension with NO JS in main context
        
        Args:
            command: dict with 'action' and action-specific params
            timeout: seconds to wait for result
        
        Returns:
            Result from extension execution
        """
        # Clear previous cookies
        await self._clear_cookies()
        
        # Set command cookie (NO JS EXECUTION!)
        await self.page.context.add_cookies([{
            'name': self.COMMAND_COOKIE,
            'value': urllib.parse.quote(json.dumps(command)),
            'url': self.page.url
        }])
        
        # Wait for extension to process
        start_time = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - start_time < timeout:
            await asyncio.sleep(0.05)  # Check every 50ms
            
            cookies = await self.page.context.cookies()
            status = self._get_cookie_value(cookies, self.STATUS_COOKIE)
            
            for idx in range(3):
                if status in ['done', 'error']:
                    result_value = self._get_cookie_value(cookies, self.RESULT_COOKIE)
                    if result_value:
                        result = json.loads(urllib.parse.unquote(result_value))
                        await self._clear_cookies()
                        
                        if 'error' in result:
                            if idx == 2:
                                raise Exception(f"Extension error: {result['error']}")
                            continue
                        
                        return result
        
        raise TimeoutError(f"Extension did not respond within {timeout}s")
    
    def _get_cookie_value(self, cookies, name):
        """Extract cookie value from cookie list"""
        cookie = next((c for c in cookies if c['name'] == name), None)
        return cookie['value'] if cookie else None
    
    async def _clear_cookies(self):
        """Clear command/result cookies"""
        await self.page.context.add_cookies([
            {'name': self.COMMAND_COOKIE, 'value': '', 'url': self.page.url, 'expires': 0},
            {'name': self.RESULT_COOKIE, 'value': '', 'url': self.page.url, 'expires': 0},
            {'name': self.STATUS_COOKIE, 'value': '', 'url': self.page.url, 'expires': 0},
        ])
    
    # Convenient wrapper methods
    
    async def click(self, selector):
        """Click element through extension"""
        return await self.execute({'action': 'click', 'selector': selector})
    
    async def get_text(self, selector):
        """Get element text through extension"""
        result = await self.execute({'action': 'getText', 'selector': selector})
        return result.get('text')
    
    async def get_all_text(self, selector):
        """Get text from all matching elements"""
        result = await self.execute({'action': 'getAllText', 'selector': selector})
        return result.get('texts', [])
    
    async def fill(self, selector, value):
        """Fill input through extension"""
        return await self.execute({
            'action': 'fillInput',
            'selector': selector,
            'value': value
        })
    
    async def get_attribute(self, selector, attribute):
        """Get element attribute"""
        result = await self.execute({
            'action': 'getAttribute',
            'selector': selector,
            'attribute': attribute
        })
        return result.get('value')
    
    async def wait_for_element(self, selector, timeout=5):
        """Wait for element to appear"""
        return await self.execute({
            'action': 'waitForElement',
            'selector': selector,
            'timeout': timeout * 1000
        }, timeout=timeout + 1)
    
    async def run_custom(self, code):
        """Execute custom JavaScript code through extension"""
        return await self.execute({'action': 'custom', 'code': code})


async def main():
    """Example usage"""
    cwd = Path(__file__).parent
    extension_path = cwd / "extension"
    
    async with async_playwright() as p:
        # Launch with extension - headless=False required for extensions
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(cwd.parent / "user_data"),
            viewport={"width": 1024, "height": 600},
            headless=False,
            args=[
                f'--disable-extensions-except={extension_path}',
                f'--load-extension={extension_path}',
                '--disable-blink-features=AutomationControlled',  # Extra stealth
                '--window-position=333,33',# '--window-size=1024,600',
            ]
        )
        
        page = await context.new_page()
        stealth = StealthExtension(page)
        
        # Navigate
        await page.goto('https://example.com')
        
        # Wait a moment for extension to initialize
        await asyncio.sleep(0.5)
        
        print("🎭 Stealth mode active - zero JS detection!\n")
        
        # Example 1: Get text (NO page.evaluate!)
        title = await stealth.get_text('h1')
        print(f"Title: {title}")
        
        # Example 2: Click elements
        # await stealth.click('button#submit')
        # print("Clicked button through extension")
        
        # Example 3: Fill forms
        # await stealth.fill('input[name="search"]', 'test query')
        # print("Filled input through extension")
        
        # Example 4: Get multiple elements
        links = await stealth.get_all_text('a')
        print(f"Found {len(links)} links")
        
        # Example 5: Custom code execution with DOM access
        result = await stealth.run_custom('''
            // This runs in sandbox
            // DOM access via helper functions:
            // $('selector') - query single element
            // $$('selector') - query all elements  
            // getDocument() - get document info
            // getCustom(path) - query any property path
            
            const doc = await getDocument();
            const links = await $$('a');
            
            return {
                title: doc.title,
                url: doc.url,
                linkCount: links.length,
                timestamp: Date.now()
            };
        ''')
        print("Custom execution result:", result)
        
        # Example 6: Extract all text from paragraphs
        paragraphs = await stealth.run_custom('''
            const pElements = await $$('p');
            return {
                count: pElements.length,
                texts: pElements.map(p => p.textContent).slice(0, 5)  // First 5 paragraphs
            };
        ''')
        print("\n📝 Paragraphs:", paragraphs)
        
        # Example 7: Check page structure and meta info
        pageInfo = await stealth.run_custom('''
            const doc = await getDocument();
            const styles = document.querySelectorAll('link[rel="stylesheet"], style').length;
            const scripts = document.querySelectorAll('script').length;
            const images = document.querySelectorAll('img').length;
            
            return {
                title: doc.title,
                hasJQuery: !!window.jQuery,
                hasAngular: !!window.angular,
                hasReact: !!window.React,
                hasVue: !!window.Vue,
                resourceCounts: {
                    stylesheets: styles,
                    scripts: scripts,
                    images: images
                }
            };
        ''')
        print("\n🔍 Page Info:", pageInfo)
        
        # Example 8: Get form data (useful for scraping)
        formData = await stealth.run_custom('''
            const forms = await $$('form');
            return forms.map(form => ({
                id: form.id,
                name: form.name,
                method: form.method || 'GET',
                action: form.action,
                inputCount: form.querySelectorAll('input').length,
                buttonCount: form.querySelectorAll('button').length
            }));
        ''')
        print("\n📋 Forms on page:", formData)
        
        # Example 9: Monitor dynamic content loading (SPA)
        spaContent = await stealth.run_custom('''
            // Useful for SPAs like React, Vue, Angular
            const doc = await getDocument();
            const mainContent = await $('.main-content') || await $('.content') || await $('main');
            
            return {
                documentReady: doc.readyState,
                hasMainContent: mainContent !== null,
                contentPreview: mainContent?.innerHTML?.substring(0, 200) || 'No main content found'
            };
        ''')
        print("\n⚡ SPA Content:", spaContent)
        
        # Example 10: Advanced - Extract data attributes
        customData = await stealth.run_custom('''
            // Extract data-* attributes from elements
            
            const pageData = {
                // Count elements with data attributes
                elementsWithData: document.querySelectorAll('[data-id], [data-name], [data-value]').length,
                
                // Get body element info
                bodyClasses: document.body.className,
                bodyId: document.body.id,
                
                // Check global scope for common libraries
                libraries: {
                    hasJQuery: typeof jQuery !== 'undefined',
                    hasAxios: typeof axios !== 'undefined',
                    hasLodash: typeof _ !== 'undefined'
                }
            };
            
            return pageData;
        ''')
        print("\n💾 Custom Data:", customData)
        
        # Example 11: Execute complex logic with multiple awaits
        complexLogic = await stealth.run_custom('''
            // Multi-step logic with DOM queries
            
            // Step 1: Get document info
            const doc = await getDocument();
            
            // Step 2: Wait for async operation (simulated)
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 3: Query fresh DOM state
            const allElements = await $$('*');
            const allText = document.body.innerText.length;
            
            // Step 4: Process and return
            return {
                pageTitle: doc.title,
                totalElements: allElements.length,
                textLength: allText,
                executedAt: new Date().toISOString()
            };
        ''')
        print("\n🔄 Complex Logic Result:", complexLogic)
        
        # Example 12: Error handling in custom code
        errorExample = await stealth.run_custom('''
            try {
                // This will fail if no 'nonexistent' element exists
                const missing = await $('nonexistent-element-xyz');
                
                if (!missing) {
                    return { status: 'element not found', success: false };
                }
            } catch (error) {
                return { 
                    status: 'error',
                    message: error.message,
                    success: false
                };
            }
            
            return { status: 'no error', success: true };
        ''')
        print("\n⚠️ Error Handling:", errorExample)
        
        # Example 6: Wait for dynamic content
        # await stealth.wait_for_element('.dynamic-content', timeout=10)
        # print("Dynamic element appeared")
        
        print("\n✅ All operations completed with ZERO JS detection!")
        
        await asyncio.sleep(3)
        await context.close()


if __name__ == "__main__":
    asyncio.run(main())