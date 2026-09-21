import Box from '@cloudscape-design/components/box';
import StatusIndicator, { StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import { useMeta } from '../lib/meta';

/**
 * 只有**资源状态**配指示器：在轨 / 脱轨 / 有风险 / 已完成，看到就得有人做点什么。
 *
 * 线索热度（热 / 温）不在这里（KAN-63）。它是分类信息不是状态——一条温线索不需要谁去
 * 处理，给它一个蓝色 info 圆点只会和真状态抢注意力。后端 STATUSES 不动，只是界面不再上色。
 */
const KIND: Record<string, StatusIndicatorProps.Type> = {
  on_track: 'success', off_track: 'error', at_risk: 'warning', done: 'success',
};

export default function StatusBadge({ status }: { status: string; reason?: string }) {
  const meta = useMeta();
  const label = meta?.statuses.find((s) => s.value === status)?.label ?? status;
  const kind = KIND[status];
  if (!kind) return <Box variant="span" color="text-body-secondary" fontSize="body-s">{label}</Box>;
  return <StatusIndicator type={kind}>{label}</StatusIndicator>;
}
