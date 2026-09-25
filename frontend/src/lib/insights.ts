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
        text: top ? `${p.name} 已超预算 ${over}，主要来自“${top.category}”（超 ${money(top.variance)}）。` : `${p.name}：${p.status_reason}`,
        headline: top ? `超预算 ${over}` : p.status_reason, detail: top ? `主要来自“${top.category}”，这一类超了 ${money(top.variance)}` : undefined });
    }
    if (p.status === 'off_track') {
      out.push({ ...base, level: 'warning', tag: '落后', href: `/projects/${p.id}`, text: `${p.name}：${p.status_reason}。`, headline: p.status_reason });
    }
    if (p.stage === 'active' && p.status !== 'off_track') {
      const d = daysUntil(p.construction_end);
      if (d !== null && d >= 0 && d <= 14) {
        out.push({ ...base, level: 'info', tag: '临近完工', href: `/projects/${p.id}`, text: `${p.name} 距计划完工还有 ${d} 天，可以准备挂牌了。`, headline: `距计划完工还有 ${d} 天`, detail: '可以准备挂牌了' });
      }
    }
    if (p.stage === 'active' && ai >= 0) {
      const hasPermit = fileLists[ai].some((f) => f.doc_type === 'permit');
      if (!hasPermit) {
        const waited = p.purchase_date ? -(daysUntil(p.purchase_date) ?? 0) : null;
        out.push({ ...base, level: 'warning', tag: '等 permit', href: `/projects/${p.id}?tab=files`,
          text: `${p.name} 还没登记政府核发的 permit 文件${waited != null && waited > 30 ? `，close 到现在已经 ${waited} 天` : ''}。拿到文件才能开工。`,
          headline: waited != null && waited > 30 ? `close 到现在 ${waited} 天，还没有 permit 文件` : '还没登记 permit 文件', detail: '拿到政府核发的文件才能开工' });
      }
      fileLists[ai].forEach((f) => {
        const d = daysUntil(f.expires_at);
        if (d !== null && d <= 30) {
          const when = d < 0 ? `已过期 ${-d} 天` : d === 0 ? '今天到期' : `${d} 天后到期`;
          out.push({ ...base, level: d < 0 ? 'error' : 'warning', tag: '保险到期', href: `/projects/${p.id}?tab=files`,
            text: `${p.name} 的${f.doc_type === 'insurance' ? '房屋保险' : '文件'}“${f.filename}”${when}，K 要续。`,
            headline: `${f.doc_type === 'insurance' ? '房屋保险' : '文件'}${when}`, detail: `${f.filename} · K 要续` });
        }
      });
      const failed = inspLists[ai].filter((i) => i.result === 'failed');
      failed.forEach((i) => {
        out.push({ ...base, level: 'warning', tag: '检查没过', href: `/projects/${p.id}`, text: `${p.name} 的“${i.name}”没过${i.fixer ? `，${i.fixer} 整改中` : '，还没写谁整改'}${i.note ? `：${i.note}` : ''}。`,
          headline: `“${i.name}”没过`, detail: `${i.fixer ? `${i.fixer} 整改中` : '还没写谁整改'}${i.note ? ` · ${i.note}` : ''}` });
      });
      const stuck = utilLists[ai].filter((u) => u.status === 'pending' && u.blocker);
      stuck.forEach((u) => {
        const kind = u.kind === 'water' ? '水' : u.kind === 'electric' ? '电' : '瓦斯';
        out.push({ ...base, level: 'info', tag: '水电卡住', href: `/projects/${p.id}?tab=data&section=utilities`, text: `${p.name} 的${kind}还没开通，卡在：${u.blocker}。`, headline: `${kind}还没开通`, detail: `卡在：${u.blocker}` });
      });
    }
    if (p.stage === 'lead' && p.analysis_count === 0) {
      out.push({ ...base, level: 'info', tag: '未算账', href: `/projects/${p.id}?tab=analysis`, text: `${p.name} 还没算过账，先跑一遍交易分析再谈价。`, headline: '还没算过账', detail: '先跑一遍交易分析再谈价' });
    }
    if (p.stage === 'lead' && p.lead_heat === 'hot_lead' && p.target_arv == null) {
      out.push({ ...base, level: 'info', tag: '待定价', href: `/projects/${p.id}`, text: `${p.name} 是热线索，但还没定目标售价，出价前需要补上。`, headline: '热线索还没定目标售价', detail: '出价前需要补上' });
    }
    if (p.stage === 'active' && p.next_up.length > 0) {
      const n = p.next_up[0];
      out.push({ ...base, level: 'info', tag: '轮到', href: `/projects/${p.id}`, text: `${p.name} 在${p.current_stage?.label ?? ''}，轮到 ${n.owners.join('、')}：${n.title}。`, headline: `轮到 ${n.owners.join('、')}：${n.title}`, detail: p.current_stage?.label ?? undefined });
    }
    if (p.missing_fields.length > 0) {
      out.push({ ...base, level: 'info', tag: '缺数据', href: `/projects/${p.id}?tab=data`, text: `${p.name} 还缺 ${p.missing_fields.length} 项关键数据：${p.missing_fields.slice(0, 3).join('、')}${p.missing_fields.length > 3 ? '…' : ''}。`, headline: `缺 ${p.missing_fields.length} 项关键数据`, detail: `${p.missing_fields.slice(0, 3).join('、')}${p.missing_fields.length > 3 ? '…' : ''}` });
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
  const title = urgent.size > 0 ? `今天有 ${urgent.size} 套房子需要你关注` : projects.length ? '所有房子都在正轨上' : '从一个地址开始';
  const subtitle = projects.length
    ? `${active} 套在建，${leads} 套未购入，${done} 套收尾。${urgent.size > 0 ? '优先处理下面标红和标黄的。' : '有空可以补一补缺失的数据。'}`
    : '输入地址，系统会自动补全房产数据并标注来源。';
  return { title, subtitle };
}

/** AI 抽屉里的规则问答：按关键词匹配洞察。匹配不到返回 null。 */
export function answer(question: string, insights: Insight[]): { text: string; items: Insight[] } | null {
  const q = question.trim();
  if (!q) return null;
  const pick = (tags: InsightTag[], empty: string, lead: string) => {
    const items = insights.filter((i) => tags.includes(i.tag));
    return { text: items.length ? lead.replace('{n}', String(items.length)) : empty, items };
  };
  if (/超支|预算|花超|overbudget/i.test(q)) return pick(['超支'], '目前没有项目超预算。', '有 {n} 个项目超预算：');
  if (/落后|延期|逾期|完工|工期/i.test(q)) return pick(['落后', '临近完工'], '没有落后或临近完工的项目。', '与工期有关的有 {n} 条：');
  if (/缺|不完整|数据|字段/i.test(q)) return pick(['缺数据'], '所有项目的关键数据都齐了。', '有 {n} 个项目数据不完整：');
  if (/permit|许可|开工/i.test(q)) return pick(['等 permit'], '在建项目的 permit 都已登记。', '有 {n} 个项目还在等 permit：');
  if (/保险|到期|续/i.test(q)) return pick(['保险到期'], '没有快到期的保险。', '有 {n} 份保险快到期：');
  if (/检查|inspection|整改|没过/i.test(q)) return pick(['检查没过'], '没有没过的检查。', '有 {n} 次检查没过在整改：');
  if (/水电|瓦斯|gas|开通/i.test(q)) return pick(['水电卡住'], '水电瓦斯都开通了。', '有 {n} 家还没开通：');
  if (/文件|合同/i.test(q)) return pick(['缺文件', '等 permit'], '在建项目的文件都齐了。', '有 {n} 个项目缺文件：');
  if (/线索|售价|出价|定价|算账|分析/i.test(q)) return pick(['待定价', '未算账'], '线索都已算过账并定了目标售价。', '有 {n} 条线索要先算账或定价：');
  if (/轮到|谁做|下一步|该谁/i.test(q)) return pick(['轮到'], '在建的房子暂时没有等着谁做的事。', '有 {n} 套房在等人做事：');
  if (/关注|今天|重要|优先/i.test(q)) {
    const items = insights.filter((i) => i.level !== 'info');
    return { text: items.length ? `今天优先看这 ${items.length} 条：` : '今天没有需要紧急处理的事。', items };
  }
  return null;
}
