export const COORDINATE_DECIMALS = 3;

export interface Coordinates {
  lat: number;
  lng: number;
}

const FACTOR = 10 ** COORDINATE_DECIMALS;

// Math.round lleva los empates hacia +∞ (-62.5 → -62): redondeando el valor absoluto, los negativos se comportan como los positivos.
function roundCoordinate(value: number): number {
  return (Math.sign(value) * Math.round(Math.abs(value) * FACTOR)) / FACTOR;
}

export function toApproximateCoordinates(lat: number, lng: number): Coordinates {
  return { lat: roundCoordinate(lat), lng: roundCoordinate(lng) };
}
