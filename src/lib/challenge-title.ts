/**
 * De setnaam uit een challenge-titel halen.
 *
 * Hosts noemen hun challenges in de praktijk "<Setnaam> <Challenge>" (in de
 * database staat bijvoorbeeld "Vrienden Weekend 2026 Hitster" in de set
 * "Vrienden Weekend 2026 🎉"). Op het antwoordformulier is de setnaam ruis:
 * daar hoort alleen de challenge zelf te staan ("HITSTER").
 *
 * Puur een weergavefilter — de titel in de database blijft zoals de host hem
 * schreef. Woord voor woord vergelijken, genormaliseerd (kleine letters, geen
 * leestekens of emoji), zodat de 🎉 in de setnaam de match niet breekt. Geen
 * overlap => de titel komt onveranderd terug.
 */
const norm = (s: string) =>
	s
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');

export function stripSetNameFromTitle(title: string, setName?: string | null): string {
	if (!title || !setName) return title;

	const titleWords = title.trim().split(/\s+/);
	const setWords = setName.trim().split(/\s+/).map(norm).filter(Boolean);

	let i = 0;
	while (i < setWords.length && i < titleWords.length && norm(titleWords[i]) === setWords[i]) i++;
	if (i === 0) return title;

	// Een scheidingsteken tussen setnaam en challenge ("2026 · Hitster") hoort
	// bij de setnaam-prefix en gaat mee weg.
	const rest = titleWords
		.slice(i)
		.join(' ')
		.replace(/^[·•\-–—:|]+\s*/, '')
		.trim();

	// Een titel die niets anders IS dan de setnaam blijft staan: een lege kop is
	// erger dan een dubbele naam.
	return rest || title;
}
