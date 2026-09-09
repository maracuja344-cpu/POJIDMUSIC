/* Visual smoke: uses the worker's actual HTML composition, without installing it.
 * Set PLAYWRIGHT_MODULE to a local Playwright installation; no npm/build required.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const read = name => process.env.BASELINE_REF && /\.(css|js|html)$/.test(name)
    ? execFileSync('git', ['show', `${process.env.BASELINE_REF}:${name}`], {cwd:root})
    : fs.readFileSync(path.join(root,name));
const out = path.resolve(process.argv[2] || path.join(root, 'tests/screenshots/mobile-foundation'));
fs.mkdirSync(out, { recursive: true });
const worker = vm.createContext({ URL, self: { registration: { scope: 'http://localhost/' }, addEventListener() {} } });
vm.runInContext(read('service-worker.js').toString(), worker);
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    let body = read(name);
    // Historical real catalog metadata, solely for repeatable visual testing.
    if (name === 'tracks.js') body = execFileSync('git', ['show','cf95112:tracks.js'], {cwd:root});
    if (name === 'index.html') body = Buffer.from(worker.versionNavigationHtml(body.toString()));
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(body);
});
const metrics = () => {
    const selectors = ['.header', '.logo', '#new .section-title', '#new .tracks-row', '#new .release-card', '#recommendations .section-title', '#recommendations .recommendation-card', '#all-tracks .release-card', '.mobile-bottom-navigation', '.mini-player'];
    return { overflow: document.documentElement.scrollWidth > innerWidth, width: innerWidth,
        items: Object.fromEntries(selectors.map(s => { const e = document.querySelector(s); if (!e) return [s, null]; const r=e.getBoundingClientRect(), c=getComputedStyle(e); return [s, { x:r.x,y:r.y,width:r.width,height:r.height,display:c.display,font:c.fontSize,color:c.color,background:c.backgroundColor,padding:c.padding,borderRadius:c.borderRadius }]; })) };
};
(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const report = {};
    try {
        for (const [name,width,height,mobile,safe] of [['desktop',1280,900,false,false],['mobile390',390,844,true,false],['mobile430',430,932,true,false],['standalone',390,844,true,true]]) {
            if (process.env.VIEWPORT_NAME && process.env.VIEWPORT_NAME !== name) continue;
            const context = await browser.newContext({ viewport:{width,height}, isMobile:mobile, hasTouch:mobile, serviceWorkers:'block' });
            const page = await context.newPage();
            page.on('pageerror', e => console.error(name, e.message));
            page.on('requestfailed', r => console.error('NETWORK',r.url(),r.failure()?.errorText));
            page.on('console', m => { if(m.type()==='error') console.error('CONSOLE',m.text()); });
            // Repeatable order for recommendation screenshots; production data stays local.
            await page.addInitScript(() => { Math.random = () => 0.42; });
            if (safe) {
                await page.addInitScript(() => { Object.defineProperty(navigator, 'standalone', {value:true}); });
                const cdp = await context.newCDPSession(page);
                await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets:{top:47,bottom:34,left:0,right:0}});
            }
            await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil:'networkidle' });
            await page.waitForTimeout(14000);
            await page.evaluate(async () => {
                const catalog = await import('/js/catalog-state.js');
                const render = await import('/js/render.js');
                catalog.setCatalogTracks(tracks.map(t=>({...t,catalogId:`fixture:${t.id}`,source:'fixture'})));
                render.renderNewTracks(); render.renderAllTracks(); render.renderRecommendations(); render.initializeCardAnimations();
            });
            await page.waitForTimeout(500);
            await page.screenshot({path:path.join(out,`${name}-home.png`)});
            report[name] = {home:await page.evaluate(metrics)};
            if (mobile) {
                await page.locator('[data-mobile-tab="search"]').click();
                await page.waitForTimeout(500);
                report[name].search = await page.locator('body').evaluate(e=>e.classList.contains('mobile-search-active'));
                await page.locator('[data-mobile-tab="home"]').click();
                await page.locator('[data-mobile-tab="profile"]').click();
                await page.waitForTimeout(600);
                report[name].guestProfile = await page.locator('#auth-modal').isVisible();
                await page.locator('.auth-close-button').click();
                // Layout-only role projection: no impersonation or backend mutations.
                report[name].roles = {};
                for (const role of ['listener','artist','admin']) {
                    await page.evaluate(role => document.querySelectorAll('[data-mobile-tab="upload"],[data-mobile-tab="artist"]').forEach(e=>e.hidden = role==='listener'),role);
                    report[name].roles[role] = await page.locator('.mobile-nav-button:visible').evaluateAll(es=>es.map(e=>({tab:e.dataset.mobileTab,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
                }
            }
            await page.locator('#new .release-card').first().click();
            await page.waitForTimeout(1200);
            report[name].player = await page.evaluate(metrics);
            await page.screenshot({path:path.join(out,`${name}-player.png`)});
            const toggle = page.locator('.mini-player .player-toggle');
            const beforeToggle = await toggle.getAttribute('aria-label');
            await toggle.click();
            await page.waitForTimeout(350);
            assert.notEqual(await toggle.getAttribute('aria-label'),beforeToggle,`${name}: pause`);
            await toggle.click();
            await page.waitForTimeout(350);
            assert.equal(await toggle.getAttribute('aria-label'),beforeToggle,`${name}: resume`);
            if (mobile) {
                await page.evaluate(() => { document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0,document.documentElement.scrollHeight); });
                await page.waitForTimeout(350);
                report[name].lastCardClear = await page.evaluate(() => {
                    const cards=document.querySelectorAll('#all-tracks .release-card');
                    return cards[cards.length-1].getBoundingClientRect().bottom <= document.querySelector('.mini-player').getBoundingClientRect().top;
                });
                assert.ok(report[name].lastCardClear,`${name}: last card reachable above player`);
            }
            await context.close();
        }
    } finally { await browser.close(); server.close(); }
    fs.writeFileSync(path.join(out,'report.json'), JSON.stringify(report,null,2));
    for (const [name,result] of Object.entries(report)) {
        assert.equal(result.home.overflow,false,`${name}: Home overflow`);
        assert.equal(result.player.overflow,false,`${name}: player overflow`);
        if (name !== 'desktop') {
            assert.equal(result.search,true,`${name}: Search opens`);
            assert.equal(result.guestProfile,true,`${name}: guest Profile opens login`);
            for (const [role,buttons] of Object.entries(result.roles)) {
                assert.equal(buttons.length,role==='listener'?3:5,`${name}: ${role} projection`);
                assert.ok(buttons.every(b=>b.width>=44 && b.height>=44),`${name}: touch targets`);
            }
            const nav=result.player.items['.mobile-bottom-navigation'], mini=result.player.items['.mini-player'];
            assert.ok(mini.y+mini.height<=nav.y,`${name}: chrome overlap`);
        }
        console.log(`PASS ${name}: layout, overflow${name==='desktop'?'':', search, guest profile, role projection, mini-player spacing'}`);
    }
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
