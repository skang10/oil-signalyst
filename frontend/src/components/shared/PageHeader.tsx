export default function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="text-[15px] font-medium">{title}</div>
      {sub && <div className="text-[12px] text-text-muted mt-[2px]">{sub}</div>}
    </div>
  );
}
