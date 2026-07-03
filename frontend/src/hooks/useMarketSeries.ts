import useSWR from 'swr';
import { api } from '@/lib/api';

export function useMarketSeries<T = unknown>(seriesId: string) {
  return useSWR<T>(
    `/api/market/${seriesId}`,
    async () => (await api.get<{ series: string; data: T }>(`/api/market/${seriesId}`)).data,
    { refreshInterval: 5 * 60 * 1000 }
  );
}
