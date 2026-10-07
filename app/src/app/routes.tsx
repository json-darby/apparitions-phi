// Every screen in the app. Screens load on demand so the drills' game engine is
// only fetched when a drill opens (it is still cached for offline use).

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Screen = LazyExoticComponent<ComponentType<{ params: Record<string, string> }>>;

const L = (f: () => Promise<{ default: ComponentType<any> }>) => lazy(f) as Screen;

export const ROUTES: { path: string; screen: Screen; block?: string; chrome?: 'none' }[] = [
  { path: '/', screen: L(() => import('../screens/Today')) },
  { path: '/welcome', screen: L(() => import('../screens/Welcome')), chrome: 'none' },
  { path: '/primer', screen: L(() => import('../primer/Primer')), chrome: 'none' },
  { path: '/lesson', screen: L(() => import('../screens/Lesson')) },
  { path: '/progress', screen: L(() => import('../screens/Progress')) },
  { path: '/readiness', screen: L(() => import('../screens/Readiness')) },
  { path: '/library', screen: L(() => import('../screens/Library')) },
  { path: '/settings', screen: L(() => import('../screens/Settings')) },

  // Learn
  { path: '/review', screen: L(() => import('../screens/learn/Review')), block: 'review' },
  { path: '/new', screen: L(() => import('../screens/learn/NewItems')), block: 'new' },
  { path: '/listen', screen: L(() => import('../screens/learn/ListenRepeat')), block: 'new' },
  { path: '/tone-pairs', screen: L(() => import('../screens/learn/TonePairs')), block: 'tonelab' },
  { path: '/sentence', screen: L(() => import('../screens/learn/SentenceBuilder')), block: 'new' },
  { path: '/writing', screen: L(() => import('../screens/learn/WritingStudio')), block: 'writing' },
  { path: '/writing/paper', screen: L(() => import('../screens/learn/PaperPractice')), block: 'writing' },
  { path: '/writing/author', screen: L(() => import('../screens/learn/StrokeAuthor')) },
  { path: '/culture', screen: L(() => import('../screens/learn/CultureNote')), block: 'culture' },
  { path: '/checkpoint', screen: L(() => import('../screens/learn/Checkpoint')), block: 'review' },

  // Drills
  { path: '/drill/night-market', screen: L(() => import('../games/NightMarket')), block: 'drill', chrome: 'none' },
  { path: '/drill/heat-check', screen: L(() => import('../games/HeatCheck')), block: 'drill', chrome: 'none' },
  { path: '/drill/last-orders', screen: L(() => import('../games/LastOrders')), block: 'drill', chrome: 'none' },
  { path: '/drill/ink-run', screen: L(() => import('../games/InkRun')), block: 'drill', chrome: 'none' },
  { path: '/drill/tone-climb', screen: L(() => import('../games/ToneClimb')), block: 'drill', chrome: 'none' },

  // The Street
  { path: '/street', screen: L(() => import('../street/Street')), block: 'street', chrome: 'none' },
  { path: '/street/talk/:task', screen: L(() => import('../street/Talk')), block: 'street' },
  { path: '/street/meters-running', screen: L(() => import('../street/MetersRunning')), block: 'street', chrome: 'none' },
  { path: '/street/after-hours', screen: L(() => import('../street/AfterHours')), block: 'street' },
  { path: '/street/door-to-door', screen: L(() => import('../street/DoorToDoor')), block: 'street' },
  { path: '/cast', screen: L(() => import('../street/Cast')) },

  // School of the Night
  { path: '/school', screen: L(() => import('../school/SchoolMap')), block: 'school' },
  { path: '/school/section/:id', screen: L(() => import('../school/SchoolSection')), block: 'school' },
  { path: '/school/lesson', screen: L(() => import('../school/SchoolLesson')), block: 'school' },
  { path: '/school/custom', screen: L(() => import('../school/SchoolCustom')), block: 'school' },

  // Animations
  { path: '/anim', screen: L(() => import('../anim/Catalogue')) },
];
