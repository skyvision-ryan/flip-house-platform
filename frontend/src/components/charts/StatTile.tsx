import { ReactNode } from 'react';
import { DISPLAY_STACK } from '../../theme';
import HelpText from '../HelpText';
import { FONT, TEXT, TEXT_2, TEXT_BAD, TEXT_GOOD } from './palette';

interface Props {
  label: ReactNode;
  value: string;
  /** 一行副文本（来源、构成、口径） */
  sub?: ReactNode;
  /** 可隐藏的公式或使用说明；实际来源、风险与数量仍放 sub。 */
  help?: ReactNode;
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
export default function StatTile({ label, value, sub, help, delta, size = 'l', tone, extra }: Props) {
  const color = tone === 'good' ? TEXT_GOOD : tone === 'bad' ? TEXT_BAD : TEXT;
  return (
    <div style={{ fontFamily: FONT, minWidth: 0 }}>
      <div style={{ fontSize: 13, color: TEXT_2, lineHeight: '20px', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: DISPLAY_STACK, fontSize: size === 'l' ? 32 : 22, lineHeight: 1.1, fontWeight: 600, color, letterSpacing: '-0.01em' }}>{value}</span>
        {delta && (
          <span style={{ fontSize: 13, fontWeight: 700, color: delta.good == null ? TEXT_2 : delta.good ? TEXT_GOOD : TEXT_BAD }}>
            {delta.good == null ? '' : delta.good ? '▲ ' : '▼ '}{delta.text}
          </span>
        )}
      </div>
      {sub && <div style={{ fontSize: 13, color: TEXT_2, lineHeight: '20px', marginTop: 8 }}>{sub}</div>}
      {help && <HelpText inline>{help}</HelpText>}
      {extra && <div style={{ marginTop: 8 }}>{extra}</div>}
    </div>
  );
}
