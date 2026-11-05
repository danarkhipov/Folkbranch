// The chart by hand: pluses, drawing a link, selecting a line, the card.
import { chromium } from 'playwright-core'
import { boot, cookiesOf, IMAGE } from './lib.mjs'
const { B, cookie } = await boot('fg-chart', 3440, IMAGE, { people: 30 })
const cookies = cookiesOf(cookie)
const br=await chromium.launch({channel:'chrome',headless:true}); const ctx=await br.newContext({viewport:{width:1440,height:900}}); await ctx.addCookies(cookies); const p=await ctx.newPage()
const errs=[],bad=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,200))); p.on('response',r=>{if(!r.ok()&&r.status()!==304)bad.push(r.status()+' '+r.url().replace(B,''))})
const ok=(n,v)=>console.log(v?'ok  ':'FAIL',n)
await p.goto(B+'/'); await p.waitForSelector('.pcard'); await p.waitForTimeout(800)
const cardBox=async(i)=>{const b=await p.locator('.pcard').nth(i).boundingBox();return b}
const c=await cardBox(3); await p.mouse.move(c.x+c.width/2,c.y+30); await p.waitForTimeout(300)
ok('plus appears on hover',await p.locator('.pcard').nth(3).locator('.tool.add.left').evaluate(e=>getComputedStyle(e).opacity!=='0'))
ok('hover names relatives',await p.locator('.rel.kin').count()>0)
await p.locator('.pcard').nth(3).locator('.tool.add.right').click(); await p.waitForTimeout(400)
ok('plus opens add dialog',await p.locator('[role=dialog]').count()>0); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
await p.mouse.move(5,5);await p.waitForTimeout(200)
// line hit
const seg=await p.evaluate(()=>{for(const el of document.querySelectorAll('svg.hits path.line-hit')){const l=el.getTotalLength();if(l<60)continue;const m=el.getScreenCTM();const q=el.getPointAtLength(l/2);const x=q.x*m.a+m.e,y=q.y*m.d+m.f;if(x>100&&x<1300&&y>100&&y<800&&document.elementFromPoint(x,y)===el)return{x,y}}return null})
if(seg){await p.mouse.move(seg.x,seg.y);await p.waitForTimeout(200);ok('line hover lights',await p.locator('path.line.hover, path.union.hover').count()>0);ok('line tip',await p.locator('.fixed.z-50.float').count()>0);await p.mouse.click(seg.x,seg.y);await p.waitForTimeout(300);ok('line click selects',await p.locator('.linkbar').count()>0);await p.keyboard.press('Escape');await p.mouse.click(1400,880);await p.waitForTimeout(200)} else ok('line segment found',false)
// dot
const dot=await p.evaluate(()=>{for(const el of document.querySelectorAll('.dot-group')){const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(x>100&&x<1300&&y>100&&y<800&&document.elementFromPoint(x,y)?.closest('.dot-group')===el)return{x,y}}return null})
if(dot){await p.mouse.click(dot.x,dot.y);await p.waitForTimeout(400);ok('family dot adds child',await p.locator('[role=dialog]').count()>0);await p.keyboard.press('Escape');await p.waitForTimeout(300)}
// drag from avatar shows draft
const a=await cardBox(1),b2=await cardBox(5); await p.mouse.move(a.x+a.width/2,a.y+25);await p.mouse.down();await p.mouse.move(b2.x+50,b2.y+30,{steps:6});await p.waitForTimeout(150);ok('drag draws link',await p.locator('.link-draft').count()>0);await p.keyboard.press('Escape');await p.mouse.up();await p.waitForTimeout(400);if(await p.locator('[role=dialog]').count())await p.keyboard.press('Escape');await p.waitForTimeout(200)
// click opens and focus dims
const c2=await cardBox(6);await p.mouse.click(c2.x+c2.width/2,c2.y+25);await p.waitForTimeout(600);ok('click opens panel',await p.locator('aside.panel').count()>0);ok('others dim',await p.locator('.pcard.dim').count()>0);ok('path lit',await p.locator('path.line.hot, path.union.hot').count()>0)
for(const [w,h] of [[1920,1080],[1280,720],[1024,700],[800,600]]){await p.setViewportSize({width:w,height:h});await p.waitForTimeout(400);const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:innerWidth,panel:document.querySelector('aside.panel')?.getBoundingClientRect().toJSON(),nav:document.querySelector('nav')?.getBoundingClientRect().right}));ok(`no sideways scroll at ${w}: panel ${Math.round(o.panel?.width??0)}x${Math.round(o.panel?.height??0)}`,o.sw<=o.cw);await p.screenshot({path:`/tmp/chart-w${w}.png`})}
console.log('errors',JSON.stringify(errs),'bad',JSON.stringify([...new Set(bad)].slice(0,6)))
await br.close()
