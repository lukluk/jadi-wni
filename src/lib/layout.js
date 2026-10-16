/**
 * Papan 14 x 8 petak (landscape): 40 petak = 2 * (14 + 8) - 4. Pojok ada di indeks 0, 13, 20, 33.
 * 0 = pojok kanan-bawah, berjalan berlawanan arah jarum jam.
 * Di HP portrait papan ditranspose menjadi 8 x 14 (pojok tetap pojok).
 */
export const GRID_COLS = 14;
export const GRID_ROWS = 8;
export const CORNERS = [0, 13, 20, 33];

/** @param {number} i @param {boolean} [landscape] */
export function tilePos(i, landscape = true) {
	let row;
	let col;
	let side;
	if (i <= 13) [row, col, side] = [GRID_ROWS - 1, GRID_COLS - 1 - i, 'b'];
	else if (i <= 20) [row, col, side] = [GRID_ROWS - 1 - (i - 13), 0, 'l'];
	else if (i <= 33) [row, col, side] = [0, i - 20, 't'];
	else [row, col, side] = [i - 33, GRID_COLS - 1, 'r'];
	if (landscape) return { row, col, side };
	// transpose: (row, col) -> (col, row); sisi ikut bertukar b->r, l->t, t->l, r->b
	return { row: col, col: row, side: { b: 'r', l: 't', t: 'l', r: 'b' }[side] };
}

export const isCorner = (i) => CORNERS.includes(i);

/**
 * Ukuran papan. Semua sel persegi sama besar. Koordinat isotropik: lebar papan = 100, tinggi = H.
 * @param {boolean} landscape
 */
export function makeLayout(landscape) {
	const cols = landscape ? GRID_COLS : GRID_ROWS;
	const rows = landscape ? GRID_ROWS : GRID_COLS;
	const c = 100 / cols;
	const X = Array.from({ length: cols + 1 }, (_, k) => k * c);
	const Y = Array.from({ length: rows + 1 }, (_, k) => k * c);
	return { landscape, cols, rows, X, Y, H: rows * c, ratio: cols / rows };
}

/** kotak sel (col,row) dalam satuan layout */
export function cellRect(L, col, row) {
	const x0 = L.X[col];
	const x1 = L.X[col + 1];
	const y0 = L.Y[row];
	const y1 = L.Y[row + 1];
	return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
