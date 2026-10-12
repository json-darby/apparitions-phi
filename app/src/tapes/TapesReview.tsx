// The old quick review is now the flashcards: the old link opens them.

import { useEffect } from 'react';
import { navigate } from '../app/router';

export default function TapesReview() {
  useEffect(() => navigate('/tapes/cards', true), []);
  return null;
}
