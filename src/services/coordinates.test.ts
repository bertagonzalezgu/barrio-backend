import { COORDINATE_DECIMALS, toApproximateCoordinates } from './coordinates';

describe('toApproximateCoordinates', () => {
  it('redondea a COORDINATE_DECIMALS decimales', () => {
    expect(COORDINATE_DECIMALS).toBe(3);
    expect(toApproximateCoordinates(41.38512, 2.17368)).toEqual({ lat: 41.385, lng: 2.174 });
  });

  it('redondea los negativos igual que los positivos', () => {
    expect(toApproximateCoordinates(-33.86882, -2.17312)).toEqual({ lat: -33.869, lng: -2.173 });
  });

  it('deja igual un valor que ya está redondeado', () => {
    expect(toApproximateCoordinates(41.385, -2.173)).toEqual({ lat: 41.385, lng: -2.173 });
  });

  it('redondea lat y lng por separado', () => {
    expect(toApproximateCoordinates(41.4004, 41.4006)).toEqual({ lat: 41.4, lng: 41.401 });
  });

  // 0.0625 es exacto en binario, así que el empate es real y no depende de la coma flotante.
  it('en un empate se aleja del cero, también en negativos', () => {
    expect(toApproximateCoordinates(0.0625, -0.0625)).toEqual({ lat: 0.063, lng: -0.063 });
  });
});
