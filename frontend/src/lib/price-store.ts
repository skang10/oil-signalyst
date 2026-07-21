import { create } from 'zustand';

interface PriceState {
  price: number | null;
  changePct: number | null;
  // Live Brent spot and the Brent-WTI spread (brent - wti), pushed alongside
  // WTI by /ws/price. Null when the Brent quote is briefly unavailable.
  brent: number | null;
  spread: number | null;
  // Client time of the last tick, so the UI can show how fresh the quote is.
  // The ticker pushes ~every 30s, so a growing value flags a dropped socket.
  updatedAt: number | null;
  setPrice: (
    price: number,
    changePct: number | null,
    brent?: number | null,
    spread?: number | null
  ) => void;
}

export const usePriceStore = create<PriceState>((set) => ({
  price: null,
  changePct: null,
  brent: null,
  spread: null,
  updatedAt: null,
  setPrice: (price, changePct, brent = null, spread = null) =>
    set({ price, changePct, brent, spread, updatedAt: Date.now() }),
}));
