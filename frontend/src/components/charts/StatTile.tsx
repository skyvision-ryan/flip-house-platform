import { ReactNode } from 'react';
import { FONT, TEXT, TEXT_2, TEXT_BAD, TEXT_GOOD } from './palette';
import { DISPLAY_STACK } from '../../theme';

interface Props {
  label: ReactNode;
  value: string;
  /** 一行副文本（来源、构成、口径） */
  sub?: ReactNode;
  /** 涨跌 / 偏差：good 决定颜色，text 自带符号 */
  delta?: { text: string; good: boolean | null };
  size?: 'l' | 'm';
  /** 数值本身的语义颜色（如亏损为红） */
  tone?: 'good' | 'bad';
  /** 右下角附加内容（例如小 Meter） */
  extra?: ReactNode;
}

/**
 * 一个数字就是图：标签 + 大数字（比例字宽，非等宽）+ 副文本。
 *
 * 只有大数字用展示字体（KAN-63）：标签和副文本继续走正文栈 FONT，
 * 这样一屏里字体的切换只发生在真正需要撑层次的地方。
 */
export default function StatTile({ label, value, sub, delta, size = 'l', tone, extra }: Props) {
  const color = tone === 'good' ? TEXT_GOOD : tone === 'bad' ? TEXT_BAD : TEXT;
  return (
    <div style={{ fontFamily: FONT, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: TEXT_2, lineHeight: '16px', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: DISPLAY_STACK, fontSize: size === 'l' ? 28 : 20, lineHeight: 1.1, fontWeight: 400, color, letterSpacing: '-0.01em' }}>{value}</span>
        {delta && (
          <span style={{ fontSize: 12, fontWeight: 700, color: delta.good == null ? TEXT_2 : delta.good ? TEXT_GOOD : TEXT_BAD }}>
            {delta.good == null ? '' : delta.good ? '▲ ' : '▼ '}{delta.text}
          </span>
        )}
      </div>
      {sub && <div style={{ fontSize: 12, color: TEXT_2, lineHeight: '16px', marginTop: 4 }}>{sub}</div>}
      {extra && <div style={{ marginTop: 8 }}>{extra}</div>}
    </div>
  );
}
