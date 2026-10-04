// Last Orders, the stacker. Thai word blocks fall into a four-column well.
// Each order ticket is in English ("Two bottles of beer"); build its Thai as
// one row, left to right: ขอ, item, number, classifier, or the question form
// ขอ, item, ได้, ไหม. A right row clears. A wrong row stays and the stack
// rises. Some blocks are not in the order: bin them.
// Touch: tap a column to drop there, swipe left or right to slide, swipe up to
// bin. Keys: arrows to slide, down to fall faster, space to drop, up to bin.
//
// What counts as a review (the rule for all games):
// - The ticket is English and the blocks are Thai, so every block is a
//   reading decision ('read').
// - Each ticket carries one decoy block (two at tiers 3 and 4) that shares a
//   slot's role: another number, the other classifier, an item with the same
//   classifier, or ไม่ for ไหม. Those slots are "tested": placing the right
//   block there, or binning the decoy, needs the meaning and counts. Slots
//   with no decoy could be filled by knowing the word class alone, so they
//   are not reported on their own.
// - Each finished row reports the pattern ('read') for its word order: counts.
// - Binning a block the order needed counts as a miss for that word.
// - Tier 3 and up: some cleared rows are read aloud (sound.record); 'say' on
//   the pattern, counted only once speech is scored (Phase 4).
// - Tier 4 has no sound to add noise to, so it is the hardest reading tier:
//   three decoys, and the ticket hides after a few seconds.

import { useMemo, useRef, useState } from 'react';
import { Container, Graphics } from 'pixi.js';
import { useApp } from '../app/context';
import { useDevice } from '../app/device';
import { useKeys } from '../input/keys';
import { KeyHints, Label } from '../ui/kit';
import { FitText } from '../ui/FitText';
import type { Item, Pattern } from '../content/types';
import type { GameItem } from '../engine/engine';
import { DrillShell, type DrillRunApi } from './shared/DrillShell';
import { usePixi } from './shared/pixi';
import { pick, shuffle, type Tier } from './shared/drill';
import { followSize, loadGameFonts, thaiLabel } from './parts/dots-pixi';
import { useLatest } from './parts/dots-svg';

const COLS = 4;
const NOUN_IDS = ['beer', 'water', 'coffee', 'fried-rice', 'pad-thai', 'papaya-salad', 'orange', 'mango'];
const DRINKS = new Set(['beer', 'water', 'coffee']);
const NUM_IDS = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10'];
const NUM_EN = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** numbers that look or sound alike, for tier 3 decoys */
const NUM_LOOKALIKE: Record<string, string[]> = { n2: ['n3'], n3: ['n2'], n4: ['n10', 'n9'], n10: ['n4'], n9: ['n4'], n6: ['n8'], n8: ['n6'] };
const DECOYS: Record<Tier, number> = { 1: 1, 2: 1, 3: 2, 4: 3 };
const ROW_MS = 1000;

type Role = 'ask' | 'item' | 'number' | 'classifier' | 'can' | 'question';
const ROLE_LABEL: Record<Role, string> = { ask: 'ขอ', item: 'item', number: 'number', classifier: 'classifier', can: 'ได้', question: 'ไหม' };

interface Word { ref: string; item: Item }
interface Ticket {
  id: number;
  kind: 'count' | 'question';
  pattern: string; // pattern ref
  seq: Word[];
  roles: Role[];
  en: string;
  /** slot index -> decoy ref, for tested slots */
  tested: Map<number, string>;
  made: number;
}
interface Tile {
  uid: number;
  ref: string;
  thai: string;
  role: Role;
  ticket: number;
  decoy: boolean;
  spawn: number;
  landed: number;
}

interface Panel {
  next: string | null;
  tickets: { id: number; en: string; roles: Role[] }[];
  hideTicket: boolean;
  rows: number;
  status: { kind: 'idle' | 'right' | 'wrong' | 'bin' | 'say'; text: string };
}
const PANEL0: Panel = { next: null, tickets: [], hideTicket: false, rows: 0, status: { kind: 'idle', text: '' } };

export default function LastOrders() {
  const [panel, setPanel] = useState<Panel>(PANEL0);
  return (
    <DrillShell
      id="last-orders"
      title="Last Orders"
      tag="Stacker"
      howTo="Thai words fall into the well. Build the order on the ticket as one row, left to right. A right row clears; a wrong row stays and the stack rises. Bin any word that is not in the order."
      controls={{
        touch: 'Tap a column to drop the word there. Swipe left or right to slide it, swipe up to bin it.',
        keys: [['← →', 'slide'], ['↓', 'faster'], ['Space', 'drop'], ['↑', 'bin'], ['Esc', 'pause']],
      }}
      request={() => ({
        skills: ['read'],
        kinds: ['item', 'pattern'],
        filter: (e) => {
          const id = e.ref.slice(e.ref.indexOf(':') + 1);
          if (e.kind === 'pattern') return id === 'p-count' || id === 'p-mai-q';
          return NOUN_IDS.includes(id) || NUM_IDS.includes(id) || id.startsWith('cl-') || ['khaw', 'dai', 'mai-q', 'mai-not'].includes(id);
        },
        count: 300,
      })}
      minItems={5}
      seconds={240}
      lives={3}
      side={(api) => <Side api={api} panel={panel} />}
    >
      {(api) => <Game api={api} panel={panel} setPanel={setPanel} />}
    </DrillShell>
  );
}

function RoleChips({ roles }: { roles: Role[] }) {
  return (
    <div className="hrow" style={{ gap: 6, flexWrap: 'nowrap', minWidth: 0 }}>
      {roles.map((r, i) => (
        <span key={i} className="pill small" style={{ minHeight: 26, padding: '0 10px', letterSpacing: r === 'ask' || r === 'can' || r === 'question' ? 0 : undefined, textTransform: 'none', fontFamily: r === 'ask' || r === 'can' || r === 'question' ? 'var(--thai)' : undefined }}>
          {ROLE_LABEL[r]}
        </span>
      ))}
    </div>
  );
}

function Side({ api, panel }: { api: DrillRunApi; panel: Panel }) {
  const { content } = useApp();
  const now = panel.tickets[0];
  const pat: Pattern | undefined = now ? content.pattern(now.roles.includes('number') ? 'p-count' : 'p-mai-q') : undefined;
  return (
    <div className="stack gap-4" style={{ paddingTop: 8 }}>
      <div className="hrow" style={{ gap: 28 }}>
        <div><Label>Rows cleared</Label><div className="h-m num" style={{ marginTop: 6 }}>{panel.rows}</div></div>
        <div><Label>Speed</Label><div className="h-m num" style={{ marginTop: 6 }}>{api.pace.speed.toFixed(2)}×</div></div>
      </div>
      <div>
        <Label>Next word</Label>
        <div className="thai-l" lang="th" style={{ marginTop: 4, minHeight: 50 }}>{panel.next ?? ''}</div>
      </div>
      <hr className="rule" />
      <div>
        <Label>Ticket</Label>
        <div className="h-s" style={{ marginTop: 6 }}>{now ? (panel.hideTicket ? 'Hidden. You read it.' : now.en) : '...'}</div>
        {panel.tickets[1] && <div className="small" style={{ marginTop: 4 }}>Then: {panel.hideTicket ? '...' : panel.tickets[1].en}</div>}
      </div>
      {now && (
        <div>
          <Label>The rule</Label>
          <div style={{ marginTop: 8 }}><RoleChips roles={now.roles} /></div>
          {pat && <p className="small" style={{ margin: '8px 0 0' }} lang="th">{pat.note}</p>}
        </div>
      )}
      <KeyHints hints={[['← →', 'slide'], ['↓', 'faster'], ['Space', 'drop'], ['↑', 'bin']]} />
    </div>
  );
}

// ---------- the pool ----------

interface Pool {
  khaw: Word | null;
  dai: Word | null;
  maiQ: Word | null;
  maiNot: Word | null;
  nouns: Word[];
  numbers: (Word & { n: number })[];
  classifiers: Map<string, Word>;
  pCount: boolean;
  pQuestion: boolean;
}

function buildPool(items: GameItem[], getItem: (id: string) => Item | undefined): Pool {
  const pool: Pool = { khaw: null, dai: null, maiQ: null, maiNot: null, nouns: [], numbers: [], classifiers: new Map(), pCount: false, pQuestion: false };
  for (const gi of items) {
    if (gi.entry.kind === 'pattern') {
      if (gi.ref === 'pattern:p-count') pool.pCount = true;
      if (gi.ref === 'pattern:p-mai-q') pool.pQuestion = true;
      continue;
    }
    const id = gi.ref.slice(5);
    const item = getItem(id);
    if (!item) continue;
    const w = { ref: gi.ref, item };
    if (id === 'khaw') pool.khaw = w;
    else if (id === 'dai') pool.dai = w;
    else if (id === 'mai-q') pool.maiQ = w;
    else if (id === 'mai-not') pool.maiNot = w;
    else if (id.startsWith('cl-')) pool.classifiers.set(id, w);
    else if (NUM_IDS.includes(id)) pool.numbers.push({ ...w, n: NUM_IDS.indexOf(id) + 1 });
    else if (NOUN_IDS.includes(id)) pool.nouns.push(w);
  }
  pool.numbers.sort((a, b) => a.n - b.n);
  return pool;
}

const classifiersFor = (noun: Word, pool: Pool): Word[] => {
  const ids = DRINKS.has(noun.item.id) ? ['cl-bottle', 'cl-glass'] : noun.item.classifier ? [noun.item.classifier] : [];
  return ids.map((id) => pool.classifiers.get(id)).filter(Boolean) as Word[];
};

const canCount = (pool: Pool) => pool.pCount && !!pool.khaw && pool.numbers.length > 0 && pool.nouns.some((n) => classifiersFor(n, pool).length > 0);
const canAsk = (pool: Pool) => pool.pQuestion && !!pool.khaw && !!pool.dai && !!pool.maiQ && pool.nouns.length > 0;

function plural(word: string, n: number) {
  if (n === 1) return word;
  if (/(s|sh|ch|o)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

// ---------- the game ----------

function Game({ api, panel, setPanel }: { api: DrillRunApi; panel: Panel; setPanel: React.Dispatch<React.SetStateAction<Panel>> }) {
  const { content, sound } = useApp();
  const { device } = useDevice();
  const apiRef = useLatest(api);
  const pool = useMemo(() => buildPool(api.items, (id) => content.item(id)), [api.items, content]);
  const playable = canCount(pool) || canAsk(pool);
  const actions = useRef({ move(_dx: number) {}, drop() {}, bin() {}, soft(_on: boolean) {} });

  useKeys((a, e) => {
    if (apiRef.current.paused || sound.getState().recording) return;
    const c = actions.current;
    if (a.type === 'move') {
      if (a.dx && a.down) c.move(a.dx);
      if (a.dy > 0) c.soft(a.down);
      if (a.dy < 0 && a.down && !e.repeat) c.bin();
      return true;
    }
    if (a.type === 'play') {
      c.drop();
      return true;
    }
  });

  const { host } = usePixi((app, el) => {
    void loadGameFonts();
    const unfollow = followSize(app, el);
    const tier = apiRef.current.tier;
    if (!playable) return unfollow;

    const gridG = new Graphics();
    const stackLayer = new Container();
    const fallLayer = new Container();
    const ghostG = new Graphics();
    const nextLayer = new Container();
    app.stage.addChild(gridG, ghostG, stackLayer, fallLayer, nextLayer);

    let destroyed = false;
    let gt = 0;
    let hold = false;
    let uid = 0;
    let ticketSeq = 0;
    let rowsCleared = 0;
    let sayCountdown = 3;
    let soft = false;
    let ended = false;
    const cols: Tile[][] = [[], [], [], []];
    const dead: boolean[] = []; // per row, aligned with stack rows
    const feed: Tile[] = [];
    let tickets: Ticket[] = [];
    let falling: { tile: Tile; col: number; y: number } | null = null; // y in rows from top, continuous
    let status: Panel['status'] = { kind: 'idle', text: '' };
    let dirty = true;

    // ---- geometry ----
    const geo = () => {
      const w = app.screen.width, h = app.screen.height;
      const rows = Math.max(6, Math.min(9, Math.floor(h / 70)));
      const cell = Math.floor(Math.min((w - 32) / (COLS + (w > 520 ? 1.6 : 0)), (h - 24) / rows, 104));
      const ww = cell * COLS;
      const x0 = Math.round((w - ww) / 2 - (w > 520 ? cell * 0.4 : 0));
      const y0 = Math.round(h - 12 - cell * rows);
      return { w, h, rows, cell, x0, y0 };
    };
    const cellXY = (col: number, rowFromBottom: number) => {
      const g = geo();
      return { x: g.x0 + col * g.cell, y: g.y0 + (g.rows - 1 - rowFromBottom) * g.cell };
    };

    // ---- tickets and tiles ----

    function makeTicket(): Ticket {
      const kinds: Ticket['kind'][] = [];
      if (canCount(pool)) kinds.push('count', 'count');
      if (canAsk(pool)) kinds.push('question');
      const kind = pick(kinds);
      const id = ++ticketSeq;
      if (kind === 'count') {
        const nouns = pool.nouns.filter((n) => classifiersFor(n, pool).length > 0);
        const noun = pick(nouns);
        const cl = pick(classifiersFor(noun, pool));
        const num = pick(pool.numbers);
        const clWord = cl.item.en.replace('classifier: ', '');
        const en = clWord === 'thing' ? `${NUM_EN[num.n - 1]} ${plural(noun.item.en, num.n)}` : `${NUM_EN[num.n - 1]} ${plural(clWord, num.n)} of ${noun.item.en}`;
        return { id, kind, pattern: 'pattern:p-count', seq: [pool.khaw!, noun, num, cl], roles: ['ask', 'item', 'number', 'classifier'], en, tested: new Map(), made: gt };
      }
      const noun = pick(pool.nouns);
      return { id, kind, pattern: 'pattern:p-mai-q', seq: [pool.khaw!, noun, pool.dai!, pool.maiQ!], roles: ['ask', 'item', 'can', 'question'], en: `Can I have ${noun.item.en}?`, tested: new Map(), made: gt };
    }

    /** A decoy for one slot, or null if none fits. */
    function decoyFor(t: Ticket, slot: number): Word | null {
      const want = t.seq[slot];
      const look = tier >= 3;
      switch (t.roles[slot]) {
        case 'number': {
          const others = pool.numbers.filter((x) => x.ref !== want.ref);
          if (!others.length) return null;
          const near = look ? others.filter((x) => (NUM_LOOKALIKE[want.item.id] ?? []).includes(x.item.id)) : [];
          return pick(near.length ? near : others);
        }
        case 'classifier': {
          const noun = t.seq[1];
          const own = classifiersFor(noun, pool).filter((c) => c.ref !== want.ref);
          const others = [...pool.classifiers.values()].filter((c) => c.ref !== want.ref);
          if (look && own.length) return pick(own);
          return others.length ? pick(others) : null;
        }
        case 'item': {
          const others = pool.nouns.filter((x) => x.ref !== want.ref);
          if (!others.length) return null;
          if (look && t.kind === 'count') {
            const same = others.filter((o) => classifiersFor(o, pool).some((c) => c.ref === t.seq[3].ref));
            if (same.length) return pick(same);
          }
          return pick(others);
        }
        case 'question':
          return pool.maiNot;
        default:
          return null;
      }
    }

    function tileOf(w: Word, role: Role, ticket: number, decoy: boolean): Tile {
      return { uid: ++uid, ref: w.ref, thai: w.item.thai, role, ticket, decoy, spawn: 0, landed: 0 };
    }

    function addTicket() {
      const t = makeTicket();
      const tiles = t.seq.map((w, i) => tileOf(w, t.roles[i], t.id, false));
      const slots = shuffle(t.roles.map((_, i) => i).filter((i) => decoyFor(t, i)));
      for (const slot of slots.slice(0, DECOYS[tier])) {
        const d = decoyFor(t, slot)!;
        if (t.seq.some((w) => w.ref === d.ref)) continue;
        t.tested.set(slot, d.ref);
        tiles.push(tileOf(d, t.roles[slot], t.id, true));
      }
      tickets.push(t);
      feed.push(...shuffle(tiles));
    }

    function spawn() {
      if (feed.length < 2) addTicket();
      const tile = feed.shift()!;
      tile.spawn = gt;
      const col = cols[1].length <= cols[2].length ? 1 : 2;
      if (cols[col].length >= geo().rows) return over();
      falling = { tile, col, y: -0.6 };
      dirty = true;
    }

    function over() {
      if (ended) return;
      ended = true;
      status = { kind: 'wrong', text: 'The stack hit the top' };
      sync();
      setTimeout(() => apiRef.current.end(), 900);
    }

    // ---- rows ----

    function land() {
      if (!falling) return;
      const { tile, col } = falling;
      tile.landed = gt;
      cols[col].push(tile);
      falling = null;
      const row = cols[col].length - 1;
      if (row >= dead.length) dead.length = row + 1;
      // a row fills when every column reaches it
      const r = row;
      if (cols.every((c) => c.length > r) && !dead[r]) resolveRow(r);
      if (cols.some((c) => c.length >= geo().rows)) return over();
      dirty = true;
    }

    function resolveRow(r: number) {
      const a = apiRef.current;
      const row = cols.map((c) => c[r]);
      const refs = row.map((t) => t.ref).join('|');
      let ticket = tickets.find((t) => t.seq.map((w) => w.ref).join('|') === refs) ?? null;
      const right = !!ticket;
      if (!ticket) {
        const tally = new Map<number, number>();
        for (const t of row) if (!t.decoy) tally.set(t.ticket, (tally.get(t.ticket) ?? 0) + 1);
        let best = -1;
        for (const t of tickets) if ((tally.get(t.id) ?? 0) > best) { best = tally.get(t.id) ?? 0; ticket = t; }
      }
      if (ticket) {
        const t = ticket;
        a.answer({ ref: t.pattern, skill: 'read', correct: right, counts: true, points: right ? 100 * tier : 0, data: { tier, want: t.seq.map((w) => w.item.thai).join(' '), got: row.map((x) => x.thai).join(' ') } });
        for (const [slot, decoyRef] of t.tested) {
          const got = row[slot];
          const want = t.seq[slot];
          const ms = got.landed - got.spawn;
          if (got.ref === want.ref) a.answer({ ref: want.ref, skill: 'read', correct: true, ms, counts: true, points: 0, data: { tier, slot: t.roles[slot], decoy: decoyRef } });
          else if (got.role === t.roles[slot]) a.answer({ ref: want.ref, skill: 'read', correct: false, ms, counts: true, confusedWith: got.ref, points: 0, data: { tier, slot: t.roles[slot] } });
        }
      }
      // tickets whose words are used up in this row can't be finished any more
      const used = new Set(row.filter((x) => !x.decoy).map((x) => x.ticket));
      if (ticket) used.add(ticket.id);
      tickets = tickets.filter((t) => !used.has(t.id));
      for (let i = feed.length - 1; i >= 0; i--) if (used.has(feed[i].ticket)) feed.splice(i, 1);
      if (falling && used.has(falling.tile.ticket)) falling = null;

      const g = geo();
      const mid = cellXY(1.5, r);
      if (right) {
        for (const c of cols) c.splice(r, 1);
        dead.splice(r, 1);
        rowsCleared++;
        a.burst?.burst(mid.x + g.cell / 2, mid.y + g.cell / 2, '#3ddc97');
        status = { kind: 'right', text: `Row cleared. +${100 * tier}` };
        if (tier >= 3 && --sayCountdown <= 0 && ticket) {
          sayCountdown = 3;
          void sayRow(ticket);
        }
      } else {
        dead[r] = true;
        a.loseLife();
        a.burst?.pull(mid.x + g.cell / 2, mid.y + g.cell / 2, '#ff5a4f');
        const want = ticket ? ticket.seq.map((w) => w.item.thai).join(' ') : '';
        status = { kind: 'wrong', text: want ? `Wrong row. It was ${want}` : 'Wrong row' };
      }
      // other rows may now be complete after the shift
      for (let i = 0; i < Math.min(...cols.map((c) => c.length)); i++) if (!dead[i]) return resolveRow(i);
      dirty = true;
      sync();
    }

    async function sayRow(t: Ticket) {
      hold = true;
      status = { kind: 'say', text: 'Read the row aloud' };
      sync();
      const target = { ref: t.pattern, thai: t.seq.map((w) => w.item.thai).join(' '), roman: t.seq.map((w) => w.item.roman).join(' ') };
      const rec = await sound.record(target);
      if (destroyed) return;
      if (rec) {
        const sc = await sound.score(rec, target);
        if (destroyed) return;
        apiRef.current.answer({ ref: t.pattern, skill: 'say', correct: sc ? sc.overall >= 0.6 : undefined, speechScore: sc?.overall ?? null, ms: rec.ms, counts: !!sc, points: 0, data: { tier, line: target.thai } });
        apiRef.current.addScore(20);
      }
      hold = false;
    }

    // ---- actions ----

    const canMoveTo = (col: number) => {
      if (!falling || col < 0 || col >= COLS) return false;
      const g = geo();
      const bottomRow = g.rows - 1 - Math.ceil(falling.y); // row index from bottom under the tile
      return cols[col].length <= Math.max(0, bottomRow);
    };
    actions.current = {
      move(dx) {
        if (!falling || hold || ended) return;
        if (canMoveTo(falling.col + dx)) {
          falling.col += dx;
          dirty = true;
        }
      },
      drop() {
        if (!falling || hold || ended) return;
        land();
        sync();
      },
      bin() {
        if (!falling || hold || ended) return;
        const t = falling.tile;
        falling = null;
        const a = apiRef.current;
        const ticket = tickets.find((x) => x.id === t.ticket);
        if (t.decoy) {
          a.answer({ ref: t.ref, skill: 'read', correct: true, ms: Math.round(gt - t.spawn), counts: true, points: 10 * tier, data: { tier, binned: true, decoy: true } });
          status = { kind: 'bin', text: `Binned ${t.thai}. Not in the order.` };
        } else {
          a.answer({ ref: t.ref, skill: 'read', correct: false, ms: Math.round(gt - t.spawn), counts: true, points: 0, data: { tier, binned: true, needed: ticket?.en } });
          status = { kind: 'wrong', text: `${t.thai} was in the order. It comes back.` };
          if (ticket) feed.splice(Math.min(1, feed.length), 0, { ...t, uid: ++uid });
        }
        dirty = true;
        sync();
      },
      soft(on) {
        soft = on;
      },
    };

    // ---- pointer: tap a column, swipe to slide or bin ----

    let start: { x: number; y: number; at: number; col: number } | null = null;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      if (apiRef.current.paused || hold || !falling) return;
      const p = local(e);
      start = { ...p, at: performance.now(), col: falling.col };
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!start || !falling) return;
      const p = local(e);
      const g = geo();
      const steps = Math.round((p.x - start.x) / (g.cell * 0.8));
      const target = Math.max(0, Math.min(COLS - 1, start.col + steps));
      while (falling && falling.col !== target && canMoveTo(falling.col + Math.sign(target - falling.col))) falling.col += Math.sign(target - falling.col);
      dirty = true;
    };
    const onUp = (e: PointerEvent) => {
      if (!start) return;
      const p = local(e);
      const dx = p.x - start.x, dy = p.y - start.y;
      const quick = performance.now() - start.at < 450;
      const g = geo();
      start = null;
      if (!falling) return;
      if (dy < -40 && Math.abs(dy) > Math.abs(dx)) return actions.current.bin();
      if (dy > 50 && Math.abs(dy) > Math.abs(dx) && quick) return actions.current.drop();
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        // a tap: go to that column if the path is clear, then drop
        const col = Math.floor((p.x - g.x0) / g.cell);
        if (col >= 0 && col < COLS) {
          while (falling && falling.col !== col && canMoveTo(falling.col + Math.sign(col - falling.col))) falling.col += Math.sign(col - falling.col);
          if (falling.col === col) actions.current.drop();
        }
      }
    };
    const onCancel = () => {
      start = null;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);

    // ---- drawing ----

    const tileNode = (t: Tile, cell: number, state: 'fall' | 'stack' | 'dead') => {
      const c = new Container();
      const pad = 4;
      const g = new Graphics()
        .roundRect(pad, pad, cell - pad * 2, cell - pad * 2, 8)
        .fill({ color: state === 'dead' ? 0x1a1a1a : state === 'fall' ? 0x15392c : 0x0f2a21, alpha: 0.95 })
        .stroke({ color: state === 'dead' ? 0x444444 : 0x7fe0b0, alpha: state === 'fall' ? 0.8 : 0.4, width: 1 });
      c.addChild(g);
      const len = [...t.thai].length;
      const fs = Math.max(13, Math.min(cell * 0.3, (cell * 1.6) / Math.max(3, len)));
      const label = thaiLabel(t.thai, fs, state === 'dead' ? 0x777777 : 0xf2f2f2);
      label.position.set(cell / 2, cell / 2);
      c.addChild(label);
      return c;
    };

    let lastKey = '';
    function draw() {
      const g = geo();
      const key = `${g.w}x${g.h}`;
      if (key !== lastKey) {
        lastKey = key;
        dirty = true;
        gridG.clear();
        // the well: a dot at each cell corner, a hairline frame
        for (let r = 0; r <= g.rows; r++)
          for (let c = 0; c <= COLS; c++) gridG.circle(g.x0 + c * g.cell, g.y0 + r * g.cell, 1.3).fill({ color: 0xffffff, alpha: 0.22 });
        gridG.rect(g.x0 - 6, g.y0 - 6, g.cell * COLS + 12, g.cell * g.rows + 12).stroke({ color: 0xffffff, alpha: 0.12, width: 1 });
      }
      if (dirty) {
        dirty = false;
        stackLayer.removeChildren().forEach((n) => n.destroy({ children: true }));
        cols.forEach((col, ci) =>
          col.forEach((t, ri) => {
            const n = tileNode(t, g.cell, dead[ri] ? 'dead' : 'stack');
            n.position.copyFrom(cellXY(ci, ri));
            stackLayer.addChild(n);
          }),
        );
        fallLayer.removeChildren().forEach((n) => n.destroy({ children: true }));
        if (falling) fallLayer.addChild(tileNode(falling.tile, g.cell, 'fall'));
        // next word, top right of the well on wide fields
        nextLayer.removeChildren().forEach((n) => n.destroy({ children: true }));
        const nx = feed[0];
        if (nx && g.w > 520) {
          const n = tileNode(nx, g.cell * 0.8, 'stack');
          n.alpha = 0.7;
          n.position.set(g.x0 + g.cell * COLS + 18, g.y0);
          nextLayer.addChild(n);
        }
      }
      ghostG.clear();
      if (falling) {
        const p = cellXY(falling.col, 0);
        fallLayer.position.set(p.x, g.y0 + falling.y * g.cell);
        // landing slot, dotted
        const land = cellXY(falling.col, cols[falling.col].length);
        const n = 10;
        for (let i = 0; i < n; i++) {
          const k = i / n;
          const s = g.cell - 10;
          ghostG.circle(land.x + 5 + s * k, land.y + 5, 1.2).fill({ color: 0xffffff, alpha: 0.5 });
          ghostG.circle(land.x + 5 + s * k, land.y + 5 + s, 1.2).fill({ color: 0xffffff, alpha: 0.5 });
          ghostG.circle(land.x + 5, land.y + 5 + s * k, 1.2).fill({ color: 0xffffff, alpha: 0.5 });
          ghostG.circle(land.x + 5 + s, land.y + 5 + s * k, 1.2).fill({ color: 0xffffff, alpha: 0.5 });
        }
      }
    }

    let lastSync = -1;
    function sync() {
      lastSync = gt;
      const first = tickets[0];
      setPanel({
        next: feed[0]?.thai ?? null,
        tickets: tickets.slice(0, 2).map((t) => ({ id: t.id, en: t.en, roles: t.roles })),
        hideTicket: tier === 4 && !!first && gt - first.made > 4000,
        rows: rowsCleared,
        status,
      });
    }

    // ---- loop ----
    let wasPaused = false;
    const tick = () => {
      const a = apiRef.current;
      draw();
      if (a.paused || ended) {
        wasPaused = true;
        return;
      }
      if (wasPaused) {
        wasPaused = false;
        soft = false;
      }
      if (hold) return;
      const dt = app.ticker.deltaMS;
      gt += dt;
      if (!falling) {
        spawn();
        sync();
        return;
      }
      const g = geo();
      const speed = (1 / (ROW_MS / Math.max(0.4, a.pace.speed))) * (soft ? 8 : 1);
      falling.y += speed * dt;
      const floorTop = g.rows - 1 - cols[falling.col].length; // top-row index where it would rest
      if (falling.y >= floorTop) {
        falling.y = floorTop;
        land();
        sync();
      }
      if (tier === 4 && gt - lastSync > 500) sync();
    };
    app.ticker.add(tick);

    return () => {
      unfollow();
      destroyed = true;
      app.ticker.remove(tick);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      if (sound.getState().recording) sound.finishRecording(true);
    };
  }, []);

  const now = panel.tickets[0];
  const s = panel.status;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={host} style={{ position: 'relative', flex: 1, minHeight: 0 }} />
      {!playable && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(5,5,5,.9)', zIndex: 4 }}>
          <p className="body center" style={{ maxWidth: '38ch' }}>
            Last Orders needs the counting pattern (ขอ, an item, a number, its classifier) or the ไหม question pattern, with their words. Meet them first.
          </p>
        </div>
      )}
      <div style={{ padding: '10px var(--gutter) calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--rule)' }}>
        {/* every line of the bar is one fixed line, so the board above never resizes */}
        {device === 'phone' && (
          <>
            <div className="hrow between" style={{ alignItems: 'baseline' }}>
              <div className="label">Ticket</div>
              <div className="label" lang="th" style={{ whiteSpace: 'nowrap' }}>Next {panel.next ?? ''}</div>
            </div>
            <FitText className="h-s" min={12} style={{ margin: '4px 0 8px' }}>{now ? (panel.hideTicket ? 'Hidden. You read it.' : now.en) : '...'}</FitText>
            {api.tier < 4 && <div style={{ height: 26, overflow: 'hidden' }}>{now && <RoleChips roles={now.roles} />}</div>}
          </>
        )}
        <FitText className={`small ${s.kind === 'right' ? 'good' : s.kind === 'wrong' ? 'bad' : ''}`} lang="th" min={9} style={{ marginTop: 8 }}>
          {s.text}
        </FitText>
      </div>
    </div>
  );
}
