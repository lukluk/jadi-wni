/** posisi petak 0..39 di grid 11x11. 0 = pojok kanan bawah, berjalan berlawanan arah jarum jam. */
export function tilePos(i) {
	if (i <= 10) return { row: 10, col: 10 - i, side: 'b' };
	if (i <= 20) return { row: 10 - (i - 10), col: 0, side: 'l' };
	if (i <= 30) return { row: 0, col: i - 20, side: 't' };
	return { row: i - 30, col: 10, side: 'r' };
}

export const isCorner = (i) => i % 10 === 0;
