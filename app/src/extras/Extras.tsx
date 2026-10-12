// Extras: the shelf for tools beside the course (the first is The Tapes).

import { Link } from '../app/router';
import { Label, Screen, TopBar } from '../ui/kit';
import { EXTRAS } from './registry';
import './extras.css';

export default function Extras() {
  return (
    <Screen top={<TopBar mid="Extras" parent="/library" />} narrow className="extras">
      <div className="page-head" style={{ marginBottom: 20 }}>
        <Label>Outside the course</Label>
        <h1 className="h-page">Extras</h1>
        <p className="body" style={{ margin: 0 }}>
          Tools that sit beside Phi rather than inside it. Nothing here changes your plan, progress, readiness or daily minutes.
        </p>
      </div>
      <div className="rows-end">
        {EXTRAS.map((x) => (
          <Link key={x.to} to={x.to} className="extra-row" style={{ textDecoration: 'none' }}>
            <span className="extra-head">
              <span className="h-s">{x.title}</span>
              <span className="small">{x.note}</span>
            </span>
            <span className="body extra-about">{x.about}</span>
          </Link>
        ))}
      </div>
      <p className="small" style={{ marginTop: 16 }}>More to come.</p>
    </Screen>
  );
}
