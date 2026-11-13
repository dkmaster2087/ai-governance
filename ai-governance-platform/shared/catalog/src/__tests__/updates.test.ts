import {
  BUILT_IN_SEQUENCE, CATALOG, CatalogData, CatalogDataError, builtInCatalogData, catalogInfo, catalogVersion, onCatalogChange,
  resetCatalog, serviceById, serviceForAppName, serviceForDomain, setCatalog,
} from '..';

const NEXT = BUILT_IN_SEQUENCE + 3600;
const withNew = (sequence = NEXT): CatalogData => {
  const data = builtInCatalogData(sequence, '2099-01-01.0000');
  data.services.push({ id: 'new-chat', name: 'New Chat', vendor: 'Newco', category: 'chat', businessTerms: 'unknown', domains: ['newchat.example'], appNames: ['new chat'], url: 'https://newchat.example' });
  return data;
};

describe('catalog updates', () => {
  afterEach(() => resetCatalog());

  it('starts with the built-in list', () => {
    expect(catalogInfo()).toMatchObject({ source: 'built-in', sequence: BUILT_IN_SEQUENCE, services: CATALOG.length });
  });

  it('applies a newer catalog to every lookup, keeps the same array, and tells listeners', () => {
    const same = CATALOG;
    let changes = 0;
    const stop = onCatalogChange(() => changes++);
    expect(setCatalog(withNew(), 'feed')).toBe(true);
    stop();
    expect(CATALOG).toBe(same);
    expect(serviceForDomain('app.newchat.example')?.id).toBe('new-chat');
    expect(serviceById('new-chat')?.name).toBe('New Chat');
    expect(serviceForAppName('New Chat (prod)')?.id).toBe('new-chat');
    expect(serviceForDomain('bedrock-runtime.us-east-1.amazonaws.com')?.id).toBe('aws-bedrock');
    expect(catalogVersion()).toBe('2099-01-01.0000');
    expect(catalogInfo().source).toBe('feed');
    expect(changes).toBe(1);
  });

  it('never applies a catalog that is not newer than the one in use', () => {
    expect(setCatalog(withNew(BUILT_IN_SEQUENCE), 'feed')).toBe(false);
    expect(setCatalog(withNew(NEXT), 'feed')).toBe(true);
    const older = builtInCatalogData(NEXT - 1, 'older');
    expect(setCatalog(older, 'upload')).toBe(false);
    expect(serviceById('new-chat')).toBeDefined();
  });

  it('refuses malformed catalogs without changing anything', () => {
    const bad = (mutate: (d: CatalogData) => void) => { const d = withNew(); mutate(d); return () => setCatalog(d, 'feed'); };
    expect(bad((d) => { d.services[0].domains = ['not a domain'] })).toThrow(CatalogDataError);
    expect(bad((d) => { d.services.push({ ...d.services[0] }); })).toThrow(/appears twice/);
    expect(bad((d) => { d.services.find((s) => s.id === 'aws-bedrock')!.patterns = ['bedrock'] })).toThrow(/anchored/);
    expect(bad((d) => { (d.services[0] as { category: string }).category = 'other'; })).toThrow(/category/);
    expect(bad((d) => { d.services[0].url = 'http://x.example'; })).toThrow(/https/);
    expect(bad((d) => { d.version = 'x'.repeat(21); })).toThrow(/20 characters/);
    expect(catalogInfo().source).toBe('built-in');
  });

  it('keeps only advisories about services in the catalog', () => {
    const d = withNew();
    d.advisories = [
      { id: 'a1', serviceId: 'new-chat', severity: 'warning', title: 'Now trains on your data', detail: 'Terms changed.', publishedAt: '2099-01-01T00:00:00Z' },
      { id: 'a2', serviceId: 'nobody', severity: 'critical', title: 'x', detail: 'x', publishedAt: '2099-01-01T00:00:00Z' },
    ];
    setCatalog(d, 'feed');
    expect(catalogInfo().advisories.map((a) => a.id)).toEqual(['a1']);
  });
});
