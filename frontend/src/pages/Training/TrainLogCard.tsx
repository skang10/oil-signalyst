import Card from '@/components/shared/Card';
import LogMono from '@/components/shared/LogMono';

export default function TrainLogCard({ lines }: { lines: string[] }) {
  return (
    <Card className="mb-3">
      <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-3">Training Log</div>
      {lines.length === 0 ? (
        <div className="font-mono text-[11px] text-text-muted bg-surface-1 rounded-default p-[10px_12px]">
          // Awaiting training command...
        </div>
      ) : (
        <LogMono lines={lines.map((l) => ({ content: l }))} />
      )}
    </Card>
  );
}
