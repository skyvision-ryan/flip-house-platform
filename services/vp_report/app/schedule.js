/* Progressive enhancement: dates, rows and native details work without JS.
   Never persist report text; only this tab's reading position and disclosure IDs. */
(function () {
  const panel = document.getElementById('schedule');
  if (!panel) return;
  const scroll = panel.querySelector('.schedule-scroll');
  const canvas = panel.querySelector('.schedule-canvas');
  const range = panel.querySelector('output');
  const previous = panel.querySelector('[data-move="-1"]');
  const next = panel.querySelector('[data-move="1"]');
  const expand = panel.querySelector('[data-expand]');
  const origin = Date.parse(panel.dataset.start + 'T00:00:00Z');
  const dayMs = 86400000;
  const today = Number(panel.dataset.today);
  const storageKey = 'vp-schedule-view-v1';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let pageY = 0;
  let frame = 0;
  const dayWidth = () => panel.querySelector('.schedule-day').getBoundingClientRect().width;
  const nameWidth = () => parseFloat(getComputedStyle(panel).getPropertyValue('--name'));
  const dateLabel = day => {
    const d = new Date(origin + day * dayMs);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  };
  function update() {
    frame = 0;
    const day = dayWidth();
    const first = Math.floor((scroll.scrollLeft + .5) / day);
    const last = Math.min(Number(panel.dataset.days) - 1,
      Math.ceil((scroll.scrollLeft + scroll.clientWidth - nameWidth()) / day) - 1);
    range.textContent = dateLabel(first) + '–' + dateLabel(last);
    previous.disabled = scroll.scrollLeft <= 1;
    next.disabled = scroll.scrollLeft >= scroll.scrollWidth - scroll.clientWidth - 1;
  }
  function moveTo(day, top) {
    scroll.scrollTo({left: Math.max(0, (day - 1) * dayWidth()),
      top: top === undefined ? scroll.scrollTop : top,
      behavior: reduced.matches ? 'auto' : 'smooth'});
  }
  panel.querySelectorAll('[data-enhanced]').forEach(el => { el.hidden = false; });
  panel.querySelectorAll('[data-move]').forEach(button => {
    button.addEventListener('click', () => scroll.scrollBy({
      left: Number(button.dataset.move) * Math.max(dayWidth(), scroll.clientWidth - nameWidth() - dayWidth()),
      behavior: reduced.matches ? 'auto' : 'smooth'}));
  });
  panel.querySelector('[data-today]').addEventListener('click', () => moveTo(today));
  const jump = panel.querySelector('[data-jump]');
  if (jump) jump.addEventListener('click', () => {
    const row = document.getElementById(jump.dataset.row);
    panel.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
    row.classList.add('is-selected');
    moveTo(Number(jump.dataset.jump), row.getBoundingClientRect().top - canvas.getBoundingClientRect().top - panel.querySelector('.schedule-head').offsetHeight);
  });
  function setExpanded(value) {
    if (value) pageY = window.scrollY;
    panel.classList.toggle('schedule-expanded', value);
    document.body.classList.toggle('schedule-lock', value);
    expand.textContent = value ? '收起' : '放大';
    expand.setAttribute('aria-expanded', String(value));
    if (value) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      document.querySelectorAll('.page > :not(#schedule)').forEach(el => { el.inert = true; });
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      document.querySelectorAll('.page > :not(#schedule)').forEach(el => { el.inert = false; });
      window.scrollTo(0, pageY);
    }
    expand.focus({preventScroll: true});
    update();
  }
  expand.addEventListener('click', () => setExpanded(!panel.classList.contains('schedule-expanded')));
  panel.addEventListener('keydown', event => {
    if (!panel.classList.contains('schedule-expanded')) return;
    if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); }
    if (event.key === 'Tab') {
      const focusable = Array.from(panel.querySelectorAll('button:not(:disabled),summary,[tabindex="0"],a[href]'))
        .filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  scroll.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(update); }, {passive:true});
  let previousDayWidth = dayWidth();
  new ResizeObserver(() => {
    const width = dayWidth();
    if (width !== previousDayWidth) scroll.scrollLeft = scroll.scrollLeft / previousDayWidth * width;
    previousDayWidth = width;
    update();
  }).observe(scroll);
  function save() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        at: Date.now(), day: origin + scroll.scrollLeft / dayWidth() * dayMs,
        top: scroll.scrollTop, page: panel.classList.contains('schedule-expanded') ? pageY : window.scrollY,
        open: Array.from(panel.querySelectorAll('details[open]')).map(el => el.id)
      }));
    } catch (_) { /* private browsing/storage denied: navigation still works */ }
  }
  let restored = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved && Date.now() - saved.at < 30 * 60 * 1000 && Number.isFinite(saved.day)) {
      (saved.open || []).forEach(id => { const el = document.getElementById(id); if (el && panel.contains(el) && el.tagName === 'DETAILS') el.open = true; });
      scroll.scrollLeft = (saved.day - origin) / dayMs * dayWidth();
      scroll.scrollTop = Number(saved.top) || 0;
      requestAnimationFrame(() => window.scrollTo(0, Number(saved.page) || 0));
      restored = true;
    }
  } catch (_) { /* malformed/expired state falls back to today */ }
  if (!restored) scroll.scrollLeft = Math.max(0, (today - 1) * dayWidth());
  window.addEventListener('pagehide', save);
  // Polling and manual refresh use the same hook before replacing this document.
  document.addEventListener('report:before-reload', save);
  update();
})();
