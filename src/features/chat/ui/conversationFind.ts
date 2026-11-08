/**
 * Szukanie w otwartej rozmowie — czysta logika, bez DOM.
 *
 * użytkownik do tej pory scrollowal, zeby dojsc do fragmentu, ktory chce zacytowac
 * (15.09). Cytat z kotwica rozwiazal WSKAZANIE, to rozwiazuje ZNAJDOWANIE:
 * znajdz → zaznacz → cytuj.
 */

/** Najkrotsza fraza, ktora ma sens szukac — krotsza trafia w polowe rozmowy. */
export const MIN_FRAZA = 2;

/** Sufit trafien: przy wiekszej liczbie podswietlanie kosztuje wiecej, niz daje. */
export const MAX_TRAFIEN = 500;

/**
 * Pozycje frazy w tekscie, bez rozrozniania wielkosci liter.
 * Zwraca poczatki, nie zakresy — dlugosc jest zawsze taka sama jak frazy.
 */
export function znajdzPozycje(tekst: string, fraza: string): number[] {
  const szukana = fraza.trim().toLocaleLowerCase();
  if (szukana.length < MIN_FRAZA) return [];
  // Obie strony na male litery: `toLocaleLowerCase` nie zmienia dlugosci
  // dla polskich znakow, wiec pozycje zostaja zgodne z oryginalem.
  const wTekscie = tekst.toLocaleLowerCase();
  const out: number[] = [];
  let i = wTekscie.indexOf(szukana);
  while (i !== -1 && out.length < MAX_TRAFIEN) {
    out.push(i);
    i = wTekscie.indexOf(szukana, i + szukana.length);
  }
  return out;
}

/** Numer nastepnego trafienia, z zawijaniem. `-1`, gdy nie ma czego przewijac. */
export function nastepneTrafienie(aktualne: number, ile: number, wstecz = false): number {
  if (ile <= 0) return -1;
  if (aktualne < 0) return wstecz ? ile - 1 : 0;
  return wstecz ? (aktualne - 1 + ile) % ile : (aktualne + 1) % ile;
}

/**
 * Docelowy `scrollTop` kontenera, zeby trafienie wyladowalo na jego srodku.
 * Liczone z prostokatow, wiec dziala tak samo dla trafienia w srodku akapitu
 * jak i na jego koncu — `scrollIntoView` potomka potrafi nie ruszyc kontenera.
 */
export function pozycjaPrzewiniecia(
  scrollTop: number,
  kontenerGora: number,
  kontenerWysokosc: number,
  trafienieGora: number,
  trafienieWysokosc: number,
): number {
  const odGory = trafienieGora - kontenerGora + trafienieWysokosc / 2;
  return Math.max(0, scrollTop + odGory - kontenerWysokosc / 2);
}

/** Licznik do paska: „3 / 17", „brak trafień", pusto przy zbyt krotkiej frazie. */
export function licznik(aktualne: number, ile: number, fraza: string): string {
  if (fraza.trim().length < MIN_FRAZA) return '';
  if (ile <= 0) return 'brak trafień';
  const numer = aktualne < 0 ? 1 : aktualne + 1;
  const sufit = ile >= MAX_TRAFIEN ? '+' : '';
  return `${numer} / ${ile}${sufit}`;
}
