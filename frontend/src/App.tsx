import { systemText } from './i18n/core.ts';
import { deviceStorage } from './i18n/preferences.ts';
import { useLanguage } from './i18n/LanguageProvider';
import { m as uiText } from './i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from './components/ui/Header';
import AppLayout from '@cloudscape-design/components/app-layout';
import Autosuggest from '@cloudscape-design/components/autosuggest';
import Button from '@cloudscape-design/components/button';
import Flashbar, { FlashbarProps } from '@cloudscape-design/components/flashbar';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import Spinner from '@cloudscape-design/components/spinner';
import ProductTopBar from './components/ui/ProductTopBar';
import DesignDirections, { LegacyDesignRedirect } from './pages/DesignDirections';
import { DESIGN_DIRECTIONS_PATH, hasDesignDirections } from './lib/designNavigation';
import Icon from '@cloudscape-design/components/icon';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AddressCandidate, api, AUTH_EVENT, SESSION_EVENT, setSessionIdentity, broadcastSession, Me } from './api/client';
import AssistantPanel from './components/AssistantPanel';
import DisplaySettings from './components/DisplaySettings';
import ChangePasswordModal from './components/ChangePasswordModal';
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
import ProcurementWorkspace from './pages/ProcurementWorkspace';
import ProcurementItemPage from './pages/ProcurementItemPage';
import PurchaseOrders from './pages/PurchaseOrders';
import Login from './pages/Login';
import MyTodo from './pages/MyTodo';
import ProjectPage from './pages/project/ProjectPage';
import TaskHistoryPage from './pages/project/TaskHistoryPage';
import Users from './pages/Users';

export default function App() {
  useLanguage();
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
  const [sessionReady, setSessionReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  const [override, setOverride] = useState<string | null>(getOverride);
  useEffect(() => {
    (async () => {
      try { setDemoMode((await api.authMode()).demo_mode); } catch { setDemoMode(true); }
      try { const user = await api.me(); setSessionIdentity(user.id); setMe(user); } catch { setMe(null); } finally { setSessionReady(true); }
    })();
  }, []);
  useEffect(() => {
    const onExpired = () => { setSessionIdentity(null); setMe(null); };
    window.addEventListener(AUTH_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EVENT, onExpired);
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const user = await api.me();
        if (!active) return;
        setSessionIdentity(user.id);
        setMe((previous) => previous?.id === user.id && previous.role_code === user.role_code ? previous : user);
      } catch (error) { if (active && (error as { status?: number }).status === 401) { setSessionIdentity(null); setMe(null); } }
    };
    const changed = (event: StorageEvent) => { if (event.key === 'session-updated') void refresh(); };
    window.addEventListener('storage', changed);
    window.addEventListener('focus', refresh);
    window.addEventListener(SESSION_EVENT, refresh);
    return () => { active = false; window.removeEventListener('storage', changed); window.removeEventListener('focus', refresh); window.removeEventListener(SESSION_EVENT, refresh); };
  }, []);
  const canSwitch = me ? (!!demoMode && me.is_admin) : true;
  useEffect(() => { if (me && !canSwitch && override) { clearActor(); setOverride(null); } }, [me, canSwitch, override]);
  const actor = me ? (canSwitch && override ? override : me.role_code) : (override ?? getActor());
  const setActor = (c: string) => { persistActor(c); setOverride(c); };
  const resetActor = () => { clearActor(); setOverride(null); };
  const onLogin = useCallback((m: Me) => { clearActor(); setOverride(null); setSessionIdentity(m.id); setMe(m); broadcastSession(); navigate(location.pathname === '/login' ? '/' : location.pathname + location.search + location.hash, { replace: true }); }, [navigate, location.pathname, location.search, location.hash]);
  const logout = async () => { try { await api.logout(); } catch { /* ignore */ } clearActor(); setOverride(null); setSessionIdentity(null); setMe(null); broadcastSession(); navigate('/'); };
  const [reviewOn, setReviewOn] = useState<boolean>(() => readReviewPref(deviceStorage()));
  const toggleReview = (v: boolean) => { setReviewOn(v); writeReviewPref(deviceStorage(), v); };
  const [helpOn, setHelpOn] = useState(() => readHelpPref(deviceStorage()));
  const [passwordOpen, setPasswordOpen] = useState(false);
  useEffect(() => { setPasswordOpen(false); }, [me?.id]);
  const [displayOpen, setDisplayOpen] = useState(false);
  const toggleHelp = (v: boolean) => { setHelpOn(v); writeHelpPref(deviceStorage(), v); };

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
  const activeHref = location.pathname.startsWith('/procurement') ? (me?.role_code === '采购' ? '/' : '/procurement') : location.pathname.startsWith('/todo') ? '/todo' : location.pathname === '/projects/new' ? '/projects/new' : location.pathname.startsWith('/projects') ? '/projects' : location.pathname.startsWith('/users') ? '/users' : location.pathname.startsWith('/design-') ? DESIGN_DIRECTIONS_PATH : '/';

  if (demoMode === null || !sessionReady) {
    return <div className="ui-loading" role="status"><Spinner size="large" /> {uiText("app.loading.account.and.permissions")}</div>;
  }
  if (!me && (!demoMode || location.pathname === '/login' || location.pathname.startsWith('/design-'))) {
    return <ReviewContext.Provider value={reviewOn}><HelpContext.Provider value={helpOn}>
      <div className="ui-login-settings"><Button iconName="settings" onClick={() => setDisplayOpen(true)}>{uiText("app.display.settings")}</Button></div>
      <Login demoMode={demoMode} onLogin={onLogin} onSkip={demoMode ? () => navigate('/') : undefined} />
      <DisplaySettings visible={displayOpen} helpOn={helpOn} reviewOn={reviewOn} onHelp={toggleHelp} onReview={toggleReview} onDismiss={() => setDisplayOpen(false)} />
    </HelpContext.Provider></ReviewContext.Provider>;
  }

  const identityMenu = me
    ? {
        type: 'menu-dropdown' as const,
        text: `${me.display_name} · ${systemText(actor)}`,
        iconName: 'user-profile' as const,
        title: canSwitch ? uiText("app.demo.mode.administrators.can.preview.another.role") : uiText("sentences.your.role", { value1: (systemText(actor)), value2: (tierInfo.label) }),
        items: [
          ...(canSwitch ? [...roleGroups, ...(override ? [{ id: '__reset', text: uiText("sentences.return.to.my.role", { value1: (me.role_code) }) }] : [])] : []),
          ...(me.is_admin ? [{ id: '__users', text: uiText("app.user.management"), iconName: 'group' as const }] : []),
          { id: '__password', text: uiText('password.title'), iconName: 'lock-private' as const },
          { id: '__logout', text: uiText("app.sign.out"), iconName: 'unlocked' as const },
        ],
        onItemClick: ({ detail }: { detail: { id: string } }) => {
          if (detail.id === '__logout') logout();
          else if (detail.id === '__reset') resetActor();
          else if (detail.id === '__password') setPasswordOpen(true);
          else if (detail.id === '__users') navigate('/users');
          else setActor(detail.id);
        },
      }
    : {
        type: 'menu-dropdown' as const,
        text: uiText("sentences.demo.role", { value1: (systemText(actor)), value2: (tierInfo.label) }),
        iconName: 'user-profile' as const,
        title: uiText("sentences.demo.mode.select.the.role.entering.data.current.tier", { value1: (tierInfo.label) }),
        items: [
          ...(roleGroups.length ? roleGroups : [{ id: '负责人', text: uiText("app.project.lead") }]),
          { id: '__login', text: uiText("app.sign.in.with.an.account"), iconName: 'lock-private' as const },
        ],
        onItemClick: ({ detail }: { detail: { id: string } }) => {
          if (detail.id === '__login') navigate('/login');
          else setActor(detail.id);
        },
      };

  const unavailable = (title: string, message: string) => <ContentLayout header={<Header variant="h1">{systemText(title)}</Header>}><Alert type="info" action={<Button onClick={() => navigate('/')}>{uiText("app.back.to.workspace")}</Button>}>{systemText(message)}</Alert></ContentLayout>;
  return (
    <FlashContext.Provider value={pushFlash}>
    <ReviewContext.Provider value={reviewOn}>
    <HelpContext.Provider value={helpOn}>
    <ActorContext.Provider value={{ actor, setActor, me, demoMode, logout }}>
      {/* KAN-75 B：轻量顶栏，橙色只留给主要操作。 */}
      <div id="top-nav" className="ui-top-nav">
        <ProductTopBar me={me} identityMenu={identityMenu} onHome={() => navigate('/')} onDisplay={() => setDisplayOpen(true)}
          search={canDo('create_project') ?
            <Autosuggest
              value={q}
              placeholder={uiText("app.enter.an.address.to.create.a.project")}
              ariaLabel={uiText("app.create.a.project.by.address")}
              options={cands.map((c) => ({ value: c.label, label: c.label, description: `${c.city}, ${c.state} ${c.zip}` }))}
              filteringType="manual"
              statusType={searching ? 'loading' : 'finished'}
              loadingText={uiText("app.searching")}
              empty={uiText("app.no.address.found")}
              enteredTextLabel={(v) => uiText("sentences.create.from", { value1: (v) })}
              onChange={({ detail }) => setQ(detail.value)}
              onLoadItems={async ({ detail }) => {
                if (detail.filteringText.length < 2) { setCands([]); return; }
                setSearching(true);
                try { setCands(await api.lookupAddress(detail.filteringText)); } catch { setCands([]); pushFlash({ type: 'error', content: uiText("app.address.search.failed.you.can.enter.the.address.manually") }); } finally { setSearching(false); }
              }}
              onSelect={({ detail }) => {
                const v = detail.selectedOption?.value ?? detail.value;
                setQ('');
                navigate(`/projects/new?address=${encodeURIComponent(v)}`);
              }}
            /> : null
          }
        />
      </div>
      <AppLayout
        headerSelector="#top-nav"
        navigationOpen={navOpen}
        onNavigationChange={({ detail }) => setNavOpen(detail.open)}
        notifications={<Flashbar items={flashes.map(item => ({ ...item, content: systemText(item.content), header: systemText(item.header) }))} />}
        toolsHide
        drawers={[
          {
            id: 'assistant',
            trigger: { iconName: 'gen-ai' },
            ariaLabels: { drawerName: systemText('助手'), closeButton: systemText('关闭助手'), triggerButton: systemText('打开助手') },
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
            onFollow={(e) => { if (!e.detail.external) { e.preventDefault(); navigate(e.detail.href); if (window.matchMedia('(max-width: 688px)').matches) setNavOpen(false); } }}
            items={[
              { type: 'link', text: uiText("app.workspace"), href: '/', icon: <Icon name="grid-view" /> },
              { type: 'link', text: uiText("app.projects"), href: '/projects', icon: <Icon name="folder" /> },
              ...(me && me.role_code !== '采购' && canDo('procurement_read') ? [{ type: 'link' as const, text: uiText("app.procurement.workspace"), href: '/procurement', icon: <Icon name="grid-view" /> }] : []),
              { type: 'link', text: uiText("app.my.tasks"), href: '/todo', icon: <Icon name="check" /> },
              ...(hasDesignDirections(me) ? [{ type: 'link' as const, text: uiText("app.design.directions"), href: DESIGN_DIRECTIONS_PATH, icon: <Icon name="view-full" /> }] : []),
              ...(canDo('create_project') ? [{ type: 'link' as const, text: uiText("app.new.project"), href: '/projects/new', icon: <Icon name="add-plus" /> }] : []),
              ...(me?.is_admin ? [{ type: 'divider' as const }, { type: 'link' as const, text: uiText("app.users"), href: '/users', icon: <Icon name="group" /> }] : []),
            ]}
          />
        }
        content={<>
          {(helpOn || reviewOn) && <div className="ui-mode-bar"><span><strong>{helpOn ? uiText("app.help.text.is.on") : ''}{helpOn && reviewOn ? ' · ' : ''}{reviewOn ? uiText("app.card.numbers.are.on") : ''}</strong>{reviewOn && uiText("app.click.a.number.to.copy.the.feedback.location")}</span><Button variant="inline-link" onClick={() => setDisplayOpen(true)}>{uiText("app.display.settings")}</Button></div>}
          <Routes key={me?.id ?? "guest"}>
            <Route path="/" element={me?.role_code === '采购' ? <ProcurementWorkspace /> : <Dashboard />} />
            <Route path="/procurement" element={me && canDo('procurement_read') ? <ProcurementWorkspace /> : <Navigate to="/" replace />} />
            <Route path="/projects/:projectId/purchase-orders/new" element={me && canDo('procurement') ? <PurchaseOrders /> : <Navigate to="/" replace />} />
            <Route path="/projects/:projectId/procurement/:itemId" element={me && canDo('procurement') ? <ProcurementItemPage /> : <Navigate to="/" replace />} />
            <Route path="/procurement/items/new" element={me && canDo('procurement') ? <ProcurementItemPage /> : <Navigate to="/" replace />} />
            <Route path="/procurement/orders" element={me && canDo('procurement_read') ? <PurchaseOrders /> : <Navigate to="/" replace />} />
            <Route path="/todo" element={<MyTodo />} />
            <Route path={DESIGN_DIRECTIONS_PATH} element={<DesignDirections />} />
            <Route path="/design-choices" element={<LegacyDesignRedirect />} />
            <Route path="/design-collaboration" element={<LegacyDesignRedirect />} />
            {/* KAN-75 块 2：独立线索入口并入买房管理。旧链接 /leads 跳到项目列表的「买房 · 未购入」筛选；s1 段、档位、热度都还在。 */}
            <Route path="/leads" element={<Navigate to="/projects?group=buying&sub=pre" replace />} />
            <Route path="/projects" element={<Dashboard listOnly />} />
            <Route path="/projects/new" element={canDo('create_project') ? <AddProject /> : unavailable(uiText("app.cannot.create.project"), uiText("app.your.account.cannot.create.projects.contact.the.project.lead"))} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/projects/:id/tasks/:taskId" element={<TaskHistoryPage />} />
            <Route path="/users" element={me?.is_admin ? <Users /> : unavailable(uiText("app.cannot.access.user.management"), uiText("app.this.page.is.for.administrators.only.your.project.permissions"))} />
            <Route path="/login" element={<Dashboard />} />
            <Route path="*" element={unavailable(uiText("app.page.not.found"), uiText("app.this.link.may.have.expired.open.the.property.or"))} />
          </Routes>
        </>}
      />
      <DisplaySettings visible={displayOpen} helpOn={helpOn} reviewOn={reviewOn} onHelp={toggleHelp} onReview={toggleReview} onDismiss={() => setDisplayOpen(false)} />
      {me && passwordOpen && <ChangePasswordModal key={me.id} onDismiss={() => setPasswordOpen(false)} />}
    </ActorContext.Provider>
    </HelpContext.Provider>
    </ReviewContext.Provider>
    </FlashContext.Provider>
  );
}
