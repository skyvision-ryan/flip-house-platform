import { useCallback, useEffect, useState } from 'react';
import Box from '@cloudscape-design/components/box';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import { Project, api } from '../api/client';
import LeadGroups from '../components/LeadGroups';
import ReviewTag from '../components/ReviewTag';
import { useMeta } from '../lib/meta';
import { isLead } from '../lib/leads';
import { useRole } from '../lib/role';

/**
 * 线索页（KAN-50）：把停在「① 预买房」的房子单独列出来，按子阶段分组。
 *
 * 数据用的还是 `api.projects()`——**不传 `?stage=lead`**。那个参数在后端是
 * 先按裸列 `stage` 过滤、再走 `project_out`（`routers/projects.py:30-31`），
 * 而裸列是惰性同步的派生缓存，会漏行也会返回已经不是线索的项目。
 * 判据统一走 `lib/leads.ts` 的 `isLead()`，和项目列表那边排除线索用的是同一个函数。
 */
export default function Leads() {
  const meta = useMeta();
  const role = useRole();
  const [projects, setProjects] = useState<Project[] | null>(null);

  const load = useCallback(async () => { setProjects((await api.projects()).filter(isLead)); }, []);
  useEffect(() => { setProjects(null); load().catch(() => setProjects([])); }, [load, role.actor]);

  /** 改完子阶段后按服务器返回的那条替换本地状态；已经不是线索的直接移出。 */
  const onPatched = useCallback((updated: Project) => {
    setProjects((prev) => (prev ?? []).flatMap((p) => (p.id !== updated.id ? [p] : isLead(updated) ? [updated] : [])));
  }, []);

  const count = projects?.length ?? 0;

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          counter={projects === null ? undefined : `(${count})`}
          description="还没确认 Open escrow 的房子都在这里，按跟进档位分组。确认之后它会移到「项目」。"
        >
          <ReviewTag id="A" />线索
        </Header>
      }
    >
      <LeadGroups projects={projects} meta={meta} canEdit={role.can('edit_project')} onPatched={onPatched} />
      <Box margin={{ top: 'm' }} variant="small" color="text-body-secondary">
        挂牌价与自动估值是参考数据，当前来自演示数据源，不代表可成交价格；「待办参考」按清单顺序取，
        显示的是负责角色不是具体的人。
      </Box>
    </ContentLayout>
  );
}
