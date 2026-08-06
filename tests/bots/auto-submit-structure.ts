// STRUCTURAL guard-position check for /api/auto-submit.
//
// ── This is not a behaviour test ─────────────────────────────────────────────
//
// Everything else in verify-timer-autosubmit.ts fires the real endpoint and
// looks at what moved in the database. This file does something categorically
// different: it READS the handler's source as text and asserts a property of its
// SHAPE. It proves nothing about what the server does at runtime — the
// behavioural half of that claim is sectionTwo()'s "flip happened with section 1
// idle". What it adds is a regression barrier against RE-INTRODUCING the
// historical bug, which the behavioural test cannot cover on this database:
//
//   if (!challenges?.length) return;   ← the old first line of the handler
//
// That early return meant a set with no per-challenge timers to settle never
// reached the game-set flip and sat in 'playing' forever. Reproducing it
// behaviourally would require the challenges query to come back EMPTY, and that
// query is database-wide — 17 rows carry timer_seconds > 0, and emptying it
// would mean deleting production challenge rows. So the guarantee is bought
// structurally instead.
//
// ── Why it is anchored on structure, not line numbers ────────────────────────
//
// A check pinned to ":189" would break the moment someone adds a comment. This
// one blanks comments and string CONTENTS (preserving offsets so reported line
// numbers stay true), then works on brace structure and identifier positions.
// Whitespace changes, re-indentation, added comments and reworded strings all
// leave the verdict untouched; only a real move of the flip logic, or a real
// early return in front of it, flips it to red.
//
// The source file is opened READ-ONLY. The falsification cases below mutate a
// STRING IN MEMORY, never the file.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const AUTO_SUBMIT_PATH = 'src/routes/api/auto-submit/+server.ts';

export function readAutoSubmitSource(): string {
	return readFileSync(resolve(process.cwd(), AUTO_SUBMIT_PATH), 'utf8');
}

/**
 * Blank out comments and string contents, character-for-character, so every
 * offset in the result still points at the same place in the original. Quotes,
 * braces and identifiers survive; anything a human wrote inside a comment or a
 * string literal becomes spaces and can no longer be mistaken for code.
 */
export function blankNonCode(src: string): string {
	const out = src.split('');
	let i = 0;
	const n = src.length;
	const blank = (from: number, to: number) => {
		for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
	};
	while (i < n) {
		const c = src[i];
		const next = src[i + 1];
		if (c === '/' && next === '/') {
			let j = i + 2;
			while (j < n && src[j] !== '\n') j++;
			blank(i, j);
			i = j;
		} else if (c === '/' && next === '*') {
			let j = i + 2;
			while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
			blank(i, Math.min(j + 2, n));
			i = j + 2;
		} else if (c === "'" || c === '"') {
			let j = i + 1;
			while (j < n && src[j] !== c) {
				if (src[j] === '\\') j++;
				j++;
			}
			blank(i + 1, j); // keep the quotes, blank the contents
			i = j + 1;
		} else if (c === '`') {
			// Template literal: blank through to the closing backtick, tracking
			// ${...} nesting so an interpolated brace cannot end it early.
			let j = i + 1;
			let depth = 0;
			while (j < n) {
				if (src[j] === '\\') {
					j += 2;
					continue;
				}
				if (src[j] === '$' && src[j + 1] === '{') {
					depth++;
					j += 2;
					continue;
				}
				if (src[j] === '}' && depth > 0) {
					depth--;
					j++;
					continue;
				}
				if (src[j] === '`' && depth === 0) break;
				j++;
			}
			blank(i + 1, j);
			i = j + 1;
		} else {
			i++;
		}
	}
	return out.join('');
}

const lineOf = (src: string, offset: number) => src.slice(0, offset).split('\n').length;

/** Offset of the `{` that opens the POST handler's body. */
function handlerBodyStart(code: string): number {
	const m = /export\s+const\s+POST\s*:\s*RequestHandler\s*=/.exec(code);
	if (!m) return -1;
	const arrow = code.indexOf('=>', m.index);
	if (arrow === -1) return -1;
	const brace = code.indexOf('{', arrow);
	return brace;
}

/**
 * Every `return` that returns from the HANDLER, as opposed to from a nested
 * callback. The distinction is what makes this check meaningful: `return false`
 * inside the `.filter((a) => {…})` predicate is not an early exit, while a
 * `return` inside an `if (…) { … }` block very much is. So the walk tracks which
 * braces open a FUNCTION body (preceded by `=>`) and ignores `return`s nested
 * inside one; if/for/try blocks add depth but not insulation.
 */
function handlerReturnOffsets(code: string, bodyStart: number): number[] {
	const returns: number[] = [];
	const stack: boolean[] = []; // true = this brace opened a function body
	let i = bodyStart + 1;
	while (i < code.length) {
		const c = code[i];
		if (c === '{') {
			const before = code.slice(Math.max(0, i - 40), i).trimEnd();
			stack.push(before.endsWith('=>') || /\bfunction\s*\w*\s*\([^)]*\)$/.test(before));
			i++;
			continue;
		}
		if (c === '}') {
			if (stack.length === 0) break; // closed the handler body
			stack.pop();
			i++;
			continue;
		}
		if (
			code.startsWith('return', i) &&
			!/[\w$]/.test(code[i - 1] ?? '') &&
			!/[\w$]/.test(code[i + 6] ?? '')
		) {
			if (!stack.some(Boolean)) returns.push(i);
			i += 6;
			continue;
		}
		i++;
	}
	return returns;
}

/** [openBrace, closeBrace] of every `if (… challenges …) { … }` block. */
function challengesGuardRanges(code: string): [number, number][] {
	const ranges: [number, number][] = [];
	const re = /\bif\s*\(\s*!?\s*challenges\b/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(code))) {
		const open = code.indexOf('{', m.index);
		if (open === -1) continue;
		// Only treat it as a block guard if the `{` really follows the condition.
		const between = code.slice(m.index, open);
		if (between.includes(';')) continue;
		let depth = 0;
		let j = open;
		for (; j < code.length; j++) {
			if (code[j] === '{') depth++;
			else if (code[j] === '}') {
				depth--;
				if (depth === 0) break;
			}
		}
		ranges.push([open, j]);
	}
	return ranges;
}

/**
 * Where section 2 begins. Anchored on identifiers that survive comment/string
 * blanking, so none of them can be matched inside prose: the `activeSets`
 * binding, the `resolveBattlesForRecap` call, and the `play_state:` object key
 * of the flip itself. The earliest hit wins; needing all three would make the
 * check brittle, needing none would make it vacuous.
 *
 * The search starts at the HANDLER BODY, never at the top of the file. Two of
 * these identifiers also appear in the import block — anchoring there put the
 * "section 2" marker on line 6, ahead of every return and every guard, and the
 * whole check passed vacuously. The falsification cases below are what caught
 * that, which is precisely why they run on every invocation.
 */
function sectionTwoAnchor(code: string, fromOffset: number): { offset: number; matched: string[] } {
	const candidates = ['activeSets', 'resolveBattlesForRecap', 'play_state:'];
	const from = Math.max(0, fromOffset);
	const hits = candidates
		.map((c) => ({ c, at: code.indexOf(c, from) }))
		.filter((h) => h.at !== -1)
		.sort((a, b) => a.at - b.at);
	return { offset: hits.length ? hits[0].at : -1, matched: hits.map((h) => h.c) };
}

export type StructureVerdict = {
	ok: boolean;
	reasons: string[];
	detail: {
		anchorLine: number | null;
		anchorsMatched: string[];
		handlerReturnLines: number[];
		guardLines: [number, number][];
	};
};

/**
 * The verdict. Two independent properties, both of which the historical bug
 * violated:
 *
 *   1. No return can execute before section 2 — every handler-level `return`
 *      sits AFTER the flip logic.
 *   2. Section 2 is not nested inside a `challenges` guard block.
 */
export function checkGuardPosition(rawSource: string): StructureVerdict {
	const code = blankNonCode(rawSource);
	const reasons: string[] = [];

	const bodyStart = handlerBodyStart(code);
	const anchor = sectionTwoAnchor(code, bodyStart);
	const returns = bodyStart === -1 ? [] : handlerReturnOffsets(code, bodyStart);
	const guards = challengesGuardRanges(code);

	if (bodyStart === -1) reasons.push('could not locate the POST handler body');
	if (anchor.offset === -1) {
		reasons.push(
			'could not locate section 2 (no activeSets / resolveBattlesForRecap / play_state:)'
		);
	}

	if (bodyStart !== -1 && anchor.offset !== -1) {
		const early = returns.filter((r) => r < anchor.offset);
		if (early.length) {
			reasons.push(
				`handler returns before section 2 at line(s) ${early.map((o) => lineOf(rawSource, o)).join(', ')} ` +
					`— an early return can skip the game-set flip (the historical bug)`
			);
		}
		if (!returns.length) {
			reasons.push('no handler-level return found at all — the walk is not seeing the handler');
		}
		const enclosing = guards.filter(([o, c]) => anchor.offset > o && anchor.offset < c);
		if (enclosing.length) {
			reasons.push(
				`section 2 is nested inside a challenges guard opening at line ` +
					`${lineOf(rawSource, enclosing[0][0])} — it would not run when that guard is false`
			);
		}
	}

	return {
		ok: reasons.length === 0,
		reasons,
		detail: {
			anchorLine: anchor.offset === -1 ? null : lineOf(rawSource, anchor.offset),
			anchorsMatched: anchor.matched,
			handlerReturnLines: returns.map((o) => lineOf(rawSource, o)),
			guardLines: guards.map(
				([o, c]) => [lineOf(rawSource, o), lineOf(rawSource, c)] as [number, number]
			)
		}
	};
}

/**
 * Falsification, run on every invocation rather than described in a comment.
 * Two in-memory mutations of the real source, each re-introducing one of the two
 * failure modes; both MUST come back red, or the checker is not actually
 * testing anything. The file on disk is never written.
 */
export function falsifyGuardPosition(rawSource: string): { name: string; ok: boolean }[] {
	const code = blankNonCode(rawSource);
	const out: { name: string; ok: boolean }[] = [];

	// (a) the historical bug verbatim: an early return in front of section 2.
	const anchorAt = sectionTwoAnchor(code, handlerBodyStart(code)).offset;
	const lineStart = rawSource.lastIndexOf('\n', anchorAt) + 1;
	const mutatedA =
		rawSource.slice(0, lineStart) +
		'\tif (!challenges?.length) return json({ created });\n' +
		rawSource.slice(lineStart);
	out.push({
		name: 'early return before section 2 is caught',
		ok: !checkGuardPosition(mutatedA).ok
	});

	// (b) section 2 swallowed by the challenges guard: plant the anchor inside
	// the guard block so the earliest hit falls within it.
	const guards = challengesGuardRanges(code);
	if (guards.length) {
		const [open] = guards[0];
		const mutatedB =
			rawSource.slice(0, open + 1) + '\n\t\tconst activeSets = null;\n' + rawSource.slice(open + 1);
		out.push({
			name: 'section 2 nested inside the challenges guard is caught',
			ok: !checkGuardPosition(mutatedB).ok
		});
	} else {
		out.push({ name: 'section 2 nested inside the challenges guard is caught', ok: false });
	}

	return out;
}

/**
 * The other half of falsification: changes that must NOT move the verdict. A
 * check that goes red on a re-indent or on prose is worse than no check, because
 * it trains whoever hits it to stop reading the output. Both cases below plant
 * the bug's exact text somewhere harmless and require the answer to stay green.
 */
export function robustnessGuardPosition(rawSource: string): { name: string; ok: boolean }[] {
	// A comment quoting the bug verbatim — blanking is what keeps this inert.
	const withComment = rawSource.replace(
		'const db = createAdminClient();',
		'// historical bug, quoted: if (!challenges?.length) return;\n\tconst db = createAdminClient();'
	);
	// Re-indentation and blank lines: pure formatting churn.
	const reformatted = rawSource.replace(/\n/g, '\n\n').replace(/\t/g, '    ');

	return [
		{ name: 'a comment quoting the bug stays green', ok: checkGuardPosition(withComment).ok },
		{
			name: 'reformatting (blank lines, spaces for tabs) stays green',
			ok: checkGuardPosition(reformatted).ok
		}
	];
}
