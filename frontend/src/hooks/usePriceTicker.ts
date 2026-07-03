import { useEffect } from 'react';
import { usePriceStore } from '@/lib/price-store';
import { BASE } from '@/lib/api';

const WS_URL = BASE.replace(/^http/, 'ws') + '/ws/price';

export function usePriceTicker() {
  const setPrice = usePriceStore((s) => s.setPrice);

  useEffect(() => {
    let ws: WebSocket;
    let retryMs = 1000;
    let cancelled = false;

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => {
        const { price, change_pct } = JSON.parse(e.data);
        setPrice(price, change_pct ?? null);
        retryMs = 1000; // reset back-off on a successful message
      };
      ws.onclose = () => {
        if (cancelled) return;
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      };
    }
    connect();

    return () => {
      cancelled = true;
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
