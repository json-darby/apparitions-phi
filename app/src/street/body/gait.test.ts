import { describe, expect, it } from 'vitest';
import { Gait, phaseAtDistance, progressTable } from './gait';
import { FRAME, footContactX, J, Pose, walkPose } from './skeleton';
import { WALKS } from './walkData';

const H = 131; // a 1.73 m person in street px

for (const who of ['m', 'f'] as const) {
  const clip = WALKS[who];
  const frame = FRAME[who];

  describe(`walk ${who}`, () => {
    it('travels a believable stride per cycle, and phase and distance invert each other', () => {
      const t = progressTable(clip, frame);
      const stride = t[t.length - 1];
      // two steps of an adult: 1.2 to 1.7 m for 1.73 m
      expect(stride * 1.73).toBeGreaterThan(1.1);
      expect(stride * 1.73).toBeLessThan(1.8);
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
      for (const ph of [0, 0.1, 0.37, 0.5, 0.81, 1.25, 2.6]) {
        const d = Math.floor(ph) * stride + t[Math.round((ph % 1) * (t.length - 1))];
        expect(phaseAtDistance(t, d)).toBeCloseTo(Math.round(ph * (t.length - 1)) / (t.length - 1), 2);
      }
    });

    it('keeps the foot that bears weight still on the floor while walking at a steady pace', () => {
      const g = new Gait(clip, frame, 500);
      const dt = 1 / 60;
      for (let i = 0; i < 240; i++) g.update(dt, 1, H, false); // get up to full stride
      let lastR: number | null = null;
      let worst = 0;
      let moved = 0;
      const x0 = g.x;
      for (let i = 0; i < 600; i++) {
        g.update(dt, 1, H, false);
        const p = g.pose;
        // world x of the right foot's contact point, while it carries all the weight
        const fx = g.x + footContactX(p, true) * H;
        const planted = p.wR > 0.6; // bearing weight, including double support
        if (planted && lastR != null) worst = Math.max(worst, Math.abs(fx - lastR));
        lastR = planted ? fx : null;
        moved = g.x - x0;
      }
      expect(moved).toBeGreaterThan(0);
      // pinned: no slide at all while it bears weight
      expect(worst).toBeLessThan(0.01);
      // the speed matches stride x cadence
      const v = moved / (600 * dt);
      expect(v).toBeCloseTo((g.stride * H) / clip.period, -1);
    });

    it('stops within about a step, feet together, and never moves backward', () => {
      const g = new Gait(clip, frame, 500);
      const dt = 1 / 60;
      for (let i = 0; i < 300; i++) g.update(dt, 1, H, false);
      const at = g.x;
      let last = g.x;
      for (let i = 0; i < 180; i++) {
        g.update(dt, 0, H, false);
        expect(g.x).toBeGreaterThanOrEqual(last - 1e-9);
        last = g.x;
      }
      expect(g.standing).toBe(true);
      expect(g.x - at).toBeLessThan(g.stride * H * 0.75);
      // standing: both feet down and level
      const p = g.pose;
      expect(Math.abs(p.p[J.ankleR * 3 + 1] - p.p[J.ankleL * 3 + 1])).toBeLessThan(0.01);
      // feet stay where they landed: together or a short natural stagger, never a stride apart
      expect(Math.abs(p.p[J.ankleR * 3] - p.p[J.ankleL * 3])).toBeLessThan(0.12);
    });

    it('turns round from a stand only, then walks the other way', () => {
      const g = new Gait(clip, frame, 500);
      const dt = 1 / 60;
      for (let i = 0; i < 120; i++) g.update(dt, 1, H, false);
      const x1 = g.x;
      for (let i = 0; i < 300; i++) g.update(dt, -1, H, false);
      expect(g.dir).toBe(-1);
      expect(g.x).toBeLessThan(x1);
      expect(Math.abs(g.theta - Math.PI)).toBeLessThan(0.05);
    });

    it('puts a foot on the floor in every pose', () => {
      const p = new Pose();
      for (let i = 0; i < 64; i++) {
        walkPose(clip, frame, { phase: i / 64, aR: 1, aL: 1, aU: 1 }, p);
        const lows = [J.heelR, J.toeR, J.heelL, J.toeL].map((j) => p.p[j * 3 + 1]);
        expect(Math.min(...lows)).toBeGreaterThan(-0.012);
        expect(Math.min(...lows)).toBeLessThan(0.012);
      }
    });
  });
}
