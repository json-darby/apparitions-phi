import { describe, expect, it } from 'vitest';
import { nextFaceColour, setFaceTint, tinted } from './tint';

describe('face colour', () => {
  it('draws in the chosen colour, or the face’s own', () => {
    setFaceTint('own');
    expect(tinted('#123456')).toBe('#123456');
    setFaceTint('jade');
    expect(tinted('#123456')).toBe('#5FE0A8');
    setFaceTint('nonsense' as never);
    expect(tinted('#123456')).toBe('#123456');
  });

  it('a double-tap always shows a different colour, then comes back round', () => {
    expect(nextFaceColour('own', '#2E9BFF')).toBe('amber');
    expect(nextFaceColour('rose', '#2E9BFF')).toBe('moon');
    expect(nextFaceColour('moon', '#2E9BFF')).toBe('own');
    // on a face whose own colour is moonlight, "their own" looks the same as moonlight, so it is skipped
    expect(nextFaceColour('rose', '#E8E8E8')).toBe('moon');
    expect(nextFaceColour('moon', '#e8e8e8')).toBe('amber');
    expect(nextFaceColour('own', '#e8e8e8')).toBe('amber');
  });
});
