// The school file, fetched once per app run and shared by every screen, with
// the custom sections saved on this device added under "Mine".

import { useEffect, useMemo, useState } from 'react';
import { useApp, useStoreVersion } from '../app/context';
import { fetchSchool, type SchoolFile } from './content';
import { loadCustom, withCustom, type CustomRecord } from './custom';

let cached: SchoolFile | null = null;
let loading: Promise<SchoolFile | null> | null = null;

/** The built-in file alone. undefined while loading, null when the file could not be read. */
export function useSchoolFile(): SchoolFile | null | undefined {
  const [file, setFile] = useState<SchoolFile | null | undefined>(cached ?? undefined);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    loading ??= fetchSchool().then((f) => {
      cached = f;
      if (!f) loading = null;
      return f;
    });
    void loading.then((f) => alive && setFile(f));
    return () => {
      alive = false;
    };
  }, []);
  return file;
}

/** The file with your custom sections (18+ ones only with 18+ on). undefined while loading, null when unreadable. */
export function useSchool(): SchoolFile | null | undefined {
  const file = useSchoolFile();
  const { store, settings } = useApp();
  const v = useStoreVersion();
  // a lesson writes to the store on every turn: keep the same file unless the custom sections changed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const raw = useMemo(() => JSON.stringify(loadCustom(store)), [store, v]);
  const records = useMemo(() => JSON.parse(raw) as CustomRecord[], [raw]);
  return useMemo(() => (file ? withCustom(file, records, settings.adult) : file), [file, records, settings.adult]);
}
