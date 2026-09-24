import type { CSSProperties } from 'react';
import Badge from '@cloudscape-design/components/badge';

type Props = {
  propertyId: number;
  height?: number;
  width?: number | string;
  radius?: number;
  showLabel?: boolean;
  alt?: string;
};

/** 当前没有房屋封面接口。内联 SVG 能继承主题，不使用外部照片或 data URI 色值。 */
export default function PropertyCover({ height = 160, width = '100%', radius = 8, showLabel = false, alt = '房屋照片占位图' }: Props) {
  return <div className="ui-property-cover" style={{
    '--cover-height': `${height}px`,
    '--cover-width': typeof width === 'number' ? `${width}px` : width,
    '--cover-radius': `${radius}px`,
  } as CSSProperties}>
    <svg viewBox="0 0 640 400" role="img" aria-label={alt}>
      <path d="M230 205L320 125L410 205M249 193V289H391V193M299 289V235H341V289" />
    </svg>
    {showLabel && <div className="ui-cover-label"><Badge color="grey">占位图</Badge></div>}
  </div>;
}
