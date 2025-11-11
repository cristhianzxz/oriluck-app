// Orientation metadata for domino sprite images.
export const TILE_IMAGE_ORIENTATION = {
	'0-0': { top: 0, bottom: 0 },
	'1-0': { top: 0, bottom: 1 },
	'1-1': { top: 1, bottom: 1 },
	'1-2': { top: 2, bottom: 1 },
	'1-3': { top: 3, bottom: 1 },
	'1-4': { top: 4, bottom: 1 },
	'1-5': { top: 5, bottom: 1 },
	'1-6': { top: 6, bottom: 1 },
	'2-0': { top: 0, bottom: 2 },
	'2-2': { top: 2, bottom: 2 },
	'2-3': { top: 3, bottom: 2 },
	'2-4': { top: 4, bottom: 2 },
	'2-5': { top: 5, bottom: 2 },
	'2-6': { top: 6, bottom: 2 },
	'3-0': { top: 0, bottom: 3 },
	'3-3': { top: 3, bottom: 3 },
	'3-4': { top: 4, bottom: 3 },
	'3-5': { top: 5, bottom: 3 },
	'3-6': { top: 6, bottom: 3 },
	'4-0': { top: 0, bottom: 4 },
	'4-4': { top: 4, bottom: 4 },
	'4-5': { top: 5, bottom: 4 },
	'4-6': { top: 6, bottom: 4 },
	'5-0': { top: 0, bottom: 5 },
	'5-5': { top: 5, bottom: 5 },
	'5-6': { top: 6, bottom: 5 },
	'6-0': { top: 0, bottom: 6 },
	'6-6': { top: 6, bottom: 6 },
};

export function getImageOrientationForTile(tileKey) {
	const orientation = TILE_IMAGE_ORIENTATION[tileKey];
	if (orientation) {
		return orientation;
	}

	const [first, second] = tileKey.split('-').map((value) => parseInt(value, 10));
	return {
		top: Number.isFinite(second) ? second : 0,
		bottom: Number.isFinite(first) ? first : 0,
	};
}
