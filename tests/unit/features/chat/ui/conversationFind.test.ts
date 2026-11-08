import {
  licznik,
  MAX_TRAFIEN,
  MIN_FRAZA,
  nastepneTrafienie,
  pozycjaPrzewiniecia,
  znajdzPozycje,
} from '@/features/chat/ui/conversationFind';

describe('znajdzPozycje', () => {
  it('znajduje wszystkie wystapienia', () => {
    expect(znajdzPozycje('ala ma kota, kot ma ale', 'ma')).toEqual([4, 17]);
  });

  it('nie rozroznia wielkosci liter, takze polskich', () => {
    expect(znajdzPozycje('Łódź i ŁÓDŹ', 'łódź')).toEqual([0, 7]);
  });

  it('nie przesuwa pozycji przy polskich znakach', () => {
    const tekst = 'źdźbło trawy';
    const [i] = znajdzPozycje(tekst, 'TRAWY');
    expect(tekst.slice(i)).toBe('trawy');
  });

  it('nie zwraca nakladajacych sie trafien', () => {
    expect(znajdzPozycje('aaaa', 'aa')).toEqual([0, 2]);
  });

  it('milczy przy zbyt krotkiej frazie — inaczej trafia w pol rozmowy', () => {
    expect(znajdzPozycje('ala ma kota', 'a')).toEqual([]);
    expect(znajdzPozycje('ala ma kota', ' ')).toEqual([]);
    expect(znajdzPozycje('ala ma kota', '')).toEqual([]);
    expect(MIN_FRAZA).toBe(2);
  });

  it('ma sufit trafien', () => {
    const wynik = znajdzPozycje('ab'.repeat(MAX_TRAFIEN + 50), 'ab');
    expect(wynik).toHaveLength(MAX_TRAFIEN);
  });
});

describe('nastepneTrafienie', () => {
  it('idzie w przod z zawijaniem', () => {
    expect(nastepneTrafienie(0, 3)).toBe(1);
    expect(nastepneTrafienie(2, 3)).toBe(0);
  });

  it('idzie wstecz z zawijaniem', () => {
    expect(nastepneTrafienie(1, 3, true)).toBe(0);
    expect(nastepneTrafienie(0, 3, true)).toBe(2);
  });

  it('z niczego wybiera pierwsze albo ostatnie', () => {
    expect(nastepneTrafienie(-1, 3)).toBe(0);
    expect(nastepneTrafienie(-1, 3, true)).toBe(2);
  });

  it('bez trafien nie ma dokad skakac', () => {
    expect(nastepneTrafienie(-1, 0)).toBe(-1);
    expect(nastepneTrafienie(2, 0, true)).toBe(-1);
  });
});

describe('licznik', () => {
  it('pokazuje numer i sume', () => {
    expect(licznik(2, 17, 'fraza')).toBe('3 / 17');
  });

  it('przed pierwszym skokiem liczy od jedynki', () => {
    expect(licznik(-1, 4, 'fraza')).toBe('1 / 4');
  });

  it('mowi wprost, gdy nic nie ma', () => {
    expect(licznik(-1, 0, 'fraza')).toBe('brak trafień');
  });

  it('milczy przy zbyt krotkiej frazie', () => {
    expect(licznik(-1, 0, 'a')).toBe('');
    expect(licznik(-1, 0, '')).toBe('');
  });

  it('zaznacza, ze sufit zostal osiagniety', () => {
    expect(licznik(0, MAX_TRAFIEN, 'fraza')).toBe(`1 / ${MAX_TRAFIEN}+`);
  });
});

describe('pozycjaPrzewiniecia', () => {
  // Kontener: 400 px wysokosci, ekranowo od y=100, przewiniety o 1000.
  const kontener = [1000, 100, 400] as const;

  it('stawia trafienie na srodku kontenera', () => {
    // Trafienie 20 px wysokie, ekranowo na y=300 → 200 px od gory kontenera.
    expect(pozycjaPrzewiniecia(...kontener, 300, 20)).toBe(1010);
  });

  it('przewija w gore, gdy trafienie jest nad widokiem', () => {
    expect(pozycjaPrzewiniecia(...kontener, -500, 20)).toBe(210);
  });

  it('przewija w dol, gdy trafienie jest pod widokiem', () => {
    expect(pozycjaPrzewiniecia(...kontener, 900, 20)).toBe(1610);
  });

  it('nie schodzi ponizej zera na poczatku rozmowy', () => {
    expect(pozycjaPrzewiniecia(0, 100, 400, 110, 20)).toBe(0);
  });
});
