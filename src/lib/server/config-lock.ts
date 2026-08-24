// Serialises read-modify-write cycles that share one row.
//
// ── The race this closes ────────────────────────────────────────────────────
// Every powerup_config write is SELECT → merge in JS → UPDATE. The merge is
// safe (mergeConfigPatch lands the change on the STORED object, so no key is
// dropped), but "stored" means "stored when we read it". Two requests that
// overlap both read the same config, each merges its own change onto that same
// snapshot, and the second UPDATE overwrites the first — the merge helper never
// saw the first change, so it could not preserve it.
//
// That is not theoretical for this console: every settings control saves on
// blur, so tabbing across four fields fires four requests as fast as the browser
// can open sockets. The lost one is silent — the host sees the value they typed,
// because the page reloads from the write that won.
//
// ── Why a lock and not a database CAS ───────────────────────────────────────
// The honest fix is to do the merge in Postgres (jsonb_set in an RPC, or an
// UPDATE guarded by the value that was read). Both need a migration, and this
// step is explicitly not taking one. A compare-and-swap through PostgREST is
// worse than it looks: the filter value would be the whole jsonb document, whose
// braces, commas and quotes are exactly the characters PostgREST filter syntax
// reserves — a mis-encoded filter matches zero rows, which turns a lost update
// into a silently skipped one.
//
// So: serialise per row, in-process. The window closes because the second
// request does not READ until the first has WRITTEN.
//
// ── What this does NOT claim ────────────────────────────────────────────────
// It is a process-local lock. Two Node instances behind a load balancer would
// each hold their own, and the race returns between them. That bound is
// acceptable here and worth stating plainly: the traffic is one host on one
// console, and the alternative costs a migration. If this app ever runs more
// than one instance, this needs to become a database-side merge — the call
// sites will not have to change, only this function.

/**
 * The tail of each key's queue. A key is present only while work is queued or
 * running on it, so an idle process holds nothing.
 */
const tails = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after every earlier call for the same `key` has settled.
 *
 * Rejections do not break the chain: the next waiter runs either way (both
 * handlers of `.then` are `run`), so one failed save cannot wedge every later
 * save for that row. The caller still sees its own rejection — `next` is what is
 * returned, and only the copy stored in the map is silenced.
 */
export function withRowLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const previous = tails.get(key) ?? Promise.resolve();
	const run = () => fn();
	const next = previous.then(run, run);

	// Stored separately from what the caller gets: this copy must never reject,
	// or the queue's own tail becomes an unhandled rejection.
	const guard = next.then(
		() => {},
		() => {}
	);
	tails.set(key, guard);

	// Drop the key once this is the last queued work, so the map cannot grow one
	// entry per set forever. Only the tail clears it — a later waiter will have
	// replaced `guard` by then, and that check is what keeps this from deleting
	// a queue that is still in use.
	void guard.then(() => {
		if (tails.get(key) === guard) tails.delete(key);
	});

	return next;
}
