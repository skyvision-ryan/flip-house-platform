import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
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

type Msg = { id: number; from: 'ai' | 'me'; text: string; prompt?: string; items?: Insight[] };

const AI = () => <Avatar color="gen-ai" iconName="gen-ai" ariaLabel={uiText("app.assistant")} tooltipText={uiText("app.assistant")} />;
const ME = () => <Avatar initials={uiText("assistantPanel.me")} ariaLabel={uiText("assistantPanel.me")} />;

function InsightList({ items, onGo }: { items: Insight[]; onGo: (href: string) => void }) {
  useLanguage();
  if (!items.length) return null;
  return (
    <SpaceBetween size="xs">
      {items.map((i, k) => (
        <SpaceBetween key={k} direction="horizontal" size="xs" alignItems="start">
          <StatusIndicator type={i.level}>{systemText(i.tag)}</StatusIndicator>
          <span>
            {systemText(i.text)} <Link href={i.href} onFollow={(e) => { e.preventDefault(); onGo(i.href); }}>{uiText("assistantPanel.view")}</Link>
          </span>
        </SpaceBetween>
      ))}
    </SpaceBetween>
  );
}

export default function AssistantPanel() {
  useLanguage();
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
        ...(urgent.length ? [{ id: 2, from: 'ai' as const, text: uiText("assistantPanel.start.with.these"), items: urgent }] : []),
      ]);
    }).finally(() => setLoading(false));
  }, []);

  const ask = (q: string) => {
    if (!q.trim()) return;
    const a = answer(q, insights);
    setMsgs((m) => [
      ...m,
      { id: Date.now(), from: 'me', text: q },
      a ? { id: Date.now() + 1, from: 'ai', text: a.text, prompt: q, items: a.items }
        : { id: Date.now() + 1, from: 'ai', text: uiText("assistantPanel.i.cannot.answer.that.yet.this.assistant.reads.project") },
    ]);
    setInput('');
  };

  const go = (href: string) => navigate(href);

  return (
    <Drawer header={<span>{uiText("app.assistant")}</span>}>
      <SpaceBetween size="l">
        <Box variant="small" color="text-body-secondary">{uiText("assistantPanel.this.rule.based.assistant.provides.guidance.from.existing.project")}</Box>

        {loading && <ChatBubble type="incoming" avatar={<AI />} ariaLabel={uiText("assistantPanel.assistant.is.loading")} showLoadingBar>{uiText("assistantPanel.reading.projects")}</ChatBubble>}

        {msgs.map((m) => (
          <ChatBubble key={m.id} type={m.from === 'ai' ? 'incoming' : 'outgoing'} avatar={m.from === 'ai' ? <AI /> : <ME />} ariaLabel={m.from === 'ai' ? uiText("app.assistant") : uiText("assistantPanel.me")}>
            <SpaceBetween size="xs">
              <span>{m.from !== 'ai' ? m.text : m.id === 1 ? `${systemText(headline(insights, projects).title)}. ${systemText(headline(insights, projects).subtitle)}` : m.prompt ? answer(m.prompt, insights)?.text ?? systemText(m.text) : systemText(m.text)}</span>
              {m.items && <InsightList items={m.items} onGo={go} />}
            </SpaceBetween>
          </ChatBubble>
        ))}

        {!loading && (
          <div>
          <Box margin={{ bottom: 'xs' }}>{uiText("assistantPanel.suggested.questions")}</Box>
          <SupportPromptGroup
            ariaLabel={uiText("assistantPanel.suggested.questions.2")}
            alignment="vertical"
            items={[
              { id: 'over', text: uiText("assistantPanel.which.projects.are.over.budget") },
              { id: 'data', text: uiText("assistantPanel.which.projects.have.incomplete.data") },
              { id: 'due', text: uiText("assistantPanel.which.property.is.due.to.finish.soon") },
            ]}
            onItemClick={({ detail }) => {
              const q = { over: '哪些项目超预算了？', data: '哪些项目数据不完整？', due: '最近要完工的是哪套？' }[detail.id] ?? '';
              ask(systemText(q));
            }}
          />
          </div>
        )}

        <Box>{uiText("assistantPanel.ask.a.question")}</Box>
        <PromptInput
          value={input}
          onChange={({ detail }) => setInput(detail.value)}
          onAction={() => ask(input)}
          placeholder={uiText("assistantPanel.ask.a.question.such.as.which.project.is.behind")}
          actionButtonIconName="send"
          actionButtonAriaLabel={uiText("assistantPanel.send")}
          disableActionButton={!input.trim()}
        />
        <Box variant="small" color="text-body-secondary">{uiText("assistantPanel.total")} {projects.length} {uiText("assistantPanel.projects")}{insights.length} {uiText("assistantPanel.insights")}</Box>
      </SpaceBetween>
    </Drawer>
  );
}
