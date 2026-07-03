import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, BASE, setAccessToken } from '@/lib/api';
import type { Role } from '@/types/roles';

interface AuthUser {
  name: string;
  role: Role;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount, attempt a silent refresh using the httpOnly refresh cookie
  // from a prior session - without this, every page reload would force a
  // fresh login even though a valid 7-day refresh token already exists.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setAccessToken(data.access_token);
          // /refresh only returns {access_token, role}, not name - reuse
          // the /users/me profile endpoint for that.
          const profile = await api.get<{ name: string }>('/api/users/me');
          setUser({ name: profile.name, role: data.role });
        }
      } catch {
        // No valid refresh cookie - just means "not logged in", not an error.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    const data = await api.post<{ access_token: string; role: Role; name: string }>('/api/auth/login', {
      email,
      password,
    });
    setAccessToken(data.access_token);
    setUser({ name: data.name, role: data.role });
  }

  async function logout() {
    await api.post('/api/auth/logout', {}).catch(() => {});
    setAccessToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
