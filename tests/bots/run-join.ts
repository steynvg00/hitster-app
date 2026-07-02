// Entrypoint: spin up N player bots in parallel (isolated contexts) against a
// single game set and report each bot's assigned team.
//
//   npm run bots:join -- --set <game-set-uuid> [--count N]
//
// Requires the app running (default http://localhost:5173, override BOT_BASE_URL)
// and chromium installed once via `npx playwright install chromium`.

import { chromium } from '@playwright/test';
import { Player, type JoinResult } from './player';
import { BOT_BASE_URL, parseSetId, parseCount } from './config';

async function main() {
	const setId = parseSetId(process.argv);
	const count = parseCount(process.argv, 2);

	console.log(`▶ Launching ${count} player bot(s) against ${BOT_BASE_URL}`);
	console.log(`  set: ${setId}\n`);

	const browser = await chromium.launch();
	try {
		const players = Array.from({ length: count }, (_, i) => new Player(`Bot ${i + 1}`, browser));

		const results = await Promise.all(
			players.map((p) =>
				p.run(setId).catch(
					(err): JoinResult => ({
						name: p.name,
						status: 'blocked',
						reason: err instanceof Error ? err.message : String(err)
					})
				)
			)
		);

		console.log('\n─── Results ───');
		for (const r of results) {
			if (r.status === 'joined') {
				console.log(`  ✓ ${r.name} → ${r.teamName} (${r.team})`);
			} else if (r.status === 'selectable-skipped') {
				console.log(`  ⤼ ${r.name} → skipped (selectable set)`);
			} else {
				console.log(`  ✗ ${r.name} → blocked: ${r.reason}`);
			}
		}

		const joined = results.filter((r) => r.status === 'joined').length;
		console.log(`\n${joined}/${count} bot(s) joined a team.`);
	} finally {
		await browser.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
