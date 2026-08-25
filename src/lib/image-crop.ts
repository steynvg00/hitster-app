/**
 * Client-side vierkante center-crop, uitgevoerd VÓÓR de upload.
 *
 * Waarom aan de client: een telefoonfoto is 3–8 MB en 4:3 of 3:4. De teamfoto
 * wordt overal als RONDE avatar getoond (lobby-bubble) en als vullend blok op
 * het podium; een vierkante bron is voor beide de juiste basis — rond croppen
 * is dan puur `border-radius` + `object-fit: cover`, zonder dat er van links en
 * rechts iets wegvalt dat de fotograaf wél in beeld had.
 *
 * Bijvangst: het canvas hercodeert naar JPEG, dus HEIC van een iPhone komt als
 * JPEG binnen en de uploadgrootte zakt naar ~100–300 kB.
 *
 * Faalt de decode (oud toestel, exotisch formaat), dan gaat het ORIGINELE
 * bestand door — een niet-vierkante foto is beter dan geen foto.
 */

/** Zijde van de uitvoer in pixels. Genoeg voor het podium op een 1080p-beamer. */
export const SQUARE_SIZE = 1080;

/** JPEG-kwaliteit van de uitvoer. */
const JPEG_QUALITY = 0.85;

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Center-cropt `file` naar een vierkant en levert een nieuw JPEG-`File`.
 * Schaalt nooit OP: een bron kleiner dan `size` houdt zijn eigen zijde.
 */
export async function cropToSquareJpeg(
	file: File,
	size: number = SQUARE_SIZE,
	quality: number = JPEG_QUALITY
): Promise<File> {
	try {
		// imageOrientation: EXIF-rotatie van telefoonfoto's meenemen, anders ligt
		// een staande foto op zijn kant in het canvas.
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
		const side = Math.min(bitmap.width, bitmap.height);
		const sx = Math.round((bitmap.width - side) / 2);
		const sy = Math.round((bitmap.height - side) / 2);
		const out = Math.min(size, side);

		const canvas = document.createElement('canvas');
		canvas.width = out;
		canvas.height = out;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			bitmap.close();
			return file;
		}
		ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
		bitmap.close();

		const blob = await toBlob(canvas, quality);
		if (!blob) return file;

		const base = file.name.replace(/\.[^./\\]+$/, '') || 'teamfoto';
		return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
	} catch {
		return file;
	}
}
