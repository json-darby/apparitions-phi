// Tone Climb: the Pixi tower. Floors of five platforms, each platform drawn as
// a tone contour in glowing dots. The player stands on a platform; the tide
// rises from below. Only state changes move anything: a jump, a camera step
// after it, and a crumbling platform. With reduced motion these snap.

import { Container, Graphics, Text, type Application } from 'pixi.js';
import { toneShape, TONE_LABEL } from '../../audio/sound';
import type { Tone } from '../../content/types';
import { UI_FONT } from '../shared/pixi';
import { TONE_HEX } from './climb-contour';

export const LANES = 5;
export const METRES_PER_FLOOR = 5;
export const CHECKPOINT_FLOORS = 10;
const DOTS = 15;
const MAX_TOWER_W = 520;

interface Layout {
  W: number;
  H: number;
  x0: number;
  w: number;
  laneW: number;
  top: number;
  bottom: number;
  gap: number;
  baseY: number;
  amp: number;
}

interface FloorView {
  c: Container;
  plats: Graphics[];
  reveal: Text | null;
}

interface Tween {
  t: number;
  dur: number;
  step: (k: number) => void;
  done?: () => void;
}

export class ClimbScene {
  /** floor index -> five tones by lane; floor 0 is the ground */
  floors: (Tone[] | null)[] = [null];
  cur = 0;
  lane = 2;
  /** distance from the current floor down to the tide, in floors */
  tide = 1.8;
  /** the tide at this distance sits at the bottom of the tower */
  tideMax = 2.4;
  /** height of the HTML controls over the bottom of the canvas */
  bottomInset = 170;

  private world = new Container();
  private tideG = new Graphics();
  private tideLabel: Text;
  private player = new Graphics();
  private views = new Map<number, FloorView>();
  private tweens: Tween[] = [];
  private cam = 0;
  private px = 0;
  private py = 0;
  private L: Layout | null = null;
  private sizeKey = '';

  constructor(private app: Application, private reduced: boolean) {
    app.stage.addChild(this.world, this.tideG);
    this.tideLabel = new Text({
      text: 'THE TIDE',
      style: { fontFamily: UI_FONT, fontSize: 10, fontWeight: '600', letterSpacing: 2, fill: 0xff3c96 },
    });
    this.tideLabel.anchor.set(1, 1);
    app.stage.addChild(this.tideLabel);
    this.drawPlayer();
    this.world.addChild(this.player);
  }

  // ---------- geometry ----------

  private layout(): Layout {
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    const key = `${W}x${H}x${this.bottomInset}`;
    if (this.L && key === this.sizeKey) return this.L;
    const w = Math.min(W - 24, MAX_TOWER_W);
    const x0 = (W - w) / 2;
    const top = 8;
    const bottom = Math.max(top + 160, H - this.bottomInset);
    const towerH = bottom - top;
    const gap = Math.max(70, Math.min(170, towerH / 3.1));
    const baseY = bottom - gap * 0.62;
    const amp = Math.min(gap * 0.42, 54);
    this.L = { W, H, x0, w, laneW: w / LANES, top, bottom, gap, baseY, amp };
    this.sizeKey = key;
    // rebuild every floor at the new size
    for (const [f] of this.views) this.dropView(f);
    this.placePlayer();
    return this.L;
  }

  laneX(lane: number): number {
    const L = this.layout();
    return L.x0 + L.laneW * (lane + 0.5);
  }

  /** contour offset at the middle of a platform (where the player stands) */
  private midOffset(f: number, lane: number): number {
    const tones = this.floors[f];
    if (!tones) return 0;
    const v = toneShape(tones[lane], DOTS)[Math.floor(DOTS / 2)];
    return -(v - 0.5) * this.layout().amp;
  }

  private floorWorldY(f: number): number {
    return -f * this.layout().gap;
  }

  /** layer pixels for a platform's middle, for the hit burst */
  platformScreen(f: number, lane: number): { x: number; y: number } {
    const L = this.layout();
    return { x: this.laneX(lane), y: L.baseY + this.cam * L.gap + this.floorWorldY(f) + this.midOffset(f, lane) };
  }

  /** lane under a point in layer pixels, or null outside the tower */
  laneAt(x: number, y: number): number | null {
    const L = this.layout();
    if (x < L.x0 || x > L.x0 + L.w || y > L.bottom) return null;
    return Math.max(0, Math.min(LANES - 1, Math.floor((x - L.x0) / L.laneW)));
  }

  // ---------- drawing ----------

  private drawPlayer() {
    const g = this.player;
    g.clear();
    // a small figure of dots, feet at 0,0
    g.circle(0, -20, 15).fill({ color: 0xffffff, alpha: 0.06 });
    g.circle(0, -30, 4.5).fill({ color: 0xffffff, alpha: 1 });
    for (let i = 0; i < 4; i++) g.circle(0, -23 + i * 3.6, 1.9).fill({ color: 0xffffff, alpha: 0.95 });
    for (const [x, y] of [[-3, -3], [3, -3], [-4.5, 0], [4.5, 0], [-4, -19], [4, -19], [-6.5, -15], [6.5, -15]]) {
      g.circle(x, y, 1.6).fill({ color: 0xffffff, alpha: 0.9 });
    }
  }

  private buildView(f: number): FloorView {
    const L = this.layout();
    const c = new Container();
    c.y = this.floorWorldY(f);
    const tones = this.floors[f];
    const plats: Graphics[] = [];
    if (!tones) {
      // the ground: a flat line of dots across the tower
      const g = new Graphics();
      const n = Math.round(L.w / 9);
      for (let i = 0; i <= n; i++) g.circle(L.x0 + (L.w * i) / n, 0, 1.6).fill({ color: 0xe8e8e8, alpha: 0.45 });
      c.addChild(g);
    } else {
      for (let lane = 0; lane < LANES; lane++) {
        const g = new Graphics();
        const tone = tones[lane];
        const pts = toneShape(tone, DOTS);
        const cx = L.x0 + L.laneW * (lane + 0.5);
        const pw = L.laneW * 0.78;
        const col = TONE_HEX[tone];
        pts.forEach((v, i) => {
          const x = cx - pw / 2 + (pw * i) / (DOTS - 1);
          const y = -(v - 0.5) * L.amp;
          g.circle(x, y, 6).fill({ color: col, alpha: 0.12 });
          g.circle(x, y, 2.3).fill({ color: col, alpha: 1 });
        });
        c.addChild(g);
        plats.push(g);
      }
    }
    if (f > 0 && f % CHECKPOINT_FLOORS === 0) {
      const g = new Graphics();
      const y = -L.amp * 0.5 - 22;
      for (let x = L.x0; x < L.x0 + L.w; x += 12) g.moveTo(x, y).lineTo(Math.min(x + 6, L.x0 + L.w), y);
      g.stroke({ width: 1, color: 0x2ee6e6, alpha: 0.6 });
      const t = new Text({
        text: `CHECKPOINT · ${f * METRES_PER_FLOOR} M`,
        style: { fontFamily: UI_FONT, fontSize: 10, fontWeight: '600', letterSpacing: 2, fill: 0x2ee6e6 },
      });
      t.x = L.x0;
      t.y = y - 16;
      c.addChild(g, t);
    }
    this.world.addChildAt(c, 0);
    const v = { c, plats, reveal: null };
    this.views.set(f, v);
    return v;
  }

  private dropView(f: number) {
    const v = this.views.get(f);
    if (!v) return;
    v.c.destroy({ children: true });
    this.views.delete(f);
  }

  /** Throw away and redraw a floor (after its lanes change). */
  refreshFloor(f: number) {
    this.dropView(f);
  }

  private placePlayer() {
    this.px = this.laneX(this.lane);
    this.py = this.floorWorldY(this.cur) + this.midOffset(this.cur, this.lane);
  }

  // ---------- events ----------

  /** Jump to a lane on the floor above, then step the camera up. */
  jump(lane: number, done: () => void) {
    const L = this.layout();
    const to = this.cur + 1;
    const fx = this.px;
    const fy = this.py;
    const tx = this.laneX(lane);
    const ty = this.floorWorldY(to) + this.midOffset(to, lane);
    const finish = () => {
      this.cur = to;
      this.lane = lane;
      this.placePlayer();
      const c0 = this.cam;
      this.tween(this.reduced ? 0 : 260, (k) => (this.cam = c0 + (to - c0) * ease(k)), done);
    };
    this.tween(this.reduced ? 0 : 300, (k) => {
      this.px = fx + (tx - fx) * k;
      this.py = fy + (ty - fy) * k - Math.sin(Math.PI * k) * L.gap * 0.3;
    }, finish);
  }

  /** A wrong landing: the chosen platform crumbles, the right one is named. */
  crumble(f: number, lane: number, rightLane: number) {
    const v = this.views.get(f) ?? this.buildView(f);
    const g = v.plats[lane];
    if (g) this.tween(this.reduced ? 0 : 320, (k) => (g.alpha = 1 - 0.85 * k));
    const tones = this.floors[f];
    if (tones) {
      const L = this.layout();
      const t = new Text({
        text: TONE_LABEL[tones[rightLane]].toUpperCase(),
        style: { fontFamily: UI_FONT, fontSize: 11, fontWeight: '700', letterSpacing: 2, fill: TONE_HEX[tones[rightLane]] },
      });
      t.anchor.set(0.5, 0);
      t.x = this.laneX(rightLane);
      t.y = L.amp * 0.5 + 10;
      v.c.addChild(t);
      v.reveal = t;
    }
  }

  /** Put a crumbled floor back. */
  restore(f: number) {
    const v = this.views.get(f);
    if (!v) return;
    for (const g of v.plats) g.alpha = 1;
    v.reveal?.destroy();
    v.reveal = null;
  }

  private tween(dur: number, step: (k: number) => void, done?: () => void) {
    if (dur <= 0) {
      step(1);
      done?.();
      return;
    }
    this.tweens.push({ t: 0, dur, step, done });
  }

  // ---------- frame ----------

  update(dtMs: number) {
    const L = this.layout();
    // tweens
    const live: Tween[] = [];
    const finished: Tween[] = [];
    for (const tw of this.tweens) {
      tw.t += dtMs;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      (k >= 1 ? finished : live).push(tw);
    }
    this.tweens = live;
    for (const tw of finished) tw.done?.();

    this.world.y = L.baseY + this.cam * L.gap;
    // floors in view
    const lo = this.cur - 1;
    const hi = this.cur + 3;
    for (const [f] of this.views) if (f < lo || f > hi) this.dropView(f);
    for (let f = Math.max(0, lo); f <= hi; f++) {
      if (f >= this.floors.length) continue;
      const v = this.views.get(f) ?? this.buildView(f);
      const sy = this.world.y + v.c.y;
      v.c.visible = sy < L.bottom + 6 && sy > -L.gap;
      v.c.alpha = f === this.cur + 1 ? 1 : f === this.cur ? 0.75 : 0.3;
    }
    this.player.x = this.px;
    this.player.y = this.py;

    // the tide
    // drawn to scale between the player's floor and the bottom of the tower
    const fy = this.world.y + this.floorWorldY(this.cur);
    const ty = Math.min(L.bottom, fy + (Math.max(0, this.tide) / this.tideMax) * Math.max(0, L.bottom - fy));
    const g = this.tideG;
    g.clear();
    if (ty < L.bottom) g.rect(L.x0 - 12, ty, L.w + 24, L.bottom - ty).fill({ color: 0xff3c96, alpha: 0.07 });
    for (let x = L.x0 - 12; x < L.x0 + L.w + 12; x += 10) g.moveTo(x, ty).lineTo(x + 5, ty);
    g.stroke({ width: 1, color: 0xff3c96, alpha: 0.75 });
    this.tideLabel.x = L.x0 + L.w;
    this.tideLabel.y = ty - 4;
  }

  destroy() {
    this.tweens = [];
    for (const [f] of this.views) this.dropView(f);
  }
}

function ease(k: number) {
  return 1 - (1 - k) * (1 - k);
}
