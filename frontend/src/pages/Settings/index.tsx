import { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { DEFAULT_CONFIG } from '@/context/RoleContext';
import { ROLE_LABELS, ROLES } from '@/types/roles';
import PageHeader from '@/components/shared/PageHeader';
import Card from '@/components/shared/Card';

export default function SettingsPage() {
  const { userConfig, setUserConfig } = useRole();
  const [draft, setDraft] = useState(userConfig);

  function save() {
    setUserConfig(draft);
  }

  function reset() {
    setDraft(DEFAULT_CONFIG);
    setUserConfig(DEFAULT_CONFIG);
  }

  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Settings" sub="Role · Instrument · Alert Threshold" />

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Identity</div>
        <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
          <span className="text-text-secondary">Name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="bg-surface-1 border border-border-strong rounded-default p-[5px_10px] text-[12px] w-[160px]"
          />
        </div>
        <div className="flex justify-between items-center py-[7px] text-[12px]">
          <span className="text-text-secondary">Role</span>
          <select
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as typeof draft.role })}
            className="bg-surface-1 border border-border-strong rounded-default p-[5px_10px] text-[12px] w-[160px]"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Alert Threshold</div>
        <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
          <span className="text-text-secondary">PSI Alert Threshold</span>
          <input
            type="number"
            step={0.05}
            value={draft.alerts.psi_threshold}
            onChange={(e) => setDraft({ ...draft, alerts: { ...draft.alerts, psi_threshold: Number(e.target.value) } })}
            className="bg-surface-1 border border-border-strong rounded-default p-[5px_10px] text-[12px] w-20"
          />
        </div>
        <div className="flex justify-between items-center py-[7px] text-[12px]">
          <span className="text-text-secondary">EIA Surprise Alerts</span>
          <div className="flex items-center gap-[6px]">
            <input
              type="number"
              step={0.5}
              value={draft.alerts.eia_surprise_threshold}
              onChange={(e) => setDraft({ ...draft, alerts: { ...draft.alerts, eia_surprise_threshold: Number(e.target.value) } })}
              className="bg-surface-1 border border-border-strong rounded-default p-[5px_10px] text-[12px] w-20"
            />
            <span className="text-[11px] text-text-muted">MB</span>
          </div>
        </div>
      </Card>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-accent-fill text-on-accent border border-accent-fill"
        >
          Save Settings
        </button>
        <button type="button" onClick={reset} className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-surface-2 border border-border-strong">
          Reset Defaults
        </button>
      </div>
    </div>
  );
}
