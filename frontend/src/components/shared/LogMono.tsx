import type { ReactNode } from 'react';

export interface LogLine {
  time?: string;
  content: ReactNode;
}

export default function LogMono({ lines }: { lines: LogLine[] }) {
  return (
    <div className="font-mono text-[11px] text-text-secondary leading-[1.9] bg-surface-1 rounded-default p-[10px_12px]">
      {lines.map((line, i) => (
        <div key={i}>
          {line.time && <span className="text-text-muted">[{line.time}]</span>} {line.content}
        </div>
      ))}
    </div>
  );
}
