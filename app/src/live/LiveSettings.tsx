// Settings → Talk live: where the live server is and the access code it wants.
// Both are kept on this device (kv `live_server`), so a phone or tablet can use
// the owner's Cloud Run server without a rebuild. "Test" asks the server's
// /health with the code. Without a server, conversations run scripted and
// offline, as they always do.

import { useState, type ReactNode } from 'react';
import { useApp } from '../app/context';
import { SectionHead } from '../ui/kit';
import { probeMessage, probeServer, serverReachable } from './client';
import { BUILD_SERVER_URL, bindLiveStore, normalizeServerUrl, saveLiveServer, savedLiveServer } from './serverConfig';

function Line({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="row" style={{ cursor: 'default', alignItems: 'center', flexWrap: 'wrap', rowGap: 10 }}>
      {/* on a phone a wide control drops below its words instead of squeezing them */}
      <span className="stack gap-1" style={{ minWidth: 0, flex: '1 1 190px' }}>
        <span>{title}</span>
        {note && <span className="small">{note}</span>}
      </span>
      <span style={{ flex: 'none' }}>{children}</span>
    </div>
  );
}

const FIELD = { width: 260, maxWidth: '100%' } as const;

export function LiveSettings() {
  const { store } = useApp();
  const [saved] = useState(() => {
    bindLiveStore(store);
    return savedLiveServer();
  });
  const [url, setUrl] = useState(saved?.url ?? '');
  const [code, setCode] = useState(saved?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  /** Save what is typed; false (and a message) when the address is not one. */
  const save = (): string | false => {
    const u = normalizeServerUrl(url);
    if (u == null) {
      setMsg({ text: 'That is not a web address. It looks like https://phi-server-….run.app', ok: false });
      return false;
    }
    bindLiveStore(store);
    saveLiveServer({ url: u, code });
    if (u !== url) setUrl(u);
    return u || BUILD_SERVER_URL;
  };

  const test = async () => {
    const base = save();
    if (base === false) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await probeServer(base, code.trim());
      setMsg({ text: probeMessage(p, base), ok: p.state === 'ok' && !!p.health?.live.available });
    } finally {
      setBusy(false);
    }
  };

  const shownDefault = serverReachable(BUILD_SERVER_URL) ? BUILD_SERVER_URL : 'https://…run.app';

  return (
    <>
      <SectionHead title="Talk live" note="Optional" />
      <p className="small" style={{ margin: '0 0 8px' }}>
        Without a server, the conversations run scripted and offline.
      </p>
      <Line title="Server address" note="The https address of your live server.">
        <input
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={url}
          placeholder={shownDefault}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => void save()}
          style={FIELD}
          aria-label="Live server address"
        />
      </Line>
      <Line title="Access code" note="The code set on the server. Kept on this device.">
        <input
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => void save()}
          style={FIELD}
          aria-label="Live server access code"
        />
      </Line>
      <Line title="Check the connection">
        <button className="pill small" type="button" disabled={busy} onClick={() => void test()}>
          {busy ? 'Testing…' : 'Test'}
        </button>
      </Line>
      {msg && (
        <p className="small" role="status" style={{ margin: '8px 0 0', overflowWrap: 'anywhere', ...(msg.ok ? { color: 'var(--fg-2)' } : {}) }}>
          {msg.text}
        </p>
      )}
    </>
  );
}
