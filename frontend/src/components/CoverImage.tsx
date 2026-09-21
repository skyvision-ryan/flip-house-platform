import { useState } from 'react';
import Badge from '@cloudscape-design/components/badge';

const FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><rect width="640" height="400" fill="#E9ECEF"/><path d="M200 230 L320 130 L440 230 Z" fill="#B6BEC9"/><rect x="235" y="230" width="170" height="110" fill="#CBD2DA"/><rect x="300" y="270" width="40" height="70" fill="#8F9BAA"/><rect x="250" y="250" width="30" height="30" fill="#FFFFFF"/><rect x="360" y="250" width="30" height="30" fill="#FFFFFF"/></svg>`);

/**
 * 封面图。**目前一律是中性占位图**，不请求任何外部图床。
 *
 * 原先从 loremflickr 按房产 id 拉一张随机房子照片：它和这套房的地址毫无关系，
 * 看起来比灰占位更像模板，而且每次渲染都要向第三方发请求。
 *
 * 真照片要等项目自己的封面文件（上传与存储不在这一轮范围）。接上之后
 * 只改这个函数：有文件就返回文件 URL，没有仍回落到 FALLBACK。
 */
export function coverUrl(_propertyId: number): string {
  return FALLBACK;
}

interface Props {
  propertyId: number;
  height?: number;
  width?: number | string;
  radius?: number;
  showLabel?: boolean;
  alt?: string;
}

export default function CoverImage({ propertyId, height = 160, width = '100%', radius = 8, showLabel = false, alt = '房产照片' }: Props) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ position: 'relative', width, height, borderRadius: radius, overflow: 'hidden', flexShrink: 0, background: '#E9ECEF' }}>
      <img src={failed ? FALLBACK : coverUrl(propertyId)} alt={alt} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {showLabel && (
        <div style={{ position: 'absolute', left: 8, bottom: 8 }}>
          <Badge color="grey">示例图</Badge>
        </div>
      )}
    </div>
  );
}
