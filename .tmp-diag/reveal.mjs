import { webkit } from 'playwright';
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 402, height: 754 }, deviceScaleFactor: 1 });

// Elke src-wissel van het slot-icoon loggen, met tijdstempel.
await page.addInitScript(() => {
	window.__reel = [];
	const start = performance.now();
	const obs = () => {
		const img = document.querySelector('.slot-img');
		if (img) {
			const w = window;
			if (w.__last !== img.getAttribute('src')) {
				w.__last = img.getAttribute('src');
				w.__reel.push([Math.round(performance.now() - start), w.__last.split('/').pop()]);
			}
		}
		requestAnimationFrame(obs);
	};
	requestAnimationFrame(obs);
});

await page.goto('http://localhost:5199/dev/reveal', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.slot-img');
await page.waitForTimeout(2600);

const reel = await page.evaluate(() => window.__reel);
const settled = await page.evaluate(() => ({
	settled: !!document.querySelector('.slot--settled'),
	laatste: document.querySelector('.slot-img')?.getAttribute('src')?.split('/').pop(),
	naam: document.querySelector('.slot-name')?.textContent?.trim()
}));

const uniek = new Set(reel.map((r) => r[1]));
console.log(`Wisselingen: ${reel.length}   unieke iconen: ${uniek.size}`);
console.log(`Eerste 6:  ${reel.slice(0, 6).map((r) => `${r[0]}ms ${r[1]}`).join('  ')}`);
console.log(`Laatste 6: ${reel.slice(-6).map((r) => `${r[0]}ms ${r[1]}`).join('  ')}`);
const gaten = reel.slice(1).map((r, i) => r[0] - reel[i][0]);
console.log(`Interval eerste 5: ${gaten.slice(0, 5).join(', ')} ms`);
console.log(`Interval laatste 5: ${gaten.slice(-5).join(', ')} ms`);
console.log(`Langste pauze zonder wisseling: ${Math.max(...gaten)} ms`);
console.log(`\nGeland: ${settled.settled}   laatste icoon: ${settled.laatste}   naam: "${settled.naam}"`);
console.log(settled.laatste === 'shield.png' ? '✅ landt op de VERKREGEN powerup (shield)' : '❌ landt op iets anders');

// Tweede ronde: is het filmpje anders?
await page.click('button');
await page.waitForTimeout(2600);
const reel2 = await page.evaluate(() => window.__reel);
const tweede = reel2.slice(reel.length).map((r) => r[1]);
const eerste = reel.map((r) => r[1]);
console.log(`\nTweede ronde: ${tweede.length} wisselingen`);
console.log(`Zelfde volgorde als ronde 1? ${JSON.stringify(eerste.slice(1, 8)) === JSON.stringify(tweede.slice(1, 8)) ? 'JA (slecht)' : 'NEE — willekeurig'}`);
await browser.close();
