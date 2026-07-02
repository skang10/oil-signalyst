import { ROLES, ROLE_LABELS } from '@/types/roles';
import { useRole } from '@/context/RoleContext';
import { cn } from '@/lib/utils';

export default function RolePill() {
  const { role, setRole } = useRole();

  return (
    <div className="flex bg-surface-1 border border-border rounded-[20px] p-[3px] gap-[2px]">
      {ROLES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => setRole(r)}
          className={cn(
            'px-[11px] py-[3px] text-[11px] rounded-[16px] border-none bg-none cursor-pointer whitespace-nowrap transition-all',
            role === r
              ? 'bg-accent-fill text-on-accent font-medium'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          {ROLE_LABELS[r]}
        </button>
      ))}
    </div>
  );
}
