import type { UserBrief } from '../api/client';
export type CorePersona = 'jessie' | 'kody';
export type SpecialistPersona = 'procurement' | 'zoey' | 'sabrina';
export type DesignPersona = CorePersona | SpecialistPersona | 'david' | 'admin';
export type DesignId = 'A' | 'B' | 'C';
export type ServiceKind = '水' | '电' | '燃气' | '保险';
export interface RoleDesign {
  id: DesignId; source: string; title: string; question: string; borrowed: string; adapted: string;
  gain: string; cost: string; url: string; sourceLabel: string;
  layout: string;
}
export interface DesignHouse {
  id: string; name: string; stage: string; focus: string; next: string; date: string;
  water: string; electric: string; gas: string; insurance: string; expiry: string; company: string;
}
export interface DesignTask {
  id: string; house: string; title: string; category: string; person: string; status: string; due: string;
  detail: string; source: string; service: ServiceKind | null;
}
export interface DesignPreview { person: UserBrief; designs: RoleDesign[]; houses: DesignHouse[]; tasks: DesignTask[] }
export function visibleDesignTasks(tasks: DesignTask[], houses: DesignHouse[], persona: CorePersona, query: string, category = '全部', house = 'all') {
  const q = query.trim().toLowerCase();
  return tasks.filter(t => (persona === 'jessie' || t.person === 'Kody') && (category === '全部' || t.category === category || t.status === category)
    && (house === 'all' || t.house === house) && `${t.title} ${t.person} ${houses.find(h => h.id === t.house)?.name}`.toLowerCase().includes(q));
}
export type DesignPreference = { choice: DesignId; note: string };
export function parseDesignPreferences(raw: string | null): Partial<Record<DesignPersona, DesignPreference>> {
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object') return {};
    const result: Partial<Record<DesignPersona, DesignPreference>> = {};
    for (const persona of ['jessie', 'kody', 'procurement', 'zoey', 'sabrina', 'david', 'admin'] as const) {
      const item = value[persona];
      if (item && ['A', 'B', 'C'].includes(item.choice) && typeof item.note === 'string') result[persona] = { choice: item.choice, note: item.note.slice(0, 1000) };
    }
    return result;
  } catch { return {}; }
}

export interface DesignRecord {
  id: string; house: string; title: string; status: string; category: string; owner: string;
  detail: string; source: string; fields: { label: string; value: string }[];
  documents: { id: string; name: string; detail: string }[]; amount?: number; planned?: number;
}
export interface SpecialistPreview {
  person: UserBrief; designs: RoleDesign[]; houses: { id: string; name: string; stage: string }[];
  records: DesignRecord[]; role_title: string; role_description: string; default_design: DesignId;
}
