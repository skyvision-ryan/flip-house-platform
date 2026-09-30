import { systemText } from '../i18n/core.ts';
import { m as uiText } from '../i18n/core.ts';
import { api, Project } from '../api/client';
import { money } from './format';

export type InsightLevel = 'error' | 'warning' | 'info';
export type InsightTag = '超支' | '落后' | '临近完工' | '缺数据' | '缺文件' | '待定价' | '未算账' | '轮到' | '保险到期' | '等 permit' | '检查没过' | '水电卡住';

export interface Insight {
  level: InsightLevel;
  tag: InsightTag;
  projectId: number;
  projectName: string;
  text: string;       // 整句，给助手用
  headline: string;   // 关键一句（带数字），给工作台“需要关注”用
  detail?: string;    // 补充说明
  href: string;
}

const LEVEL_ORDER: Record<InsightLevel, number> = { error: 0, warning: 1, info: 2 };

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  return Math.round((d.getTime() - Date.now()) / 86400000);
}

/** 由规则从现有数据生成洞察。不是大模型，接入后升级为真实推理。 */
const ROLE_TAGS: Record<string, InsightTag[]> = {
  K: ['保险到期', '水电卡住'],
  Z: ['等 permit', '检查没过'],
  PM: ['检查没过', '落后', '临近完工', '等 permit'],
  L: ['超支', '落后', '临近完工', '等 permit', '检查没过', '待定价', '未算账', '轮到', '缺数据'],
};

export async function loadInsights(projects: Project[], actor?: string): Promise<Insight[]> {
  const all = await loadInsightsAll(projects);
  const keep = actor ? ROLE_TAGS[actor] : undefined;
  return keep ? all.filter((i) => keep.includes(i.tag)) : all;
}

async function loadInsightsAll(projects: Project[]): Promise<Insight[]> {
  const out: Insight[] = [];
  const active = projects.filter((p) => p.stage === 'active');

  const [summaries, fileLists, inspLists, utilLists] = await Promise.all([
    Promise.all(active.map((p) => api.budgetSummary(p.id).catch(() => null))),
    Promise.all(active.map((p) => api.files(p.id).catch(() => []))),
    Promise.all(active.map((p) => api.inspections(p.id).catch(() => []))),
    Promise.all(active.map((p) => api.utilities(p.id).catch(() => []))),
  ]);

  projects.forEach((p) => {
    const base = { projectId: p.id, projectName: p.name };
    const ai = active.indexOf(p);

    if (p.status === 'at_risk') {
      const s = ai >= 0 ? summaries[ai] : null;
      const top = s?.categories.filter((c) => c.variance > 0).sort((a, b) => b.variance - a.variance)[0];
      const over = money((p.budget_spent ?? 0) - (p.budget_planned ?? 0));
      out.push({ ...base, level: 'error', tag: '超支', href: `/projects/${p.id}?tab=budget`,
        get text() { return top ? uiText("sentences.is.over.budget.mainly.in.over", { value1: (p.name), value2: (over), value3: (top.category), value4: (money(top.variance)) }) : `${p.name}：${p.status_reason}`; },
        get headline() { return top ? uiText("sentences.over.budget", { value1: (over) }) : p.status_reason; }, get detail() { return top ? uiText("sentences.mainly.in.which.is.over.budget", { value1: (top.category), value2: (money(top.variance)) }) : undefined; } });
    }
    if (p.status === 'off_track') {
      out.push({ ...base, level: 'warning', tag: '落后', href: `/projects/${p.id}`, get text() { return `${p.name}：${p.status_reason}。`; }, get headline() { return p.status_reason; } });
    }
    if (p.stage === 'active' && p.status !== 'off_track') {
      const d = daysUntil(p.construction_end);
      if (d !== null && d >= 0 && d <= 14) {
        out.push({ ...base, level: 'info', tag: '临近完工', href: `/projects/${p.id}`, get text() { return uiText("sentences.is.days.from.its.planned.finish.prepare.for.listing", { value1: (p.name), value2: (d) }); }, get headline() { return uiText("sentences.days.to.planned.finish", { value1: (d) }); }, get detail() { return uiText("insights.ready.to.prepare.the.listing"); } });
      }
    }
    if (p.stage === 'active' && ai >= 0) {
      const hasPermit = fileLists[ai].some((f) => f.doc_type === 'permit');
      if (!hasPermit) {
        const waited = p.purchase_date ? -(daysUntil(p.purchase_date) ?? 0) : null;
        out.push({ ...base, level: 'warning', tag: '等 permit', href: `/projects/${p.id}?tab=files`,
          get text() { return uiText("sentences.has.no.issued.government.permit.file.the.issued.document.is", { value1: (p.name), value2: (waited != null && waited > 30 ? uiText("sentences.days.since.closing", { value1: (waited) }) : '') }); },
          get headline() { return waited != null && waited > 30 ? uiText("sentences.days.since.closing.no.permit.file", { value1: (waited) }) : uiText("insights.no.issued.permit.file.recorded.yet"); }, get detail() { return uiText("insights.an.issued.government.permit.is.required.before.construction.can"); } });
      }
      fileLists[ai].forEach((f) => {
        const d = daysUntil(f.expires_at);
        if (d !== null && d <= 30) {
          const when = d < 0 ? uiText("sentences.expired.days.ago", { value1: (-d) }) : d === 0 ? '今天到期' : uiText("sentences.expires.in.days", { value1: (d) });
          out.push({ ...base, level: d < 0 ? 'error' : 'warning', tag: '保险到期', href: `/projects/${p.id}?tab=files`,
            get text() { return uiText("sentences.k.needs.to.renew.it", { value1: (p.name), value2: (f.doc_type === 'insurance' ? uiText("insights.property.insurance") : uiText("updatesList.files")), value3: (f.filename), value4: (when) }); },
            get headline() { return `${f.doc_type === 'insurance' ? uiText("insights.property.insurance") : uiText("updatesList.files")}${when}`; }, get detail() { return uiText("sentences.k.needs.to.renew", { value1: (f.filename) }); } });
        }
      });
      const failed = inspLists[ai].filter((i) => i.result === 'failed');
      failed.forEach((i) => {
        out.push({ ...base, level: 'warning', tag: '检查没过', href: `/projects/${p.id}`, get text() { return uiText("sentences.failed", { value1: (p.name), value2: (i.name), value3: (i.fixer ? uiText("sentences.is.handling.corrections", { value1: (i.fixer) }) : uiText("insights.correction.assignee.not.entered")), value4: (i.note ? `：${i.note}` : '') }); },
          get headline() { return uiText("sentences.failed.2", { value1: (i.name) }); }, get detail() { return `${i.fixer ? uiText("sentences.handling.corrections", { value1: (i.fixer) }) : uiText("insights.correction.assignee.not.entered.2")}${i.note ? ` · ${i.note}` : ''}`; } });
      });
      const stuck = utilLists[ai].filter((u) => u.status === 'pending' && u.blocker);
      stuck.forEach((u) => {
        const kind = u.kind === 'water' ? '水' : u.kind === 'electric' ? '电' : '瓦斯';
        out.push({ ...base, level: 'info', tag: '水电卡住', href: `/projects/${p.id}?tab=data&section=utilities`, get text() { return uiText("sentences.is.not.active.issue", { value1: (p.name), value2: (kind), value3: (u.blocker) }); }, get headline() { return uiText("sentences.is.not.active", { value1: (kind) }); }, get detail() { return uiText("sentences.issue", { value1: (u.blocker) }); } });
      });
    }
    if (p.stage === 'lead' && p.analysis_count === 0) {
      out.push({ ...base, level: 'info', tag: '未算账', href: `/projects/${p.id}?tab=analysis`, get text() { return uiText("sentences.has.no.analysis.yet.run.a.deal.analysis.before.discussing", { value1: (p.name) }); }, get headline() { return uiText("insights.no.deal.analysis.yet"); }, get detail() { return uiText("insights.run.a.deal.analysis.before.discussing.price"); } });
    }
    if (p.stage === 'lead' && p.lead_heat === 'hot_lead' && p.target_arv == null) {
      out.push({ ...base, level: 'info', tag: '待定价', href: `/projects/${p.id}`, get text() { return uiText("sentences.is.a.hot.lead.without.a.target.sale.price.add", { value1: (p.name) }); }, get headline() { return uiText("insights.hot.lead.has.no.target.sale.price"); }, get detail() { return uiText("insights.add.it.before.making.an.offer"); } });
    }
    if (p.stage === 'active' && p.next_up.length > 0) {
      const n = p.next_up[0];
      out.push({ ...base, level: 'info', tag: '轮到', href: `/projects/${p.id}`, get text() { return uiText("sentences.is.at.next.action.by", { value1: (p.name), value2: (p.current_stage?.label ?? ''), value3: (n.owners.join('、')), value4: (n.title) }); }, get headline() { return uiText("sentences.action.by", { value1: (n.owners.join('、')), value2: (n.title) }); }, get detail() { return p.current_stage?.label ?? undefined; } });
    }
    if (p.missing_fields.length > 0) {
      out.push({ ...base, level: 'info', tag: '缺数据', href: `/projects/${p.id}?tab=data`, get text() { return uiText("sentences.is.missing.key.fields", { value1: (p.name), value2: (p.missing_fields.length), value3: (p.missing_fields.slice(0, 3).join('、')), value4: (p.missing_fields.length > 3 ? '…' : '') }); }, get headline() { return uiText("sentences.key.fields.missing", { value1: (p.missing_fields.length) }); }, get detail() { return `${p.missing_fields.slice(0, 3).join('、')}${p.missing_fields.length > 3 ? '…' : ''}`; } });
    }
  });

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** 首页头部的一句话。 */
export function headline(insights: Insight[], projects: Project[]): { title: string; subtitle: string } {
  const urgent = new Set(insights.filter((i) => i.level !== 'info').map((i) => i.projectId));
  // KAN-75 块 2：按分组位置数，不读旧 stage 列；没有 group_position（老接口）时回落旧列
  const gp = (p: Project) => p.group_position;
  const leads = projects.filter((p) => (gp(p) ? gp(p)!.sub_key === 'pre' : p.stage === 'lead')).length;
  const active = projects.filter((p) => (gp(p) ? gp(p)!.sub_key !== 'pre' && gp(p)!.group_key !== 'closeout' && !gp(p)!.complete : p.stage === 'active')).length;
  const done = projects.filter((p) => p.stage === 'portfolio').length;
  const title = urgent.size > 0 ? uiText("sentences.properties.need.your.attention.today", { value1: (urgent.size) }) : projects.length ? '所有房子都在正轨上' : '从一个地址开始';
  const subtitle = projects.length
    ? uiText("sentences.active.unpurchased.in.closeout", { value1: (active), value2: (leads), value3: (done), value4: (urgent.size > 0 ? uiText("insights.prioritize.the.red.and.yellow.items.below") : uiText("insights.fill.in.missing.data.when.time.allows")) })
    : '输入地址，系统会自动补全房产数据并标注来源。';
  return { title, subtitle };
}

/** AI 抽屉里的规则问答：按关键词匹配洞察。匹配不到返回 null。 */
export function answer(question: string, insights: Insight[]): { text: string; items: Insight[] } | null {
  const q = question.trim();
  if (!q) return null;
  const pick = (tags: InsightTag[], empty: string, lead: string) => {
    const items = insights.filter((i) => tags.includes(i.tag));
    return { get text() { return items.length ? systemText(lead).replace('{n}', String(items.length)) : systemText(empty); }, items };
  };
  if (/超支|预算|花超|over.?budget|budget/i.test(q)) return pick(['超支'], '目前没有项目超预算。', '有 {n} 个项目超预算：');
  if (/落后|延期|逾期|完工|工期|schedule|finish|due|delay/i.test(q)) return pick(['落后', '临近完工'], '没有落后或临近完工的项目。', '与工期有关的有 {n} 条：');
  if (/缺|不完整|数据|字段|incomplete|missing data|fields/i.test(q)) return pick(['缺数据'], '所有项目的关键数据都齐了。', '有 {n} 个项目数据不完整：');
  if (/permit|许可|开工/i.test(q)) return pick(['等 permit'], '在建项目的 permit 都已登记。', '有 {n} 个项目还在等 permit：');
  if (/保险|到期|续|insurance|expir/i.test(q)) return pick(['保险到期'], '没有快到期的保险。', '有 {n} 份保险快到期：');
  if (/检查|inspection|整改|没过/i.test(q)) return pick(['检查没过'], '没有没过的检查。', '有 {n} 次检查没过在整改：');
  if (/水电|瓦斯|gas|开通|water|electric|utilit/i.test(q)) return pick(['水电卡住'], '水电瓦斯都开通了。', '有 {n} 家还没开通：');
  if (/文件|合同|files|documents|contract/i.test(q)) return pick(['缺文件', '等 permit'], '在建项目的文件都齐了。', '有 {n} 个项目缺文件：');
  if (/线索|售价|出价|定价|算账|分析|pricing|analysis|leads/i.test(q)) return pick(['待定价', '未算账'], '线索都已算过账并定了目标售价。', '有 {n} 条线索要先算账或定价：');
  if (/轮到|谁做|下一步|该谁|next action|who/i.test(q)) return pick(['轮到'], '在建的房子暂时没有等着谁做的事。', '有 {n} 套房在等人做事：');
  if (/关注|今天|重要|优先|attention|today|priorit/i.test(q)) {
    const items = insights.filter((i) => i.level !== 'info');
    return { get text() { return items.length ? uiText("sentences.prioritize.these.items.today", { value1: (items.length) }) : uiText("insights.no.urgent.actions.today"); }, items };
  }
  return null;
}
