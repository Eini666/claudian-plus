/** „1 linia”, „3 linie”, „25 linii”, „22 linie” — polska odmiana liczebnika. */
export function linesLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = count === 1
    ? 'linia'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? 'linie'
      : 'linii';
  return `${count} ${word}`;
}
