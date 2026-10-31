import type { BirdsData } from './types';

/** Loads the bundled, same-origin data file. The app never talks to external APIs. */
export async function loadBirds(): Promise<BirdsData> {
  const res = await fetch(new URL('data/birds.json', document.baseURI));
  if (!res.ok) throw new Error(`birds.json: HTTP ${res.status}`);
  return res.json();
}

export const asset = (path: string) => new URL(path, document.baseURI).href;
