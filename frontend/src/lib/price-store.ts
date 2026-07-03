import { create } from 'zustand';

interface PriceState {
  price: number | null;
  changePct: number | null;
  setPrice: (price: number, changePct: number | null) => void;
}

export const usePriceStore = create<PriceState>((set) => ({
  price: null,
  changePct: null,
  setPrice: (price, changePct) => set({ price, changePct }),
}));
