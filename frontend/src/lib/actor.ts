import { createContext, useContext } from 'react';
import type { Me } from '../api/client';

/** 顶栏“我是谁”。登录后由账号决定；演示模式下没登录也能选，管理员登录后也能临时切换。存在本机浏览器里。 */
const KEY = 'actor';

export function getActor(): string {
  try { return localStorage.getItem(KEY) || '负责人'; } catch { return '负责人'; }
}

export function getOverride(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setActor(code: string) {
  try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
}

export function clearActor() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export const ActorContext = createContext<{ actor: string; setActor: (c: string) => void; me: Me | null; demoMode: boolean; logout: () => Promise<void> }>({
  actor: '负责人', setActor: () => {}, me: null, demoMode: true, logout: async () => {},
});
export const useActor = () => useContext(ActorContext);
