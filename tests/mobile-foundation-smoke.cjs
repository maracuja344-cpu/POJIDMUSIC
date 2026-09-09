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
async function searchPass(page, name, mobile) {
    const result = {};
    await page.evaluate(async () => {
        const catalog = await import('/js/catalog-state.js');
        catalog.setCatalogTracks(catalog.getCatalogTracks().map(t=>({...t, artists:[{
            id:`fixture-${t.artist}`, slug:`fixture-${t.artist.toLowerCase().replace(/\W/g,'')}`,
            displayName:t.artist, avatarUrl:t.cover, isFallback:false
        }]})));
    });
    if (mobile) {
        await page.locator('[data-mobile-tab="search"]').click();
        await page.waitForTimeout(150);
        assert.equal(await page.locator('.search-input').evaluate(e=>document.activeElement===e),true,'Search autofocus');
        if (!process.env.BASELINE_REF) assert.equal(await page.locator('.search-idle').isVisible(),true,'Intentional idle state');
        await page.screenshot({path:path.join(out,`${name}-search-empty.png`)});
    }
    const field=page.locator('.search-input');
    await field.fill('Avario');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#search-results .release-card').count(),1,'Track-only query');
    assert.equal(await page.locator('.search-artists').isVisible(),false,'No matching artist');
    await field.fill('triplepeepy');
    await page.waitForTimeout(70);
    assert.equal(await page.locator('#search-results .release-card').count(),1,'Debounce does not render early');
    await page.waitForTimeout(350);
    assert.equal(await page.locator('.search-artists').isVisible(),true,'Artists group');
    assert.ok(await page.locator('#search-results .release-card').count()>1,'Tracks group');
    await page.evaluate(()=>document.querySelector('.search-input').blur());
    await page.screenshot({path:path.join(out,`${name}-search-results.png`)});
    result.normal = await page.locator('#search-results').evaluate(e=>({htmlWidth:document.documentElement.scrollWidth, viewport:innerWidth, styles:[...e.querySelectorAll('.release-card,.search-artist-result,.search-group-title')].map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {class:n.className,width:r.width,height:r.height,font:s.fontSize,padding:s.padding,color:s.color,background:s.backgroundColor,border:s.border};})}));
    assert.ok(result.normal.htmlWidth<=result.normal.viewport,'Search no overflow');
    if (mobile) {
        await page.locator('#search-results .release-card').first().click();
        await page.waitForTimeout(1000);
        assert.equal(await page.locator('.mini-player').isVisible(),true,'Search playback opens mini-player');
        await page.screenshot({path:path.join(out,`${name}-search-player.png`)});
        const toggle=page.locator('.mini-player .player-toggle'), before=await toggle.getAttribute('aria-label');
        await toggle.click();await page.waitForTimeout(300);
        assert.notEqual(await toggle.getAttribute('aria-label'),before,'Search pause');
        await toggle.click();await page.waitForTimeout(300);
        assert.equal(await toggle.getAttribute('aria-label'),before,'Search resume');
        result.roles={};
        for (const role of ['listener','artist','admin']) {
            await page.evaluate(role=>document.querySelectorAll('[data-mobile-tab="upload"],[data-mobile-tab="artist"]').forEach(e=>e.hidden=role==='listener'),role);
            const buttons=await page.locator('.mobile-nav-button:visible').evaluateAll(es=>es.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
            assert.equal(buttons.length,role==='listener'?3:5);
            assert.ok(buttons.every(e=>e.width>=44&&e.height>=44));result.roles[role]=buttons.length;
        }
        assert.equal(await page.locator('[data-mobile-tab="search"]').getAttribute('aria-current'),'page');
        await page.locator('.search-artist-result').first().click();
        await page.waitForTimeout(300);
        assert.ok(new URL(page.url()).searchParams.has('artist'),'Artist routing');
        assert.equal(await page.locator('.header').isVisible(),true,'Artist keeps its header');
        await page.goBack(); await page.waitForTimeout(400);
        assert.equal(await page.locator('#catalog-view').isVisible(),true,'History returns to catalog');
        // Artist-only cannot arise naturally: artists come from matching playable tracks.
        // Isolate the existing artist projection to check this layout without changing semantics.
        await page.locator('.search-results-list').evaluate(e=>e.style.display='none');
        await page.locator('.search-tracks-title').evaluate(e=>e.hidden=true);
        await page.screenshot({path:path.join(out,`${name}-artists-only-layout.png`)});
        await page.locator('.search-results-list').evaluate(e=>e.style.display='');
    }
    await field.fill('zzzz-no-match');await page.waitForTimeout(300);
    assert.equal(await page.locator('.search-empty').isVisible(),true,'No results');
    await page.screenshot({path:path.join(out,`${name}-no-results.png`)});
    await page.locator('.search-clear-button').click();
    assert.equal(await field.inputValue(),'','Clear query');
    if(mobile && !process.env.BASELINE_REF) assert.equal(await page.locator('.search-idle').isVisible(),true);
    await page.evaluate(async()=>{
        const catalog=await import('/js/catalog-state.js');const list=catalog.getCatalogTracks();
        const long='Очень длинное название для проверки переносов и границ экрана '.repeat(3);
        catalog.setCatalogTracks(list.map(t=>({...t,title:long,artists:[{id:'fixture-long',slug:'fixture-long',displayName:long,avatarUrl:'',isFallback:false}]})));
    });
    await field.fill('Очень');await page.waitForTimeout(300);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long text no overflow');
    await page.screenshot({path:path.join(out,`${name}-long-results.png`)});
    assert.equal(await page.locator('.search-artist-result').count(),1,'Artist identities deduplicated');
    if(mobile && !process.env.BASELINE_REF) assert.equal(await page.locator('.search-artist-avatar').textContent(),'О','Initial fallback');
    if(mobile){
        await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,document.documentElement.scrollHeight);});
        await page.waitForTimeout(300);
        assert.ok(await page.evaluate(()=>{const c=document.querySelectorAll('#search-results .release-card');return c[c.length-1].getBoundingClientRect().bottom<=document.querySelector('.mini-player').getBoundingClientRect().top;}),'Last search row clears player');
        await page.evaluate(async()=>{
            const catalog=await import('/js/catalog-state.js');const track=catalog.getCatalogTracks()[0];
            catalog.setCatalogTracks([{...track,title:'Legacy track',artist:'Legacy artist',artists:[{id:'credit-legacy',slug:'legacy',displayName:'Legacy artist',isFallback:true}]}]);
        });
        await field.fill('Legacy');await page.waitForTimeout(300);
        assert.equal(await page.locator('.search-artist-result').count(),0,'Legacy identity not linked as Artist');
        assert.equal(await page.locator('#search-results .release-card').count(),1,'Legacy track still searchable');
        await page.locator('.search-cancel-button').click();await page.waitForTimeout(300);
        assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('mobile-search-active')),false,'Cancel returns Home');
        await page.screenshot({path:path.join(out,`${name}-home-return.png`)});
    }
    return result;
}
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
            if(process.env.SEARCH_PASS){report[name]=await searchPass(page,name,mobile);await context.close();continue;}
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
    if(process.env.SEARCH_PASS){console.log('PASS Search presentation/behavior: '+Object.keys(report).join(', '));return;}
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
