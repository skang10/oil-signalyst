import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('xuemei@local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch {
      setError('Invalid email or password.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-surface-0">
      <form
        onSubmit={handleSubmit}
        className="w-[340px] bg-surface-2 border border-border rounded-default p-6 flex flex-col gap-4"
      >
        <div>
          <div className="text-[15px] font-medium">OilSignalyst</div>
          <div className="text-[12px] text-text-muted mt-[2px]">Sign in to continue</div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-muted uppercase tracking-[0.5px]">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-surface-1 border border-border-strong rounded-default p-[8px_10px] text-[13px] text-text-primary outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-muted uppercase tracking-[0.5px]">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-surface-1 border border-border-strong rounded-default p-[8px_10px] text-[13px] text-text-primary outline-none"
          />
        </label>

        {error && <div className="text-[12px] text-danger">{error}</div>}

        <button
          type="submit"
          disabled={isPending}
          className="mt-1 px-[14px] py-[8px] text-[13px] rounded-default cursor-pointer bg-accent-fill text-on-accent border-none disabled:opacity-50"
        >
          {isPending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
