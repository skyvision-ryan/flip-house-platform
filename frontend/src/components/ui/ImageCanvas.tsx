import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useEffect, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import './ImageCanvas.css';

export default function ImageCanvas({ src, label }: { src: string; label: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [scale, setScale] = useState(1);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const duration = reduced ? 0 : 160;
  return <SpaceBetween size="s">
    <p className="ui-muted">放大核对细节，拖动查看其他位置。聚焦图片后可用方向键移动、+ / − 缩放；手机可双指缩放。</p>
    {status === 'error' ? <Alert type="error" header="图片未能显示" action={<Button onClick={() => { setStatus('loading'); setAttempt(a => a + 1); }}>重新加载图片</Button>}>请检查连接或访问权限。原文件与业务记录没有改变。</Alert> :
      <TransformWrapper key={attempt} minScale={1} maxScale={6} centerOnInit smooth={!reduced}
        keyboard={{ disabled: false, animationTime: duration }}
        velocityAnimation={{ disabled: true }} doubleClick={{ animationTime: duration }}
        zoomAnimation={{ animationTime: duration }} autoAlignment={{ animationTime: duration }}
        onTransform={(_, state) => setScale(state.scale)}>
        {({ zoomIn, zoomOut, centerView }) => <>
          <SpaceBetween direction="horizontal" size="xs">
            <Button disabled={status !== 'ready' || scale >= 6} onClick={() => zoomIn(0.4, duration)}>放大</Button>
            <Button disabled={status !== 'ready' || scale <= 1} onClick={() => zoomOut(0.4, duration)}>缩小</Button>
            <Button disabled={status !== 'ready'} onClick={() => centerView(1, duration)}>适合窗口</Button>
            <span aria-live="polite">{Math.round(scale * 100)}%</span>
          </SpaceBetween>
          {status === 'loading' && <div role="status"><Spinner /> 正在读取图片…</div>}
          <TransformComponent wrapperClass="ui-image-canvas" contentClass="ui-image-canvas-content"
            wrapperProps={{ tabIndex: 0, role: 'region', 'aria-label': `图片查看区域：${label}` }}>
            <img src={attempt ? `${src}${src.includes('?') ? '&' : '?'}preview_reload=${attempt}` : src} alt={label} draggable={false}
              onLoad={() => { setStatus('ready'); void centerView(1, 0); }} onError={() => setStatus('error')} />
          </TransformComponent>
        </>}
      </TransformWrapper>}
  </SpaceBetween>;
}
