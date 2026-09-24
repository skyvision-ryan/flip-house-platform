import AppLayout from '@cloudscape-design/components/app-layout';
import Autosuggest from '@cloudscape-design/components/autosuggest';
import Button from '@cloudscape-design/components/button';
import Flashbar, { FlashbarProps } from '@cloudscape-design/components/flashbar';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import Spinner from '@cloudscape-design/components/spinner';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AddressCandidate, api, AUTH_EVENT, Me } from './api/client';
import AssistantPanel from './components/AssistantPanel';
import DisplaySettings from './components/DisplaySettings';
import { HelpContext } from './components/HelpText';
import { ReviewContext } from './components/ReviewTag';
import { ActorContext, clearActor, getActor, getOverride, setActor as persistActor } from './lib/actor';
import { readHelpPref, writeHelpPref } from './lib/displayPref';
import { FlashContext } from './lib/flash';
import { useMeta } from './lib/meta';
import { readReviewPref, writeReviewPref } from './lib/reviewPref';
import { Tier, TIER_FALLBACK } from './lib/role';
import AddProject from './pages/AddProject';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import MyTodo from './pages/MyTodo';
import ProjectPage from './pages/project/ProjectPage';
import TaskHistoryPage from './pages/project/TaskHistoryPage';
import Users from './pages/Users';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(true);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [flashes, setFlashes] = useState<FlashbarProps.MessageDefinition[]>([]);
  const [q, setQ] = useState('');
  const [cands, setCands] = useState<AddressCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const meta = useMeta();

  // ---- 会话：登录了用账号的角色；演示模式没登录用顶栏“我是”；管理员在演示模式下可临时切换 ----
  const [me, setMe] = useState<Me | null>(null);
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  const [override, setOverride] = useState<string | null>(getOverride);
  useEffect(() => {
    (async () => {
      try { setDemoMode((await api.authMode()).demo_mode); } catch { setDemoMode(true); }
      try { setMe(await api.me()); } catch { setMe(null); }
    })();
  }, []);
  useEffect(() => {
    const onExpired = () => setMe(null);
    window.addEventListener(AUTH_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EVENT, onExpired);
  }, []);
  const canSwitch = me ? (!!demoMode && me.is_admin) : true;
  useEffect(() => { if (me && !canSwitch && override) { clearActor(); setOverride(null); } }, [me, canSwitch, override]);
  const actor = me ? (canSwitch && override ? override : me.role_code) : (override ?? getActor());
  const setActor = (c: string) => { persistActor(c); setOverride(c); };
  const resetActor = () => { clearActor(); setOverride(null); };
  const onLogin = useCallback((m: Me) => { clearActor(); setOverride(null); setMe(m); navigate('/'); }, [navigate]);
  const logout = async () => { try { await api.logout(); } catch { /* ignore */ } clearActor(); setOverride(null); setMe(null); navigate('/'); };
  const [reviewOn, setReviewOn] = useState<boolean>(() => readReviewPref(localStorage));
  const toggleReview = (v: boolean) => { setReviewOn(v); writeReviewPref(localStorage, v); };
  const [helpOn, setHelpOn] = useState(() => readHelpPref(localStorage));
  const [displayOpen, setDisplayOpen] = useState(false);
  const toggleHelp = (v: boolean) => { setHelpOn(v); writeHelpPref(localStorage, v); };

  const pushFlash = (msg: Omit<FlashbarProps.MessageDefinition, 'id' | 'onDismiss' | 'dismissible'>) => {
    const id = String(Date.now());
    setFlashes((prev) => [...prev, { ...msg, id, dismissible: true, onDismiss: () => setFlashes((p) => p.filter((f) => f.id !== id)) }]);
    setTimeout(() => setFlashes((p) => p.filter((f) => f.id !== id)), 6000);
  };

  const roleOf = (code: string) => meta?.roles.find((r) => r.code === code);
  const tier: Tier = (roleOf(actor)?.tier as Tier) ?? 'blue';
  const tierInfo = meta?.tiers?.[tier] ?? TIER_FALLBACK[tier];
  const canDo = (action: string) => { const ok = meta?.permissions?.[action] ?? ['purple', 'blue']; return ok.includes(tier) || ok.includes(actor); };
  const tierOrder: Tier[] = ['purple', 'blue', 'teal', 'grey'];
  const roleGroups = tierOrder.map((t) => ({
    id: `g-${t}`, text: (meta?.tiers?.[t] ?? TIER_FALLBACK[t]).label,
    items: (meta?.roles ?? []).filter((r) => r.tier === t).map((r) => ({ id: r.code, text: r.label, description: r.duties || undefined })),
  })).filter((g) => g.items.length);
  const activeHref = location.pathname.startsWith('/todo') ? '/todo' : location.pathname === '/projects/new' ? '/projects/new' : location.pathname.startsWith('/projects') ? '/projects' : location.pathname.startsWith('/users') ? '/users' : '/';

  if (demoMode === null) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size="large" /></div>;
  }
  if (!me && (!demoMode || location.pathname === '/login')) {
    return <ReviewContext.Provider value={reviewOn}><HelpContext.Provider value={helpOn}>
      <div className="ui-login-settings"><Button iconName="settings" onClick={() => setDisplayOpen(true)}>显示设置</Button></div>
      <Login demoMode={demoMode} onLogin={onLogin} onSkip={demoMode ? () => navigate('/') : undefined} />
      <DisplaySettings visible={displayOpen} helpOn={helpOn} reviewOn={reviewOn} onHelp={toggleHelp} onReview={toggleReview} onDismiss={() => setDisplayOpen(false)} />
    </HelpContext.Provider></ReviewContext.Provider>;
  }

  const identityMenu = me
    ? {
        type: 'menu-dropdown' as const,
        text: `${me.display_name} · ${actor} · ${tierInfo.label}`,
        iconName: 'user-profile' as const,
        title: canSwitch ? '演示模式：管理员可以临时切换身份看别人看到的' : `你的角色：${actor}（${tierInfo.label}）`,
        items: [
          ...(canSwitch ? [...roleGroups, ...(override ? [{ id: '__reset', text: `回到自己（${me.role_code}）` }] : [])] : []),
          ...(me.is_admin ? [{ id: '__users', text: '用户管理', iconName: 'group' as const }] : []),
          { id: '__logout', text: '退出登录', iconName: 'unlocked' as const },
        ],
        onItemClick: ({ detail }: { detail: { id: string } }) => {
          if (detail.id === '__logout') logout();
          else if (detail.id === '__reset') resetActor();
          else if (detail.id === '__users') navigate('/users');
          else setActor(detail.id);
        },
      }
    : {
        type: 'menu-dropdown' as const,
        text: `我是：${actor} · ${tierInfo.label}`,
        iconName: 'user-profile' as const,
        title: `演示模式：谁在填，就选谁。当前级别：${tierInfo.label}`,
        items: [
          ...(roleGroups.length ? roleGroups : [{ id: '负责人', text: '负责人' }]),
          { id: '__login', text: '用账号登录', iconName: 'lock-private' as const },
        ],
        onItemClick: ({ detail }: { detail: { id: string } }) => {
          if (detail.id === '__login') navigate('/login');
          else setActor(detail.id);
        },
      };

  return (
    <FlashContext.Provider value={pushFlash}>
    <ReviewContext.Provider value={reviewOn}>
    <HelpContext.Provider value={helpOn}>
    <ActorContext.Provider value={{ actor, setActor, me, demoMode, logout }}>
      {/* KAN-75：顶栏中性底色，橙色细边仅作品牌强调，不按角色变色。 */}
      <div id="top-nav" style={{ position: 'sticky', top: 0, zIndex: 1002 }}>
        <TopNavigation
          identity={{ href: '/', title: '翻新项目平台', onFollow: (e) => { e.preventDefault(); navigate('/'); } }}
          search={
            <Autosuggest
              value={q}
              placeholder="输入地址新建项目"
              ariaLabel="按地址新建项目"
              options={cands.map((c) => ({ value: c.label, label: c.label, description: `${c.city}, ${c.state} ${c.zip}` }))}
              filteringType="manual"
              statusType={searching ? 'loading' : 'finished'}
              loadingText="查找中"
              empty="没有找到地址"
              enteredTextLabel={(v) => `用“${v}”新建`}
              onChange={({ detail }) => setQ(detail.value)}
              onLoadItems={async ({ detail }) => {
                if (detail.filteringText.length < 2) { setCands([]); return; }
                setSearching(true);
                try { setCands(await api.lookupAddress(detail.filteringText)); } finally { setSearching(false); }
              }}
              onSelect={({ detail }) => {
                const v = detail.selectedOption?.value ?? detail.value;
                setQ('');
                navigate(`/projects/new?address=${encodeURIComponent(v)}`);
              }}
            />
          }
          utilities={[
            { type: 'button', text: '显示设置', iconName: 'settings', onClick: () => setDisplayOpen(true) },
            identityMenu,
          ]}
        />
      </div>
      <AppLayout
        headerSelector="#top-nav"
        navigationOpen={navOpen}
        onNavigationChange={({ detail }) => setNavOpen(detail.open)}
        notifications={<Flashbar items={flashes} />}
        toolsHide
        drawers={[
          {
            id: 'assistant',
            trigger: { iconName: 'gen-ai' },
            ariaLabels: { drawerName: '助手', closeButton: '关闭助手', triggerButton: '打开助手' },
            resizable: true,
            defaultSize: 400,
            content: <AssistantPanel />,
          },
        ]}
        activeDrawerId={drawer}
        onDrawerChange={({ detail }) => setDrawer(detail.activeDrawerId)}
        // 侧栏不再重复写一遍产品名：顶栏左上角已经有了。
        navigation={
          <SideNavigation
            activeHref={activeHref}
            onFollow={(e) => { if (!e.detail.external) { e.preventDefault(); navigate(e.detail.href); } }}
            items={[
              { type: 'link', text: '工作台', href: '/' },
              ...(canDo('read_money') ? [{ type: 'link' as const, text: '项目', href: '/projects' }] : []),
              { type: 'link', text: '我的事项', href: '/todo' },
              ...(canDo('create_project') ? [{ type: 'link' as const, text: '新建项目', href: '/projects/new' }] : []),
              ...(me?.is_admin ? [{ type: 'divider' as const }, { type: 'link' as const, text: '用户', href: '/users' }] : []),
            ]}
          />
        }
        content={<>
          {(helpOn || reviewOn) && <div className="ui-mode-bar"><span><strong>{helpOn ? '辅助说明已开启' : ''}{helpOn && reviewOn ? ' · ' : ''}{reviewOn ? '卡片编号已开启' : ''}</strong>{reviewOn && ' · 点击编号复制反馈位置'}</span><Button variant="inline-link" onClick={() => setDisplayOpen(true)}>显示设置</Button></div>}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/todo" element={<MyTodo />} />
            {/* KAN-75 块 2：独立线索入口并入买房管理。旧链接 /leads 跳到项目列表的「买房 · 未购入」筛选；s1 段、档位、热度都还在。 */}
            <Route path="/leads" element={<Navigate to="/projects?group=buying&sub=pre" replace />} />
            <Route path="/projects" element={canDo('read_money') ? <Dashboard listOnly /> : <MyTodo />} />
            <Route path="/projects/new" element={<AddProject />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/projects/:id/tasks/:taskId" element={<TaskHistoryPage />} />
            <Route path="/users" element={me?.is_admin ? <Users /> : <Dashboard />} />
            <Route path="/login" element={<Dashboard />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </>}
      />
      <DisplaySettings visible={displayOpen} helpOn={helpOn} reviewOn={reviewOn} onHelp={toggleHelp} onReview={toggleReview} onDismiss={() => setDisplayOpen(false)} />
    </ActorContext.Provider>
    </HelpContext.Provider>
    </ReviewContext.Provider>
    </FlashContext.Provider>
  );
}
