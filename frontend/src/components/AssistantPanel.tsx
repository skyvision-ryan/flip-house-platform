import Avatar from '@cloudscape-design/chat-components/avatar';
import ChatBubble from '@cloudscape-design/chat-components/chat-bubble';
import SupportPromptGroup from '@cloudscape-design/chat-components/support-prompt-group';
import Box from '@cloudscape-design/components/box';
import Drawer from '@cloudscape-design/components/drawer';
import Link from '@cloudscape-design/components/link';
import PromptInput from '@cloudscape-design/components/prompt-input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Project } from '../api/client';
import { answer, headline, Insight, loadInsights } from '../lib/insights';

type Msg = { id: number; from: 'ai' | 'me'; text: string; items?: Insight[] };

const AI = <Avatar color="gen-ai" iconName="gen-ai" ariaLabel="助手" tooltipText="助手" />;
const ME = <Avatar initials="我" ariaLabel="我" />;

function InsightList({ items, onGo }: { items: Insight[]; onGo: (href: string) => void }) {
  if (!items.length) return null;
  return (
    <SpaceBetween size="xs">
      {items.map((i, k) => (
        <SpaceBetween key={k} direction="horizontal" size="xs" alignItems="start">
          <StatusIndicator type={i.level}>{i.tag}</StatusIndicator>
          <span>
            {i.text} <Link href={i.href} onFollow={(e) => { e.preventDefault(); onGo(i.href); }}>去看看</Link>
          </span>
        </SpaceBetween>
      ))}
    </SpaceBetween>
  );
}

export default function AssistantPanel() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.projects().then(async (ps) => {
      setProjects(ps);
      const ins = await loadInsights(ps);
      setInsights(ins);
      const h = headline(ins, ps);
      const urgent = ins.filter((i) => i.level !== 'info');
      setMsgs([
        { id: 1, from: 'ai', text: `${h.title}。${h.subtitle}` },
        ...(urgent.length ? [{ id: 2, from: 'ai' as const, text: '先看这几条：', items: urgent }] : []),
      ]);
    }).finally(() => setLoading(false));
  }, []);

  const ask = (q: string) => {
    if (!q.trim()) return;
    const a = answer(q, insights);
    setMsgs((m) => [
      ...m,
      { id: Date.now(), from: 'me', text: q },
      a ? { id: Date.now() + 1, from: 'ai', text: a.text, items: a.items }
        : { id: Date.now() + 1, from: 'ai', text: '这个问题现在还答不了。目前我只会按规则读项目数据（超支、落后、缺数据、缺文件、待定价）。接入大模型后可以直接问。' },
    ]);
    setInput('');
  };

  const go = (href: string) => navigate(href);

  return (
    <Drawer header={<span>助手</span>}>
      <SpaceBetween size="l">
        <Box variant="small" color="text-body-secondary">当前为规则助手，根据已有项目数据提供提示。</Box>

        {loading && <ChatBubble type="incoming" avatar={AI} ariaLabel="助手正在读取" showLoadingBar>正在读取所有项目…</ChatBubble>}

        {msgs.map((m) => (
          <ChatBubble key={m.id} type={m.from === 'ai' ? 'incoming' : 'outgoing'} avatar={m.from === 'ai' ? AI : ME} ariaLabel={m.from === 'ai' ? '助手' : '我'}>
            <SpaceBetween size="xs">
              <span>{m.text}</span>
              {m.items && <InsightList items={m.items} onGo={go} />}
            </SpaceBetween>
          </ChatBubble>
        ))}

        {!loading && (
          <div>
          <Box margin={{ bottom: 'xs' }}>建议提问</Box>
          <SupportPromptGroup
            ariaLabel="建议的问题"
            alignment="vertical"
            items={[
              { id: 'over', text: '哪些项目超预算了？' },
              { id: 'data', text: '哪些项目数据不完整？' },
              { id: 'due', text: '最近要完工的是哪套？' },
            ]}
            onItemClick={({ detail }) => {
              const q = { over: '哪些项目超预算了？', data: '哪些项目数据不完整？', due: '最近要完工的是哪套？' }[detail.id] ?? '';
              ask(q);
            }}
          />
          </div>
        )}

        <Box>问一句</Box>
        <PromptInput
          value={input}
          onChange={({ detail }) => setInput(detail.value)}
          onAction={() => ask(input)}
          placeholder="问一句，比如“哪个项目落后了”"
          actionButtonIconName="send"
          actionButtonAriaLabel="发送"
          disableActionButton={!input.trim()}
        />
        <Box variant="small" color="text-body-secondary">共 {projects.length} 个项目，{insights.length} 条洞察。</Box>
      </SpaceBetween>
    </Drawer>
  );
}
