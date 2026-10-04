// Ink Run: the Pixi letter rain. Each drop is a ring of glowing dots that
// falls toward the line. A drop shows its letter when the round lets you see
// it (tier 1 drawing), otherwise only once it is answered or lands.

import { Container, Graphics, Text, type Application } from 'pixi.js';
import type { Letter } from '../../content/types';
import { THAI_FONT, UI_FONT } from '../shared/pixi';

export type DropState = 'fall' | 'hit' | 'miss' | 'gone';

export interface Drop {
  id: number;
  letter: Letter;
  /** 0..1 across the rain */
  x: number;
  /** 0..1 from the top to the line */
  p: number;
  state: DropState;
  /** this is the drop whose name was called */
  called: boolean;
  /** part of a look-alike round */
  pair: boolean;
  /** time since it was resolved, ms */
  since: number;
  /** answered wrongly at least once */
  tried: boolean;
}

interface DropView {
  c: Container;
  ring: Graphics;
  glyph: Text;
  look: string;
}

const RING = 30;
const LINE_PAD = 26;

export class RainScene {
  private views = new Map<number, DropView>();
  private line = new Graphics();
  private lineLabel: Text;
  private sizeKey = '';

  constructor(private app: Application, private reduced: boolean) {
    this.lineLabel = new Text({
      text: 'HOLD THE LINE',
      style: { fontFamily: UI_FONT, fontSize: 10, fontWeight: '600', letterSpacing: 2.2, fill: 0xff5a4f },
    });
    this.lineLabel.anchor.set(0, 1);
    app.stage.addChild(this.line, this.lineLabel);
  }

  get lineY(): number {
    return this.app.screen.height - LINE_PAD;
  }

  /** layer pixels of a drop's centre */
  pos(d: Drop): { x: number; y: number } {
    const W = this.app.screen.width;
    const margin = Math.min(70, W * 0.12);
    const top = RING + 6;
    return { x: margin + d.x * (W - 2 * margin), y: top + d.p * (this.lineY - RING * 0.6 - top) };
  }

  private build(d: Drop): DropView {
    const c = new Container();
    const ring = new Graphics();
    const glyph = new Text({
      text: d.letter.char,
      style: { fontFamily: THAI_FONT, fontSize: 46, fontWeight: '600', fill: 0xf2f2f2 },
    });
    glyph.anchor.set(0.5, 0.56);
    c.addChild(ring, glyph);
    this.app.stage.addChild(c);
    const v = { c, ring, glyph, look: '' };
    this.views.set(d.id, v);
    return v;
  }

  private drawRing(v: DropView, d: Drop, seen: boolean) {
    const look = `${d.state}|${d.called}|${seen}|${d.tried}`;
    if (v.look === look) return;
    v.look = look;
    const g = v.ring;
    g.clear();
    v.glyph.style.fill = d.state === 'hit' ? 0x3ddc97 : d.state === 'miss' ? 0xff5a4f : 0xf2f2f2;
    const colour = d.state === 'hit' ? 0x3ddc97 : d.state === 'miss' ? 0xff5a4f : d.called && !seen ? 0x2e9bff : 0xe8e8e8;
    const bright = d.state !== 'fall' || (d.called && !seen) ? 1 : 0.55;
    g.circle(0, 0, RING + 4).fill({ color: colour, alpha: 0.05 });
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.circle(Math.cos(a) * RING, Math.sin(a) * RING, 1.8).fill({ color: colour, alpha: bright });
    }
    // a veiled drop carries a little ink inside instead of its letter
    if (!seen && d.state === 'fall') {
      let s = d.id * 9301 + 49297;
      for (let i = 0; i < 9; i++) {
        s = (s * 9301 + 49297) % 233280;
        const a = (s / 233280) * Math.PI * 2;
        s = (s * 9301 + 49297) % 233280;
        const r = (s / 233280) * RING * 0.6;
        g.circle(Math.cos(a) * r, Math.sin(a) * r, 1.5).fill({ color: colour, alpha: bright * 0.7 });
      }
    }
  }

  /** Draw the drops as they are now. seen: letters visible while falling. */
  sync(drops: Drop[], seen: boolean) {
    const W = this.app.screen.width;
    const key = `${W}x${this.app.screen.height}`;
    if (key !== this.sizeKey) {
      this.sizeKey = key;
      const g = this.line;
      g.clear();
      g.moveTo(0, this.lineY).lineTo(W, this.lineY).stroke({ width: 1, color: 0xff5a4f, alpha: 0.85 });
      this.lineLabel.x = 16;
      this.lineLabel.y = this.lineY - 6;
    }
    const live = new Set<number>();
    for (const d of drops) {
      if (d.state === 'gone') continue;
      live.add(d.id);
      const v = this.views.get(d.id) ?? this.build(d);
      const { x, y } = this.pos(d);
      v.c.x = x;
      v.c.y = y;
      this.drawRing(v, d, seen);
      const showGlyph = seen || d.state !== 'fall';
      v.glyph.visible = showGlyph;
      v.c.alpha = d.state === 'fall' ? 1 : this.reduced ? (d.since < 700 ? 1 : 0) : Math.max(0, 1 - d.since / 900);
    }
    for (const [id, v] of this.views) {
      if (live.has(id)) continue;
      v.c.destroy({ children: true });
      this.views.delete(id);
    }
  }

  destroy() {
    for (const [, v] of this.views) v.c.destroy({ children: true });
    this.views.clear();
  }
}
